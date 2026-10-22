/**
 * The running daemon's token file (XR-LAUNCH-034, durable pairing).
 *
 * `xr serve` writes its CURRENT token to `<XR home>/daemon/token` (directory
 * 0700, file 0600), rewrites it on every start and removes it on shutdown. The
 * token still rotates per start; nothing long-lived is stored. Reading it again
 * whenever the daemon rejects a token lets the extension survive a daemon
 * restart without asking the user to paste a new token.
 *
 * Path rule (same as src/daemon/token-file.ts in the XR repo):
 *   $XR_HOME/daemon/token, or ~/.xr/daemon/token when XR_HOME is unset.
 *
 * The file is used only when it is a regular file (not a symlink), small,
 * and — on macOS/Linux — owned by the current user and not readable by
 * group/others. A file that fails a check is ignored, never "repaired".
 * The token value is never logged or put in an error message.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAX_TOKEN_FILE_BYTES = 1024;

export function daemonTokenPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const xrHome = env.XR_HOME?.trim() || path.join(home, ".xr");
  return path.join(xrHome, "daemon", "token");
}

export type TokenFileResult =
  | { ok: true; token: string; path: string }
  | { ok: false; reason: "missing" | "not-a-file" | "too-large" | "not-owner" | "too-open" | "empty" | "unreadable"; path: string };

export interface TokenFileOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Override for tests; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Override for tests; defaults to process.getuid(). */
  uid?: number;
}

export function readDaemonTokenFile(opts: TokenFileOptions = {}): TokenFileResult {
  const file = daemonTokenPath(opts.env ?? process.env, opts.home ?? os.homedir());
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    return { ok: false, reason: "missing", path: file };
  }
  if (!st.isFile()) return { ok: false, reason: "not-a-file", path: file };
  if (st.size > MAX_TOKEN_FILE_BYTES) return { ok: false, reason: "too-large", path: file };
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") {
    const uid = opts.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
    if (uid !== undefined && st.uid !== uid) return { ok: false, reason: "not-owner", path: file };
    if ((st.mode & 0o077) !== 0) return { ok: false, reason: "too-open", path: file };
  }
  let token: string;
  try {
    token = fs.readFileSync(file, "utf8").trim();
  } catch {
    return { ok: false, reason: "unreadable", path: file };
  }
  if (!token) return { ok: false, reason: "empty", path: file };
  return { ok: true, token, path: file };
}

/** Human text for a skipped file. Never contains the token. */
export function describeTokenFileProblem(result: TokenFileResult): string | null {
  if (result.ok || result.reason === "missing") return null;
  switch (result.reason) {
    case "not-a-file":
      return `${result.path} is not a regular file, so it was ignored.`;
    case "too-large":
      return `${result.path} is too large to be a daemon token, so it was ignored.`;
    case "not-owner":
      return `${result.path} is owned by another user, so it was ignored.`;
    case "too-open":
      return `${result.path} is readable by other users, so it was ignored. Restart \`xr serve\` to rewrite it with owner-only permissions.`;
    case "empty":
      return `${result.path} is empty.`;
    case "unreadable":
      return `${result.path} could not be read.`;
  }
}
