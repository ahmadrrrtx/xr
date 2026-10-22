/**
 * XR-LAUNCH-015 — OS secret backends. A secret value NEVER travels on argv
 * (visible to every local user via `ps`):
 *   macOS    `security -i` reads its command line, value included, from stdin;
 *            reads use `find-generic-password -w` (value on the child's stdout).
 *   Linux    `secret-tool store` reads the value from stdin.
 *   Windows  DPAPI via PowerShell; the value arrives on stdin, never in env/argv.
 * Every op has an async form (daemon) and a sync form (CLI write paths and the
 * one-time cold read in getSecretSyncCached). Detection is spawn-free (PATH scan).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { runCommand } from "../util/process.ts";

export type OsBackendId = "macos-keychain" | "linux-secret-service" | "windows-dpapi";

export interface OsSecretBackend {
  readonly id: OsBackendId;
  set(name: string, value: string): Promise<boolean>;
  get(name: string): Promise<string | undefined>;
  remove(name: string): Promise<boolean>;
  setSync(name: string, value: string): boolean;
  getSync(name: string): string | undefined;
  removeSync(name: string): boolean;
  /** XR names held by this backend when it can enumerate them (null = cannot). */
  list(): Promise<string[] | null>;
}

export interface Spawned { ok: boolean; stdout: string }
/** Process seam: tests capture argv/stdin to prove a value never reaches argv. */
export interface SecretRunner {
  run(cmd: string, args: string[], input?: string, env?: Record<string, string>): Promise<Spawned>;
  runSync(cmd: string, args: string[], input?: string, env?: Record<string, string>): Spawned;
}

const TIMEOUT_MS = 8000;

export const defaultRunner: SecretRunner = {
  async run(cmd, args, input, env) {
    const r = await runCommand(cmd, args, { input, env: env ? { ...process.env, ...env } : undefined, timeoutMs: TIMEOUT_MS });
    return { ok: r.ok, stdout: r.stdout };
  },
  runSync(cmd, args, input, env) {
    const r = spawnSync(cmd, args, { input, env: env ? { ...process.env, ...env } : undefined, timeout: TIMEOUT_MS, encoding: "utf8", windowsHide: true });
    return { ok: r.status === 0 && !r.error, stdout: r.stdout ?? "" };
  },
};

/** Spawn-free PATH lookup. */
export function whichSync(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()).concat("") : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Which OS backend is usable here, by tool presence only (a store can still fail). */
export function detectOsBackend(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): OsBackendId | null {
  if (platform === "darwin") return whichSync("security", env) || existsSync("/usr/bin/security") ? "macos-keychain" : null;
  if (platform === "linux") return whichSync("secret-tool", env) ? "linux-secret-service" : null;
  if (platform === "win32") return whichSync("pwsh", env) || whichSync("powershell", env) ? "windows-dpapi" : null;
  return null;
}

const SERVICE = "xr";
const clean = (s: string) => s.trim(); // matches the pre-015 readers

/** `security -i` command line with the value double-quoted (stdin only). */
export function macosAddCommand(name: string, value: string): string {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `add-generic-password -U -a ${q(name)} -s ${q(SERVICE)} -w ${q(value)}\n`;
}

export function macosBackend(r: SecretRunner = defaultRunner): OsSecretBackend {
  const findArgs = (name: string) => ["find-generic-password", "-a", name, "-s", SERVICE, "-w"];
  const delArgs = (name: string) => ["delete-generic-password", "-a", name, "-s", SERVICE];
  return {
    id: "macos-keychain",
    async set(name, value) { return (await r.run("security", ["-i"], macosAddCommand(name, value))).ok; },
    async get(name) { const o = await r.run("security", findArgs(name)); return o.ok && clean(o.stdout) ? clean(o.stdout) : undefined; },
    async remove(name) { return (await r.run("security", delArgs(name))).ok; },
    setSync(name, value) { return r.runSync("security", ["-i"], macosAddCommand(name, value)).ok; },
    getSync(name) { const o = r.runSync("security", findArgs(name)); return o.ok && clean(o.stdout) ? clean(o.stdout) : undefined; },
    removeSync(name) { return r.runSync("security", delArgs(name)).ok; },
    async list() { return null; },
  };
}

export function linuxBackend(r: SecretRunner = defaultRunner): OsSecretBackend {
  const storeArgs = (name: string) => ["store", "--label", `XR ${name}`, "application", SERVICE, "name", name];
  const lookupArgs = (name: string) => ["lookup", "application", SERVICE, "name", name];
  const clearArgs = (name: string) => ["clear", "application", SERVICE, "name", name];
  return {
    id: "linux-secret-service",
    async set(name, value) { return (await r.run("secret-tool", storeArgs(name), value)).ok; },
    async get(name) { const o = await r.run("secret-tool", lookupArgs(name)); return o.ok && clean(o.stdout) ? clean(o.stdout) : undefined; },
    async remove(name) { return (await r.run("secret-tool", clearArgs(name))).ok; },
    setSync(name, value) { return r.runSync("secret-tool", storeArgs(name), value).ok; },
    getSync(name) { const o = r.runSync("secret-tool", lookupArgs(name)); return o.ok && clean(o.stdout) ? clean(o.stdout) : undefined; },
    removeSync(name) { return r.runSync("secret-tool", clearArgs(name)).ok; },
    async list() {
      // `search` also prints values; only attribute names are parsed, nothing is kept or logged.
      const o = await r.run("secret-tool", ["search", "--all", "application", SERVICE]);
      if (!o.ok) return null;
      return [...o.stdout.matchAll(/^attribute\.name = ([A-Z][A-Z0-9_]{1,80})$/gm)].map((m) => m[1]!);
    },
  };
}

const PS_SET = `$ErrorActionPreference='Stop'
$value=[Console]::In.ReadToEnd()
$secure=ConvertTo-SecureString -String $value -AsPlainText -Force
Set-Content -LiteralPath $env:XR_SECRET_PATH -Value (ConvertFrom-SecureString -SecureString $secure) -NoNewline`;
const PS_GET = `$ErrorActionPreference='Stop'
$secure=ConvertTo-SecureString -String (Get-Content -LiteralPath $env:XR_SECRET_PATH -Raw)
$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`;

export function windowsBackend(secretDir: () => string, r: SecretRunner = defaultRunner, ps = whichSync("pwsh") ? "pwsh" : "powershell"): OsSecretBackend {
  const path = (name: string) => join(secretDir(), `${name}.dpapi`);
  const args = (script: string) => ["-NoProfile", "-NonInteractive", "-Command", script];
  const rm = (name: string) => { try { rmSync(path(name), { force: true }); return true; } catch { return false; } };
  return {
    id: "windows-dpapi",
    async set(name, value) { return (await r.run(ps, args(PS_SET), value, { XR_SECRET_PATH: path(name) })).ok; },
    async get(name) {
      if (!existsSync(path(name))) return undefined;
      const o = await r.run(ps, args(PS_GET), undefined, { XR_SECRET_PATH: path(name) });
      return o.ok && o.stdout.trim() ? o.stdout.trim() : undefined;
    },
    async remove(name) { return rm(name); },
    setSync(name, value) { return r.runSync(ps, args(PS_SET), value, { XR_SECRET_PATH: path(name) }).ok; },
    getSync(name) {
      if (!existsSync(path(name))) return undefined;
      const o = r.runSync(ps, args(PS_GET), undefined, { XR_SECRET_PATH: path(name) });
      return o.ok && o.stdout.trim() ? o.stdout.trim() : undefined;
    },
    removeSync(name) { return rm(name); },
    async list() {
      try { return readdirSync(secretDir()).filter((f) => f.endsWith(".dpapi")).map((f) => f.slice(0, -".dpapi".length)); } catch { return []; }
    },
  };
}

export function osBackendFor(id: OsBackendId, secretDir: () => string): OsSecretBackend {
  if (id === "macos-keychain") return macosBackend();
  if (id === "linux-secret-service") return linuxBackend();
  return windowsBackend(secretDir);
}
