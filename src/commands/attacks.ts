/**
 * XR 3.1.5 (Helios) — Injection defense lab
 *
 * Canonical: xr attacks
 * Spec: security lab, IA trust vocabulary
 */

import type { Command, CommandContext } from "../core/command-registry.ts";
import { runLab } from "../security/lab.ts";
import {
  banner,
  heading,
  ok,
  warn,
  emit,
  table,
  xrCyan,
  xrDim,
  xrGreen,
  xrRed,
  xrBold,
  statusMark,
} from "../cli/output.ts";

export class AttacksCommand implements Command {
  name = "attacks";
  description = "run prompt-injection defense benchmark";
  usage = "xr attacks [--json]";

  async execute(_ctx: CommandContext): Promise<void> {
    const report = runLab();
    const pct = Math.round(report.rate * 100);

    emit(
      {
        ok: true,
        total: report.total,
        blocked: report.blocked,
        rate: report.rate,
        percent: pct,
        outcomes: report.outcomes,
      },
      () => {
        banner();
        heading("Injection defense lab");
        const mark =
          pct >= 90 ? statusMark("ok") : pct >= 70 ? statusMark("warn") : statusMark("error");
        console.log(
          `  ${mark} Blocked ${xrBold(String(report.blocked))}/${report.total}  (${xrBold(String(pct) + "%")})`,
        );
        console.log();

        const rows = report.outcomes.slice(0, 40).map((o) => [
          o.id.slice(0, 16),
          o.category.slice(0, 14),
          o.blocked ? xrGreen("blocked") : xrRed("missed"),
          (o.by || "—").slice(0, 24),
        ]);
        table(["id", "category", "result", "by"], rows, {
          widths: [18, 16, 10, 26],
        });
        if (report.outcomes.length > 40) {
          console.log(`  ${xrDim(`… ${report.outcomes.length - 40} more (use --json for full report)`)}`);
        }
        console.log();
        if (pct >= 90) ok("Defense posture looks strong");
        else warn("Review missed cases and tighten egress / approval policies");
        console.log(`  ${xrDim("See also:")} ${xrCyan("xr shield status")} · ${xrCyan("xr audit verify")}`);
        console.log();
      },
    );
  }
}
