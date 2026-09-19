/**
 * XR — canonical path identity (Phase 1 · the Windows root-cause fix).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The Windows hang historically tracked as a "known approvals flake" /
 * "win32 hang #21" / `test/phase2/approvals-durable.test.ts` exit 124 was NOT a
 * flake, not Bun, and not Defender. It was a synchronous SELF-DEADLOCK in the
 * store constructor, caused by two different path normalizations for the same
 * database file:
 *
 *     this.openedPath = path;            // raw      → keyed the MIGRATION LOCK
 *     this.sharedKey  = resolve(path);   // canonical → keyed the CONNECTION registry
 *
 * `withMigrationLock` guards re-entrancy with a map keyed on the string it is
 * handed. When the outer and inner calls receive different spellings, the inner
 * call treats itself as a foreign contender for a lock IT ALREADY HOLDS and
 * spins on `Atomics.wait` — blocking the single JS thread — until the 45 s
 * deadline. `evictIfDeadHolder` deliberately refuses to evict our own pid, so
 * there is no escape. The segment is then killed at exit 124.
 *
 * That divergence is routine on Windows (drive-letter case, separator style,
 * 8.3 short names, \\?\ long-path prefixes, and — already documented in this
 * repo's own CI workflow — `os.tmpdir()` disagreeing with git-bash `$TEMP` on
 * the Windows runner) and effectively impossible on Linux, which is exactly why
 * it reproduced only on win32 and looked probabilistic.
 *
 * The fix is identity, not tolerance: derive ONE canonical key per file and use
 * it for every lock and every registry.
 *
 * `realpathSync.native` resolves 8.3 short names and symlinks; on Windows it is
 * also case-normalizing on the drive letter. Lowercasing the whole path is then
 * correct because Windows filesystems are case-insensitive by default (and the
 * case-sensitive-opt-in flag is rare enough that a `win32`-only lowercase is the
 * right trade; see `canonicalDbKey` notes below).
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const IS_WINDOWS = process.platform === "win32";

/**
 * Canonicalize a filesystem path for use as an IDENTITY KEY (registry lookup,
 * lock naming). Never for display — `path` is still what users should see.
 *
 * Steps, in order:
 *   1. `resolve()`  → absolute, separators normalized, `..` collapsed.
 *   2. `realpath`   → resolve symlinks, 8.3 short names, and (on Windows) the
 *                     canonical case of each component. Best-effort: a path that
 *                     does not exist yet (fresh DB) keeps the resolve() result.
 *   3. lowercase on win32 only, because NTFS is case-insensitive by default so
 *      `C:\Data\xr.db` and `c:\data\XR.DB` are the SAME file.
 *
 * On POSIX no case folding happens: `/data/Xr.db` and `/data/xr.db` are two
 * different files and must stay two different keys.
 */
export function canonicalPathKey(p: string): string {
  let out = resolve(p);
  try {
    out = realpathSync.native(out);
  } catch {
    /* Not created yet (first run, fresh temp dir) — resolve() stands, and the
       deterministic parent resolution is enough to make two spellings agree. */
  }
  return IS_WINDOWS ? out.toLowerCase() : out;
}

/**
 * The single identity for a workspace/engine SQLite file.
 *
 * Used for BOTH `WorkspaceStore.sharedKey` (the max-1-connection registry) and
 * the `.migrate.lock` name, so the re-entrancy guard in `withMigrationLock` can
 * never fail to recognize its own lock. Kept as a named alias so call sites read
 * as intent ("this is the DB identity") rather than mechanics.
 */
export function canonicalDbKey(dbPath: string): string {
  return canonicalPathKey(dbPath);
}

/**
 * Absolute path to the lockfile for a database identity.
 * Takes the CANONICAL key so lock naming cannot drift from registry naming.
 */
export function migrationLockPath(canonicalDbPath: string): string {
  return `${canonicalDbPath}.migrate.lock`;
}

/** True when two spellings refer to the same file identity on this platform. */
export function sameFileIdentity(a: string, b: string): boolean {
  return canonicalPathKey(a) === canonicalPathKey(b);
}

/**
 * Normalize a workspace-relative path for comparison and storage.
 * Separate concern from identity keys: this is for user-facing file paths
 * (always forward slashes, no leading `./`), not for lock naming.
 */
export function normalizeRelativePath(p: string): string {
  const unified = p.replace(/\\/g, "/");
  const trimmed = unified.replace(/^\.\//, "");
  return trimmed.replace(/\/{2,}/g, "/");
}
