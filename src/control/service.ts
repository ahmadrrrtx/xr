/**
 * XR v0.8 — Computer Control: service facade.
 *
 *   plan → preview → execute
 *
 * Every public entry point on this service runs the same six-step pipeline:
 *
 *   1. Refuse if control is disabled by config or env (kill switch).
 *   2. Validate the Action with Zod.
 *   3. Classify risk (pure function).
 *   4. Audit the *plan*.
 *   5. Approve (skip-/auto-/always-prompt according to mode + risk).
 *   6. Execute (or skip on dry-run / denial) and audit the *result*.
 *
 * This is the only entry point higher layers (CLI, voice, agent) should call.
 * Direct imports of executor.ts from outside `src/control/` are a smell.
 */

import { confirm, colors as C } from "../interfaces/cli.ts";
import { loadConfig } from "../config/config.ts";
import type { Store } from "../state/db.ts";
import { ActionSchema, type Action, type ActionResult, type ControlOptions, type RiskAssessment } from "./types.ts";
import { classify } from "./classify.ts";
import { execute } from "./executor.ts";
import { detectCapabilities, isControlReady } from "./adapter.ts";
import { auditPlanned, auditExecuted, auditDenied, auditDisabled } from "./audit.ts";

// ── Disable switch ──────────────────────────────────────────────────────────

export function isDisabled(): { disabled: boolean; reason?: string } {
  if (process.env.XR_CONTROL_DISABLED === "1") {
    return { disabled: true, reason: "XR_CONTROL_DISABLED=1 in environment" };
  }
  try {
    const { config } = loadConfig();
    if (config.control?.enabled === false) {
      return { disabled: true, reason: "control.enabled is false in config.json" };
    }
  } catch {
    // If config is unreadable we fail safe → disabled.
    return { disabled: true, reason: "config could not be loaded" };
  }
  return { disabled: false };
}

// ── Pretty preview ──────────────────────────────────────────────────────────

function describe(action: Action): string {
  switch (action.type) {
    case "app":    return `Launch app ${C.bold(action.name)}`;
    case "focus":  return `Focus window ${C.bold(action.name)}`;
    case "open":   return `Open ${C.bold(action.target)}`;
    case "type":   return action.sensitive
      ? `Type ${C.dim("«sensitive value, " + action.text.length + " chars»")}`
      : `Type "${C.bold(action.text.length > 60 ? action.text.slice(0, 57) + "..." : action.text)}"`;
    case "click":  return action.target
      ? `${action.button}-click ${C.bold(action.target)}`
      : `${action.button}-click at (${C.bold(String(action.x))}, ${C.bold(String(action.y))})`;
    case "move":   return `Move cursor to (${action.x}, ${action.y})`;
    case "scroll": return `Scroll ${C.bold(action.direction)} ×${action.amount}`;
    case "key":    return `Press ${C.bold(action.keys.join("+"))}`;
  }
}

function badge(risk: RiskAssessment): string {
  switch (risk.level) {
    case "safe":        return C.green("[safe]");
    case "sensitive":   return C.amber("[sensitive]");
    case "destructive": return C.red("[destructive]");
  }
}

// ── Approval gate ───────────────────────────────────────────────────────────

async function shouldApprove(
  risk: RiskAssessment,
  opts: ControlOptions,
): Promise<boolean> {
  if (opts.mode === "dry-run") return false;          // never executes
  if (opts.mode === "step") return await confirm("   Run this step?", true);
  // mode === "auto"
  if (risk.level === "safe") return true;
  if (risk.level === "sensitive" && opts.autoApproveSensitive) return true;
  // sensitive without --yes, OR destructive (always): prompt.
  const prompt = risk.level === "destructive"
    ? "   This is a DESTRUCTIVE action. Proceed?"
    : "   Approve this action?";
  // Destructive defaults to NO; sensitive defaults to YES (familiar pattern).
  return await confirm(prompt, risk.level !== "destructive");
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RunResult {
  action: Action;
  risk: RiskAssessment;
  result: ActionResult;
}

export async function runAction(
  store: Store,
  raw: unknown,
  opts: ControlOptions,
): Promise<RunResult> {
  // 1. Kill switch
  const kill = isDisabled();
  if (kill.disabled) {
    const result: ActionResult = { ok: false, skipped: true, message: `computer control is disabled (${kill.reason})` };
    // Best-effort audit if the action looks parseable.
    const safe = ActionSchema.safeParse(raw);
    if (safe.success) auditDisabled(store, safe.data);
    return {
      action: safe.success ? safe.data : ({ type: "focus", name: "(invalid)" } as Action),
      risk: { level: "safe", reason: "disabled", reversible: true },
      result,
    };
  }

  // 2. Validate
  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      action: { type: "focus", name: "(invalid)" } as Action,
      risk: { level: "safe", reason: "invalid", reversible: true },
      result: { ok: false, skipped: true, message: `invalid action: ${parsed.error.issues.map(i => i.message).join("; ")}` },
    };
  }
  const action = parsed.data;

  // 3. Classify
  const risk = classify(action);

  // 4. Audit plan + preview
  auditPlanned(store, action, risk);
  console.log(`  ${badge(risk)} ${describe(action)} ${C.dim("— " + risk.reason)}`);

  // 5. Approve
  if (opts.mode === "dry-run") {
    const result: ActionResult = { ok: true, skipped: true, message: "(dry-run) not executed" };
    auditExecuted(store, action, risk, result);
    return { action, risk, result };
  }

  const approved = await shouldApprove(risk, opts);
  if (!approved) {
    auditDenied(store, action, risk);
    const result: ActionResult = { ok: false, skipped: true, message: "denied by user" };
    return { action, risk, result };
  }

  // Capability check before execution — better message than a raw fail.
  if (!isControlReady()) {
    const caps = detectCapabilities();
    const result: ActionResult = {
      ok: false,
      skipped: true,
      message: `required tools missing: ${caps.missing.join("; ") || "none"}`,
    };
    auditExecuted(store, action, risk, result);
    return { action, risk, result };
  }

  // 6. Execute
  const result = execute(action);
  auditExecuted(store, action, risk, result);

  if (opts.delayMs && opts.delayMs > 0) {
    await new Promise((r) => setTimeout(r, opts.delayMs));
  }

  return { action, risk, result };
}

/** Plan → preview → execute a list of actions. */
export async function runPlan(
  store: Store,
  actions: unknown[],
  opts: ControlOptions,
): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (let i = 0; i < actions.length; i++) {
    console.log(C.dim(`  step ${i + 1}/${actions.length}`));
    const r = await runAction(store, actions[i], opts);
    out.push(r);
    // If a step failed (not skipped), stop the plan unless user is in step mode.
    if (!r.result.ok && !r.result.skipped && opts.mode !== "step") {
      console.log(C.red("  plan halted after failure"));
      break;
    }
  }
  return out;
}
