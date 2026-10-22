/**
 * Daemon token resolution.
 *
 * The daemon generates a fresh random bearer token on every `xr serve` start.
 * It hides it from the terminal by default and writes the CURRENT token to
 * `<XR home>/daemon/token` (owner-only, removed on shutdown; see
 * ./token-file.ts). Sources, in precedence order:
 *
 *   1. xr.token setting (application scope, never workspace settings)
 *   2. XR_DAEMON_TOKEN environment variable
 *   3. the token of a daemon this extension started this session (in memory)
 *   4. the running daemon's token file (re-read on every refresh)
 *   5. VS Code secret storage (OS keychain), filled by "XR: Set daemon token"
 *
 * The session tries them IN ORDER and moves to the next one when the daemon
 * rejects a token (401/403). So a stale setting or a token stored before a
 * daemon restart no longer blocks the connection while the token file holds
 * the current one (XR-LAUNCH-034).
 *
 * Tokens are never logged and never appear in error messages. `describeSource`
 * returns only the source name.
 */

export type TokenSource = "setting" | "environment" | "session" | "daemon-file" | "secret-storage";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

export interface TokenInputs {
  setting?: string;
  environment?: string;
  session?: string;
  daemonFile?: string;
  secretStorage?: string;
}

/** Every configured token, in precedence order, without duplicates (first source wins). */
export function resolveTokens(inputs: TokenInputs): ResolvedToken[] {
  const candidates: Array<[TokenSource, string | undefined]> = [
    ["setting", inputs.setting],
    ["environment", inputs.environment],
    ["session", inputs.session],
    ["daemon-file", inputs.daemonFile],
    ["secret-storage", inputs.secretStorage],
  ];
  const seen = new Set<string>();
  const out: ResolvedToken[] = [];
  for (const [source, value] of candidates) {
    const token = value?.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({ token, source });
  }
  return out;
}

/** The highest-precedence token, or null. */
export function resolveToken(inputs: TokenInputs): ResolvedToken | null {
  return resolveTokens(inputs)[0] ?? null;
}

export function describeSource(source: TokenSource): string {
  switch (source) {
    case "setting":
      return "xr.token setting";
    case "environment":
      return "XR_DAEMON_TOKEN environment variable";
    case "session":
      return "daemon started from VS Code this session";
    case "daemon-file":
      return "the running daemon's token file";
    case "secret-storage":
      return "VS Code secret storage";
  }
}
