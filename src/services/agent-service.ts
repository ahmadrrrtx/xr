/**
 * XR — Agent Service
 * Orchestrates the reasoning-action loop for the AI agent.
 */

import { ServiceRegistry } from "../core/service-registry.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { Tokens } from "../core/tokens.ts";
import { runAgent, type AgentDeps, type AgentResult } from "../core/agent.ts";
import { ProviderService } from "./provider-service.ts";
import { BudgetService } from "./budget-service.ts";
import { ConfigService } from "./config-service.ts";
import { PluginService } from "./plugin-service.ts";
import { McpService } from "./mcp-service.ts";
import { SkillService } from "./skill-service.ts";
import { SessionRepo } from "../state/repos/session-repo.ts";
import { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import { CostRepo } from "../state/repos/cost-repo.ts";
import { WorkspaceStore } from "../state/workspace-store.ts";
import { MemoryStore } from "../memory/store.ts";
import { priceFor } from "../cost/pricing.ts";
import type { ApprovalRequest, Mode, Provider } from "../core/types.ts";

/**
 * Overrides accepted by both runTask and runScopedTask. runTask is a thin
 * passthrough to runScopedTask, so it must accept the full override surface —
 * declaring a narrower type dropped options (say/approve/systemPrompt/…) that
 * the runtime forwards and honors.
 */
export interface AgentRunOverrides {
  provider?: string;
  model?: string;
  budget?: number;
  maxTokens?: number;
  maxSteps?: number;
  dryRun?: boolean;
  json?: boolean;
  systemPrompt?: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
  say?: (line: string) => void;
  approve?: (req: ApprovalRequest) => Promise<boolean>;
  memoryEnabled?: boolean;
}

export class AgentService implements LifecycleHook {
  private registry: ServiceRegistry;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a task using the agent loop.
   */
  async runTask(
    task: string,
    mode: Mode,
    overrides: AgentRunOverrides = {},
  ): Promise<AgentResult> {
    return this.runScopedTask(task, mode, overrides);
  }

  async runScopedTask(
    task: string,
    mode: Mode,
    overrides: AgentRunOverrides = {},
  ): Promise<AgentResult> {
    const configService = this.registry.resolve(Tokens.Config);
    const providerService = this.registry.resolve(Tokens.Providers);
    const budgetService = this.registry.resolve(Tokens.Budget);
    const pluginService = this.registry.resolve(Tokens.Plugins);
    const mcpService = this.registry.resolve(Tokens.Mcp);
    let skillService: SkillService | undefined;
    skillService = this.registry.tryResolve(Tokens.Skills);
    const sessionStore = this.registry.resolve(Tokens.SessionStore);
    const memoryStore = this.registry.resolve(Tokens.UserMemoryStore);
    const costStore = this.registry.resolve(Tokens.CostStore);

    const config = configService.get();

    // Stage 6 — the canonical memory engine, backed by the same WorkspaceStore the rest
    // of the system uses, so CLI / TUI / voice / dashboard / agent all share ONE
    // memory. (The legacy UserMemoryRepo stays registered for backward compat.)
    /** 0.2 Storage Unification: Resolve the single workspace store. */
    const unifiedStore = this.registry.resolve(Tokens.Store);
    const engine = new MemoryStore(unifiedStore);
    const provider = providerService.getProvider({
      provider: overrides.provider,
      model: overrides.model,
    });

    // Determine pricing for this provider
    const pricing = priceFor(provider.id, (overrides.model ?? config.defaults.model));

    const budget = {
      maxUsd: overrides.budget ?? config.budget.perTaskUsd,
      maxTokens: overrides.maxTokens ?? config.budget.perTaskTokens,
    };

    await pluginService.ensureLoaded();
    await mcpService.ensureLoaded();

    const { confirm } = await import("../interfaces/cli.ts");

    let skillPrompt = "";
    try {
      const ctx = skillService?.executionContext(task, 4);
      if (ctx?.prompt) skillPrompt = ctx.prompt;
    } catch {
      /* skills are best-effort; they must never break the agent */
    }

    const scopedSystemPrompt = [skillPrompt, overrides.systemPrompt]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join("\n\n");

    const deps: AgentDeps = {
      provider,
      sessionStore,
      auditStore: this.registry.resolve(Tokens.AuditStore),
      costStore,
      userMemoryStore: memoryStore,
      cwd: process.cwd(),
      systemPrompt: scopedSystemPrompt || undefined,
      tools: {
        allow: overrides.toolsAllow,
        deny: overrides.toolsDeny,
      },
      say: overrides.say ?? ((line: string) => console.log(line)),
      approve: overrides.approve ?? (async (req) => {
        const preview = req.preview ? `\n${req.preview}` : "";
        return await confirm(`Approve ${req.tool}? ${req.reason}${preview}`, false);
      }),
      onOverBudget: async (meter, reason) => {
        return null; // Default to stop
      },
      budget,
      pricing,
      maxSteps: overrides.maxSteps ?? 12,
      egressAllowlist: config.security.egressAllowlist,
      dryRun: overrides.dryRun,
      memory: {
        enabled: overrides.memoryEnabled ?? (config.memory.enabled && config.memory.injectInChat),
        recallLimit: config.memory.recallLimit,
        semantic: config.memory.semanticRecall,
      },
      memoryStore: engine,
      sessionSummary: {
        enabled: config.memory.enabled && config.memory.saveSessionSummaries,
        minTurns: config.memory.sessionSummaryMinTurns,
      },
      extraTools: [...pluginService.getPluginTools(), ...mcpService.getMcpTools()],
    };

    return await runAgent(task, mode, deps);
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}
}
