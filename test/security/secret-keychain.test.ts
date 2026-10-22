/**
 * XR-LAUNCH-015 / XR-LAUNCH-017 — keychain-first secret storage, migration and
 * purge, against a MOCKED OS backend (the suite never touches a real keychain;
 * test/helpers/suite-tmp.ts forces XR_SECRET_BACKEND=file and these cases opt
 * back into "auto" with an injected backend).
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as secrets from "../../src/security/secrets.ts";
import {
  FIXED_SECRET_NAMES,
  knownSecretNames,
  migrateFileSecretsToKeychain,
  prepareDaemonSecrets,
  purgeXrSecrets,
  secretStoreHealth,
} from "../../src/security/secret-migration.ts";
import {
  detectOsBackend,
  linuxBackend,
  macosAddCommand,
  macosBackend,
  windowsBackend,
  type OsSecretBackend,
  type SecretRunner,
} from "../../src/security/secret-backends.ts";
import { purgeThenUninstall, type UninstallPaths } from "../../src/install/uninstall.ts";
import { AUDIT_SIGNING_KEY_NAME, loadOrCreateAuditIdentity } from "../../src/security/audit-signer.ts";

const NAME = "XR_TEST_KC_KEY";
const VALUE = "sk-test-keychain-0123456789";

class MockKeychain implements OsSecretBackend {
  readonly id = "linux-secret-service" as const;
  store = new Map<string, string>();
  failSet = false;
  failGet = false;
  failRemove = false;
  /** set() reports success but stores a different value (read-back must catch it). */
  corrupt = false;
  listable = true;
  calls: string[] = [];
  private doSet(name: string, value: string): boolean {
    this.calls.push(`set:${name}`);
    if (this.failSet) return false;
    this.store.set(name, this.corrupt ? `${value}-mangled` : value);
    return true;
  }
  private doGet(name: string): string | undefined {
    this.calls.push(`get:${name}`);
    return this.failGet ? undefined : this.store.get(name);
  }
  private doRemove(name: string): boolean {
    this.calls.push(`remove:${name}`);
    if (this.failRemove) return false;
    return this.store.delete(name);
  }
  async set(n: string, v: string) { return this.doSet(n, v); }
  async get(n: string) { return this.doGet(n); }
  async remove(n: string) { return this.doRemove(n); }
  setSync(n: string, v: string) { return this.doSet(n, v); }
  getSync(n: string) { return this.doGet(n); }
  removeSync(n: string) { return this.doRemove(n); }
  async list() { return this.listable ? [...this.store.keys()] : null; }
}

let HOME: string;
let kc: MockKeychain;
const saved = { home: process.env.XR_HOME, mode: process.env.XR_SECRET_BACKEND };

function envFile(): string {
  return existsSync(join(HOME, ".env")) ? readFileSync(join(HOME, ".env"), "utf8") : "";
}

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "xr-kc-"));
  process.env.XR_HOME = HOME;
  process.env.XR_SECRET_BACKEND = "auto";
  kc = new MockKeychain();
  secrets.__setOsBackendForTests(kc);
});

afterEach(() => {
  secrets.__setOsBackendForTests(undefined);
  delete process.env[NAME];
  process.env.XR_HOME = saved.home;
  process.env.XR_SECRET_BACKEND = saved.mode;
  rmSync(HOME, { recursive: true, force: true });
});

describe("XR-LAUNCH-015 · keychain is the primary store", () => {
  test("sync setSecret writes the keychain only — no file copy — and indexes the name", () => {
    expect(secrets.setSecret(NAME, VALUE)).toBe("linux-secret-service");
    expect(kc.store.get(NAME)).toBe(VALUE);
    expect(envFile()).not.toContain(NAME);
    expect(secrets.readSecretIndex().entries[NAME]).toBe("linux-secret-service");
    const index = readFileSync(join(HOME, "secrets", "index.json"), "utf8");
    expect(index).not.toContain(VALUE); // names only
  });

  test("async setSecretAsync writes the keychain only", async () => {
    expect(await secrets.setSecretAsync(NAME, VALUE)).toBe("linux-secret-service");
    expect(kc.store.get(NAME)).toBe(VALUE);
    expect(envFile()).not.toContain(NAME);
  });

  test("keychain failure falls back to the sealed file, says so once, and returns 'file'", () => {
    kc.failSet = true;
    const warn = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(secrets.setSecret(NAME, VALUE)).toBe("file");
      expect(secrets.setSecret("XR_TEST_KC_OTHER", VALUE)).toBe("file");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("rejected the write");
      expect(String(warn.mock.calls[0]![0])).not.toContain(VALUE);
    } finally {
      warn.mockRestore();
    }
    expect(envFile()).toMatch(new RegExp(`^${NAME}=XRG1\\.`, "m"));
    expect(secrets.readSecretIndex().entries[NAME]).toBe("file");
  });

  test("a write that does not read back identically is treated as a failure", async () => {
    kc.corrupt = true;
    const warn = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await secrets.setSecretAsync(NAME, VALUE)).toBe("file");
    } finally {
      warn.mockRestore();
    }
    secrets.clearSecretMemo();
    expect(secrets.getSecretSyncCached(NAME)).toBe(VALUE);
  });

  test("XR_SECRET_BACKEND=keychain refuses the file fallback", () => {
    process.env.XR_SECRET_BACKEND = "keychain";
    kc.failSet = true;
    expect(() => secrets.setSecret(NAME, VALUE)).toThrow(/refusing the file fallback/);
    expect(envFile()).not.toContain(NAME);
  });

  test("XR_SECRET_BACKEND=file is an explicit opt-in: no keychain call, no warning", () => {
    process.env.XR_SECRET_BACKEND = "file";
    const warn = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(secrets.setSecret(NAME, VALUE)).toBe("file");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(kc.calls).toEqual([]);
  });

  test("moving a secret into the keychain removes the stale file copy", () => {
    process.env.XR_SECRET_BACKEND = "file";
    secrets.setSecret(NAME, "old-value-123");
    process.env.XR_SECRET_BACKEND = "auto";
    secrets.setSecret(NAME, VALUE);
    expect(envFile()).not.toContain(NAME);
    secrets.clearSecretMemo();
    expect(secrets.getSecretSyncCached(NAME)).toBe(VALUE);
  });

  test("cold sync read of an indexed keychain name spawns once, then memoizes (including misses)", () => {
    secrets.setSecret(NAME, VALUE);
    secrets.clearSecretMemo();
    kc.calls = [];
    expect(secrets.getSecretSyncCached(NAME)).toBe(VALUE);
    expect(secrets.getSecretSyncCached(NAME)).toBe(VALUE);
    expect(kc.calls).toEqual([`get:${NAME}`]);

    secrets.clearSecretMemo();
    kc.failGet = true;
    kc.calls = [];
    expect(secrets.getSecretSyncCached(NAME)).toBeUndefined();
    expect(secrets.getSecretSyncCached(NAME)).toBeUndefined();
    expect(kc.calls).toEqual([`get:${NAME}`]);
  });

  test("unindexed names never trigger a sync keychain read", () => {
    kc.store.set("XR_TEST_KC_UNINDEXED", VALUE);
    expect(secrets.getSecretSyncCached("XR_TEST_KC_UNINDEXED")).toBeUndefined();
    expect(kc.calls).toEqual([]);
  });

  test("daemon mode: no sync keychain reads; warmSecretCache fills the memo", async () => {
    secrets.setSecret(NAME, VALUE);
    secrets.clearSecretMemo();
    secrets.disableSyncOsSecretReads();
    kc.calls = [];
    expect(secrets.getSecretSyncCached(NAME)).toBeUndefined();
    expect(kc.calls).toEqual([]);
    expect(await secrets.warmSecretCache()).toBe(1);
    expect(secrets.getSecretSyncCached(NAME)).toBe(VALUE);
  });

  test("daemon start warms the cache, disables sync reads, and is bounded even if hydration hangs", async () => {
    secrets.setSecret(NAME, VALUE);
    secrets.clearSecretMemo();
    const started = Date.now();
    await prepareDaemonSecrets(() => new Promise<void>(() => {}), 50);
    expect(Date.now() - started).toBeLessThan(2000);
    kc.calls = [];
    expect(secrets.getSecretSyncCached(NAME)).toBe(VALUE); // from the warmed memo
    secrets.clearSecretMemo();
    expect(secrets.getSecretSyncCached(NAME)).toBeUndefined(); // no sync keychain read in the daemon
    expect(kc.calls).toEqual([]);
  });

  test("getSecretAsync probes legacy keychain-only names until discovery has run", async () => {
    kc.store.set("XR_TEST_KC_LEGACY", VALUE);
    expect(await secrets.getSecretAsync("XR_TEST_KC_LEGACY")).toBe(VALUE);
  });

  test("removeSecret clears keychain, file and index", async () => {
    secrets.setSecret(NAME, VALUE);
    secrets.removeSecret(NAME);
    expect(kc.store.has(NAME)).toBe(false);
    expect(secrets.readSecretIndex().entries[NAME]).toBeUndefined();
    secrets.setSecret(NAME, VALUE);
    await secrets.removeSecretAsync(NAME);
    expect(kc.store.has(NAME)).toBe(false);
  });

  test("an indexed but unreadable audit key is NOT replaced (chain anchor kept)", () => {
    secrets.setSecret(AUDIT_SIGNING_KEY_NAME, "anchor-key-material");
    secrets.clearSecretMemo();
    kc.failGet = true;
    expect(loadOrCreateAuditIdentity()).toBeNull();
    expect(kc.store.get(AUDIT_SIGNING_KEY_NAME)).toBe("anchor-key-material");
  });
});

describe("XR-LAUNCH-015 · file → keychain migration", () => {
  function seedFile(entries: Record<string, string>): void {
    process.env.XR_SECRET_BACKEND = "file";
    for (const [k, v] of Object.entries(entries)) secrets.setSecret(k, v);
    process.env.XR_SECRET_BACKEND = "auto";
    secrets.clearSecretMemo();
  }

  test("moves verified entries, strips them from .env, keeps a 0600 backup until the next good run", async () => {
    seedFile({ XR_TEST_KC_A: "value-a-123", XR_TEST_KC_B: "value-b-456" });
    const r1 = await migrateFileSecretsToKeychain();
    expect(r1.moved.sort()).toEqual(["XR_TEST_KC_A", "XR_TEST_KC_B"]);
    expect(kc.store.get("XR_TEST_KC_A")).toBe("value-a-123");
    expect(envFile()).not.toContain("XR_TEST_KC_A");
    expect(r1.backup && existsSync(r1.backup)).toBe(true);
    if (process.platform !== "win32") expect(statSync(r1.backup!).mode & 0o777).toBe(0o600);
    expect(readFileSync(r1.backup!, "utf8")).not.toContain("value-a-123"); // still sealed
    const log = readFileSync(join(HOME, "logs", "secrets-migration.log"), "utf8");
    expect(log).toContain("XR_TEST_KC_A");
    expect(log).not.toContain("value-a-123");

    const r2 = await migrateFileSecretsToKeychain();
    expect(r2.backupRemoved).toBe(true);
    expect(existsSync(r1.backup!)).toBe(false);
    expect(secrets.readSecretIndex().pendingBackup).toBeUndefined();
    // Idempotent: a third run changes nothing.
    const r3 = await migrateFileSecretsToKeychain();
    expect(r3.moved).toEqual([]);
    expect(r3.backupRemoved).toBeUndefined();
  });

  test("entries the keychain refuses stay in the file; no backup is left behind", async () => {
    seedFile({ XR_TEST_KC_A: "value-a-123" });
    kc.failSet = true;
    const r = await migrateFileSecretsToKeychain();
    expect(r.failed).toEqual(["XR_TEST_KC_A"]);
    expect(r.backup).toBeUndefined();
    expect(envFile()).toContain("XR_TEST_KC_A=XRG1.");
  });

  test("an unverified backup is kept and blocks further moves", async () => {
    seedFile({ XR_TEST_KC_A: "value-a-123" });
    const r1 = await migrateFileSecretsToKeychain();
    kc.store.clear(); // keychain lost the value
    const r2 = await migrateFileSecretsToKeychain();
    expect(r2.skipped).toContain("not yet verified");
    expect(existsSync(r1.backup!)).toBe(true);
  });

  test("discovers legacy keychain-only entries once (enumerating and probing backends)", async () => {
    kc.store.set("XR_TELEGRAM_BOT_TOKEN", "legacy-token-1");
    const r = await migrateFileSecretsToKeychain();
    expect(r.discovered).toContain("XR_TELEGRAM_BOT_TOKEN");
    expect(secrets.readSecretIndex().discovered).toBe(true);
    expect((await migrateFileSecretsToKeychain()).discovered).toEqual([]);

    // A backend that cannot enumerate (macOS) is probed by known names.
    rmSync(join(HOME, "secrets", "index.json"), { force: true });
    kc.listable = false;
    const probed = await migrateFileSecretsToKeychain();
    expect(probed.discovered).toContain("XR_TELEGRAM_BOT_TOKEN");
  });

  test("skips cleanly without an OS store", async () => {
    secrets.__setOsBackendForTests(null);
    expect((await migrateFileSecretsToKeychain()).skipped).toBe("no OS keychain available");
  });
});

describe("XR-LAUNCH-017 · uninstall --purge removes keychain entries", () => {
  test("purge removes indexed, known and enumerable XR entries and reports them", async () => {
    secrets.setSecret(NAME, VALUE);
    kc.store.set("OPENAI_API_KEY", "sk-openai-test");
    kc.store.set("XR_DISCORD_BOT_TOKEN", "discord-test");
    const r = await purgeXrSecrets();
    expect(r.removed.sort()).toEqual([NAME, "OPENAI_API_KEY", "XR_DISCORD_BOT_TOKEN"].sort());
    expect(kc.store.size).toBe(0);
  });

  test("entries that survive deletion are reported, not hidden", async () => {
    kc.store.set("OPENAI_API_KEY", "sk-openai-test");
    kc.failRemove = true;
    const r = await purgeXrSecrets();
    expect(r.failed).toEqual(["OPENAI_API_KEY"]);
  });

  test("file mode never touches the keychain and says so", async () => {
    process.env.XR_SECRET_BACKEND = "file";
    kc.store.set("OPENAI_API_KEY", "sk-openai-test");
    const r = await purgeXrSecrets();
    expect(r.skipped).toContain("not checked");
    expect(kc.store.size).toBe(1);
  });

  test("purgeThenUninstall purges BEFORE the data home is removed; keep-data never purges", async () => {
    const root = mkdtempSync(join(tmpdir(), "xr-kc-uninstall-"));
    const paths: UninstallPaths = {
      launcher: join(root, "bin", "xr"),
      installDir: join(root, "app"),
      dataHome: join(root, "data"),
      rcFiles: [],
    };
    mkdirSync(paths.dataHome, { recursive: true });
    const seen = { dataHome: false };
    let calls = 0;
    const purge = async () => {
      calls++;
      seen.dataHome = existsSync(paths.dataHome);
      return { backend: "linux-secret-service" as const, removed: ["OPENAI_API_KEY"], failed: [] };
    };
    const keep = await purgeThenUninstall({ mode: "keep-data", yes: true, packageRoot: "/nonexistent" }, paths, purge);
    expect(keep.secrets).toBeNull();
    expect(calls).toBe(0);
    const res = await purgeThenUninstall({ mode: "purge", yes: true, packageRoot: "/nonexistent" }, paths, purge);
    expect(calls).toBe(1);
    expect(seen.dataHome).toBe(true);
    expect(res.secrets?.removed).toEqual(["OPENAI_API_KEY"]);
    expect(res.summary.dataHomeRemoved).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }, 30_000); // two real uninstalls: on Windows each reads the user Path via a cold PowerShell start (>5 s on windows-11-arm)

  test("the known-name list covers every fixed secret id defined in src/", () => {
    const sources = [
      "src/telegram/manager.ts",
      "src/discord/manager.ts",
      "src/cloud/client.ts",
      "src/integrations/vault-adapter.ts",
      "src/security/audit-signer.ts",
    ].map((f) => readFileSync(join(import.meta.dir, "..", "..", f), "utf8")).join("\n");
    const ids = [...sources.matchAll(/export const [A-Z_]+ = ["']([A-Z][A-Z0-9_]+)["'];/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    for (const id of ids) expect(FIXED_SECRET_NAMES as readonly string[]).toContain(id);
    expect(knownSecretNames()).toContain("OPENAI_API_KEY");
  });
});

describe("XR-LAUNCH-015 · secrets never reach argv", () => {
  function capture(): SecretRunner & { seen: Array<{ cmd: string; args: string[]; input?: string; env?: Record<string, string> }> } {
    const seen: Array<{ cmd: string; args: string[]; input?: string; env?: Record<string, string> }> = [];
    return {
      seen,
      async run(cmd, args, input, env) { seen.push({ cmd, args, input, env }); return { ok: true, stdout: VALUE }; },
      runSync(cmd, args, input, env) { seen.push({ cmd, args, input, env }); return { ok: true, stdout: VALUE }; },
    };
  }

  test("macOS: `security -i` receives the value on stdin only", async () => {
    const r = capture();
    const b = macosBackend(r);
    await b.set(NAME, VALUE);
    b.setSync(NAME, VALUE);
    for (const call of r.seen) {
      expect(call.args.join(" ")).not.toContain(VALUE);
      expect(call.args).toEqual(["-i"]);
      expect(call.input).toContain(VALUE);
    }
  });

  test("macOS: the stdin command quotes and escapes the value", () => {
    expect(macosAddCommand("N_X", 'a"b\\c')).toBe('add-generic-password -U -a "N_X" -s "xr" -w "a\\"b\\\\c"\n');
  });

  test("Linux: secret-tool receives the value on stdin only", async () => {
    const r = capture();
    await linuxBackend(r).set(NAME, VALUE);
    expect(r.seen[0]!.args.join(" ")).not.toContain(VALUE);
    expect(r.seen[0]!.input).toBe(VALUE);
  });

  test("Windows: PowerShell receives the value on stdin — not argv, not env", async () => {
    const r = capture();
    await windowsBackend(() => HOME, r, "pwsh").set(NAME, VALUE);
    const call = r.seen[0]!;
    expect(call.args.join(" ")).not.toContain(VALUE);
    expect(JSON.stringify(call.env ?? {})).not.toContain(VALUE);
    expect(call.input).toBe(VALUE);
  });
});

describe.skipIf(process.platform === "win32")("XR-LAUNCH-015 · real processes: the value is never on argv", () => {
  // Fake `secret-tool` / `security` executables log every argv they receive,
  // which is exactly what `ps` would show; the real spawn path is exercised.
  const FAKE = `#!/bin/sh
d="$XR_FAKE_DIR"
printf '%s\n' "$*" >> "$d/argv.log"
case "$1" in
  store) cat > "$d/value" ;;
  lookup|find-generic-password) [ -f "$d/value" ] && cat "$d/value" || exit 1 ;;
  -i) cat >> "$d/stdin.log" ;;
  *) : ;;
esac
`;
  let dir: string;
  const savedPath = process.env.PATH;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "xr-kc-fake-"));
    for (const tool of ["secret-tool", "security"]) {
      writeFileSync(join(dir, tool), FAKE);
      chmodSync(join(dir, tool), 0o755);
    }
    process.env.XR_FAKE_DIR = dir;
    process.env.PATH = `${dir}:${savedPath}`;
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    delete process.env.XR_FAKE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test("Linux end-to-end (sync + async writes through setSecret) keeps the value off argv", async () => {
    secrets.__setOsBackendForTests(linuxBackend());
    expect(secrets.setSecret(NAME, VALUE)).toBe("linux-secret-service");
    expect(await secrets.setSecretAsync(NAME, `${VALUE}-2`)).toBe("linux-secret-service");
    const argv = readFileSync(join(dir, "argv.log"), "utf8");
    expect(argv).toContain("store");
    expect(argv).not.toContain(VALUE);
    expect(readFileSync(join(dir, "value"), "utf8")).toBe(`${VALUE}-2`);
  });

  test("macOS writes reach `security -i` on stdin, never on argv", async () => {
    const b = macosBackend();
    await b.set(NAME, VALUE);
    b.setSync(NAME, VALUE);
    expect(readFileSync(join(dir, "argv.log"), "utf8")).not.toContain(VALUE);
    expect(readFileSync(join(dir, "stdin.log"), "utf8")).toContain(`-w "${VALUE}"`);
  });
});

describe("XR-LAUNCH-015 · doctor reports the real store", () => {
  test("Linux without secret-tool is not reported as linux-secret-service", () => {
    const empty = mkdtempSync(join(tmpdir(), "xr-kc-path-"));
    expect(detectOsBackend("linux", { PATH: empty })).toBeNull();
    const tool = join(empty, "secret-tool");
    writeFileSync(tool, "#!/bin/sh\nexit 0\n");
    chmodSync(tool, 0o755);
    expect(detectOsBackend("linux", { PATH: empty })).toBe("linux-secret-service");
    rmSync(empty, { recursive: true, force: true });

    secrets.__setOsBackendForTests(null);
    const health = secretStoreHealth("linux");
    expect(health.state).toBe("warn");
    expect(health.detail).not.toContain("linux-secret-service");
    expect(health.detail).toContain("no OS keychain found");
    expect(health.remediation).toContain("secret-tool");
    expect(secrets.preferredSecretBackend()).toBe("file");
  });

  test("strict mode without a keychain fails the doctor row", () => {
    secrets.__setOsBackendForTests(null);
    process.env.XR_SECRET_BACKEND = "keychain";
    expect(secretStoreHealth("linux").state).toBe("fail");
  });

  test("a working keychain with leftover file entries warns and points at xr repair", () => {
    process.env.XR_SECRET_BACKEND = "file";
    secrets.setSecret(NAME, VALUE);
    process.env.XR_SECRET_BACKEND = "auto";
    const h = secretStoreHealth("linux");
    expect(h.state).toBe("warn");
    expect(h.remediation).toContain("xr repair");
  });
});
