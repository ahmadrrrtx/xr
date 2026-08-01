/**
 * XR Phase 3 · T1 — Provider module registry (compile-safe).
 *
 * Maps provider id → per-provider module. XRApp loads ONLY the modules in a
 * command's boot profile, so the kernel's import cost scales with what a
 * command actually needs (Commandment 11) instead of eagerly evaluating the
 * entire service graph (Article XII · Forbidden: "Eager-importing the whole
 * runtime at startup").
 *
 * COMPILE-SAFETY (Global Rule 7): the dynamic imports below are written as
 * STATIC STRING LITERALS inside the switch — never as computed paths. Bun's
 * `--compile` tracer follows literal specifiers at build time; a variable
 * `import(name)` fails at boot in the compiled binary (proven by
 * test/perf/binary-smoke.test.ts).
 */

import type { ServiceProvider } from "./app.ts";

/** Provider id → module/symbol metadata (kept for diagnostics/docs). */
export const PROVIDER_MODULES: Readonly<Record<string, { path: string; symbol: string }>> = {
  state: { path: "./providers/state.ts", symbol: "StateServiceProvider" },
  config: { path: "./providers/config.ts", symbol: "ConfigServiceProvider" },
  providers: { path: "./providers/llm.ts", symbol: "LlmServiceProvider" },
  intelligence: { path: "./providers/intelligence.ts", symbol: "IntelligenceServiceProvider" },
  budget: { path: "./providers/budget.ts", symbol: "BudgetServiceProvider" },
  plugins: { path: "./providers/plugins.ts", symbol: "PluginServiceProvider" },
  mcp: { path: "./providers/mcp.ts", symbol: "McpServiceProvider" },
  skills: { path: "./providers/skills.ts", symbol: "SkillServiceProvider" },
  capabilities: { path: "./providers/capabilities.ts", symbol: "CapabilityServiceProvider" },
  trust: { path: "./providers/trust.ts", symbol: "TrustServiceProvider" },
  execution: { path: "./providers/execution.ts", symbol: "ExecutionServiceProvider" },
  context: { path: "./providers/context.ts", symbol: "ContextServiceProvider" },
  agent: { path: "./providers/agent.ts", symbol: "AgentServiceProvider" },
  "multi-agents": { path: "./providers/multi-agents.ts", symbol: "MultiAgentServiceProvider" },
  shield: { path: "./providers/shield.ts", symbol: "ShieldServiceProvider" },
  business: { path: "./providers/business.ts", symbol: "BusinessServiceProvider" },
};

/**
 * Literal-path dynamic import per provider id. This switch is the ONLY place
 * provider modules are imported; adding a provider requires adding one case
 * here (compile-safe by construction).
 */
async function importProviderModule(id: string): Promise<Record<string, new () => ServiceProvider>> {
  switch (id) {
    case "state":
      return (await import("./providers/state.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "config":
      return (await import("./providers/config.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "providers":
      return (await import("./providers/llm.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "intelligence":
      return (await import("./providers/intelligence.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "budget":
      return (await import("./providers/budget.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "plugins":
      return (await import("./providers/plugins.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "mcp":
      return (await import("./providers/mcp.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "skills":
      return (await import("./providers/skills.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "capabilities":
      return (await import("./providers/capabilities.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "trust":
      return (await import("./providers/trust.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "execution":
      return (await import("./providers/execution.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "context":
      return (await import("./providers/context.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "agent":
      return (await import("./providers/agent.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "multi-agents":
      return (await import("./providers/multi-agents.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "shield":
      return (await import("./providers/shield.ts")) as unknown as Record<string, new () => ServiceProvider>;
    case "business":
      return (await import("./providers/business.ts")) as unknown as Record<string, new () => ServiceProvider>;
    default:
      throw new Error(`provider-modules: unknown provider "${id}"`);
  }
}

/** Load one provider instance. */
export async function loadProvider(id: string): Promise<ServiceProvider> {
  const entry = PROVIDER_MODULES[id];
  if (!entry) throw new Error(`provider-modules: unknown provider "${id}"`);
  const mod = await importProviderModule(id);
  const Ctor = mod[entry.symbol];
  if (typeof Ctor !== "function") {
    throw new Error(`provider-modules: export "${entry.symbol}" not found in ${entry.path}`);
  }
  return new Ctor();
}

/** Load the default provider set in canonical boot order. */
export async function loadDefaultProviders(order: readonly string[]): Promise<ServiceProvider[]> {
  const out: ServiceProvider[] = [];
  for (const id of order) out.push(await loadProvider(id));
  return out;
}
