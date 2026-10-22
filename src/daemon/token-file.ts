/**
 * XR-LAUNCH-018 / 034 — the running daemon's token, readable by its owner only.
 *
 * `xr serve` hides the token from the terminal banner by default, so a person
 * opening the dashboard (and the VS Code extension reconnecting after a daemon
 * restart) needs another local way to get it. The daemon writes the CURRENT
 * token to `<XR home>/daemon/token`:
 *
 *   · directory 0700, file 0600, written atomically (temp file + rename);
 *   · rewritten on every start (the token still rotates per start; nothing
 *     long-lived is stored), removed on shutdown, and only if it still holds
 *     this daemon's token, so a second daemon's file is never deleted;
 *   · best-effort: a read-only home never prevents `xr serve` from starting.
 *
 * Windows: POSIX modes are a no-op; the file inherits the ACL of the user's
 * profile directory (disclosed in docs/security/KNOWN_LIMITATIONS.md).
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function daemonTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XR_HOME || join(homedir(), ".xr"), "daemon", "token");
}

/** Read the current daemon token (trimmed), or null when no daemon has written one. */
export function readDaemonTokenFile(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const value = readFileSync(daemonTokenPath(env), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

const active = new Set<() => void>();
let exitHookInstalled = false;

export interface DaemonTokenFile {
  /** Absolute path, or null when the file could not be written. */
  path: string | null;
  /** Remove the file if it still holds this daemon's token. Idempotent. */
  release: () => void;
}

export function writeDaemonTokenFile(token: string, env: NodeJS.ProcessEnv = process.env): DaemonTokenFile {
  const file = daemonTokenPath(env);
  const dir = join(file, "..");
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32" && !lstatSync(dir).isSymbolicLink()) chmodSync(dir, 0o700);
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${token}\n`, { mode: 0o600, flag: "w" });
    if (process.platform !== "win32") chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch {
    return { path: null, release: () => {} };
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    active.delete(release);
    try {
      if (existsSync(file) && readFileSync(file, "utf8").trim() === token) unlinkSync(file);
    } catch {
      /* best-effort on shutdown */
    }
  };
  active.add(release);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // One process-wide hook (not one per daemon) so a process that exits
    // without calling stop() still removes the token it wrote.
    process.once("exit", () => {
      for (const r of [...active]) r();
    });
  }
  return { path: file, release };
}
