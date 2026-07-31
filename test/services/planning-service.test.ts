/**
 * XR Phase 2 · T4 — one `PlanningService`, two schema-validated output kinds.
 *
 * Before Phase 2 there were two planning authorities with ASYMMETRIC safety:
 * `control/planner.ts` validated its output with Zod and failed closed, while
 * `agents/planner.ts` returned an unvalidated object straight to the executor.
 * Art. IV.4 requires ambiguity to deny on both paths.
 */

import { describe, expect, test } from "bun:test";
import {
  ControlPlanSchema,
  PlanValidationError,
  PlanningService,
  WorkflowPlanSchema,
  planningService,
} from "../../src/services/planning-service.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";

/** A provider that returns a scripted reply — no network, deterministic. */
function scriptedProvider(reply: string): Provider {
  return {
    id: "test",
    label: "Test Provider",
    async chat(_m: Message[], _t: Tool[]): Promise<ModelTurn> {
      return { message: reply, toolCalls: [], done: true };
    },
    async health() {
      return { ok: true };
    },
  };
}

describe("T4 — one planning authority", () => {
  test("a single service produces BOTH output kinds", async () => {
    const svc = new PlanningService();

    const workflow = await svc.plan({
      kind: "workflow",
      input: { goal: "Ship a safe feature", cwd: process.cwd() },
    });
    expect(workflow.kind).toBe("workflow");

    const control = await svc.plan({
      kind: "control",
      input: {
        provider: scriptedProvider(
          JSON.stringify({ rationale: "open the site", actions: [{ type: "open", target: "https://example.com" }] }),
        ),
        task: "open example.com",
        noMemory: true,
      },
    });
    expect(control).toHaveProperty("kind", "control");
  });

  test("the output kinds stay DISTINCT — they are not collapsed", async () => {
    const svc = new PlanningService();
    const workflow = svc.planWorkflow({ goal: "Do the thing", cwd: process.cwd() });
    const control = await svc.planControl({
      provider: scriptedProvider(JSON.stringify({ actions: [{ type: "wait_ms", ms: 500 }] })),
      task: "wait",
      noMemory: true,
    });

    // A workflow plan is a DAG of agent tasks…
    expect(Array.isArray(workflow.plan.tasks)).toBe(true);
    expect(workflow.plan.tasks[0]).toHaveProperty("role");
    // …a control plan is a flat action list. Different artefacts, one authority.
    expect(control).not.toHaveProperty("error");
    if ("plan" in control) {
      expect(Array.isArray(control.plan.actions)).toBe(true);
      expect(control.plan.actions[0]).toHaveProperty("type");
      expect(control.plan).not.toHaveProperty("tasks");
    }
  });
});

describe("T4 — WORKFLOW kind is now schema-validated (new in Phase 2)", () => {
  test("a real compiled workflow passes the schema", () => {
    const result = planningService.planWorkflow({
      goal: "Implement a safe feature",
      cwd: process.cwd(),
    });
    expect(result.kind).toBe("workflow");
    expect(result.plan.tasks.length).toBeGreaterThan(0);
    expect(WorkflowPlanSchema.safeParse(result.plan).success).toBe(true);
  });

  test("every produced task carries the fields the executor requires", () => {
    const { plan } = planningService.planWorkflow({ goal: "Research a topic", cwd: process.cwd() });
    for (const task of plan.tasks) {
      expect(task.taskId).toBeTruthy();
      expect(task.workflowId).toBe(plan.workflowId);
      expect(task.role).toBeTruthy();
      expect(task.status).toBeTruthy();
      expect(Array.isArray(task.dependencies)).toBe(true);
    }
  });

  test("referential integrity: no task depends on a task that does not exist", () => {
    const { plan } = planningService.planWorkflow({ goal: "Build a feature", cwd: process.cwd() });
    const ids = new Set(plan.tasks.map((t) => t.taskId));
    for (const task of plan.tasks) {
      for (const dep of task.dependencies) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  test("FAIL CLOSED: a structurally invalid workflow is REFUSED by the schema", () => {
    // The gate the workflow path lacked entirely before Phase 2.
    const missingTasks = WorkflowPlanSchema.safeParse({
      workflowId: "wf_1",
      goal: "g",
      kind: "generic",
      status: "planned",
      createdAt: Date.now(),
      tasks: [],
    });
    expect(missingTasks.success).toBe(false);

    const badTask = WorkflowPlanSchema.safeParse({
      workflowId: "wf_1",
      goal: "g",
      kind: "generic",
      status: "planned",
      createdAt: Date.now(),
      tasks: [{ taskId: "", workflowId: "wf_1", role: "planner", name: "n", status: "pending", dependencies: [] }],
    });
    expect(badTask.success).toBe(false);
  });

  test("PlanValidationError names the kind and the issues", () => {
    const err = new PlanValidationError("workflow", ["t1 depends on unknown task t9"]);
    expect(err.planKind).toBe("workflow");
    expect(err.issues).toHaveLength(1);
    expect(err.message).toContain("t9");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("T4 — CONTROL kind keeps its fail-closed validation", () => {
  test("a valid plan is returned with its source", async () => {
    const result = await planningService.planControl({
      provider: scriptedProvider(
        JSON.stringify({
          rationale: "navigate",
          actions: [{ type: "open", target: "https://example.com" }],
        }),
      ),
      task: "open example.com",
      noMemory: true,
    });
    expect(result).not.toHaveProperty("error");
    if ("plan" in result) {
      expect(result.kind).toBe("control");
      expect(result.source).toBe("llm");
      expect(result.plan.actions).toHaveLength(1);
      expect(result.plan.actions[0]!.type).toBe("open");
    }
  });

  test("FAIL CLOSED: a non-JSON model reply is refused", async () => {
    const result = await planningService.planControl({
      provider: scriptedProvider("I will just do it, trust me."),
      task: "do something",
      noMemory: true,
    });
    expect(result).toHaveProperty("error");
  });

  test("FAIL CLOSED: an unknown action type is refused, not silently dropped", async () => {
    const result = await planningService.planControl({
      provider: scriptedProvider(
        JSON.stringify({ actions: [{ type: "exfiltrate", target: "/etc/passwd" }] }),
      ),
      task: "smuggle an action past the schema",
      noMemory: true,
    });
    expect(result).toHaveProperty("error");
  });

  test("FAIL CLOSED: a malformed action of a KNOWN type is refused", async () => {
    const result = await planningService.planControl({
      provider: scriptedProvider(
        JSON.stringify({ actions: [{ type: "click", x: "not-a-number", y: 10 }] }),
      ),
      task: "click somewhere",
      noMemory: true,
    });
    expect(result).toHaveProperty("error");
  });

  test("a provider error is reported structurally, never thrown", async () => {
    const failing: Provider = {
      id: "boom",
      label: "Failing",
      async chat(): Promise<ModelTurn> {
        throw new Error("provider offline");
      },
      async health() {
        return { ok: false };
      },
    };
    const result = await planningService.planControl({
      provider: failing,
      task: "anything",
      noMemory: true,
    });
    expect(result).toHaveProperty("error");
    if ("error" in result) expect(result.error).toContain("provider offline");
  });

  test("the control schema matches the executor's own ActionSchema", () => {
    // Guards against drift: a plan that validates here must not be rejected
    // downstream for shape reasons.
    const ok = ControlPlanSchema.safeParse({
      task: "t",
      actions: [{ type: "wait_ms", ms: 100 }],
    });
    expect(ok.success).toBe(true);
  });
});

describe("T4 — the planners are strategies, not entry points", () => {
  test("every production call-site plans through the service", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative, resolve } = await import("node:path");
    const root = resolve(import.meta.dir, "../..");
    const src = join(root, "src");

    const files: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (e.endsWith(".ts")) files.push(full);
      }
    })(src);

    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(root, f).replace(/\\/g, "/");
      // The strategies themselves and the service are allowed.
      if (
        rel === "src/agents/planner.ts" ||
        rel === "src/control/planner.ts" ||
        rel === "src/services/planning-service.ts"
      ) {
        continue;
      }
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      if (/\bcompileWorkflowPlan\s*\(/.test(code) || /\bplanActions\s*\(/.test(code)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
