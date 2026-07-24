/**
 * XR 4.1 — Control/Computer Action Adapter
 *
 * Wraps the existing classify→preview→approve→execute→audit flow so each
 * control Action produces a canonical execution record. Does not replace
 * any control logic (risk classification remains authoritative).
 */
import type { Action, ActionResult, ControlOptions, Plan, RiskAssessment } from "../../control/types.ts";
import type { ExecutionService } from "../service.ts";
import type { ActorIdentity, ExecutionObservation } from "../types.ts";
import {
  IN_PROCESS_PLACEMENT,
  failObservation,
  okObservation,
  redact,
  safeJson,
  sizeBytes,
  userActor,
} from "./common.ts";
import { controlTrustRequest } from "../../trust/tool-support.ts";

export interface ControlAdapterOptions {
  service: ExecutionService;
  workspaceId: string;
  sessionId?: string;
  actor?: ActorIdentity;
  cwd?: string;
  /** Existing control execute function (performs the actual side effect). */
  execute: (action: Action) => Promise<ActionResult>;
  /** Existing classify function (risk assessor). */
  classify: (action: Action) => RiskAssessment;
  /** Approval hook (existing control approvals path). */
  approve?: (action: Action, risk: RiskAssessment, preview?: string) => Promise<boolean>;
  /** Optional preview generator. */
  preview?: (action: Action) => Promise<string | undefined>;
  /** Audit sink. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

/**
 * Run one control Action through the fabric. Returns the original ActionResult
 * shape (back-compat) plus the canonical record attached.
 */
export async function executeControlAction(
  action: Action,
  opts: ControlAdapterOptions,
): Promise<ActionResult & { __execution?: import("../types.ts").ExecutionRecord }> {
  const service = opts.service;
  const actor = opts.actor ?? userActor("cli");
  const risk = opts.classify(action);
  const prev = opts.preview ? await opts.preview(action).catch(() => undefined) : undefined;

  let result: ActionResult = { ok: false, message: "action not executed" };

  const record = await service.execute({
    workspaceId: opts.workspaceId,
    sessionId: opts.sessionId,
    actor,
    intent: {
      summary: `control ${action.type}`,
      origin: actor,
      constraints: { cwd: opts.cwd, mode: "control" },
    },
    plan: {
      summary: `control action: ${action.type}`,
      risk: risk.level,
      preview: prev,
    },
    capability: { kind: "control_action", name: action.type },
    placement: IN_PROCESS_PLACEMENT,
    // XR 4.2 — record the control risk tier/placement. Destructive (GUI/browser)
    // actions are host-authority: admitted with an elevated gate, not blocked.
    trust: { request: controlTrustRequest(action.type, risk.level, opts.cwd ?? process.cwd()) },
    idempotency: "unknown_unsafe",
    inputSummary: redact(safeJson(action)),
    inputBytes: sizeBytes(safeJson(action)),
    dryRun: false,
    maxAttempts: 1,
    approve:
      risk.level !== "safe" && opts.approve
        ? async (_req) => {
            const ok = await opts.approve!(action, risk, prev);
            return ok;
          }
        : undefined,
    audit: opts.audit,
    run: async (ctx) => {
      let obs: ExecutionObservation;
      try {
        const r = await opts.execute(action);
        result = r;
        obs = (r.ok ? okObservation : failObservation)(r.message, {
          meta: r.data as Record<string, unknown> | undefined,
          outputBytes: sizeBytes(r.message),
        });
        ctx.addEvidence({
          kind: "control_record",
          reference: `action:${action.type}`,
          meta: { risk: risk.level, skipped: !!r.skipped },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = { ok: false, message: msg };
        obs = failObservation(msg, { logs: [msg], meta: { action: action.type } });
      }
      return obs;
    },
  });

  if (record.outcome?.kind === "denied") {
    result = { ok: false, message: "denied: approval not granted", skipped: true };
  } else if (record.outcome?.kind === "succeeded" && !result.ok) {
    result = { ok: true, message: record.observation?.summary ?? "ok" };
  }

  return Object.assign(result, { __execution: record });
}
