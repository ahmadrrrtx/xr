/**
 * XR — Doctor Command
 * Stage 3: includes provider health matrix in diagnostics.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import {
  printStatus,
  probeHealth,
  detectPlatform,
} from "../install/system.ts";
import { ProviderService } from "../services/provider-service.ts";
import { banner, colors as C, ok, warn } from "../interfaces/cli.ts";

export class DoctorCommand implements Command {
  name = "doctor";
  description = "system health, dependency, audit, and provider check";
  usage = "xr doctor [--network] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const json = ctx.args.includes("--json");

    if (json) {
      // Build combined JSON output including provider health
      const opts: any = {};
      for (const a of ctx.args) if (a === "--network") opts.network = true;
      const checks = await probeHealth(opts);

      try {
        const providerService = ctx.container.resolve<ProviderService>(
          "providers",
        );
        const reports = await providerService.checkAllProviders();
        for (const r of reports) {
          checks.push({
            id: `provider-${r.id}`,
            label: `Provider: ${r.id}`,
            state: r.ok ? "ok" : r.authOk ? "warn" : "fail",
            detail: r.detail,
            remediation: r.ok
              ? undefined
              : r.authOk
              ? "Provider endpoint unreachable"
              : `Set API key or run: xr providers add ${r.id}`,
          });
        }
      } catch (e) {
        checks.push({
          id: "providers",
          label: "Provider health",
          state: "warn",
          detail: (e as Error).message,
        });
      }

      console.log(
        JSON.stringify(
          { platform: detectPlatform(), checks },
          null,
          2,
        ),
      );
      return;
    }

    // Text mode: print base status, then append provider health
    await printStatus(ctx.args);

    try {
      const providerService = ctx.container.resolve<ProviderService>(
        "providers",
      );
      const reports = await providerService.checkAllProviders();
      if (reports.length) {
        console.log("");
        console.log(C.bold("Provider Health"));
        for (const r of reports) {
          const status = r.ok
            ? C.green("✓")
            : r.authOk
            ? C.amber("!")
            : C.red("✗");
          const latency = r.latencyMs ? C.dim(` ${r.latencyMs}ms`) : "";
          console.log(
            `  ${r.id.padEnd(12)} ${status}  ${r.detail}${latency}`,
          );
        }
      }
    } catch (e) {
      warn(`Provider health check failed: ${(e as Error).message}`);
    }
  }
}
