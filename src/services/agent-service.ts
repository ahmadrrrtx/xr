/**
 * XR — Agent Service
 * Orchestrates the reasoning-action loop for the AI agent.
 */

import { Container } from "../core/container.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { runAgent, type AgentDeps, type AgentResult } from "../core/agent.ts";
import { ProviderService } from "./provider-service.ts";
import { BudgetService } from "./budget-service.ts";
import { ConfigService } from "./config-service.ts";
import { PluginService } from "./plugin-service.ts";
import { McpService } from "./mcp-service.ts";
import { SessionStore } from "../state/stores/session-store.ts";
import { UserMemoryStore } from "../state/stores/user-memory-store.ts";
import { CostStore } from "../state/stores/cost-store.ts";
import { Store } from "../state/db.ts";
import { MemoryStore } from "../memory/store.ts";
import { priceFor } from "../cost/pricing.ts";
import type { Mode, Provider } from "../core/types.ts";

export class AgentService implements LifecycleHook {
  private container: Container;

  constructor(container: Container) {
    this.container = container;
  }

  /**
   * Execute a task using the agent loop.
   */
  async runTask(
    task: string,
    mode: Mode,
    overrides: {
      provider?: string;
      model?: string;
      budget?: number;
      maxTokens?: number;
      maxSteps?: number;
      dryRun?: boolean;
      json?: boolean;
    } = {},
  ): Promise<AgentResult> {
    return this.runScopedTask(task, mode, overrides);
  }

  async runScopedTask(
    task: string,
    mode: Mode,
    overrides: {
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
      approve?: (req: any) => Promise<boolean>;
      memoryEnabled?: boolean;
    } = {},
  ): Promise<AgentResult> {
    const configService = this.container.resolve<ConfigService>("config");
    const providerService = this.container.resolve<ProviderService>("providers");
    const budgetService = this.container.resolve<BudgetService>("budget");
    const pluginService = this.container.resolve<PluginService>("plugins");
    const mcpService = this.container.resolve<McpService>("mcp");
    const sessionStore = this.container.resolve<SessionStore>("sessionStore");
    const memoryStore = this.container.resolve<UserMemoryStore>("userMemoryStore");
    const costStore = this.container.resolve<CostStore>("costStore");

    const config = configService.get();

    // Stage 6 — the canonical memory engine, backed by the same Store the rest
    // of the system uses, so CLI / TUI / voice / dashboard / agent all share ONE
    // memory. (The legacy UserMemoryStore stays registered for backward compat.)
    const legacyStore = this.container.resolve<Store>("legacyStore");
    const engine = new MemoryStore(legacyStore);
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

    const deps: AgentDeps = {
      provider,
      sessionStore,
      auditStore: this.container.resolve<any>("auditStore"),
      costStore,
      userMemoryStore: memoryStore,
      cwd: process.cwd(),
      systemPrompt: overrides.systemPrompt,
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
