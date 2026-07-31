/**
 * XR Phase 2 · T4 — `PlanningService`: the single planning authority.
 *
 * Constitution Art. III.2 (one source of truth per concern) and Art. IV.4
 * (fail closed).
 *
 * ── The two authorities this replaces ───────────────────────────────────────
 *
 *   src/agents/planner.ts   → `WorkflowRecord` (multi-agent DAG: tasks + deps)
 *                             built from a deterministic template.
 *                             **No runtime validation of the produced plan.**
 *   src/control/planner.ts  → `Plan` = `Action[]` (computer-control steps)
 *                             parsed from a model reply and validated with Zod.
 *
 * Two independent planning entry points with ASYMMETRIC safety: the control
 * planner rejected a malformed/jailbroken plan, the workflow planner had no
 * schema gate at all. Art. IV.4 requires ambiguity to deny on BOTH.
 *
 * ── What this service does and does not unify ───────────────────────────────
 *
 * Unified: the planning AUTHORITY — one service, one place to ask for a plan,
 * one validation contract, one error taxonomy.
 *
 * NOT unified: the OUTPUT KINDS. A workflow DAG and a control action list are
 * genuinely different artefacts with different consumers and different
 * execution semantics. They remain distinct, discriminated by `kind`, and each
 * is validated by its own schema. Collapsing them would be the same category
 * error this phase forbids for extension types.
 *
 * The service PROPOSES. It never executes — that remains the caller's decision
 * (authority ≠ intelligence, Inviolable P5).
 */

import { z } from "zod";
import type { Provider } from "../core/types.ts";
import type { Store } from "../state/workspace-store.ts";
import { ActionSchema, type Plan as ControlPlan } from "../control/types.ts";
import { planActions, type PlanSource } from "../control/planner.ts";
import { compileWorkflowPlan } from "../agents/planner.ts";
import type { WorkflowPlanRequest, WorkflowRecord } from "../agents/types.ts";

// ── Output-kind schemas ─────────────────────────────────────────────────────

/**
 * Runtime schema for the CONTROL output kind.
 * `ActionSchema` is the same schema the control executor enforces, so a plan
 * that validates here cannot be rejected later for shape reasons.
 */
export const ControlPlanSchema = z.object({
  task: z.string().min(1),
  actions: z.array(ActionSchema).max(20),
  rationale: z.string().optional(),
});

/**
 * Runtime schema for the WORKFLOW output kind.
 *
 * NEW in Phase 2: the workflow planner previously returned an unvalidated
 * object. This schema encodes the structural invariants the multi-agent
 * executor actually relies on — non-empty id/goal, at least one task, every
 * task carrying an agent role and a status, and (critically) every declared
 * dependency referring to a task that exists in the same record.
 */
export const WorkflowPlanSchema = z
  .object({
    workflowId: z.string().min(1),
    goal: z.string().min(1),
    kind: z.string().min(1),
    status: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    tasks: z
      .array(
        z
          .object({
            taskId: z.string().min(1),
            workflowId: z.string().min(1),
            role: z.string().min(1),
            name: z.string().min(1),
            status: z.string().min(1),
            dependencies: z.array(z.string()),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

// ── Service contract ────────────────────────────────────────────────────────

export type PlanKind = "workflow" | "control";

export interface WorkflowPlanInput extends WorkflowPlanRequest {
  readonly kind?: WorkflowPlanRequest["kind"];
}

export interface ControlPlanInput {
  readonly provider: Provider;
  readonly task: string;
  readonly maxActions?: number;
  readonly store?: Store;
  readonly noMemory?: boolean;
}

export interface WorkflowPlanResult {
  readonly kind: "workflow";
  readonly plan: WorkflowRecord;
  readonly source: "template";
}

export interface ControlPlanResult {
  readonly kind: "control";
  readonly plan: ControlPlan;
  readonly source: PlanSource;
}

export type PlanResult = WorkflowPlanResult | ControlPlanResult;

/** Structured failure. Planning never throws for a bad plan — it denies. */
export class PlanValidationError extends Error {
  constructor(
    readonly planKind: PlanKind,
    readonly issues: string[],
  ) {
    super(`${planKind} plan failed schema validation: ${issues.join("; ")}`);
    this.name = "PlanValidationError";
  }
}

export class PlanningService {
  /**
   * Produce a WORKFLOW plan (multi-agent DAG).
   *
   * Phase 2 adds the schema gate this path never had: a structurally invalid
   * record — including one with a dangling dependency — is REFUSED rather than
   * handed to the executor.
   */
  planWorkflow(input: WorkflowPlanInput): WorkflowPlanResult {
    const record = compileWorkflowPlan(input);

    const parsed = WorkflowPlanSchema.safeParse(record);
    if (!parsed.success) {
      throw new PlanValidationError(
        "workflow",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }

    // Referential integrity: every dependency must name a task in this record.
    // A dangling edge would deadlock the multi-agent executor, so it denies.
    const ids = new Set(record.tasks.map((t) => t.taskId));
    const dangling: string[] = [];
    for (const task of record.tasks) {
      for (const dep of task.dependencies ?? []) {
        if (!ids.has(dep)) dangling.push(`${task.taskId} depends on unknown task ${dep}`);
      }
    }
    if (dangling.length > 0) throw new PlanValidationError("workflow", dangling);

    return { kind: "workflow", plan: record, source: "template" };
  }

  /**
   * Produce a CONTROL plan (validated action list).
   *
   * Delegates to the existing memory-then-LLM strategy, then re-validates the
   * result against the same schema the executor enforces. Preserves the
   * fail-closed behaviour: a parse failure returns a structured error, never a
   * partially-trusted plan.
   */
  async planControl(input: ControlPlanInput): Promise<ControlPlanResult | { error: string }> {
    const result = await planActions(input.provider, input.task, {
      ...(input.maxActions !== undefined ? { maxActions: input.maxActions } : {}),
      ...(input.store !== undefined ? { store: input.store } : {}),
      ...(input.noMemory !== undefined ? { noMemory: input.noMemory } : {}),
    });
    if ("error" in result) return result;

    const parsed = ControlPlanSchema.safeParse(result.plan);
    if (!parsed.success) {
      return {
        error: `control plan failed schema validation: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      };
    }

    return { kind: "control", plan: result.plan, source: result.source };
  }

  /**
   * Discriminated entry point — one call site can request either kind and the
   * compiler narrows the result.
   */
  async plan(
    request: { kind: "workflow"; input: WorkflowPlanInput },
  ): Promise<WorkflowPlanResult>;
  async plan(
    request: { kind: "control"; input: ControlPlanInput },
  ): Promise<ControlPlanResult | { error: string }>;
  async plan(
    request:
      | { kind: "workflow"; input: WorkflowPlanInput }
      | { kind: "control"; input: ControlPlanInput },
  ): Promise<PlanResult | { error: string }> {
    return request.kind === "workflow"
      ? this.planWorkflow(request.input)
      : await this.planControl(request.input);
  }
}

/** Process-wide instance. Planning is stateless, so one instance is safe. */
export const planningService = new PlanningService();
