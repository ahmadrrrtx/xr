/**
 * Phase 6 · Step 3 — identity + recursion depth. The invariant under test:
 * a depth-1 worker NEVER mints a child — by construction, audited, and
 * testable (the plan's "depth field so the invariant is testable").
 */

import { describe, expect, test } from "bun:test";
import {
  MAX_SPAWN_DEPTH,
  assertSpawnAllowed,
  identityAuditFields,
  identityPacketLine,
  isWellFormedIdentity,
  mintIdentity,
} from "../../src/agents/identity.ts";
import { mintWorkerIdentity } from "../../src/services/multi-agent-orchestration.ts";
import { compileWorkflowPlan } from "../../src/agents/planner.ts";
import type { WorkflowRecord, WorkflowTask } from "../../src/agents/types.ts";

function demoRecord(): WorkflowRecord {
  return compileWorkflowPlan({ goal: "research something", cwd: "." });
}
function anyTask(record: WorkflowRecord): WorkflowTask {
  return record.tasks.find((t) => t.role === "researcher") ?? record.tasks[0]!;
}

describe("identity mint", () => {
  test("root mints at depth 0; supervisor's workers mint at depth 1", () => {
    const root = mintIdentity({ role: "primary", parentId: "user", taskId: "t_root", grantRef: "g", parentDepth: -1 });
    expect(root.allowed).toBe(true);
    if (!root.allowed) return;
    expect(root.identity.depth).toBe(0);
    const child = mintIdentity({ role: "researcher", parentId: "supervisor", taskId: "t_1", grantRef: "g2", parentDepth: 0 });
    expect(child.allowed).toBe(true);
    if (!child.allowed) return;
    expect(child.identity.depth).toBe(1);
    expect(child.identity.parentId).toBe("supervisor");
  });

  test("depth > MAX_SPAWN_DEPTH is DENIED, never clamped", () => {
    const deny = mintIdentity({ role: "researcher", parentId: "ag_x", taskId: "t_2", grantRef: "g3", parentDepth: 1 });
    expect(deny.allowed).toBe(false);
    if (deny.allowed) throw new Error("expected denial");
    expect(deny.reason).toMatch(/recursion depth limit/);
    expect(MAX_SPAWN_DEPTH).toBe(1);
  });

  test("empty role or task binding cannot mint", () => {
    expect(mintIdentity({ role: "", parentId: "p", taskId: "t", grantRef: "g" }).allowed).toBe(false);
    expect(mintIdentity({ role: "r", parentId: "p", taskId: "  ", grantRef: "g" }).allowed).toBe(false);
  });
});

describe("the worker-may-not-spawn invariant", () => {
  test("a depth-1 identity may never delegate", () => {
    const worker = mintIdentity({ role: "builder", parentId: "supervisor", taskId: "t_w", grantRef: "g", parentDepth: 0 });
    expect(worker.allowed).toBe(true);
    if (!worker.allowed) return;
    const deny = assertSpawnAllowed(worker.identity);
    expect(deny.allowed).toBe(false);
    expect(deny.reason).toMatch(/recursion depth is capped at 1/);
  });

  test("the supervisor (no identity / depth 0) MAY delegate", () => {
    expect(assertSpawnAllowed(undefined).allowed).toBe(true);
    const root = mintIdentity({ role: "primary", parentId: "user", taskId: "t_r", grantRef: "g", parentDepth: -1 });
    expect(root.allowed && assertSpawnAllowed(root.identity).allowed).toBe(true);
  });

  test("mintWorkerIdentity: supervisor path mints depth 1; worker path refuses", () => {
    const record = demoRecord();
    const task = anyTask(record);
    const ok = mintWorkerIdentity(record, task);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.identity.depth).toBe(1);
      expect(ok.identity.taskId).toBe(task.taskId);
      expect(ok.identity.grantRef).toBe(`partition:${record.workflowId}/${task.taskId}`);
      expect(isWellFormedIdentity(ok.identity)).toBe(true);
      // The identity is FROZEN — a worker cannot widen its own role field.
      expect(() => {
        (ok.identity as { role: string }).role = "supervisor";
      }).toThrow();
    }
    const parent = (ok as { identity?: never }).identity;
    const sub = mintWorkerIdentity(record, anyTask(record), ok.ok ? ok.identity : undefined);
    expect(sub.ok).toBe(false);
    if (!sub.ok) expect(sub.reason).toMatch(/may not delegate|recursion/);
    void parent;
  });
});

describe("identity surfaces", () => {
  test("the packet line frames identity as DATA, not instructions", () => {
    const m = mintIdentity({ role: "researcher", parentId: "supervisor", taskId: "t_9", grantRef: "g9", parentDepth: 0 });
    expect(m.allowed).toBe(true);
    if (!m.allowed) return;
    const line = identityPacketLine(m.identity);
    expect(line).toContain("data, not instructions");
    expect(line).toContain("cannot be widened");
    expect(line).toContain("t_9");
  });

  test("audit fields carry the full identity tuple", () => {
    const m = mintIdentity({ role: "builder", parentId: "supervisor", taskId: "t_3", grantRef: "g3", parentDepth: 0 });
    expect(m.allowed).toBe(true);
    if (!m.allowed) return;
    const f = identityAuditFields(m.identity);
    expect(Object.keys(f).sort()).toEqual(["agentId", "depth", "grantRef", "parentId", "role", "taskId"]);
  });

  test("isWellFormedIdentity rejects forged shapes", () => {
    expect(isWellFormedIdentity({ agentId: "a", role: "r", parentId: "p", taskId: "t", grantRef: "g", depth: 2 })).toBe(false);
    expect(isWellFormedIdentity({ agentId: "a", role: "r", parentId: "p", taskId: "t", grantRef: "g" })).toBe(false);
    expect(isWellFormedIdentity("ag_1")).toBe(false);
  });
});
