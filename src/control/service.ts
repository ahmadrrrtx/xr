/**
 * XR Stage 9 — Computer Control: service facade.
 * plan → preview → execute
 */

import { confirm, colors as C } from "../interfaces/cli.ts";
import { loadConfig } from "../config/config.ts";
import type { Store } from "../state/workspace-store.ts";
import { ActionSchema, type Action, type ActionResult, type ControlOptions, type RiskAssessment, type Plan } from "./types.ts";
import { classify } from "./classify.ts";
import { execute } from "./executor.ts";
import { detectCapabilities, isControlReady } from "./adapter.ts";
import { auditPlanned, auditExecuted, auditDenied, auditDisabled } from "./audit.ts";
import { approvals } from "./approvals.ts";
import { rememberPlan } from "./memory.ts";
import { checkPermissionForAction } from "./permissions.ts";

export function isDisabled(): { disabled: boolean; reason?: string } {
  if (process.env.XR_CONTROL_FORCE_TEST === "1") {
    return { disabled: false };
  }
  if (process.env.XR_CONTROL_DISABLED === "1") {
    return { disabled: true, reason: "XR_CONTROL_DISABLED=1 in environment" };
  }
  try {
    const { config } = loadConfig();
    if (config.control?.enabled === false) {
      return { disabled: true, reason: "control.enabled is false in config.json" };
    }
  } catch {
    return { disabled: true, reason: "config could not be loaded" };
  }
  return { disabled: false };
}

function describe(action: Action): string {
  switch (action.type) {
    case "app":    return `Launch app ${C.bold(action.name)}`;
    case "close":  return `Close app ${C.bold(action.name)}`;
    case "focus":  return `Focus window ${C.bold(action.name)}`;
    case "open":   return `Open ${C.bold(action.target)}`;
    case "type":   return action.sensitive
      ? `Type ${C.dim("«sensitive value, " + action.text.length + " chars»")}`
      : `Type "${C.bold(action.text.length > 60 ? action.text.slice(0, 57) + "..." : action.text)}"`;
    case "click":  return action.target
      ? `${action.button}-click ${C.bold(action.target)}`
      : `${action.button}-click at (${C.bold(String(action.x))}, ${C.bold(String(action.y))})`;
    case "drag_drop": return `Drag (${action.x1},${action.y1}) → (${action.x2},${action.y2})`;
    case "move":   return `Move cursor to (${action.x}, ${action.y})`;
    case "scroll": return `Scroll ${C.bold(action.direction)} ×${action.amount}`;
    case "key":    return `Press ${C.bold(action.keys.join("+"))}`;
    case "wait_ms": return `Wait ${action.ms}ms`;
    case "browser": {
      const sel = action.selector ? ` ${C.bold(action.selector.slice(0, 60))}` : "";
      const val = action.sensitive ? ` ${C.dim("«sensitive»")}` : action.value ? ` ${C.dim('"' + action.value.slice(0, 40) + '"')}` : "";
      return `Browser ${C.bold(action.op)}${sel}${val}`;
    }
    case "file": return `File ${action.op} ${C.bold(action.path)}${action.targetPath ? " → " + action.targetPath : ""}`;
    case "editor": return `Open ${action.editor} ${action.file || ""}${action.line ? ":"+action.line : ""}`;
    case "screenshot": return `Screenshot ${action.target}`;
    case "system": return `System ${action.op}${action.value ? " " + action.value.slice(0,40) : ""}`;
    case "computer_use": return `Computer-use: ${C.bold(action.task.slice(0,60))}`;
  }
}

function badge(risk: RiskAssessment): string {
  switch (risk.level) {
    case "safe":        return C.green("[safe]");
    case "sensitive":   return C.amber("[sensitive]");
    case "destructive": return C.red("[destructive]");
  }
}

async function shouldApprove(
  action: Action,
  risk: RiskAssessment,
  preview: string,
  opts: ControlOptions,
): Promise<boolean> {
  if (opts.mode === "dry-run") return false;
  if (opts.mode === "step") {
    return await raceApproval(action, risk, preview, "   Run this step?", true);
  }
  if (risk.level === "safe") return true;
  if (risk.level === "sensitive" && opts.autoApproveSensitive) return true;
  const prompt = risk.level === "destructive"
    ? "   This is a DESTRUCTIVE action. Proceed?"
    : "   Approve this action?";
  return await raceApproval(action, risk, preview, prompt, risk.level !== "destructive");
}

async function raceApproval(
  action: Action,
  risk: RiskAssessment,
  preview: string,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  const pending = approvals.request(action, risk, preview);
  const cli = (async () => {
    const answer = await confirm(prompt, defaultYes);
    pending.resolve(answer);
    return answer;
  })();
  const dash = pending.promise;
  return await Promise.race([cli, dash]);
}

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
  const kill = isDisabled();
  if (kill.disabled) {
    const result: ActionResult = { ok: false, skipped: true, message: `computer control is disabled (${kill.reason})` };
    const safe = ActionSchema.safeParse(raw);
    if (safe.success) auditDisabled(store, safe.data);
    return {
      action: safe.success ? safe.data : ({ type: "focus", name: "(invalid)" } as Action),
      risk: { level: "safe", reason: "disabled", reversible: true },
      result,
    };
  }

  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      action: { type: "focus", name: "(invalid)" } as Action,
      risk: { level: "safe", reason: "invalid", reversible: true },
      result: { ok: false, skipped: true, message: `invalid action: ${parsed.error.issues.map(i => i.message).join("; ")}` },
    };
  }
  const action = parsed.data;

  // Permission check – Stage 9
  const perm = process.env.XR_CONTROL_FORCE_TEST === "1" ? { allowed: true } : checkPermissionForAction(action.type);
  // file_write is a special case – check the op
  if (action.type === "file" && (action.op === "write" || action.op === "move" || action.op === "delete" || action.op === "mkdir")) {
    const { hasPermission } = await import("./permissions.ts");
    if (!hasPermission("files_write")) {
      const result: ActionResult = { ok: false, skipped: true, message: `permission 'files_write' not granted – run: xr control permissions grant files_write` };
      return { action, risk: { level: "safe", reason: "forbidden", reversible: true }, result };
    }
  } else if (!perm.allowed) {
    const permReason = "reason" in perm && perm.reason ? perm.reason : "action not permitted by control permissions";
    const result: ActionResult = { ok: false, skipped: true, message: permReason };
    return { action, risk: { level: "safe", reason: "forbidden", reversible: true }, result };
  }

  const risk = classify(action);
  auditPlanned(store, action, risk);
  const preview = describe(action);
  console.log(`  ${badge(risk)} ${preview} ${C.dim("— " + risk.reason)}`);

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

  const result = await execute(action);
  auditExecuted(store, action, risk, result);

  if (opts.delayMs && opts.delayMs > 0) {
    await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return { action, risk, result };
}

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
    if (!r.result.ok && !r.result.skipped && opts.mode !== "step") {
      console.log(C.red("  plan halted after failure"));
      break;
    }
  }
  return out;
}

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

  const memoryAllowed = opts.memory !== false && opts.mode === "auto";
  const allExecuted = results.length === plan.actions.length
    && results.every((r) => r.result.ok && !r.result.skipped);

  if (memoryAllowed && allExecuted) {
    rememberPlan(store, { task: plan.task, plan, allowMemory: true });
  }
  return results;
}

// Stage 9 – computer-use wrapper
export async function runComputerUse(store: Store, task: string, provider: any): Promise<string> {
  const { runComputerUse: runCU } = await import("./computer-use.ts");
  return runCU({ provider, store, task, maxSteps: 20 });
}
