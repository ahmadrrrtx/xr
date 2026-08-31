/**
 * XR — local secret storage helpers.
 *
 * Security rules:
 * - Raw keys are never printed.
 * - OS-backed storage is preferred when available.
 * - File fallback is explicit, user-readable, and chmod 600 where supported.
 *
 * Backends:
 * - macOS: Keychain via `security`
 * - Linux: Secret Service via `secret-tool` when installed
 * - Windows: user/machine-bound DPAPI via PowerShell ConvertFrom-SecureString
 * - Fallback: ~/.xr/.env — AES-256-GCM ENCRYPTED AT REST (launch hardening,
 *   audit discrepancy D-1). See "File fallback encryption" below.
 *
 * File fallback encryption:
 * - Values are sealed with AES-256-GCM using a per-install 256-bit random key
 *   at ~/.xr/secrets/.file-key (chmod 600, generated on first use).
 * - Format: `NAME=XRG1.<b64 iv>.<b64 tag>.<b64 ciphertext>`; legacy plaintext
 *   `NAME=value` lines are migrated transparently on first read/write.
 * - Honest threat model: this protects the file when it leaks WITHOUT the key
 *   (backups, accidental commits, partial exfiltration). An attacker who can
 *   read the whole ~/.xr directory can also read the key — OS backends remain
 *   the strong anchor; this fallback stops being the weakest form of storage
 *   XR could have shipped.
 *
 * Performance:
 * - getSecretSyncCached never spawns (env + in-memory memo + file only)
 * - getSecretAsync uses non-blocking subprocess for OS backends
 * - getSecret remains for CLI write paths; may spawn once on cold miss
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { commandExists, runCommand } from "../util/process.ts";
import { envSecretCompatEnabled } from "./env-compat.ts";

export type SecretBackend = "macos-keychain" | "linux-secret-service" | "windows-dpapi" | "file";

/** XR_HOME is resolved lazily per call so long-lived processes (and tests
 *  setting process.env.XR_HOME per case) see the right root. */
function xrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,80}$/;

/** In-memory secret memo — never re-probes OS keychain after a successful read. */
const secretMemo = new Map<string, string>();

function assertSafeName(name: string): void {
  if (!SECRET_NAME_RE.test(name)) throw new Error(`unsafe secret name: ${name}`);
}

function assertSafeValue(value: string): void {
  if (!value || /[\r\n\0]/.test(value)) throw new Error("secret value is empty or contains an unsafe newline/null byte");
}

function powershellCandidates(): string[] {
  return process.platform === "win32" ? ["pwsh", "powershell"] : [];
}

export async function preferredSecretBackendAsync(): Promise<SecretBackend> {
  if (platform() === "darwin" && (await commandExists("security"))) return "macos-keychain";
  if (platform() === "linux" && (await commandExists("secret-tool"))) return "linux-secret-service";
  if (platform() === "win32") {
    for (const ps of powershellCandidates()) {
      if (await commandExists(ps)) return "windows-dpapi";
    }
  }
  return "file";
}

/** Sync backend preference using only env/platform heuristics (no spawn). */
export function preferredSecretBackend(): SecretBackend {
  if (platform() === "darwin") return "macos-keychain";
  if (platform() === "linux") return "linux-secret-service";
  if (platform() === "win32") return "windows-dpapi";
  return "file";
}

function envPath(): string {
  const home = xrHome();
  if (!existsSync(home)) mkdirSync(home, { recursive: true });
  return join(home, ".env");
}

function secretDir(): string {
  const dir = join(xrHome(), "secrets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try { chmodSync(dir, 0o700); } catch {}
  return dir;
}

// ── AES-256-GCM file-fallback sealing (launch hardening · audit D-1) ────────

const ENC_PREFIX = "XRG1.";
const ENV_HEADER =
  "# XR secrets — values sealed with AES-256-GCM (per-install key in secrets/.file-key).\n" +
  "# Do not edit by hand; use `xr providers keys` / the onboarding wizard.\n";

function fileKeyPath(): string {
  return join(secretDir(), ".file-key");
}

/** Load or lazily create the per-install file key (never logged). */
function loadOrCreateFileKey(): Buffer {
  const path = fileKeyPath();
  if (existsSync(path)) {
    const raw = readFileSync(path);
    if (raw.length === 32) return raw;
    // A corrupt key must NOT be overwritten in place: secrets sealed with it
    // would become permanently unreadable. Fail closed instead.
    throw new Error(`XR secret file key at ${path} is corrupt (expected 32 bytes); refusing to continue`);
  }
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
  return key;
}

function encryptSecretValue(value: string): string {
  const key = loadOrCreateFileKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

function isEncryptedValue(raw: string): boolean {
  return raw.startsWith(ENC_PREFIX);
}

function decryptSecretValue(raw: string): string {
  const parts = raw.slice(ENC_PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("encrypted secret value is malformed");
  const [ivB64, tagB64, ctB64] = parts;
  const key = loadOrCreateFileKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64!, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64!, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Read the fallback file, decrypting sealed values and transparently migrating
 * legacy plaintext entries. Returns null only if the file does not exist.
 * A line that fails to decrypt is preserved verbatim and surfaced as undefined
 * — it is never silently dropped, and a migration rewrite only happens when
 * every line parses cleanly.
 */
function readEnvEntries(): { entries: Map<string, string>; corruptRaw: string[] } {
  const path = envPath();
  const entries = new Map<string, string>();
  const corruptRaw: string[] = [];
  if (!existsSync(path)) return { entries, corruptRaw };
  let sawPlaintext = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!SECRET_NAME_RE.test(k)) continue;
    if (isEncryptedValue(v)) {
      try {
        entries.set(k, decryptSecretValue(v));
      } catch {
        // Undecryptable entries are carried through verbatim on rewrites and
        // surfaced as "absent" to readers — never silently discarded.
        corruptRaw.push(`${k}=${v}`);
      }
    } else if (v.length) {
      entries.set(k, v);
      sawPlaintext = true;
    }
  }
  if (sawPlaintext) writeEnvEntries(entries, corruptRaw);
  return { entries, corruptRaw };
}

function writeEnvEntries(entries: Map<string, string>, corruptRaw: string[] = []): void {
  const path = envPath();
  const lines = [...entries.keys()].sort().map((k) => `${k}=${encryptSecretValue(entries.get(k)!)}`);
  // Corrupt entries ride along unchanged; if the key is ever repaired the
  // value is still there, and if not, the damage is visible in the file.
  const body = [...lines, ...corruptRaw.sort()];
  writeFileSync(path, ENV_HEADER + body.join("\n") + (body.length ? "\n" : ""));
  try { chmodSync(path, 0o600); } catch {}
}

function windowsSecretPath(name: string): string {
  assertSafeName(name);
  return join(secretDir(), `${name}.dpapi`);
}

async function setWindowsSecretAsync(name: string, value: string): Promise<boolean> {
  let ps: string | undefined;
  for (const c of powershellCandidates()) {
    if (await commandExists(c)) { ps = c; break; }
  }
  if (!ps) return false;
  const script = `
$ErrorActionPreference = 'Stop'
$path = $env:XR_SECRET_PATH
$value = $env:XR_SECRET_VALUE
$secure = ConvertTo-SecureString -String $value -AsPlainText -Force
$encrypted = ConvertFrom-SecureString -SecureString $secure
Set-Content -LiteralPath $path -Value $encrypted -NoNewline
`;
  const res = await runCommand(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, XR_SECRET_PATH: windowsSecretPath(name), XR_SECRET_VALUE: value },
    timeoutMs: 10_000,
    stdio: "ignore",
  });
  return res.ok;
}

async function getWindowsSecretAsync(name: string): Promise<string | undefined> {
  let ps: string | undefined;
  for (const c of powershellCandidates()) {
    if (await commandExists(c)) { ps = c; break; }
  }
  const path = windowsSecretPath(name);
  if (!ps || !existsSync(path)) return undefined;
  const script = `
$ErrorActionPreference = 'Stop'
$encrypted = Get-Content -LiteralPath $env:XR_SECRET_PATH -Raw
$secure = ConvertTo-SecureString -String $encrypted
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
`;
  const res = await runCommand(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, XR_SECRET_PATH: path },
    timeoutMs: 10_000,
  });
  const value = res.ok ? res.stdout.trim() : "";
  return value || undefined;
}

function removeWindowsSecret(name: string): void {
  try { rmSync(windowsSecretPath(name), { force: true }); } catch {}
}

function setFileSecret(name: string, value: string): void {
  assertSafeName(name);
  assertSafeValue(value);
  const { entries, corruptRaw } = readEnvEntries();
  entries.set(name, value);
  writeEnvEntries(entries, corruptRaw.filter((line) => !line.startsWith(`${name}=`)));
  secretMemo.set(name, value);
}

function getFileSecret(name: string): string | undefined {
  assertSafeName(name);
  return readEnvEntries().entries.get(name);
}

/**
 * Decrypted view over the file fallback, for the ONE authorized consumer
 * besides this module: the config loader hydrating provider env vars at
 * startup. Everything else should use the per-name get/set helpers so this
 * module remains the sole owner of the on-disk format. Triggers the same
 * transparent legacy migration as a per-name read.
 */
export function listFileSecrets(): Record<string, string> {
  return Object.fromEntries(readEnvEntries().entries);
}

function removeFileSecret(name: string): void {
  assertSafeName(name);
  const path = envPath();
  const { entries, corruptRaw } = readEnvEntries();
  entries.delete(name);
  const keptCorrupt = corruptRaw.filter((line) => !line.startsWith(`${name}=`));
  if (entries.size || keptCorrupt.length || existsSync(path)) writeEnvEntries(entries, keptCorrupt);
  secretMemo.delete(name);
}

/**
 * Non-blocking secret write for daemon / async CLI paths.
 */
export async function setSecretAsync(name: string, value: string): Promise<SecretBackend> {
  assertSafeName(name);
  assertSafeValue(value);
  const backend = await preferredSecretBackendAsync();
  if (backend === "macos-keychain") {
    const res = await runCommand("security", ["add-generic-password", "-a", name, "-s", "xr", "-w", value, "-U"], {
      timeoutMs: 8000,
      stdio: "ignore",
    });
    if (res.ok) {
      secretMemo.set(name, value);
      process.env[name] = value;
      return backend;
    }
  }
  if (backend === "linux-secret-service") {
    const res = await runCommand("secret-tool", ["store", "--label", `XR ${name}`, "application", "xr", "name", name], {
      input: value,
      timeoutMs: 8000,
      stdio: "ignore",
    });
    if (res.ok) {
      secretMemo.set(name, value);
      process.env[name] = value;
      return backend;
    }
  }
  if (backend === "windows-dpapi" && (await setWindowsSecretAsync(name, value))) {
    secretMemo.set(name, value);
    process.env[name] = value;
    return backend;
  }
  setFileSecret(name, value);
  process.env[name] = value;
  return "file";
}

/** CLI-compatible sync write — uses async under the hood only when Bun allows; falls back to file. */
export function setSecret(name: string, value: string): SecretBackend {
  assertSafeName(name);
  assertSafeValue(value);
  // Prefer file for sync path reliability; OS backends are best-effort fire-and-forget.
  const backend = preferredSecretBackend();
  if (backend === "macos-keychain" || backend === "linux-secret-service" || backend === "windows-dpapi") {
    // Schedule async OS store without blocking; always persist file as durable fallback.
    void setSecretAsync(name, value).catch(() => {});
  }
  setFileSecret(name, value);
  // Phase 2 · F-24 — the write path obeys the same compat gate as reads:
  // with XR_SECRETS_ENV_COMPAT off, the durable store is updated but the
  // key is never mirrored into process.env.
  if (envSecretCompatEnabled()) process.env[name] = value;
  return "file";
}

/**
 * Hot-path secret read: process.env → memo → file only. Never spawns.
 */
export function getSecretSyncCached(name: string): string | undefined {
  assertSafeName(name);
  // Phase 2 · F-24 — ambient env is only part of the read path while compat
  // is on; with XR_SECRETS_ENV_COMPAT off, the durable backends are the only
  // authority (the 2.0 posture the broker seam is headed for).
  if (envSecretCompatEnabled() && process.env[name]) return process.env[name];
  if (secretMemo.has(name)) return secretMemo.get(name);
  const file = getFileSecret(name);
  if (file) {
    secretMemo.set(name, file);
    // Phase 2 · F-24 — ambient hydration is compat-gated: with
    // XR_SECRETS_ENV_COMPAT off, the value is memoized (never re-read from
    // disk) but deliberately NOT mirrored into process.env.
    if (envSecretCompatEnabled()) process.env[name] = file;
    return file;
  }
  return undefined;
}

/**
 * Async OS-aware secret read for daemon startup / explicit key fetch.
 */
export async function getSecretAsync(name: string): Promise<string | undefined> {
  assertSafeName(name);
  const quick = getSecretSyncCached(name);
  if (quick) return quick;

  const backend = await preferredSecretBackendAsync();
  if (backend === "macos-keychain") {
    const res = await runCommand("security", ["find-generic-password", "-a", name, "-s", "xr", "-w"], {
      timeoutMs: 5000,
    });
    if (res.ok && res.stdout.trim()) {
      const v = res.stdout.trim();
      secretMemo.set(name, v);
      process.env[name] = v;
      return v;
    }
  }
  if (backend === "linux-secret-service") {
    const res = await runCommand("secret-tool", ["lookup", "application", "xr", "name", name], {
      timeoutMs: 5000,
    });
    if (res.ok && res.stdout.trim()) {
      const v = res.stdout.trim();
      secretMemo.set(name, v);
      process.env[name] = v;
      return v;
    }
  }
  if (backend === "windows-dpapi") {
    const v = await getWindowsSecretAsync(name);
    if (v) {
      secretMemo.set(name, v);
      process.env[name] = v;
      return v;
    }
  }
  return getFileSecret(name);
}

/**
 * Legacy sync getSecret. Uses cache first; on cold miss may return file only
 * to avoid blocking the event loop with OS keychain probes during daemon work.
 * For OS backends call getSecretAsync explicitly.
 */
export function getSecret(name: string): string | undefined {
  return getSecretSyncCached(name);
}

export async function removeSecretAsync(name: string): Promise<SecretBackend> {
  assertSafeName(name);
  const backend = await preferredSecretBackendAsync();
  if (backend === "macos-keychain") {
    await runCommand("security", ["delete-generic-password", "-a", name, "-s", "xr"], { timeoutMs: 5000, stdio: "ignore" });
  } else if (backend === "linux-secret-service") {
    await runCommand("secret-tool", ["clear", "application", "xr", "name", name], { timeoutMs: 5000, stdio: "ignore" });
  } else if (backend === "windows-dpapi") {
    removeWindowsSecret(name);
  }
  removeFileSecret(name);
  secretMemo.delete(name);
  delete process.env[name];
  return backend;
}

export function removeSecret(name: string): SecretBackend {
  assertSafeName(name);
  const backend = preferredSecretBackend();
  void removeSecretAsync(name).catch(() => {});
  removeFileSecret(name);
  secretMemo.delete(name);
  delete process.env[name];
  return backend;
}

export function clearSecretMemo(): void {
  secretMemo.clear();
}
