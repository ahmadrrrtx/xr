/**
 * XR — Budget Command
 * View and manage spend caps.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { BudgetService } from "../services/budget-service.ts";
import { colors as C } from "../interfaces/cli.ts";
import { banner, ok } from "../interfaces/cli.ts";

export class BudgetCommand implements Command {
  name = "budget";
  description = "view spend caps and usage";

  async execute(ctx: CommandContext): Promise<void> {
    const { container, args } = ctx;
    const budgetService = container.resolve<BudgetService>("budget");
    const sub = args[0];

    if (!sub || sub === "status") {
      const status = budgetService.getStatus();
      const cfg = budgetService.getConfig();
      banner();
      console.log(`${C.bold("💰 Budget Status")}`);
      console.log(`  Monthly Cap ...... ${C.green(`$${status.monthlyCap.toFixed(2)}`)}`);
      console.log(`  Monthly Spend .... ${C.dim(`$${status.monthlySpend.toFixed(4)}`)}`);
      console.log(`  Remaining ....... ${C.cyan(`$${status.remainingMonthly.toFixed(4)}`)}`);
      console.log(`  Usage ............ ${status.percentUsed > 90 ? C.red : status.percentUsed > 70 ? C.yellow : C.green}(${status.percentUsed.toFixed(1)}%)`);
      if (status.dailyCap !== null) {
        console.log(`  Daily Cap ........ ${C.green(`$${status.dailyCap.toFixed(2)}`)}`);
        console.log(`  Daily Spend ...... ${C.dim(`$${status.dailySpend.toFixed(4)}`)}`);
      }
      console.log(`\n  Auto-fallback .... ${cfg.auto_fallback ? C.green("enabled") : C.red("disabled")}`);
      console.log(`  Warnings ........ ${cfg.warnings_enabled ? C.green("enabled") : C.red("disabled")}`);
      return;
    }

    if (sub === "set") {
      const amount = Number(args[1]);
      if (isNaN(amount)) {
        console.log(C.red(`Usage: xr budget set <amount>`));
        return;
      }
      budgetService.setMonthlyCap(amount);
      ok(`Monthly cap updated to $${amount.toFixed(2)}`);
      return;
    }

    if (sub === "reset") {
      budgetService.resetSpending();
      ok("Spending history reset.");
      return;
    }

    console.log(C.yellow(`Unknown budget command: ${sub}. Use status, set, or reset.`));
  }
}
