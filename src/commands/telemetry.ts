/**
 * XR — `xr telemetry` (Phase 8 · T2)
 *
 * Operator surface for the privacy-respecting observability plane:
 * status / enable / disable / set-endpoint. Telemetry is OPT-IN
 * (Constitution Art. XXI) and this command makes consent explicit and
 * reversible. Status always shows exactly what is and is not captured.
 */

import type { Command, CommandContext } from "../core/command-registry.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { heading, tip } from "../cli/output.ts";
import { xrCyan, xrDim, xrGreen, xrAmber, xrBold } from "../ui/theme.ts";

export class TelemetryCommand implements Command {
  name = "telemetry";
  description = "manage opt-in telemetry (OTLP traces/metrics/logs)";
  usage =
    "xr telemetry status [--json]\n" +
    "  xr telemetry enable [--endpoint <url>] [--content <prompt|tool-args|none>]\n" +
    "  xr telemetry disable";

  async execute(ctx: CommandContext): Promise<void> {
    const [sub = "status", ...rest] = ctx.args;
    const jsonOut = rest.includes("--json");
    const { config } = loadConfig();

    if (sub === "status") {
      const t = config.telemetry;
      if (jsonOut) {
        console.log(JSON.stringify({
          enabled: t.enabled,
          endpoint: t.endpoint,
          serviceName: t.serviceName,
          sampleRatio: t.sampleRatio,
          structuralOnly: !(t.content.prompt || t.content.toolArgs),
          content: { prompt: t.content.prompt, toolArgs: t.content.toolArgs },
          exportMetrics: t.exportMetrics,
          exportLogs: t.exportLogs,
          cardinality: "bounded (overflow folds to xr_other)",
          privacy: "opt-in · structural-by-default · redacted · local-first · no mandatory cloud",
        }, null, 2));
        return;
      }
      heading("Telemetry");
      console.log(`  ${t.enabled ? xrGreen("✓ enabled") : xrDim("○ disabled (opt-in; nothing is emitted or sent)")}`);
      if (t.enabled) {
        console.log(`  endpoint .......... ${xrCyan(t.endpoint)} ${xrDim("(OTLP/HTTP; default is the local viewer)")}`);
        console.log(`  service name ...... ${t.serviceName}`);
        console.log(`  sampling .......... ${Math.round(t.sampleRatio * 100)}%`);
      }
      console.log(`  capture mode ...... ${t.content.prompt || t.content.toolArgs ? xrAmber("structural + explicitly opted-in content flags") : xrGreen("structural only (durations, model/tool names, token counts, placements, SLOs)")}`);
      console.log(`  prompt content .... ${t.content.prompt ? xrAmber("captured (explicitly opted in)") : "never"}`);
      console.log(`  tool-args shape ... ${t.content.toolArgs ? xrAmber("captured (explicitly opted in)") : "never"}`);
      console.log(`  redaction ......... always on (PII/secrets)\n  cardinality ....... bounded per metric\n  cloud ............. never required (local-first)`);
      tip(t.enabled
        ? "viewer: docker run -p 18888:18888 -p 4318:18890 mcr.microsoft.com/dotnet/aspire-dashboard (docs/observability/LOCAL-VIEWER.md)"
        : "telemetry is off — enable with: xr telemetry enable");
      return;
    }

    if (sub === "enable") {
      const endpointIdx = rest.indexOf("--endpoint");
      const endpoint = endpointIdx >= 0 ? rest[endpointIdx + 1] : undefined;
      if (endpoint && !/^https?:\/\//.test(endpoint)) {
        throw Object.assign(new Error("endpoint must be an http(s) URL"), { exitCode: 2 });
      }
      const contentIdx = rest.indexOf("--content");
      const content = contentIdx >= 0 ? (rest[contentIdx + 1] ?? "") : "";
      config.telemetry.enabled = true;
      if (endpoint) config.telemetry.endpoint = endpoint;
      if (content === "prompt") config.telemetry.content.prompt = true;
      if (content === "tool-args") config.telemetry.content.toolArgs = true;
      if (content === "none") {
        config.telemetry.content.prompt = false;
        config.telemetry.content.toolArgs = false;
      }
      if (content && !["prompt", "tool-args", "none"].includes(content)) {
        throw Object.assign(new Error("--content must be one of: prompt | tool-args | none"), { exitCode: 2 });
      }
      saveConfig(config);
      console.log(`${xrGreen("✓")} telemetry enabled — structural-by-default, redacted, cardinality-bounded`);
      console.log(`  endpoint: ${xrCyan(config.telemetry.endpoint)}`);
      if (config.telemetry.content.prompt || config.telemetry.content.toolArgs) {
        console.log(xrAmber("  ⚠ content opt-in flags are ON (prompt/tool-args). This is your explicit choice."));
      }
      tip("local viewer: docs/observability/LOCAL-VIEWER.md — no cloud account is ever required");
      return;
    }

    if (sub === "disable") {
      config.telemetry.enabled = false;
      config.telemetry.content.prompt = false;
      config.telemetry.content.toolArgs = false;
      saveConfig(config);
      console.log(`${xrGreen("✓")} telemetry disabled — nothing is emitted or sent (content opt-ins cleared)`);
      return;
    }

    throw Object.assign(
      new Error(`unknown telemetry subcommand "${sub}" — ${xrBold("xr telemetry status")} shows what is captured`),
      { exitCode: 2 },
    );
  }
}
