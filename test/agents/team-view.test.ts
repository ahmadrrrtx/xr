/**
 * Phase 4 · team-run view composer — the engine owns every number the
 * multi-agent page shows. These tests pin the math and the control guards so
 * the shell can never drift into computing cost/progress itself (SEC-07).
 */
import { describe, expect, test } from "bun:test";
import { composeTeamView, controlAffordances, taskTiers } from "../../src/daemon/routes/agents-view.ts";
import type { WorkflowRecord, WorkflowTask } from "../../src/agents/types.ts";

function task(id: string, deps: string[], over: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    workflowId: "wf_1",
    taskId: id,
    agentId: `agent-${id}`,
    role: "executor",
    name: id,
    description: id,
    dependencies: deps,
    status: "pending",
    inputs: {},
    errors: [],
    createdAt: 1,
    updatedAt: 1,
    retryCount: 0,
    maxRetries: 1,
    permissions: { writeFiles: false, shell: false, network: false, plugins: false, mcp: false, memoryRead: false, memoryWrite: false, computerControl: false, secrets: false, destructiveExec: false },
    toolScope: { mode: "allowlist", tools: [] },
    memoryScope: { mode: "none", paths: [] } as never,
    providerScope: { mode: "inherit" } as never,
    reviewState: "not_required",
    approvalState: "not_required",
    auditTrail: [],
    handoffHistory: [],
    cancellationState: "active",
    ...over,
  };
}

function record(over: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    workflowId: "wf_1",
    kind: "build",
    goal: "test goal",
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    reviewState: "not_required",
    approvalState: "not_required",
    cancellationState: "active",
    planSummary: "plan",
    rootTaskIds: ["a"],
    tasks: [
      task("a", []),
      task("b", ["a"], { status: "completed" }),
      task("c", ["a"], { status: "failed" }),
      task("d", ["b", "c"]),
    ],
    errors: [],
    auditTrail: [],
    metadata: { cwd: "/tmp", createdBy: "test" },
    ...over,
  };
}

describe("team-run view composer", () => {
  test("progress + task counters come from task statuses only", () => {
    const v = composeTeamView(record());
    expect(v.progressPct).toBe(25); // 1 of 4 completed
    expect(v.tasksCompleted).toBe(1);
    expect(v.tasksFailed).toBe(1);
    expect(v.tasksTotal).toBe(4);
  });

  test("cost roll-ups sum the engine-issued partitions (rounded, no shell math)", () => {
    const v = composeTeamView(
      record({
        partitions: [
          { partitionId: "p1", childId: "b", agentId: null, capUsd: 1.5, capTokens: 1000, consumedUsd: 0.25001, consumedTokens: 100, status: "open" },
          { partitionId: "p2", childId: "c", agentId: null, capUsd: 1.5, capTokens: 1000, consumedUsd: 0.75, consumedTokens: 300, status: "closed" },
        ],
      }),
    );
    expect(v.costUsd).toBe(1);
    expect(v.costCapUsd).toBe(3);
    expect(v.tokens).toBe(400);
    expect(v.nodes.find((n) => n.taskId === "b")?.budget.consumedUsd).toBe(0.25001);
    expect(v.nodes.find((n) => n.taskId === "a")?.budget.capUsd).toBe(0);
  });

  test("tiers are longest-path layers; edges only reference known tasks", () => {
    const v = composeTeamView(record());
    const tier = new Map(v.nodes.map((n) => [n.taskId, n.tier]));
    expect(tier.get("a")).toBe(0);
    expect(tier.get("b")).toBe(1);
    expect(tier.get("c")).toBe(1);
    expect(tier.get("d")).toBe(2);
    const ids = new Set(v.nodes.map((n) => n.taskId));
    for (const e of v.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    expect(v.edges).toHaveLength(4);
  });

  test("cycle-guard: a pathological dependency loop cannot hang the composer", () => {
    const rec = record();
    rec.tasks = [task("x", ["y"]), task("y", ["x"])];
    const tiers = taskTiers(rec.tasks);
    // The guard's contract is TERMINATION with bounded layers, not minimality.
    expect(Math.max(...tiers.values())).toBeLessThanOrEqual(2);
  });

  test("control affordances: pause only while running, cancel never on terminal states", () => {
    expect(controlAffordances("running")).toEqual({ pause: true, resume: false, cancel: true });
    expect(controlAffordances("paused")).toEqual({ pause: false, resume: true, cancel: true });
    expect(controlAffordances("completed")).toEqual({ pause: false, resume: false, cancel: false });
    expect(controlAffordances("cancelled")).toEqual({ pause: false, resume: true, cancel: false });
    expect(controlAffordances("failed")).toEqual({ pause: false, resume: true, cancel: false });
    expect(composeTeamView(record({ status: "completed" })).affordances.cancel).toBe(false);
  });

  test("artifacts pass through untouched for the page's chip rail", () => {
    const rec = record();
    rec.tasks[1].outputs = { summary: "done", artifacts: [{ path: "src/api/x.ts", description: "Git Commit: Feat/x" }] };
    const v = composeTeamView(rec);
    expect(v.nodes.find((n) => n.taskId === "b")?.artifacts).toEqual([{ path: "src/api/x.ts", description: "Git Commit: Feat/x" }]);
  });
});
