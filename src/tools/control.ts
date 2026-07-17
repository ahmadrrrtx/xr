/**
 * XR v0.8.1 — Agent tool: computer_control.
 *
 * Lets the running agent perform a multi-step computer-control task in ONE
 * tool call. The tool:
 *   1. asks the planner LLM to turn the natural-language task into Action[],
 *   2. runs every action through the v0.8 safety pipeline
 *      (classify → approve → execute → audit),
 *   3. returns a compact summary to the model.
 *
 * Why a single tool, not many?
 *   • Keeps the agent budget tight (one tool call per workflow).
 *   • The existing `runAgent()` approval gate already handles the "should I
 *     even let this tool be called?" question; per-action approvals are
 *     handled INSIDE the service so the user still sees individual previews.
 *   • The agent tool inherits the dryRun flag from the agent context, so
 *     `xr --dry-run "automate X"` never touches the OS.
 */

import type { Tool, ToolResult, ToolContext } from "../core/types.ts";
import { loadConfig } from "../config/config.ts";
import { buildProvider } from "../providers/factory.ts";
import { Store } from "../state/workspace-store.ts";
import { planActions } from "../control/planner.ts";
import { runTypedPlan, isDisabled } from "../control/service.ts";
import type { ControlOptions } from "../control/types.ts";

export const computerControlTool: Tool = {
  name: "computer_control",
  description:
    "Perform a multi-step task on the user's computer (open apps, navigate sites, fill forms, click, type). " +
    "The user is prompted to approve every sensitive action. Use ONLY when the task explicitly asks XR to control the computer.",
  parameters: {
    task: "string — one natural-language sentence describing what to do",
    mode: 'string (optional) — "auto" (default), "step" (confirm each), or "dry-run" (preview only)',
  },
  requiresApproval: true, // The agent must get top-level approval before invoking this at all.
  async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const task = String(args.task ?? "").trim();
    const requestedMode = String(args.mode ?? "auto").toLowerCase();
    const mode: ControlOptions["mode"] =
      requestedMode === "dry-run" ? "dry-run"
      : requestedMode === "step" ? "step"
      : "auto";

    if (!task) return { ok: false, output: "computer_control requires a non-empty `task` argument" };

    const kill = isDisabled();
    if (kill.disabled) {
      ctx.audit("computer_control.disabled", { reason: kill.reason });
      return { ok: false, output: `computer control is disabled (${kill.reason}). Tell the user to run \`xr control start\`.` };
    }

    // If the agent is in dry-run, force the planner's execution into dry-run too.
    const effectiveMode: ControlOptions["mode"] = ctx.dryRun ? "dry-run" : mode;

    // 0.2 Storage Unification: Reuse the singleton Store that the kernel
    // bootstrapped. The WorkspaceStore module tracks the last-opened store,
    // which is the kernel's single instance. Do NOT create new Store().
    const store = Store.lastOpened() ?? new Store();
    const storeIsOwned = !Store.lastOpened(); // Only close if we created it
    try {
      // Reuse the same provider the agent is using. Pass the store so the
      // planner can consult memory before billing an LLM call.
      const { config } = loadConfig();
      const provider = buildProvider(config, {});
      const memoryEnabled = config.control?.memory?.enabled !== false;
      const planned = await planActions(provider, task, { store, noMemory: !memoryEnabled });
      if ("error" in planned) {
        ctx.audit("computer_control.plan_error", { task, error: planned.error });
        return { ok: false, output: `planner failed: ${planned.error}` };
      }
      if (planned.plan.actions.length === 0) {
        return { ok: true, output: planned.plan.rationale ?? "planner returned an empty plan (nothing to do)" };
      }

      const opts = {
        mode: effectiveMode,
        autoApproveSensitive: false, // agent path NEVER auto-approves; the human decides.
        delayMs: 250,
        memory: memoryEnabled,
      } as ControlOptions & { memory?: boolean };
      const results = await runTypedPlan(store, planned.plan, opts);
      const okCount  = results.filter((r) => r.result.ok && !r.result.skipped).length;
      const skipped  = results.filter((r) => r.result.skipped).length;
      const failed   = results.filter((r) => !r.result.ok && !r.result.skipped).length;

      ctx.audit("computer_control.summary", {
        task,
        mode: effectiveMode,
        steps: planned.plan.actions.length,
        executed: okCount,
        skipped,
        failed,
        source: planned.source, // "memory" or "llm"
      });

      const sourceTag = planned.source === "memory" ? " [recalled from memory, no LLM cost]" : "";
      const summary = `computer_control${sourceTag}: ${okCount} executed · ${skipped} skipped · ${failed} failed (mode: ${effectiveMode}). ` +
        `plan rationale: ${planned.plan.rationale ?? "(none)"}.` +
        (failed ? ` last error: ${results.find((r) => !r.result.ok && !r.result.skipped)?.result.message ?? ""}` : "");
      return { ok: failed === 0, output: summary, data: { plan: planned.plan, source: planned.source, results: results.map((r) => ({ ok: r.result.ok, skipped: r.result.skipped, message: r.result.message })) } };
    } finally {
      // 0.2 Storage Unification: Only close the store if we created it,
      // not if it's the kernel's singleton.
      if (storeIsOwned) store.close();
    }
  },
};
