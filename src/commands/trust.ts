/**
 * XR 4.2 — Trust & Isolation CLI command.
 *
 * `xr trust`            — show isolation backend availability + health
 * `xr trust classify …` — show the risk tier + placement decision for an action
 * `--json`              — stable JSON output (non-TTY friendly)
 *
 * Lets a user understand risk tier, placement, and isolation availability
 * BEFORE a consequential action. Secret-free.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { shellTrustSpec } from "../runtime/trust/tool-support.ts";

export class TrustCommand implements Command {
  name = "trust";
  description = "Trust & Isolation: risk tiers, placement backends, and pre-action decisions";
  usage = "xr trust [status|classify <command...>] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const trust = ctx.registry.resolve(Tokens.Trust);
    await trust.ensureReady();
    const args = ctx.args;
    const json = args.includes("--json");
    const positional = args.filter((a) => !a.startsWith("--"));
    const sub = (positional[0] ?? "status").toLowerCase();

    if (sub === "classify") {
      const cmd = positional.slice(1).join(" ") || "true";
      const { classification, decision } = trust.decide(shellTrustSpec(cmd, ctx.cwd).request);
      if (json) {
        console.log(
          JSON.stringify(
            {
              command: cmd,
              classification: {
                tier: classification.tier,
                reasons: classification.reasons,
                requiredApprovalLevel: classification.requiredApprovalLevel,
                requiredCredentialMode: classification.requiredCredentialMode,
                network: classification.net,
              },
              decision,
            },
            null,
            2,
          ),
        );
        return;
      }
      const where =
        decision.kind === "admitted" || decision.kind === "in_process_ok"
          ? `${decision.placement}`
          : `${decision.kind}`;
      console.log(`Command:     ${cmd}`);
      console.log(`Risk tier:   ${classification.tier}`);
      console.log(`Reasons:     ${classification.reasons.join("; ") || "-"}`);
      console.log(`Approval:    ${classification.requiredApprovalLevel}`);
      console.log(`Placement:   ${where}`);
      console.log(`Decision:    ${decision.kind} — ${decision.reason}`);
      if (decision.kind === "blocked") {
        console.log(`Remediation: ${decision.remediation ?? "-"}`);
      }
      return;
    }

    // status (default)
    const health = trust.health();
    if (json) {
      console.log(JSON.stringify(health, null, 2));
      return;
    }
    console.log("XR Trust & Isolation");
    console.log(`  Ready:               ${health.ready ? "yes" : "no"}`);
    console.log("  Placement backends:");
    for (const b of health.backends) {
      const mark = b.available ? "✓" : "✗";
      console.log(`    ${mark} ${b.placement.padEnd(20)} ${b.available ? "" : "[unavailable]"}`);
    }
    console.log(`  Active environments: ${health.activeEnvironments}`);
    console.log(`  Cleanup failures:    ${health.cleanupFailures}`);
    console.log(`  Quarantined:         ${health.quarantined}`);
    console.log(`  Active credentials:  ${health.activeCredentials}`);
    console.log("");
    console.log("  Tier 2 (high-risk) actions run inside an OS sandbox or are blocked —");
    console.log("  they never silently run in the host process.");
  }
}
