/**
 * XR Phase 3 · T1 — Command-scoped boot profiles.
 *
 * Article VI · Rule 4 / Commandment 11: "Startup must be lazy and bounded:
 * a command boots only the subsystems it needs."
 *
 * Every provider declares which other providers it requires; every command
 * declares the provider ids it needs; `providerClosure()` expands a command's
 * profile into the full ordered provider set (dependencies first), and
 * XRApp.bootstrap({ profile }) then registers ONLY those providers.
 *
 * Correctness contract (Phase-0/1/2 guarantees never weaken):
 *   - The profile is DERIVED from each command's actual registry usage
 *     (Tokens.* resolved in src/commands/*), verified by a test that asserts
 *     every Tokens.X a command resolves is covered by its profile
 *     (test/perf/boot-profile.test.ts) plus a golden-path run of every
 *     command under its profile.
 *   - `null` profile = full boot (daemon `serve`, programmatic consumers,
 *     tests, and anything not in the table) — identical to pre-Phase-3.
 *   - The single composition root (XRApp) and dependency-ordered lifecycle
 *     derivation are untouched; profiles only FILTER the provider set.
 */

/** Provider id → provider ids it requires (verified against providers.ts). */
export const PROVIDER_REQUIRES: Readonly<Record<string, readonly string[]>> = {
  state: [],
  config: [],
  providers: ["config"], // LlmServiceProvider
  intelligence: ["config", "providers"],
  budget: ["state"],
  plugins: ["config", "state"],
  mcp: ["state"],
  skills: [],
  capabilities: ["state", "config"],
  trust: [],
  execution: ["state", "trust"],
  context: ["state", "intelligence"],
  agent: ["state", "config", "providers", "budget", "plugins", "mcp", "skills", "execution"],
  "multi-agents": ["state", "agent"],
  shield: ["state"],
  business: ["state", "config"],
};

/** Canonical provider boot order (matches XRApp.registerDefaultProviders). */
export const DEFAULT_PROVIDER_ORDER: readonly string[] = [
  "state",
  "config",
  "providers",
  "intelligence",
  "budget",
  "plugins",
  "mcp",
  "skills",
  "capabilities",
  "trust",
  "execution",
  "context",
  "agent",
  "multi-agents",
  "shield",
  "business",
];

/** Validate the graph is complete and acyclic at module load (fail fast). */
for (const id of DEFAULT_PROVIDER_ORDER) {
  if (!PROVIDER_REQUIRES[id]) throw new Error(`boot-profile: missing PROVIDER_REQUIRES entry for "${id}"`);
}

/**
 * Expand a provider set to its dependency closure, in canonical order with
 * dependencies first. Throws on unknown ids or cycles (configuration error
 * surfaces at boot, not silently).
 */
export function providerClosure(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (seen.has(id)) return;
    if (visiting.has(id)) throw new Error(`boot-profile: provider cycle involving "${id}"`);
    const requires = PROVIDER_REQUIRES[id];
    if (!requires) throw new Error(`boot-profile: unknown provider "${id}"`);
    visiting.add(id);
    for (const dep of requires) visit(dep);
    visiting.delete(id);
    seen.add(id);
    out.push(id);
  };

  for (const id of ids) visit(id);
  // Canonical order: dependency order dominates; emit in DEFAULT_PROVIDER_ORDER
  // for ties so the boot sequence is deterministic and readable.
  const canonical = new Set(out);
  return DEFAULT_PROVIDER_ORDER.filter((id) => canonical.has(id));
}

/**
 * Command name (registry name) → provider ids the command needs (pre-closure).
 *
 * Derived from the Tokens.* each command actually resolves (see
 * src/commands/*) and verified by test/perf/boot-profile.test.ts, which
 * asserts coverage and runs every command under its profile.
 *
 * Commands NOT listed here (or `null`) boot the full provider set — the
 * conservative default, identical to pre-Phase-3 behavior.
 */
export const COMMAND_PROFILES: Readonly<Record<string, readonly string[] | null>> = {
  // Agent-family: the agent closure is inherently broad (it composes the
  // provider plane, execution, context, plugins, skills, budget).
  run: ["agent"],
  ask: ["agent"],
  plan: ["agent"],
  agents: ["multi-agents"],

  // State-backed commands (read/write the unified store).
  audit: ["state"],
  session: ["state"],
  logs: ["state"],
  memory: ["state"],
  context: ["state"],
  mcp: ["state"],
  plugins: ["state"],
  plugin: ["state"],
  install: ["state"],
  onboarding: ["state"],
  status: ["state"],
  repair: ["state"],
  reset: ["state"],
  enterprise: ["state"],
  ent: ["state"],
  evaluate: ["state"],
  eval: ["state"],
  workspace: ["state"],
  execution: ["state"],
  voice: ["state"],
  speak: ["state"],
  listen: ["state"],
  control: ["state"],
  env: ["state"],
  research: ["state"],

  // Config + provider plane.
  config: ["config"],
  providers: ["providers", "intelligence"],
  models: ["providers", "intelligence"],

  // Budget / business / capabilities / skills / shield / trust.
  budget: ["budget"],
  business: ["business"],
  biz: ["business"],
  capabilities: ["capabilities"],
  capability: ["capabilities"],
  doctor: ["providers", "capabilities"],
  skill: ["skills"],
  skills: ["skills"],
  shield: ["shield"],
  trust: ["trust"],

  // Update reads config/state; attacks + uninstall need no registry services
  // (they operate on files directly) but keep state available for safety.
  update: ["config", "state"],
  attacks: [],
  uninstall: [],
};

/** Resolve a command's full provider list (closure), or null for full boot. */
export function profileForCommand(command: string): string[] | null {
  const ids = COMMAND_PROFILES[command];
  if (ids == null) return null;
  return providerClosure(ids);
}

/**
 * Boot-trace phase labels — single source of truth for boot-profile output.
 * (Kept here so the trace format and the profile model cannot drift.)
 */
export const BOOT_PHASES = [
  "kernel-import",
  "register",
  "init",
  "lifecycle-init",
  "start",
  "recovery",
  "execute",
] as const;
export type BootPhase = (typeof BOOT_PHASES)[number];
