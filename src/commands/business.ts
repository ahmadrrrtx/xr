/**
 * XR — Business OS Command
 * Provides `xr business` and `xr biz` access to the Business OS.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { BusinessOS } from "../business/index.ts";
import { banner, ok, info, warn, xrBold, xrDim, xrGreen } from "../cli/output.ts";

export class BusinessCommand implements Command {
  name = "business";
  description = "XR Business OS commands";
  usage = "xr business [status|init]";

  async execute(ctx: CommandContext): Promise<void> {
    const businessOS = ctx.container.resolve<BusinessOS>("business");
    const sub = ctx.args[0] ?? "status";

    if (sub === "status") {
      if (!businessOS.isInitialized()) {
        console.log(`${xrBold("Business OS")} ${xrDim("— not initialized")}`);
        console.log(`Enable with: ${xrDim("config.business.enabled = true")}`);
        return;
      }
      const health = businessOS.getHealth();
      banner();
      console.log(`  ${xrBold("Business OS")} ${xrDim("v" + businessOS.getVersion().version)}`);
      console.log(`  ${xrDim("─".repeat(42))}`);
      console.log(`  Status ........ ${xrGreen(health.status)}`);
      console.log(`  Tables ........ ${Object.values(health.stats).filter((v) => v > 0).length} active`);
      const stats = businessOS.getHealth().stats;
      for (const [table, count] of Object.entries(stats)) {
        console.log(`  ${table.padEnd(28)} ${String(count).padStart(4)}`);
      }
      return;
    }

    if (sub === "init") {
      await businessOS.initialize();
      ok("Business OS initialized successfully.");
      return;
    }

    if (sub === "help" || sub === "--help" || sub === "-h") {
      console.log("Usage: xr business [status|init]");
      console.log("  xr business status  Show health and table stats");
      console.log("  xr business init    Initialize business tables");
      return;
    }

    warn(`Unknown business subcommand: ${sub}`);
    console.log("Usage: xr business [status|init]");
  }
}

export class BizAliasCommand implements Command {
  name = "biz";
  description = "Alias for xr business";
  usage = "xr biz [status|init]";

  async execute(ctx: CommandContext): Promise<void> {
    const cmd = new BusinessCommand();
    await cmd.execute({ ...ctx, args: ctx.args });
  }
}
