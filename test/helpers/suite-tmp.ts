/**
 * XR test-suite temp root (R-8 hygiene).
 *
 * The suite creates ~290 `mkdtempSync(join(tmpdir(), ...))` sites; on a small
 * tmpfs /tmp a full run used to leave ~220 MB of store/WAL dirs behind and
 * flake with SQLITE_FULL when the filesystem filled. Deleting the os tmpdir is
 * not an option, so instead the suite gets an owned root:
 *
 *   preload (bunfig.toml) → TMPDIR/TMP/TEMP := <tmpdir()/xr-suite-XXXXXX>
 *
 * `node:os tmpdir()` honors TMPDIR on POSIX and TMP/TEMP on Windows (verified
 * against Bun 1.3.14), and every test — including module-top `mkdtempSync`
 * calls and spawned CLI/MCP children (TMPDIR/TMP/TEMP are on the MCP safe-env
 * allow-list) — inherits it.
 *
 * Cleanup is layered because Bun's test runner ends the process WITHOUT
 * running `exit`/`beforeExit` JS hooks (probed empirically 2026-08-08):
 *   1. **Start-up sweep** (primary): removes `xr-suite-*` roots left by
 *      previous runs. Only roots older than GRACE_MS are touched, so two
 *      suites started within the grace window cannot delete each other; an
 *      actively-writing older run keeps its root's mtime fresh (its tests
 *      create direct children in the root throughout the run).
 *   2. **afterAll** (when the harness honors it from preload) and exit
 *      hooks (plain `bun run` paths) — best-effort, harmless if never fired.
 *
 * Escape hatch for debugging: `XR_TEST_TMP_KEEP=1 bun test` skips all
 * cleanup and prints the root path.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GRACE_MS = 120_000; // roots younger than this belong to plausibly-running suites
const ROOT_PREFIX = "xr-suite-";
const KEEP = process.env.XR_TEST_TMP_KEEP === "1";

const base = tmpdir();

// 1. Start-up sweep of stale roots from previous runs (the primary mechanism —
//    reliable even if the previous run was SIGKILLed).
if (!KEEP) {
  const now = Date.now();
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith(ROOT_PREFIX)) continue;
    try {
      if (now - statSync(join(base, entry)).mtimeMs > GRACE_MS) {
        rmSync(join(base, entry), { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
      }
    } catch {
      // Another suite may hold it; leave it for a later sweep.
    }
  }
}

// 2. Suite-owned root: everything the suite allocates through tmpdir() lands here.
const root = mkdtempSync(join(base, ROOT_PREFIX));

process.env.TMPDIR = root; // POSIX: node:os tmpdir() checks TMPDIR first
process.env.TMP = root; // Windows parity
process.env.TEMP = root; // Windows parity

if (KEEP) {
  console.log(`[suite-tmp] XR_TEST_TMP_KEEP=1 — suite temp root kept at ${root}`);
} else {
  const cleanup = (): void => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    } catch {
      // Best effort; a busy WAL or hard harness exit must not fail the run —
      // the next run's start-up sweep reclaims it.
    }
  };
  afterAll(cleanup); // honored when the harness runs preload-registered hooks
  process.on("exit", cleanup); // fires on plain `bun run` paths, not under `bun test`
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}
