/**
 * XR — Route decision (pure)
 *
 * Phase 3 · T1/T10 — the routing decision is extracted from the CLI router
 * into this dependency-light module so that:
 *
 *   1. `xr <command>` resolution does not force-load any command module
 *      (the router now lazy-loads commands AFTER the decision is made);
 *   2. the route-decision performance budget (<20 ms p95) is measured
 *      against exactly the code that runs, with no kernel import tax;
 *   3. tests can assert routing behavior without booting the kernel.
 *
 * Behavior is byte-for-byte what `registryNameFor` did inside router.ts
 * before this extraction — this is a move, not a redesign (Phase 3 scope:
 * optimize the existing substrate, no capability change).
 */

import {
  resolveCommandName,
  getCatalogEntry,
  allAliasesAndNames,
  type CatalogEntry,
} from "./catalog.ts";

/** Alias → registry name. Kept here as the single routing authority map. */
const REGISTRY_NAME: Record<string, string> = {
  shell: "shell", // not registered — fast path
  serve: "serve",
  help: "help",
  version: "version",
  run: "run",
  ask: "ask",
  plan: "plan",
  research: "research",
  repo: "repo",
  repomap: "repo",
  agents: "agents",
  agent: "agents",
  control: "control",
  computer: "control",
  env: "env",
  environment: "env",
  voice: "voice",
  speak: "speak",
  listen: "listen",
  workspace: "workspace",
  workspaces: "workspace",
  ws: "workspace",
  session: "session",
  sessions: "session",
  memory: "memory",
  mem: "memory",
  context: "context",
  ctx: "context",
  knowledge: "context",
  config: "config",
  cfg: "config",
  settings: "config",
  trust: "trust",
  isolation: "trust",
  providers: "providers",
  provider: "providers",
  models: "models",
  model: "models",
  budget: "budget",
  cost: "budget",
  spend: "budget",
  skills: "skills",
  skill: "skill",
  marketplace: "skills",
  capabilities: "capabilities",
  capability: "capability",
  caps: "capabilities",
  plugins: "plugins",
  plugin: "plugin",
  mcp: "mcp",
  hygiene: "hygiene",
  // Phase 5 · ADR-0027 — deprecated aliases for `xr hygiene`.
  shield: "shield",
  security: "hygiene",
  audit: "audit",
  "verify-log": "audit",
  // Phase 06 — durable-execution history & recovery surface.
  execution: "execution",
  log: "logs",
  logs: "logs",
  telemetry: "telemetry",
  attacks: "attacks",
  lab: "attacks",
  "security-lab": "attacks",
  doctor: "doctor",
  health: "doctor",
  check: "doctor",
  status: "status",
  update: "update",
  upgrade: "update",
  repair: "repair",
  reset: "reset",
  install: "install",
  onboarding: "onboarding",
  setup: "onboarding",
  init: "onboarding",
  business: "business",
  biz: "business",
  enterprise: "enterprise",
  ent: "enterprise",
  evaluate: "evaluate",
  eval: "eval",
  benchmark: "evaluate",
  task: "run",
  do: "run",
  exec: "run",
};

/** Map a raw CLI token to its registry command name. */
export function registryNameFor(input: string): string | undefined {
  const lower = input.toLowerCase();
  if (REGISTRY_NAME[lower]) return REGISTRY_NAME[lower];
  const canonical = resolveCommandName(lower);
  if (canonical && REGISTRY_NAME[canonical]) return REGISTRY_NAME[canonical];
  return canonical;
}

/** Fast-path classification of a command token (route decision, pure). */
export type RouteKind = "version" | "help" | "command-help" | "shell" | "serve" | "command" | "task" | "unknown";

export interface RouteDecision {
  kind: RouteKind;
  /** Registry command name for kind "command" / "command-help". */
  command?: string;
  catalog?: CatalogEntry;
}

export interface RouteInput {
  /** First non-flag token. */
  head: string | undefined;
  /** `--version` / `-v` global flag present. */
  flagsVersion?: boolean;
  /** `--help` / `-h` global flag present. */
  flagsHelp?: boolean;
  /** `--help`/`-h` appears in the remaining args (`xr <cmd> --help`). */
  wantsCommandHelp?: boolean;
}

/**
 * Decide what `head` (the first non-flag token) means, without loading any
 * command module or booting the kernel. This is the entire route decision
 * that the <20 ms budget covers — everything after this is command-scoped
 * lazy boot, budgeted separately.
 *
 * The decision order mirrors the pre-Phase-3 router exactly (version → help →
 * command-help → shell → serve → command → task), so this module can become
 * the single routing authority the router dispatches on.
 */
export function decideRoute(input: RouteInput): RouteDecision {
  const { head, flagsVersion, flagsHelp, wantsCommandHelp } = input;
  if (flagsVersion || head === "version" || head === "--version" || head === "-v") {
    return { kind: "version" };
  }
  if ((flagsHelp && !head) || head === "help" || head === "--help" || head === "-h") {
    return { kind: "help" };
  }
  if (head && (flagsHelp || wantsCommandHelp)) {
    return { kind: "command-help", command: resolveCommandName(head) ?? head };
  }
  if (!head || head === "shell" || head === "--tui" || head === "tui") {
    return { kind: "shell" };
  }
  if (head === "serve") return { kind: "serve" };
  const regName = registryNameFor(head);
  if (regName && regName !== "shell" && regName !== "serve" && regName !== "help" && regName !== "version") {
    return { kind: "command", command: regName, catalog: getCatalogEntry(head) };
  }
  if (head && !head.startsWith("-") && !resolveCommandName(head)) {
    return { kind: "task" };
  }
  return { kind: "unknown" };
}

export { allAliasesAndNames };
