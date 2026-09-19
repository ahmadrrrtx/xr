/**
 * Cross-process exclusive lock around a whole migration run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 1 · SELF-DEADLOCK GUARD (Windows root-cause fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-entrancy is keyed on the `dbPath` STRING (`heldByThisProcess`). That makes
 * correctness depend on every caller passing a byte-identical spelling. When two
 * callers disagree — routine on Windows (drive case, separators, 8.3 short
 * names, \\?\ prefixes) — the nested acquire does not recognize its own lock and
 * blocks the single JS thread for the full wait deadline. The file used to warn
 * about this in a comment and then rely on nobody making the mistake:
 *
 *     "without this the nested acquire would wait on our own lockfile until the
 *      45 s deadline (self-deadlock)."
 *
 * Two independent defenses now stand in the way:
 *   1. THIS FUNCTION canonicalizes its own key at the entry point (see
 *      `canonicalDbKey()` in src/util/paths.ts), so callers cannot get it
 *      wrong; WorkspaceStore additionally keys its connection registry and the
 *      lockfile name off the same canonical identity.
 *   2. THIS FUNCTION detects a self-hold and THROWS instead of sleeping. A
 *      self-holder can never release while we block, so waiting is provably
 *      pointless: 45 s of frozen main thread is not an acceptable failure mode
 *      for a desktop app even when the lock is legitimately foreign.
 *
 * Defense (2) converts any future spelling divergence from a HANG into a fast,
 * actionable error — and the regression suite asserts it.
 *
 * The per-migration `BEGIN IMMEDIATE` + re-check design in migrations.ts
 * serializes the BOOKKEEPING, but it cannot stop a second process from
 * opening the database while the first is MID-LOOP: that opener sees a
 * partially applied schema (e.g. `context_items` without the `confidence`
 * column a later migration adds) and statements compiled against the
 * half-built shape fail with `no such column` — the CF-1 macOS failure. An
 * O_EXCL lockfile spanning the entire run closes that window: openers queue
 * on the lock, then observe the completed schema. A lock whose mtime is
 * older than the stale threshold is evicted, so a crashed holder cannot
 * wedge every future boot.
 */
import { O_CREAT, O_EXCL, O_WRONLY } from "node:constants";
import { canonicalDbKey } from "../util/paths.ts";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";

export class MigrationLockError extends Error {}

const MIGRATION_LOCK_STALE_MS = 20_000;
/** Announce a slow (but legitimate) wait so it is never a silent freeze. */
const MIGRATION_LOCK_SLOW_WARN_MS = 2_000;
const MIGRATION_LOCK_WAIT_MS = 45_000;

/** Nesting depth per dbPath for THIS process (see re-entrancy note in withMigrationLock). */
const heldByThisProcess = new Map<string, number>();

function sleepSync(ms: number): void {
  // Sync sleep: migration runs happen during store OPEN (constructor), where
  // the call sites are synchronous.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** true when `pid` is a live process we did not lose (EPERM = alive, not ours). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A holder that died mid-run (kill -9, OOM, power loss) leaves its lockfile
 * behind. The mtime-stale rule alone would make every opener wait the full
 * stale window — longer than the wait deadline — so waiters ALSO probe the
 * recorded pid: a dead holder's lock is evicted immediately. This is what
 * keeps the crash-injection suite (SIGKILL mid-migration) fast.
 */
/**
 * True when the lockfile records OUR OWN pid. A self-holder cannot release the
 * lock while this thread is blocked, so any wait is a guaranteed deadlock.
 *
 * `heldByThisProcess` catches the common case first (same string); this catches
 * the dangerous one — the same PROCESS holding the lock under a DIFFERENT
 * spelling, which is the Windows defect this guard exists for.
 */
function heldByThisProcessPid(lockPath: string): boolean {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const pid = Number.parseInt(raw.split(" ")[0] ?? "", 10);
    return Number.isFinite(pid) && pid === process.pid;
  } catch {
    return false;
  }
}

function evictIfDeadHolder(lockPath: string): boolean {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const pid = Number.parseInt(raw.split(" ")[0] ?? "", 10);
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
    if (pidAlive(pid)) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false; // unreadable/vanished — the outer loop re-checks
  }
}

export function withMigrationLock<T>(dbPath: string, fn: () => T): T {
  /**
   * Normalize HERE, at the single entry point, rather than trusting every call
   * site to remember. Re-entrancy is keyed on this string, so canonicalizing at
   * the boundary makes the class of bug structurally impossible: `xr.db`,
   * `./xr.db`, `X:\Xr.db` and `x:\xr.db` all address one lock.
   *
   * The caller-side canonical key (workspace-store) still matters — it is what
   * names the lockfile on disk — but the two can no longer disagree.
   */
  const key = canonicalDbKey(dbPath);

  // Per-process re-entrancy: the constructor holds the lock around the legacy
  // DDL block AND runMigrationsUp() (which locks again). Same-process nesting
  // is safe by construction — our own writes already serialize on the gate —
  // and without this the nested acquire would wait on our own lockfile until
  // the 45 s deadline (self-deadlock).
  const held = heldByThisProcess.get(key) ?? 0;
  if (held > 0) {
    heldByThisProcess.set(key, held + 1);
    try {
      return fn();
    } finally {
      heldByThisProcess.set(key, held);
    }
  }

  const lockPath = `${key}.migrate.lock`;
  const deadline = Date.now() + MIGRATION_LOCK_WAIT_MS;
  let fd = -1;
  let warnedSlow = false;
  for (;;) {
    try {
      fd = openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY);
      writeSync(fd, `${process.pid} ${Date.now()}\n`);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      // Self-hold under a different spelling: fail loud and fast rather than
      // freezing the thread for the whole deadline (see header).
      if (heldByThisProcessPid(lockPath)) {
        throw new MigrationLockError(
          `migration lock self-deadlock at ${lockPath}: this process already holds it ` +
            `(likely a non-canonical path spelling). Use canonicalDbKey() from src/util/paths.ts ` +
            `so the lock key and the connection-registry key agree.`,
        );
      }
      if (evictIfDeadHolder(lockPath)) continue;
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > MIGRATION_LOCK_STALE_MS;
      } catch {
        stale = false; // lock vanished under us — retry the create
      }
      if (stale) {
        try {
          unlinkSync(lockPath);
        } catch {
          /* raced with another evictor — next iteration re-checks */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new MigrationLockError(`timed out waiting for migration lock at ${lockPath}`);
      }
      // A silent multi-second freeze is unacceptable product behaviour even
      // when the holder is legitimately foreign. Announce it once.
      const waited = Date.now() - (deadline - MIGRATION_LOCK_WAIT_MS);
      if (!warnedSlow && waited > MIGRATION_LOCK_SLOW_WARN_MS) {
        warnedSlow = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[xr] waiting for migration lock at ${lockPath} (held by another process) — ${waited}ms so far`,
        );
      }
      sleepSync(25);
    }
  }
  heldByThisProcess.set(key, 1);
  try {
    return fn();
  } finally {
    heldByThisProcess.delete(key);
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* best effort */
    }
  }
}

