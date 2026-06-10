/**
 * XR — Doctor Command
 * System health check and audit chain verification.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { Container } from "../core/container.ts";
import { ConfigService } from "../services/config-service.ts";
import { ProviderService } from "../services/provider-service.ts";
import { SessionStore } from "../state/stores/session-store.ts";
import { AuditStore } from "../state/stores/audit-store.ts";
import { UserMemoryStore } from "../state/stores/user-memory-store.ts";
import { BudgetService } from "../services/budget-service.ts";
import { PluginService } from "../services/plugin-service.ts";
import { banner, ok, warn, info, colors as C } from "../interfaces/cli.ts";

export class DoctorCommand implements Command {
  name = "doctor";
  description = "system health + audit chain check";

  async execute(ctx: CommandContext): Promise<void> {
    const { container } = ctx;
    const configService = container.resolve<ConfigService>("config");
    const providerService = container.resolve<ProviderService>("providers");
    const sessionStore = container.resolve<SessionStore>("sessionStore");
    const auditStore = container.resolve<AuditStore>("auditStore");
    const userMemoryStore = container.resolve<UserMemoryStore>("userMemoryStore");
    const budgetService = container.resolve<BudgetService>("budget");
    const pluginService = container.resolve<PluginService>("plugins");

    banner();
    const { config, warnings } = { config: configService.get(), warnings: configService.getWarnings() };
    
    console.log(`${C.bold("System Health Check")}`);
    console.log(`  config ........... ${warnings.length ? C.yellow(`⚠ ${warnings.length} warning(s)`) : C.green("✓ valid")}`);
    for (const w of warnings) console.log(`    ${C.dim(w)}`);
    
    const h = await providerService.checkHealth();
    const providerStatus = h.ok ? C.green(`✓ active`) : C.red(`✗ failed`);
    console.log(`  provider ......... ${providerStatus} ${C.dim(`(${h.detail ?? ""}${h.latencyMs ? " " + h.latencyMs + "ms" : ""})`)}`);

    const chain = auditStore.verifyChain();
    console.log(`  audit chain ...... ${chain.valid ? C.green(`✓ intact (${auditStore.count()} entries)`) : C.red(`✗ BROKEN at #${chain.brokenAt}`)}`);
    
    const budgetStatus = budgetService.getStatus();
    const budgetTag = budgetStatus.isOverBudget ? C.red("✗ exhausted") : budgetStatus.isNearCap ? C.yellow("⚠ near cap") : C.green("✓ healthy");
    console.log(`  global budget .... ${budgetTag} ${C.dim(`($${budgetStatus.monthlySpend.toFixed(2)} / $${budgetStatus.monthlyCap.toFixed(2)})`)}`);

    const memCount = userMemoryStore.count();
    console.log(`  user memory ...... ${C.green(`✓ enabled (${memCount} entries)`)}`);

    const pluginSummary = pluginService.summary();
    console.log(`  plugins .......... ${C.green(`✓ ${pluginSummary.installed} installed · ${pluginSummary.loaded} loaded`)}`);
  }
}
