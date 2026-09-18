/**
 * Cross-process exclusive lock around a whole migration run.
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
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";

export class MigrationLockError extends Error {}

const MIGRATION_LOCK_STALE_MS = 20_000;
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
  // Per-process re-entrancy: the constructor holds the lock around the legacy
  // DDL block AND runMigrationsUp() (which locks again). Same-process nesting
  // is safe by construction — our own writes already serialize on the gate —
  // and without this the nested acquire would wait on our own lockfile until
  // the 45 s deadline (self-deadlock).
  const held = heldByThisProcess.get(dbPath) ?? 0;
  if (held > 0) {
    heldByThisProcess.set(dbPath, held + 1);
    try {
      return fn();
    } finally {
      heldByThisProcess.set(dbPath, held);
    }
  }

  const lockPath = `${dbPath}.migrate.lock`;
  const deadline = Date.now() + MIGRATION_LOCK_WAIT_MS;
  let fd = -1;
  for (;;) {
    try {
      fd = openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY);
      writeSync(fd, `${process.pid} ${Date.now()}\n`);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
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
      sleepSync(25);
    }
  }
  heldByThisProcess.set(dbPath, 1);
  try {
    return fn();
  } finally {
    heldByThisProcess.delete(dbPath);
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

