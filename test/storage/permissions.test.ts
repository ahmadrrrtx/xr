/**
 * XR-LAUNCH-016 — owner-only data home. Asserts the modes a fresh install
 * creates under the default umask, and the idempotent tightening of an
 * existing (pre-fix) install. POSIX only: Windows relies on profile ACLs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { hardenDataHome, hardenDataHomeOnce } from "../../src/storage/permissions.ts";
import { openDatabase } from "../../src/state/write-gate.ts";
import { loadConfig } from "../../src/config/config.ts";

const posix = process.platform !== "win32";
const mode = (p: string) => statSync(p).mode & 0o777;

let ROOT: string;
let oldUmask: number;
const savedHome = process.env.XR_HOME;

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "xr-perms-"));
  oldUmask = process.umask(0o022); // the default umask that produced 0644/0755
});

afterEach(() => {
  process.umask(oldUmask);
  process.env.XR_HOME = savedHome;
  rmSync(ROOT, { recursive: true, force: true });
});

describe.skipIf(!posix)("XR-LAUNCH-016 · fresh install", () => {
  test("first config load creates the home 0700 and config.json 0600", () => {
    const home = join(ROOT, "fresh-home");
    process.env.XR_HOME = home;
    loadConfig();
    expect(mode(home)).toBe(0o700);
    expect(mode(join(home, "config.json"))).toBe(0o600);
  });

  test("openDatabase creates the DB (and WAL/SHM) 0600", () => {
    const db = openDatabase(join(ROOT, "xr.db"));
    db.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);");
    expect(mode(join(ROOT, "xr.db"))).toBe(0o600);
    for (const f of ["xr.db-wal", "xr.db-shm"]) if (existsSync(join(ROOT, f))) expect(mode(join(ROOT, f)) & 0o077).toBe(0);
    db.close();
  });

  test("hardenDataHomeOnce creates a missing home 0700 — and recreates it after removal", () => {
    const home = join(ROOT, "a", "b");
    hardenDataHomeOnce(home);
    expect(mode(home)).toBe(0o700);
    rmSync(home, { recursive: true, force: true });
    hardenDataHomeOnce(home); // memoized tightening, but existence is re-ensured
    expect(mode(home)).toBe(0o700);
  });
});

describe.skipIf(!posix)("XR-LAUNCH-016 · existing install migration", () => {
  function legacyHome(): string {
    const home = join(ROOT, "legacy");
    mkdirSync(join(home, "memories"), { recursive: true });
    chmodSync(home, 0o755);
    chmodSync(join(home, "memories"), 0o755);
    writeFileSync(join(home, "config.json"), "{}");
    chmodSync(join(home, "config.json"), 0o644);
    writeFileSync(join(home, "xr.db"), "");
    chmodSync(join(home, "xr.db"), 0o644);
    writeFileSync(join(home, "run.sh"), "#!/bin/sh\n");
    chmodSync(join(home, "run.sh"), 0o755);
    return home;
  }

  test("tightens home, files and dirs; keeps owner bits; logs names; is idempotent", () => {
    const home = legacyHome();
    const r = hardenDataHome(home);
    expect(r.changed.sort()).toEqual([".", "config.json", "memories", "run.sh", "xr.db"].sort());
    expect(mode(home)).toBe(0o700);
    expect(mode(join(home, "config.json"))).toBe(0o600);
    expect(mode(join(home, "xr.db"))).toBe(0o600);
    expect(mode(join(home, "memories"))).toBe(0o700);
    expect(mode(join(home, "run.sh"))).toBe(0o700); // owner exec kept
    const log = readFileSync(join(home, "logs", "permissions-migration.log"), "utf8");
    expect(log).toContain("config.json");
    expect(hardenDataHome(home).changed).toEqual([]);
  });

  test("symlinks are never followed", () => {
    const home = legacyHome();
    const outside = join(ROOT, "outside.txt");
    writeFileSync(outside, "x");
    chmodSync(outside, 0o644);
    symlinkSync(outside, join(home, "link"));
    hardenDataHome(home);
    expect(mode(outside)).toBe(0o644);
  });

  test("refuses to tighten the user's own home directory or a filesystem root", () => {
    expect(hardenDataHome(homedir()).skipped).toContain("refusing");
    expect(hardenDataHome("/").skipped).toContain("refusing");
  });

  test("windows is a documented no-op", () => {
    expect(hardenDataHome(legacyHome(), "win32").skipped).toContain("windows");
  });
});
