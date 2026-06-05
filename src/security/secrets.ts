/**
 * XR — local secret storage helpers.
 *
 * Uses OS-backed storage when a safe built-in tool is available:
 * - macOS: Keychain via `security`
 * - Linux: Secret Service via `secret-tool` if installed
 * Otherwise falls back to ~/.xr/.env with chmod 600. Raw keys are never printed.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

export type SecretBackend = "macos-keychain" | "linux-secret-service" | "file";

const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");

function hasCommand(cmd: string): boolean {
  const res = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 1500,
  });
  return res.status === 0;
}

export function preferredSecretBackend(): SecretBackend {
  if (platform() === "darwin" && hasCommand("security")) return "macos-keychain";
  if (platform() === "linux" && hasCommand("secret-tool")) return "linux-secret-service";
  return "file";
}

function envPath(): string {
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
  return join(XR_HOME, ".env");
}

function setFileSecret(name: string, value: string): void {
  const path = envPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n").filter((l) => l.trim() && !l.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  writeFileSync(path, lines.join("\n") + "\n");
  try { chmodSync(path, 0o600); } catch {}
}

function getFileSecret(name: string): string | undefined {
  const path = envPath();
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name && rest.length) return rest.join("=").trim();
  }
  return undefined;
}

function removeFileSecret(name: string): void {
  const path = envPath();
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith(`${name}=`));
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""));
  try { chmodSync(path, 0o600); } catch {}
}

export function setSecret(name: string, value: string): SecretBackend {
  const backend = preferredSecretBackend();
  if (backend === "macos-keychain") {
    const res = spawnSync("security", ["add-generic-password", "-a", name, "-s", "xr", "-w", value, "-U"], { stdio: "ignore" });
    if (res.status === 0) return backend;
  }
  if (backend === "linux-secret-service") {
    const res = spawnSync("secret-tool", ["store", "--label", `XR ${name}`, "application", "xr", "name", name], { input: value, stdio: ["pipe", "ignore", "ignore"] });
    if (res.status === 0) return backend;
  }
  setFileSecret(name, value);
  return "file";
}

export function getSecret(name: string): string | undefined {
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
  return getFileSecret(name);
}

export function removeSecret(name: string): SecretBackend {
  const backend = preferredSecretBackend();
  if (backend === "macos-keychain") {
    spawnSync("security", ["delete-generic-password", "-a", name, "-s", "xr"], { stdio: "ignore" });
  } else if (backend === "linux-secret-service") {
    spawnSync("secret-tool", ["clear", "application", "xr", "name", name], { stdio: "ignore" });
  }
  removeFileSecret(name);
  delete process.env[name];
  return backend;
}
