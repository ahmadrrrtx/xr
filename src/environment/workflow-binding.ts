/**
 * XR 5.1 — Workflow binding: environment actions as canonical Phase 7 nodes.
 *
 * Environment actions are never hidden side effects outside the workflow
 * substrate: this factory compiles a governed environment request + assessment
 * into a canonical `tool_action` WorkflowNode (capability family
 * `control_action`) with risk tier, idempotency, compensation, and failure
 * policy mapped FROM the environment assessment — the same decisions the
 * runtime gate makes. The Phase 7 engine owns execution/scheduling; the
 * environment gate owns authority.
 */
import type { ToolActionNode } from "../workflow/types.ts";
import type { IdempotencyClass } from "../execution/types.ts";
import { assessEnvironmentAction } from "./classify.ts";
import { redactEnvironmentAction } from "./privacy.ts";
import type { EnvironmentActionRequest, EnvironmentAssessment, Reversibility } from "./types.ts";

export function idempotencyFor(reversibility: Reversibility): IdempotencyClass {
  switch (reversibility) {
    case "reversible":
      return "naturally_idempotent";
    case "compensatable":
      return "idempotent_with_key";
    case "irreversible":
    case "unknown":
      return "non_idempotent";
  }
}

export function riskTierFor(assessment: EnvironmentAssessment): "low" | "medium" | "high" {
  if (assessment.risk.level === "destructive") return "high";
  if (assessment.risk.level === "sensitive") return assessment.approval === "strong" ? "high" : "medium";
  return assessment.approval === "strong" ? "medium" : "low";
}

export interface EnvironmentNodeSpec {
  id: string;
  label: string;
  dependencies?: string[];
  timeoutMs?: number;
  request: EnvironmentActionRequest;
}

/**
 * Compile a governed environment action into a canonical tool_action node.
 * Fails (returns error) when the environment gate would block the action —
 * blocked actions must never enter a published workflow.
 */
export function buildEnvironmentActionNode(spec: EnvironmentNodeSpec):
  | { ok: true; node: ToolActionNode }
  | { ok: false; error: string } {
  const assessment = assessEnvironmentAction(spec.request);
  if (assessment.blockedReason) return { ok: false, error: assessment.blockedReason };

  const action = spec.request.action;
  const op = "op" in action ? `${action.type}.${(action as { op: string }).op}` : action.type;
  const reversibility = assessment.reversibility;
  const idempotency = idempotencyFor(reversibility);
  const riskTier = riskTierFor(assessment);

  const node: ToolActionNode = {
    id: spec.id,
    kind: "tool_action",
    label: spec.label,
    dependencies: [...(spec.dependencies ?? [])],
    idempotency,
    idempotencyKeyTemplate: idempotency === "idempotent_with_key" ? `${spec.id}:{{runId}}` : undefined,
    timeoutMs: Math.min(Math.max(spec.timeoutMs ?? 120_000, 0), 600_000),
    retry: {
      // Bounded recovery only: irreversible/unknown actions never retry.
      maxRetries: reversibility === "irreversible" || reversibility === "unknown" ? 0 : 1,
      backoffMs: 500,
      exponentialBackoff: false,
      retryableErrors: reversibility === "irreversible" || reversibility === "unknown" ? ["none"] : ["timeout", "transient"],
    },
    onFailure: {
      action: reversibility === "compensatable" ? "compensate" : "stop_workflow",
      ...(reversibility === "compensatable" ? { compensateNodeId: `${spec.id}_compensate` } : {}),
    },
    compensation:
      reversibility === "compensatable"
        ? {
            supported: true,
            nodeId: `${spec.id}_compensate`,
            scope: assessment.compensation.scope,
            description: assessment.compensation.description,
          }
        : {
            supported: false,
            scope: "none",
            description: assessment.compensation.description,
          },
    capability: {
      family: "control_action",
      name: `environment.${spec.request.environment}.${op}`,
    },
    inputSummary: JSON.stringify(redactEnvironmentAction(action)).slice(0, 500),
    inputs: {
      request: { ...spec.request, action: redactEnvironmentAction(action) },
      assessment: {
        interaction: assessment.interaction,
        reversibility,
        approval: assessment.approval,
        approvalReason: assessment.approvalReason,
      },
    },
    riskTier,
    requiresApproval: assessment.approval !== "none",
    metadata: {
      environment: spec.request.environment,
      sourceActor: spec.request.sourceActor,
      interaction: assessment.interaction,
    },
  };
  return { ok: true, node };
}
