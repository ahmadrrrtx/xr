/**
 * Phase 23 — persistent prompt history (`~/.xr/cli-history`, one entry per line).
 *
 * Location: $XR_HOME/cli-history (XR_HOME defaults to ~/.xr; `--config` moves it).
 * Entries that look like they
 * carry a credential are never written: a prompt is a message, and a pasted key
 * must not end up in a plaintext file.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HISTORY_MAX = 1000;

/** Patterns that mean "this line probably contains a secret". */
const SECRET_LIKE = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /(api[_-]?key|token|secret|password|passwd)\s*[=:]\s*\S{6,}/i,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

/** `~/.xr/cli-history` (or `$XR_HOME/cli-history`), next to the engine config. */
export function historyPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.XR_HOME || join(homedir(), ".xr");
  return join(home, "cli-history");
}

export function looksSecret(line: string): boolean {
  return SECRET_LIKE.some((re) => re.test(line));
}

export function loadHistory(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
    return lines.slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

/** Append one entry. Never throws: history is a convenience, not a requirement. */
export function appendHistory(path: string, entry: string): void {
  const line = entry.replace(/\r?\n/g, " ").trim();
  if (!line || looksSecret(line)) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
  } catch {
    /* unwritable home: keep working without history */
  }
}

/** Keep the file bounded. Called rarely (at session start). */
export function trimHistory(path: string): void {
  try {
    const lines = loadHistory(path);
    if (existsSync(path) && readFileSync(path, "utf8").split("\n").length > HISTORY_MAX * 2) {
      writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
    }
  } catch {
    /* ignore */
  }
}
