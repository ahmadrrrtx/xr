/**
 * XR-LAUNCH-016 — owner-only permissions for the XR data home.
 *
 * Under the default umask (022) `xr.db`, `config.json` and the data
 * directories used to be created 0644/0755, readable by every local account.
 * Now the data home is created 0700 and every XR-written DB/config file 0600.
 * Existing installs are tightened on start (idempotent, once per process),
 * and each change is logged to ~/.xr/logs/permissions-migration.log.
 *
 * Scope is deliberately narrow: the home itself plus its direct children.
 * A 0700 home already blocks traversal to everything below it; children are
 * tightened as defence in depth. Only group/other bits are removed (owner
 * bits, including exec on an install checkout that shares XR_HOME, are kept).
 * Symlinks and files owned by another uid are never touched, and the user's
 * own home directory or a filesystem root is refused outright. The process
 * umask is NOT changed: it would leak into files XR writes in user projects.
 * Windows uses per-user profile ACLs instead of POSIX modes, so this is a no-op there.
 */
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";

export interface HardenReport {
  home: string;
  /** Paths (relative to home; "." = home) whose group/other bits were removed. */
  changed: string[];
  skipped?: string;
}

const hardened = new Set<string>();

function tighten(path: string): boolean {
  let st;
  try { st = lstatSync(path); } catch { return false; }
  if (st.isSymbolicLink() || (st.mode & 0o077) === 0) return false;
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) return false;
  try { chmodSync(path, st.mode & 0o700); return true; } catch { return false; }
}

export function hardenDataHome(home: string, platform: NodeJS.Platform = process.platform): HardenReport {
  const abs = resolve(home);
  const report: HardenReport = { home: abs, changed: [] };
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true, mode: 0o700 });
  if (platform === "win32") return { ...report, skipped: "windows: per-user profile ACLs, not POSIX modes" };
  if (abs === resolve(homedir()) || abs === parse(abs).root) {
    return { ...report, skipped: "refusing to tighten the user home directory or a filesystem root" };
  }
  if (tighten(abs)) report.changed.push(".");
  let entries: string[] = [];
  try { entries = readdirSync(abs); } catch { /* unreadable: nothing more to do */ }
  for (const name of entries) if (tighten(join(abs, name))) report.changed.push(name);
  if (report.changed.length) {
    try {
      mkdirSync(join(abs, "logs"), { recursive: true, mode: 0o700 });
      appendFileSync(
        join(abs, "logs", "permissions-migration.log"),
        `${new Date().toISOString()} removed group/other access: ${report.changed.join(", ")}\n`,
        { mode: 0o600 },
      );
    } catch { /* best-effort */ }
  }
  return report;
}

/** Create-or-tighten the data home once per process (config load path). Never throws. */
export function hardenDataHomeOnce(home: string): void {
  const key = resolve(home);
  // Existence is ensured on EVERY call (the old ensureHome contract): a home
  // removed mid-process (tests, a manual reset) must be recreated, 0700.
  if (!existsSync(key)) {
    try { mkdirSync(key, { recursive: true, mode: 0o700 }); } catch { /* surfaced by the caller's write */ }
  }
  if (hardened.has(key)) return;
  hardened.add(key);
  try { hardenDataHome(key); } catch { /* permissions are best-effort; never block startup */ }
}

/** Restrict an XR-owned file (DB, WAL/SHM, config) to the owner. */
export function restrictToOwner(path: string): void {
  if (process.platform === "win32") return;
  tighten(path);
}
