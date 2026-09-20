/**
 * XR — migration-lock self-deadlock regression (Phase 1).
 *
 * Guards the Windows root cause: two different path spellings for the same
 * database file made `withMigrationLock` fail to recognize its own lock and
 * block the single JS thread for the full 45 s deadline (`Atomics.wait`), which
 * CI observed as exit 124 and filed as a "known approvals flake".
 *
 * These tests are written to FAIL on the pre-fix code:
 *   · the divergent-spelling case took ~45 s before and now takes milliseconds;
 *   · the self-hold case THREW nothing before (it spun) and now throws promptly.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, symlinkSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { canonicalPathKey, canonicalDbKey, sameFileIdentity, normalizeRelativePath } from "../../src/util/paths.ts";
import { withMigrationLock, MigrationLockError, isTransientLockCreateError } from "../../src/state/migration-lock.ts";

/**
 * Remove a DIRECTORY symlink without following it. POSIX: `unlink` is the
 * call. Windows: a directory symlink is a directory entry — `unlink` reports
 * EPERM and Bun's `rmSync(link, { force: true })` fails with EFAULT
 * (windows-latest, bun 1.3.14) — so `rmdir` on the link itself is the call.
 */
function removeDirLink(link: string): void {
  try {
    unlinkSync(link);
  } catch {
    try {
      rmdirSync(link);
    } catch {
      /* already gone */
    }
  }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xr-lockreg-"));
}

describe("canonicalPathKey — one identity per file", () => {
  test("collapses `..` and separator style on every platform", () => {
    const a = canonicalPathKey("/tmp/x/y/xr.db");
    const b = canonicalPathKey("/tmp/x/../x/y/xr.db");
    expect(a).toBe(b);
  });

  test("two spellings of the same real file share one identity", () => {
    const dir = tmp();
    try {
      const db = join(dir, "xr.db");
      writeFileSync(db, "");
      // Mixed separators + a redundant `..` segment: same file, two spellings.
      const alias = `${dir}/sub/..${process.platform === "win32" ? "\\" : "/"}xr.db`;
      expect(sameFileIdentity(db, alias)).toBe(true);
      expect(canonicalDbKey(db)).toBe(canonicalDbKey(alias));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("POSIX keeps case-sensitivity (two different files stay two keys)", () => {
    if (process.platform === "win32") return; // NTFS is case-insensitive by default
    expect(canonicalPathKey("/tmp/Data/Xr.db")).not.toBe(canonicalPathKey("/tmp/data/xr.db"));
  });

  test("win32 case folds, because NTFS case-insensitivity makes them one file", () => {
    if (process.platform !== "win32") return;
    expect(canonicalPathKey("C:\\Data\\Xr.db")).toBe(canonicalPathKey("c:\\data\\xr.db"));
  });

  test("a path that does not exist yet still canonicalizes deterministically", () => {
    const missing = join(tmpdir(), "xr-not-created-yet-xyz", "xr.db");
    const alias = join(tmpdir(), "xr-not-created-yet-xyz", ".", "sub", "..", "xr.db");
    expect(canonicalPathKey(missing)).toBe(canonicalPathKey(alias));
  });

  test("a file behind a symlinked directory has ONE key before and after it is created", () => {
    // macOS: tmpdir() is /var/folders/… → /private/var/folders/…. The store
    // computes the key before creating xr.db; a second opener computes it
    // after. Those two computations MUST agree or the max-1-writer registry
    // opens a second read-write connection to the same file.
    const real = tmp();
    const link = `${real}-link`;
    try {
      try {
        symlinkSync(real, link, "dir");
      } catch {
        return; // no symlink privilege on this runner (Windows without dev mode) — nothing to prove here
      }
      const viaLink = join(link, "nested", "xr.db");
      const before = canonicalPathKey(viaLink);
      mkdirSync(join(real, "nested"));
      writeFileSync(join(real, "nested", "xr.db"), "");
      const after = canonicalPathKey(viaLink);
      expect(before).toBe(after);
      // …and it is the same identity as the un-linked spelling.
      expect(after).toBe(canonicalPathKey(join(real, "nested", "xr.db")));
    } finally {
      removeDirLink(link);
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("withMigrationLock — re-entrancy is keyed on identity, not spelling", () => {
  test("nested acquire under a DIFFERENT spelling does not self-deadlock", () => {
    const dir = tmp();
    try {
      const db = join(dir, "xr.db");
      const canonical = canonicalDbKey(db);
      const started = Date.now();

      // Outer acquires on the canonical key; the inner call hands in a
      // divergent-but-equivalent spelling. Pre-fix this blocked ~45 s.
      const result = withMigrationLock(canonical, () =>
        withMigrationLock(`${dir}/./xr.db`, () => "ok"),
      );

      const elapsed = Date.now() - started;
      // The inner call canonicalizes to the same string, so re-entrancy fires.
      expect(result).toBe("ok");
      expect(elapsed).toBeLessThan(2_000);
      expect(elapsed).toBeLessThan(45_000); // the pre-fix bound, stated explicitly
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the same string nests freely and fast", () => {
    const dir = tmp();
    try {
      const key = canonicalDbKey(join(dir, "xr.db"));
      const started = Date.now();
      expect(withMigrationLock(key, () => withMigrationLock(key, () => 42))).toBe(42);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a self-hold under a FOREIGN key THROWS instead of freezing 45 s", () => {
    const dir = tmp();
    try {
      // Simulate the exact dangerous state: our own pid recorded in a lockfile
      // whose key this process is not tracking in `heldByThisProcess`.
      const foreignKey = resolve(dir, "spelled-differently", "xr.db");
      const lockPath = `${foreignKey}.migrate.lock`;
      mkdirp(foreignKey);
      writeFileSync(lockPath, `${process.pid} ${Date.now()}\n`);

      const started = Date.now();
      let thrown: unknown = null;
      try {
        withMigrationLock(foreignKey, () => "should not run");
      } catch (e) {
        thrown = e;
      }
      const elapsed = Date.now() - started;

      expect(thrown).toBeInstanceOf(MigrationLockError);
      expect(String((thrown as Error).message)).toContain("self-deadlock");
      // The whole point: fail fast. Pre-fix this waited the full deadline.
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the lock is released and the lockfile removed on the happy path", () => {
    const dir = tmp();
    try {
      const key = canonicalDbKey(join(dir, "xr.db"));
      withMigrationLock(key, () => undefined);
      expect(readdirSync(dir).filter((f) => f.endsWith(".migrate.lock"))).toHaveLength(0);
      // And re-acquiring immediately must not block (proves release).
      const started = Date.now();
      withMigrationLock(key, () => undefined);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("withMigrationLock — Windows delete-pending is a retry, not a failure", () => {
  // Job 105977660468 (CF-1 open churn, 8 processes): one opener's O_EXCL
  // create hit `EPERM … xr.db.migrate.lock` because the holder had unlinked
  // the file while another opener's probe still had it open (delete pending).
  test("win32 classifies EPERM/EACCES/EBUSY on the exclusive create as transient", () => {
    expect(isTransientLockCreateError("EPERM", "win32")).toBe(true);
    expect(isTransientLockCreateError("EACCES", "win32")).toBe(true);
    expect(isTransientLockCreateError("EBUSY", "win32")).toBe(true);
  });
  test("everything else is a real fault: EEXIST is the normal contention path, ENOENT/EROFS are errors", () => {
    expect(isTransientLockCreateError("EEXIST", "win32")).toBe(false);
    expect(isTransientLockCreateError("ENOENT", "win32")).toBe(false);
    expect(isTransientLockCreateError("EROFS", "win32")).toBe(false);
    expect(isTransientLockCreateError(undefined, "win32")).toBe(false);
  });
  test("POSIX never reinterprets a permission error (no delete-pending state exists there)", () => {
    expect(isTransientLockCreateError("EPERM", "linux")).toBe(false);
    expect(isTransientLockCreateError("EACCES", "darwin")).toBe(false);
  });
});

describe("normalizeRelativePath — user-facing paths are a separate concern", () => {
  test("unifies separators and strips a leading ./", () => {
    expect(normalizeRelativePath(".\\src\\state\\x.ts")).toBe("src/state/x.ts");
    expect(normalizeRelativePath("./src//x.ts")).toBe("src/x.ts");
  });
});

function mkdirp(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
