/**
 * XR 3.1.5 (Helios) — Budget Command
 * View and manage spend caps. Glyph/color aligned with Shell status bar.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { BudgetService } from "../services/budget-service.ts";
import {
  banner,
  ok,
  emit,
  tip,
  xrCyan,
  xrDim,
  xrBold,
  xrGreen,
  xrAmber,
  xrRed,
  icon,
} from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";

export class BudgetCommand implements Command {
  name = "budget";
  description = "view spend caps and usage";
  usage = "xr budget [status|set|reset] [amount] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const { registry, args } = ctx;
    const budgetService = registry.resolve(Tokens.Budget);
    const KNOWN = new Set(["status", "show", "set", "reset", "help"]);
    const sub = args.find((a) => !a.startsWith("-") && KNOWN.has(a));

    if (!sub || sub === "status" || sub === "show") {
      const status = budgetService.getStatus();
      const cfg = budgetService.getConfig();

      emit(
        {
          ok: true,
          monthlyCap: status.monthlyCap,
          monthlySpend: status.monthlySpend,
          remainingMonthly: status.remainingMonthly,
          percentUsed: status.percentUsed,
          dailyCap: status.dailyCap,
          dailySpend: status.dailySpend,
          autoFallback: cfg.auto_fallback,
          warningsEnabled: cfg.warnings_enabled,
        },
        () => {
          banner();
          console.log(`  ${icon("budget", "amber")}  ${xrBold("Budget")}`);
          console.log(`  ${xrDim("─".repeat(40))}`);
          console.log(`  Monthly cap ...... ${xrGreen(`$${status.monthlyCap.toFixed(2)}`)}`);
          console.log(`  Monthly spend .... ${xrDim(`$${status.monthlySpend.toFixed(4)}`)}`);
          console.log(`  Remaining ........ ${xrCyan(`$${status.remainingMonthly.toFixed(4)}`)}`);
          const pctColor =
            status.percentUsed > 90 ? xrRed : status.percentUsed > 70 ? xrAmber : xrGreen;
          console.log(`  Usage ............ ${pctColor(`${status.percentUsed.toFixed(1)}%`)}`);
          if (status.dailyCap !== null) {
            console.log(`  Daily cap ........ ${xrGreen(`$${status.dailyCap.toFixed(2)}`)}`);
            console.log(`  Daily spend ...... ${xrDim(`$${status.dailySpend.toFixed(4)}`)}`);
          }
          console.log(
            `\n  Auto-fallback .... ${cfg.auto_fallback ? xrGreen("enabled") : xrRed("disabled")}`,
          );
          console.log(
            `  Warnings ......... ${cfg.warnings_enabled ? xrGreen("enabled") : xrRed("disabled")}`,
          );
          console.log();
          tip('Per-task hard cap: xr "task" --budget 0.25');
          console.log();
        },
      );
      return;
    }

    if (sub === "set") {
      const amount = Number(args.find((a, i) => i > args.indexOf("set") && !a.startsWith("-")));
      if (Number.isNaN(amount)) {
        throw usageError("Amount required", "xr budget set <usd>", ["xr budget"]);
      }
      budgetService.setMonthlyCap(amount);
      emit({ ok: true, monthlyCap: amount }, () => {
        ok(`Monthly cap updated to $${amount.toFixed(2)}`);
      });
      return;
    }

    if (sub === "reset") {
      budgetService.resetSpending();
      emit({ ok: true, reset: true }, () => {
        ok("Spending history reset.");
      });
      return;
    }

    if (sub === "help" || sub === "--help" || sub === "-h") {
      console.log("Usage: xr budget [status|set <usd>|reset]");
      return;
    }

    throw usageError(
      `Unknown budget command: ${sub}`,
      "Use status, set, or reset.",
      ["xr budget", "xr budget set 10"],
    );
  }
}
