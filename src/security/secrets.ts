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
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

export type SecretBackend = "macos-keychain" | "linux-secret-service" | "windows-dpapi" | "file";

const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,80}$/;

function assertSafeName(name: string): void {
  if (!SECRET_NAME_RE.test(name)) throw new Error(`unsafe secret name: ${name}`);
}

function assertSafeValue(value: string): void {
  if (!value || /[\r\n\0]/.test(value)) throw new Error("secret value is empty or contains an unsafe newline/null byte");
}

function hasCommand(cmd: string): boolean {
  const res = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 1500,
  });
  return res.status === 0;
}

function powershell(): string | undefined {
  if (hasCommand("pwsh")) return "pwsh";
  if (hasCommand("powershell")) return "powershell";
  return undefined;
}

export function preferredSecretBackend(): SecretBackend {
  if (platform() === "darwin" && hasCommand("security")) return "macos-keychain";
  if (platform() === "linux" && hasCommand("secret-tool")) return "linux-secret-service";
  if (platform() === "win32" && powershell()) return "windows-dpapi";
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

function setWindowsSecret(name: string, value: string): boolean {
  const ps = powershell();
  if (!ps) return false;
  const script = `
$ErrorActionPreference = 'Stop'
$path = $env:XR_SECRET_PATH
$value = $env:XR_SECRET_VALUE
$secure = ConvertTo-SecureString -String $value -AsPlainText -Force
$encrypted = ConvertFrom-SecureString -SecureString $secure
Set-Content -LiteralPath $path -Value $encrypted -NoNewline
`;
  const res = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, XR_SECRET_PATH: windowsSecretPath(name), XR_SECRET_VALUE: value },
    stdio: "ignore",
    timeout: 10_000,
  });
  return res.status === 0;
}

function getWindowsSecret(name: string): string | undefined {
  const ps = powershell();
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
  const res = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, XR_SECRET_PATH: path },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  });
  const value = res.status === 0 ? res.stdout.trim() : "";
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
}

export function setSecret(name: string, value: string): SecretBackend {
  assertSafeName(name);
  assertSafeValue(value);
  const backend = preferredSecretBackend();
  if (backend === "macos-keychain") {
    const res = spawnSync("security", ["add-generic-password", "-a", name, "-s", "xr", "-w", value, "-U"], { stdio: "ignore" });
    if (res.status === 0) return backend;
  }
  if (backend === "linux-secret-service") {
    const res = spawnSync("secret-tool", ["store", "--label", `XR ${name}`, "application", "xr", "name", name], { input: value, stdio: ["pipe", "ignore", "ignore"] });
    if (res.status === 0) return backend;
  }
  if (backend === "windows-dpapi" && setWindowsSecret(name, value)) return backend;
  setFileSecret(name, value);
  return "file";
}

export function getSecret(name: string): string | undefined {
  assertSafeName(name);
  if (process.env[name]) return process.env[name];
  const backend = preferredSecretBackend();
  if (backend === "macos-keychain") {
    const res = spawnSync("security", ["find-generic-password", "-a", name, "-s", "xr", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  if (backend === "linux-secret-service") {
    const res = spawnSync("secret-tool", ["lookup", "application", "xr", "name", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  if (backend === "windows-dpapi") {
    const v = getWindowsSecret(name);
    if (v) return v;
  }
  return getFileSecret(name);
}

export function removeSecret(name: string): SecretBackend {
  assertSafeName(name);
  const backend = preferredSecretBackend();
  if (backend === "macos-keychain") {
    spawnSync("security", ["delete-generic-password", "-a", name, "-s", "xr"], { stdio: "ignore" });
  } else if (backend === "linux-secret-service") {
    spawnSync("secret-tool", ["clear", "application", "xr", "name", name], { stdio: "ignore" });
  } else if (backend === "windows-dpapi") {
    removeWindowsSecret(name);
  }
  removeFileSecret(name);
  delete process.env[name];
  return backend;
}
