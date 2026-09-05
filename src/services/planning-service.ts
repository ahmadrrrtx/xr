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
import { compileWorkflowPlan, templateRoleSetFor } from "../agents/planner.ts";
import { getAgentByRole } from "../agents/registry.ts";
import type { WorkflowPlanRequest, WorkflowRecord, WorkflowTask, AgentRole } from "../agents/types.ts";
import { loadConfig } from "../config/config.ts";
import { randomUUID } from "node:crypto";

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

/**
 * Phase 6 · Step 5 — the STRICT fragment schema. `strict()` everywhere: a
 * fragment asking for anything the editor does not model (tools, budget,
 * roles) fails to parse — it is never coerced, never partially applied.
 */
export const PlanFragmentSchema = z
  .object({
    add: z
      .array(
        z
          .object({
            role: z
              .enum([
                "planner", "researcher", "builder", "reviewer", "executor",
                "synthesizer", "verifier", "security_checker", "memory_manager",
              ]),
            name: z.string().min(3).max(160),
            description: z.string().min(10).max(2000),
            afterTaskId: z.string().max(64).optional(),
          })
          .strict(),
      )
      .max(3)
      .optional(),
    rename: z
      .array(z.object({ taskId: z.string().max(64), name: z.string().min(3).max(160) }).strict())
      .max(8)
      .optional(),
    skip: z.array(z.string().max(64)).max(8).optional(),
  })
  .strict()
  .refine((f) => (f.add?.length ?? 0) + (f.rename?.length ?? 0) + (f.skip?.length ?? 0) > 0, {
    message: "fragment is empty",
  });

/** First balanced top-level JSON object in text, or null. (No prose rescue.) */
export function extractFirstJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Kind detection for the verifier gate, kept out of the compile call site. */
function detectKindForVerifier(goal: string): "general" | "research" | "build" | "refactor" | "security" | "automation" | "business" {
  // Local mirror of planner.detectWorkflowKind without importing a second
  // authority into the service; the PLANNING gate owns this decision.
  const q = goal.toLowerCase();
  if (/(threat|security|vuln|audit|cve|hardening|sandbox|permissions?)/i.test(q)) return "security";
  if (/(research|investigate|compare|study|analyze market|benchmark|literature)/i.test(q)) return "research";
  if (/(browser|computer|click|open app|automation|desktop|fill form|upload|download)/i.test(q)) return "automation";
  if (/(refactor|migrate|cleanup|rewrite|rename|restructure)/i.test(q)) return "refactor";
  if (/(build|implement|code|feature|fix|test|package|repo|repository|typescript|bun|react|next)/i.test(q)) return "build";
  if (/(sales|support|ops|business|proposal|customer)/i.test(q)) return "business";
  return "general";
}

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
    // Phase 6 · Step 4 — the verifier slot is a template decision informed by
    // config (`orchestration.verifierKinds`). Explicit caller input always
    // wins; unset means "ask the config". Reading config here keeps the
    // compiler itself pure/deterministic.
    let effective: WorkflowPlanInput = input;
    if (input.withVerifier === undefined) {
      try {
        const orch = loadConfig().config.orchestration;
        const kind = input.kind ?? detectKindForVerifier(input.goal);
        effective = { ...input, withVerifier: orch.verifier && orch.verifierKinds.includes(kind) };
      } catch {
        effective = { ...input, withVerifier: false };
      }
    }
    const record = compileWorkflowPlan(effective);

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
   * Phase 6 · Step 5 — apply a SUPERVISED PLAN-FRAGMENT EDIT to a compiled
   * workflow record. The supervisor LLM may add / rename / skip tasks WITHIN
   * the template's declared role set — it may not invent roles, tools,
   * memory scopes, or budget. Every rule below is a DENIAL, never a repair:
   * an edit that fails validation leaves the plan untouched.
   *
   *   · structural  — strict JSON, exact shape, bounded size.
   *   · role-set    — added roles must be declared by the compiled template
   *                   for this kind (`templateRoleSetFor`).
   *   · safety      — review/security/verification GATES may never be skipped;
   *                   completed tasks are immutable.
   *   · budget      — every ADDED task must be fundable from the root
   *                   envelope's unallocated headroom (caller-provided check,
   *                   sourced from the partition ledger — the planning plane
   *                   never mints money; it only refuses edits the money
   *                   cannot pay for).
   *
   * The result is a NEW record (planVersion + 1); the caller persists it and
   * audits `plan.edited`. Off by default: this method is only reachable when
   * `orchestration.supervisorEditing` is enabled for the workflow kind.
   */
  applyPlanFragment(
    record: WorkflowRecord,
    fragmentRaw: string,
    opts: {
      withVerifier?: boolean;
      maxEdits: number;
      budgetCheck?: (addedCount: number) => { ok: boolean; reason?: string };
    },
  ): { ok: true; record: WorkflowRecord; changes: string[]; errors: [] } | { ok: false; record: null; changes: []; errors: string[] } {
    const errors: string[] = [];
    const changes: string[] = [];
    if ((record.planVersion ?? 0) >= opts.maxEdits) {
      return { ok: false, record: null, changes: [], errors: [`plan-edit budget exhausted (maxEdits=${opts.maxEdits})`] };
    }

    // Structural: the fragment is data — first balanced JSON object, strict
    // schema, no unknown keys. Anything else is a refusal, never a coercion.
    const jsonText = extractFirstJsonObject(fragmentRaw);
    if (!jsonText) {
      return { ok: false, record: null, changes: [], errors: ["fragment is not a JSON object"] };
    }
    const parsed = PlanFragmentSchema.safeParse(jsonText);
    if (!parsed.success) {
      return { ok: false, record: null, changes: [], errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    }
    const frag = parsed.data;

    const declaredRoles = new Set<string>(templateRoleSetFor(record.kind, opts.withVerifier ?? true));
    // The CLONE is the working copy: `tasksById` must index the clone's task
    // objects, or edits would mutate the caller's record and be lost from the
    // returned plan of record (contract: caller persists the RETURNED record).
    const next: WorkflowRecord = JSON.parse(JSON.stringify(record));
    const tasksById = new Map(next.tasks.map((t) => [t.taskId, t]));

    // skips — gates and completed work are untouchable
    for (const taskId of frag.skip ?? []) {
      const task = tasksById.get(taskId);
      if (!task) {
        errors.push(`skip: unknown task ${taskId}`);
        continue;
      }
      if (task.role === "security_checker" || task.role === "reviewer" || task.role === "verifier" || task.role === "planner") {
        errors.push(`skip: ${taskId} is a ${task.role} gate — gates are not removable by the supervisor`);
        continue;
      }
      if (task.status === "completed" || task.status === "running") {
        errors.push(`skip: ${taskId} is ${task.status}; only pending/ready tasks may be skipped`);
        continue;
      }
      task.status = "cancelled";
      task.cancellationState = "cancelled";
      task.blockedReason = "skipped by supervised plan edit";
      task.updatedAt = Date.now();
      changes.push(`skip:${taskId}`);
    }

    // renames — display only, never semantic
    for (const r of frag.rename ?? []) {
      const task = tasksById.get(r.taskId);
      if (!task) {
        errors.push(`rename: unknown task ${r.taskId}`);
        continue;
      }
      task.name = r.name;
      task.updatedAt = Date.now();
      changes.push(`rename:${r.taskId}`);
    }

    // adds — role-set locked, capability profiles copied from the registry
    const added: WorkflowTask[] = [];
    for (const a of frag.add ?? []) {
      if (!declaredRoles.has(a.role)) {
        errors.push(`add: role "${a.role}" is not in the ${record.kind} template's declared role set`);
        continue;
      }
      const agent = getAgentByRole(a.role as AgentRole);
      if (!agent) {
        errors.push(`add: no registered agent for role "${a.role}"`);
        continue;
      }
      const deps = a.afterTaskId ? [a.afterTaskId] : next.rootTaskIds.length ? [next.rootTaskIds[next.rootTaskIds.length - 1]!] : [];
      for (const d of deps) {
        if (!tasksById.has(d) && !added.some((t) => t.taskId === d)) {
          errors.push(`add: afterTaskId "${d}" does not exist`);
          deps.length = 0;
        }
      }
      const now = Date.now();
      added.push({
        workflowId: next.workflowId,
        taskId: `t_${randomUUID().slice(0, 8)}`,
        agentId: agent.id,
        role: agent.role,
        name: a.name,
        description: a.description,
        dependencies: deps,
        status: deps.length ? "pending" : "ready",
        inputs: { goal: next.goal, addedBy: "supervisor-fragment-edit" },
        errors: [],
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        maxRetries: 1,
        permissions: { ...agent.permissions },
        toolScope: { ...agent.toolScope, tools: [...agent.toolScope.tools] },
        memoryScope: { ...agent.memoryScope },
        providerScope: { ...agent.providerScope },
        reviewState: "not_required",
        approvalState: "not_required",
        auditTrail: [],
        handoffHistory: [],
        cancellationState: "active",
        phase: "execution",
        delegatedReason: "Added by a supervised plan-fragment edit (audited, role-set-locked).",
      });
      changes.push(`add:${a.role}`);
    }

    // Budget headroom: additions must be FUNDABLE from unallocated root
    // envelope headroom. Rejected as a whole otherwise — a partially funded
    // plan is exactly the fiction this phase exists to remove.
    if (added.length > 0 && opts.budgetCheck) {
      const check = opts.budgetCheck(added.length);
      if (!check.ok) {
        return { ok: false, record: null, changes: [], errors: [`add rejected: ${check.reason ?? "insufficient unallocated headroom"}`] };
      }
    }

    if (errors.length > 0) {
      return { ok: false, record: null, changes: [], errors };
    }

    next.tasks.push(...added);
    next.planVersion = (next.planVersion ?? 0) + 1;
    next.updatedAt = Date.now();
    if (added.length > 0) {
      next.rootTaskIds = next.tasks.filter((t) => t.dependencies.length === 0).map((t) => t.taskId);
    }
    return { ok: true, record: next, changes, errors: [] };
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
