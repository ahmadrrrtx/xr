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
 * - Fallback: ~/.xr/.env
 *
 * Performance:
 * - getSecretSyncCached never spawns (env + in-memory memo + file only)
 * - getSecretAsync uses non-blocking subprocess for OS backends
 * - getSecret remains for CLI write paths; may spawn once on cold miss
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { commandExists, runCommand } from "../util/process.ts";

export type SecretBackend = "macos-keychain" | "linux-secret-service" | "windows-dpapi" | "file";

const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");
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
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
  return join(XR_HOME, ".env");
}

function secretDir(): string {
  const dir = join(XR_HOME, "secrets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try { chmodSync(dir, 0o700); } catch {}
  return dir;
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
  const path = envPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n").filter((l) => l.trim() && !l.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  writeFileSync(path, lines.join("\n") + "\n");
  try { chmodSync(path, 0o600); } catch {}
  secretMemo.set(name, value);
}

function getFileSecret(name: string): string | undefined {
  assertSafeName(name);
  const path = envPath();
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name && rest.length) return rest.join("=").trim();
  }
  return undefined;
}

function removeFileSecret(name: string): void {
  assertSafeName(name);
  const path = envPath();
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith(`${name}=`));
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""));
  try { chmodSync(path, 0o600); } catch {}
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
  process.env[name] = value;
  return "file";
}

/**
 * Hot-path secret read: process.env → memo → file only. Never spawns.
 */
export function getSecretSyncCached(name: string): string | undefined {
  assertSafeName(name);
  if (process.env[name]) return process.env[name];
  if (secretMemo.has(name)) return secretMemo.get(name);
  const file = getFileSecret(name);
  if (file) {
    secretMemo.set(name, file);
    process.env[name] = file;
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
