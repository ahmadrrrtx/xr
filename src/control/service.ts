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
import { ActionSchema, type Action, type ActionResult, type ControlOptions, type RiskAssessment, type Plan } from "./types.ts";
import { classify } from "./classify.ts";
import { execute } from "./executor.ts";
import { detectCapabilities, isControlReady } from "./adapter.ts";
import { auditPlanned, auditExecuted, auditDenied, auditDisabled } from "./audit.ts";
import { approvals } from "./approvals.ts";
import { rememberPlan } from "./memory.ts";

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
    case "browser": {
      const sel = action.selector ? ` ${C.bold(action.selector.slice(0, 60))}` : "";
      const val = action.sensitive
        ? ` ${C.dim("«sensitive»")}`
        : action.value ? ` ${C.dim('"' + action.value.slice(0, 40) + '"')}` : "";
      return `Browser ${C.bold(action.op)}${sel}${val}`;
    }
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

/**
 * Approval gate. Sensitive/destructive actions race the CLI prompt against
 * the dashboard queue — first one to answer wins. This lets the user approve
 * from either surface without changing flags.
 */
async function shouldApprove(
  action: Action,
  risk: RiskAssessment,
  preview: string,
  opts: ControlOptions,
): Promise<boolean> {
  if (opts.mode === "dry-run") return false;          // never executes
  if (opts.mode === "step") {
    // Step mode: every action prompts, regardless of risk.
    return await raceApproval(action, risk, preview, "   Run this step?", true);
  }
  // mode === "auto"
  if (risk.level === "safe") return true;
  if (risk.level === "sensitive" && opts.autoApproveSensitive) return true;
  const prompt = risk.level === "destructive"
    ? "   This is a DESTRUCTIVE action. Proceed?"
    : "   Approve this action?";
  return await raceApproval(action, risk, preview, prompt, risk.level !== "destructive");
}

/**
 * Show the prompt on the CLI AND post to the dashboard queue. Whichever
 * surface answers first wins; the other is silently cancelled.
 */
async function raceApproval(
  action: Action,
  risk: RiskAssessment,
  preview: string,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  const pending = approvals.request(action, risk, preview);

  // CLI side
  const cli = (async () => {
    const answer = await confirm(prompt, defaultYes);
    pending.resolve(answer); // closes the dashboard prompt too
    return answer;
  })();

  // Dashboard side (only resolves if the dashboard answers first)
  const dash = pending.promise;

  return await Promise.race([cli, dash]);
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
  const preview = describe(action);
  console.log(`  ${badge(risk)} ${preview} ${C.dim("— " + risk.reason)}`);

  // 5. Approve
  if (opts.mode === "dry-run") {
    const result: ActionResult = { ok: true, skipped: true, message: "(dry-run) not executed" };
    auditExecuted(store, action, risk, result);
    return { action, risk, result };
  }

  const approved = await shouldApprove(action, risk, preview, opts);
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
  const result = await execute(action);
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

/**
 * Run a typed Plan (from the planner) with a one-shot preview + audit event.
 * This is the recommended entry point for the agent tool and the dashboard.
 *
 * After the plan finishes, if EVERY step actually executed and succeeded AND
 * the run wasn't a dry-run / partial, we attempt to remember the plan so the
 * next call with the same task hits memory and skips the LLM. All gates live
 * in memory.ts — service.ts only decides whether memory is *allowed*.
 */
export async function runTypedPlan(
  store: Store,
  plan: Plan,
  opts: ControlOptions & { memory?: boolean },
): Promise<RunResult[]> {
  store.audit("control.plan.proposed", {
    task: plan.task,
    rationale: plan.rationale ?? null,
    steps: plan.actions.length,
  });

  if (plan.rationale) {
    console.log(C.dim(`  plan: ${plan.rationale}`));
  }
  console.log(C.dim(`  ${plan.actions.length} step(s) — mode: ${opts.mode}`));

  const results = await runPlan(store, plan.actions, opts);

  // Memory gate: only when the caller explicitly enabled it AND every action
  // was actually executed AND succeeded. Dry-run, denials, and failures
  // disqualify the plan from being remembered.
  const memoryAllowed = opts.memory !== false && opts.mode === "auto";
  const allExecuted = results.length === plan.actions.length
    && results.every((r) => r.result.ok && !r.result.skipped);

  if (memoryAllowed && allExecuted) {
    rememberPlan(store, { task: plan.task, plan, allowMemory: true });
  }

  return results;
}
