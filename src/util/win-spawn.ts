/**
 * Windows batch-shim spawning (Bun ≥ 1.4 / Node CVE-2024-27980 hardening).
 *
 * `node:child_process` refuses to start a `.cmd`/`.bat` without a shell
 * (`spawn EINVAL`) — and on Windows `npm`, `npx`, `xr` (npm launcher) and
 * npm-installed `bun` are all `.cmd` shims. `shell: true` alone is unsafe
 * (cmd.exe re-parses the arguments), so a batch target runs through an
 * explicit `cmd.exe /d /s /c "<quoted line>"` with verbatim arguments, and any
 * argument carrying a cmd.exe metacharacter is refused instead of escaped.
 * Everything else (non-Windows, real .exe) is returned unchanged.
 */
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

const BATCH = /^\.(cmd|bat)$/i;
const UNSAFE = /[\0\r\n"%!^&|<>]/;

export function resolveWindowsCommand(cmd: string, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  if (extname(cmd)) return /[\\/]/.test(cmd) ? (exists(cmd) ? cmd : null) : findOnPath(cmd, [""], env, exists);
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return /[\\/]/.test(cmd) ? exts.map((e) => cmd + e).find(exists) ?? null : findOnPath(cmd, exts, env, exists);
}

function findOnPath(cmd: string, exts: string[], env: NodeJS.ProcessEnv, exists: (p: string) => boolean): string | null {
  for (const dir of (env.PATH ?? env.Path ?? "").split(";").filter(Boolean)) {
    for (const e of exts) if (exists(join(dir, cmd + e))) return join(dir, cmd + e);
  }
  return null;
}

/** `[command, args, extraSpawnOptions]` safe to hand to spawn/spawnSync. */
export function shimSafe(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists?: (p: string) => boolean): [string, string[], { windowsVerbatimArguments?: boolean }] {
  if (platform !== "win32") return [cmd, [...args], {}];
  const target = BATCH.test(extname(cmd)) ? cmd : resolveWindowsCommand(cmd, env, exists);
  if (!target || !BATCH.test(extname(target))) return [cmd, [...args], {}];
  for (const a of [target, ...args]) {
    if (UNSAFE.test(a)) throw new Error(`refusing to pass ${JSON.stringify(a)} to the Windows batch shim ${target}: cmd.exe would re-parse it`);
  }
  const line = [target, ...args].map((a) => (a === "" || /[\s,;=]/.test(a) ? `"${a}"` : a)).join(" ");
  return [env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true }];
}
