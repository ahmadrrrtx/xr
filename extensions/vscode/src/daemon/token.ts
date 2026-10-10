/**
 * Daemon token resolution.
 *
 * The daemon generates a fresh random bearer token on every `xr serve` start
 * and prints it once. It does not write it to disk, so the extension cannot
 * read it from a file. Sources, in precedence order:
 *
 *   1. xr.token setting (application scope, never workspace settings)
 *   2. XR_DAEMON_TOKEN environment variable
 *   3. the token of a daemon this extension started this session (in memory)
 *   4. VS Code secret storage (OS keychain), filled by "XR: Set daemon token"
 *
 * Tokens are never logged and never appear in error messages. `describeSource`
 * returns only the source name.
 */

export type TokenSource = "setting" | "environment" | "session" | "secret-storage";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

export interface TokenInputs {
  setting?: string;
  environment?: string;
  session?: string;
  secretStorage?: string;
}

export function resolveToken(inputs: TokenInputs): ResolvedToken | null {
  const candidates: Array<[TokenSource, string | undefined]> = [
    ["setting", inputs.setting],
    ["environment", inputs.environment],
    ["session", inputs.session],
    ["secret-storage", inputs.secretStorage],
  ];
  for (const [source, value] of candidates) {
    const token = value?.trim();
    if (token) return { token, source };
  }
  return null;
}

export function describeSource(source: TokenSource): string {
  switch (source) {
    case "setting":
      return "xr.token setting";
    case "environment":
      return "XR_DAEMON_TOKEN environment variable";
    case "session":
      return "daemon started from VS Code this session";
    case "secret-storage":
      return "VS Code secret storage";
  }
}
