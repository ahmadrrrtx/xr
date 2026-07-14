/**
 * XR 3.1C — Global CLI flag parsing
 *
 * Shared flags every command understands. Keeps naming consistent with the
 * Shell (mode / workspace / model / budget vocabulary from IA §1).
 *
 * Spec: docs/xr-3.1/XR-3.1-INFORMATION-ARCHITECTURE.md §5
 *       docs/xr-3.1/XR-3.1-ACCESSIBILITY-STANDARDS.md §4
 */

export type OutputFormat = "text" | "json" | "yaml" | "markdown";

export interface GlobalFlags {
  /** Remaining positional / command-local args after global flags are stripped. */
  args: string[];
  help: boolean;
  version: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  json: boolean;
  yaml: boolean;
  format: OutputFormat;
  noColor: boolean;
  yes: boolean;
  dryRun: boolean;
  workspace?: string;
  mode?: "agent" | "plan" | "ask";
  model?: string;
  provider?: string;
  budget?: number;
  maxTokens?: number;
  resume?: string;
  /** Raw original argv (for debugging). */
  raw: string[];
}

const BOOLEAN_FLAGS = new Set([
  "help", "h",
  "version", "v",
  "quiet", "q",
  "verbose",
  "debug",
  "json",
  "yaml",
  "no-color", "noColor",
  "yes", "y",
  "dry-run", "dryRun",
  "tui",
]);

const VALUE_FLAGS = new Set([
  "format", "output", "o",
  "workspace", "w",
  "mode",
  "model",
  "provider",
  "budget",
  "max-tokens", "maxTokens",
  "resume",
  "port",
]);

function isBooleanFlag(name: string): boolean {
  return BOOLEAN_FLAGS.has(name);
}

function isValueFlag(name: string): boolean {
  return VALUE_FLAGS.has(name);
}

function normalizeFlagName(raw: string): string {
  // --foo-bar → foo-bar; -h → h
  if (raw.startsWith("--")) return raw.slice(2);
  if (raw.startsWith("-") && raw.length === 2) return raw.slice(1);
  return raw;
}

/**
 * Parse global XR CLI flags from argv (after the binary name).
 * Does not consume the command name itself — caller decides head.
 */
export function parseGlobalFlags(argv: string[]): GlobalFlags {
  const raw = [...argv];
  const args: string[] = [];
  const out: GlobalFlags = {
    args,
    help: false,
    version: false,
    quiet: false,
    verbose: false,
    debug: false,
    json: false,
    yaml: false,
    format: "text",
    noColor: false,
    yes: false,
    dryRun: false,
    raw,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    // End of flags
    if (token === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }

    // Long flag with =value
    if (token.startsWith("--") && token.includes("=")) {
      const eq = token.indexOf("=");
      const name = token.slice(2, eq);
      const value = token.slice(eq + 1);
      applyValue(out, name, value);
      continue;
    }

    // Long / short flags
    if (token.startsWith("-") && token !== "-") {
      const name = normalizeFlagName(token);

      if (name === "h" || name === "help") { out.help = true; continue; }
      if (name === "v" || name === "version") { out.version = true; continue; }
      if (name === "q" || name === "quiet") { out.quiet = true; continue; }
      if (name === "verbose") { out.verbose = true; continue; }
      if (name === "debug") { out.debug = true; process.env.XR_DEBUG = "1"; continue; }
      if (name === "json") { out.json = true; out.format = "json"; continue; }
      if (name === "yaml") { out.yaml = true; out.format = "yaml"; continue; }
      if (name === "no-color" || name === "noColor") {
        out.noColor = true;
        process.env.NO_COLOR = "1";
        continue;
      }
      if (name === "y" || name === "yes") { out.yes = true; continue; }
      if (name === "dry-run" || name === "dryRun") { out.dryRun = true; continue; }
      if (name === "tui") { args.push("--tui"); continue; }

      if (isValueFlag(name)) {
        const next = argv[i + 1];
        if (next == null || next.startsWith("-")) {
          // leave for command-local error handling
          args.push(token);
          continue;
        }
        i++;
        applyValue(out, name, next);
        continue;
      }

      // Unknown flag — pass through to command
      args.push(token);
      continue;
    }

    // Positional
    args.push(token);
  }

  // Env overrides (accessibility + scripting)
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") out.noColor = true;
  if (process.env.XR_JSON === "1" || process.env.XR_OUTPUT === "json") {
    out.json = true;
    out.format = "json";
  }
  if (process.env.XR_QUIET === "1") out.quiet = true;
  if (process.env.XR_DEBUG === "1") out.debug = true;
  if (process.env.XR_WORKSPACE) out.workspace = process.env.XR_WORKSPACE;

  return out;
}

function applyValue(out: GlobalFlags, name: string, value: string): void {
  switch (name) {
    case "format":
    case "output":
    case "o": {
      const f = value.toLowerCase();
      if (f === "json" || f === "yaml" || f === "markdown" || f === "md" || f === "text") {
        out.format = f === "md" ? "markdown" : (f as OutputFormat);
        if (out.format === "json") out.json = true;
        if (out.format === "yaml") out.yaml = true;
      }
      break;
    }
    case "workspace":
    case "w":
      out.workspace = value;
      break;
    case "mode": {
      const m = value.toLowerCase();
      if (m === "agent" || m === "plan" || m === "ask") out.mode = m;
      break;
    }
    case "model":
      out.model = value;
      break;
    case "provider":
      out.provider = value;
      break;
    case "budget": {
      const n = Number(value);
      if (Number.isFinite(n)) out.budget = n;
      break;
    }
    case "max-tokens":
    case "maxTokens": {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) out.maxTokens = n;
      break;
    }
    case "resume":
      out.resume = value;
      break;
    case "port":
      // leave for serve; also keep as passthrough
      out.args.push("--port", value);
      break;
    default:
      break;
  }
}

/** Detect whether stdout is an interactive TTY (for color/spinners). */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.CI !== "true" && process.env.XR_CI !== "1";
}

/** Detect CI / non-interactive environments. */
export function isCiEnv(): boolean {
  return (
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.XR_CI === "1" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITLAB_CI === "true"
  );
}

/** Exit codes (Accessibility §4.7). */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NETWORK: 3,
  DENIED: 4,
  NOT_FOUND: 5,
  INTERRUPT: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
