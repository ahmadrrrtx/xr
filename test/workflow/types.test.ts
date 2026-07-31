/**
 * XR 5.0 — Workflow Types Tests
 */
import { describe, expect, test } from "bun:test";
import {
  isValidWorkflowTransition,
  isTerminal,
  isActive,
  isAwaitingHuman,
  hashDefinition,
} from "../../src/execution/workflow/types.ts";
import {
  applyRunEvent,
  applyNodeEvent,
  canAdvanceNodes,
  canAcceptHumanInput,
  canPause,
  canCancel,
  WorkflowStateError,
} from "../../src/execution/workflow/state-machine.ts";
import {
  createDraft,
  publishDraft,
  createNewVersion,
  publishNewVersion,
  verifyIntegrity,
  canMigrateActiveRun,
} from "../../src/execution/workflow/versioning.ts";
import * as n from "../../src/execution/workflow/nodes.ts";
import type { WorkflowDefinition, WorkflowNode, WorkflowRunState, WorkflowNodeState } from "../../src/execution/workflow/types.ts";

// ── State Transitions ──────────────────────────────────────────────────────

describe("Workflow State Machine", () => {
  describe("Run-level transitions", () => {
    test("valid transitions work", () => {
      expect(applyRunEvent("draft", "publish")).toBe("published");
      expect(applyRunEvent("published", "queue")).toBe("queued");
      expect(applyRunEvent("queued", "start")).toBe("running");
      expect(applyRunEvent("running", "complete")).toBe("completed");
      expect(applyRunEvent("running", "pause")).toBe("paused");
      expect(applyRunEvent("paused", "resume")).toBe("running");
      expect(applyRunEvent("running", "fail")).toBe("failed");
      expect(applyRunEvent("running", "enter_approval")).toBe("awaiting_approval");
      expect(applyRunEvent("awaiting_approval", "resume")).toBe("running");
    });

    test("invalid transitions throw", () => {
      expect(() => applyRunEvent("completed", "start")).toThrow(WorkflowStateError);
      expect(() => applyRunEvent("cancelled", "resume")).toThrow(WorkflowStateError);
      expect(() => applyRunEvent("draft", "start")).toThrow(WorkflowStateError);
    });

    test("cancellation flow", () => {
      let state: WorkflowRunState = "queued";
      state = applyRunEvent(state, "start"); // running
      state = applyRunEvent(state, "request_cancel"); // cancelling
      state = applyRunEvent(state, "cancel"); // cancelled
      expect(state).toBe("cancelled");
      expect(isTerminal(state)).toBe(true);
    });
  });

  describe("Node-level transitions", () => {
    test("normal flow", () => {
      let state: WorkflowNodeState = "pending";
      state = applyNodeEvent(state, "mark_ready", "n1");
      expect(state).toBe("ready");
      state = applyNodeEvent(state, "start", "n1");
      expect(state).toBe("running");
      state = applyNodeEvent(state, "complete", "n1");
      expect(state).toBe("completed");
    });

    test("human approval flow", () => {
      let state: WorkflowNodeState = "running";
      state = applyNodeEvent(state, "wait_approval", "n1");
      expect(state).toBe("waiting_approval");
      state = applyNodeEvent(state, "start", "n1");
      expect(state).toBe("running");
    });

    test("failure and skip", () => {
      let state: WorkflowNodeState = "running";
      state = applyNodeEvent(state, "fail", "n1");
      expect(state).toBe("failed");
      state = applyNodeEvent(state, "skip", "n1");
      expect(state).toBe("skipped");
    });
  });

  describe("Predicates", () => {
    test("canAdvanceNodes", () => {
      expect(canAdvanceNodes("running")).toBe(true);
      expect(canAdvanceNodes("awaiting_approval")).toBe(false);
      expect(canAdvanceNodes("completed")).toBe(false);
    });

    test("canAcceptHumanInput", () => {
      expect(canAcceptHumanInput("awaiting_approval")).toBe(true);
      expect(canAcceptHumanInput("awaiting_review")).toBe(true);
      expect(canAcceptHumanInput("running")).toBe(false);
    });

    test("canPause", () => {
      expect(canPause("running")).toBe(true);
      expect(canPause("waiting")).toBe(true);
      expect(canPause("completed")).toBe(false);
    });

    test("canCancel", () => {
      expect(canCancel("running")).toBe(true);
      expect(canCancel("awaiting_approval")).toBe(true);
      expect(canCancel("completed")).toBe(false);
    });
  });
});

// ── Workflow Types ─────────────────────────────────────────────────────────

describe("Workflow Types", () => {
  test("isValidWorkflowTransition", () => {
    expect(isValidWorkflowTransition("draft", "published")).toBe(true);
    expect(isValidWorkflowTransition("draft", "queued")).toBe(false);
    expect(isValidWorkflowTransition("running", "completed")).toBe(true);
    expect(isValidWorkflowTransition("completed", "running")).toBe(false);
  });

  test("terminal states are idempotent", () => {
    for (const state of ["completed", "cancelled", "failed", "expired"] as WorkflowRunState[]) {
      expect(isTerminal(state)).toBe(true);
      expect(isActive(state)).toBe(false);
    }
  });

  test("active states", () => {
    expect(isActive("running")).toBe(true);
    expect(isActive("awaiting_approval")).toBe(true);
    expect(isActive("paused")).toBe(true);
  });

  test("human waiting states", () => {
    expect(isAwaitingHuman("awaiting_approval")).toBe(true);
    expect(isAwaitingHuman("awaiting_review")).toBe(true);
    expect(isAwaitingHuman("running")).toBe(false);
  });

  test("hashDefinition produces consistent output", () => {
    const nodes: WorkflowNode[] = [n.trigger("Start", { type: "manual" })];
    const hash1 = hashDefinition({
      definitionId: "test-1",
      version: 1,
      name: "Test",
      nodes,
      entryNodeIds: [nodes[0].id],
      tags: [],
      authoredBy: { kind: "user", id: "test" },
      schemaVersion: "xr-5.0.0/wf-v1",
      active: true,
    });
    const hash2 = hashDefinition({
      definitionId: "test-1",
      version: 1,
      name: "Test",
      nodes,
      entryNodeIds: [nodes[0].id],
      tags: [],
      authoredBy: { kind: "user", id: "test" },
      schemaVersion: "xr-5.0.0/wf-v1",
      active: true,
    });
    expect(hash1).toBe(hash2);
  });
});

// ── Node Factory ───────────────────────────────────────────────────────────

describe("Node Factory Functions", () => {
  test("trigger node", () => {
    const node = n.trigger("Start", { type: "cron", schedule: "0 9 * * 1-5" });
    expect(node.kind).toBe("trigger");
    expect(node.trigger.type).toBe("cron");
    expect(node.dependencies).toEqual([]);
  });

  test("agentic node", () => {
    const node = n.agentic("Research", "Find information about X", "researcher", {
      requiresReview: true,
      riskTier: "low",
    });
    expect(node.kind).toBe("agentic");
    expect(node.agentRole).toBe("researcher");
    expect(node.requiresReview).toBe(true);
    expect(node.riskTier).toBe("low");
  });

  test("human approval node", () => {
    const node = n.humanApproval("Approve Deployment", "Deploy to production", "This will deploy v2.0 to production", { kind: "workspace_owner" });
    expect(node.kind).toBe("human_approval");
    expect(node.approver.kind).toBe("workspace_owner");
    expect(node.request.riskLevel).toBe("medium");
  });

  test("human review node", () => {
    const node = n.humanReview("Review Report", "Review the generated report", ["n1", "n2"], { kind: "any_reviewer" });
    expect(node.kind).toBe("human_review");
    expect(node.request.reviewTargetNodes).toEqual(["n1", "n2"]);
  });

  test("branch node", () => {
    const node = n.branch("Check Result", { type: "field_compare", field: "status", operator: "eq", value: "ok" }, ["n_pass"], ["n_fail"]);
    expect(node.kind).toBe("branch");
    expect(node.trueNodes).toEqual(["n_pass"]);
    expect(node.falseNodes).toEqual(["n_fail"]);
  });

  test("completion node", () => {
    const node = n.completion("Done", "Workflow completed successfully", { outcome: "success" });
    expect(node.kind).toBe("completion");
    expect(node.outcome).toBe("success");
  });

  test("node graph validation catches cycles", () => {
    const a = n.trigger("Start", { type: "manual" });
    const b = n.deterministic("Step", "builtin:noop", {}, { dependencies: [a.id] });
    const c = n.deterministic("Cycle", "builtin:noop", {}, { dependencies: [b.id] });
    // Create cycle: b depends on c
    (b as any).dependencies = [c.id];
    const result = n.validateGraph([a, b, c]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Cycle"))).toBe(true);
  });

  test("node graph validation catches missing dependencies", () => {
    const a = n.trigger("Start", { type: "manual" });
    const b = n.deterministic("Step", "builtin:noop", {}, { dependencies: ["nonexistent"] });
    const result = n.validateGraph([a, b]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("missing"))).toBe(true);
  });
});

// ── Versioning ─────────────────────────────────────────────────────────────

describe("Workflow Versioning", () => {
  test("createDraft creates version 0", () => {
    const draft = createDraft({
      name: "Test Workflow",
      nodes: [n.trigger("Start", { type: "manual" })],
      entryNodeIds: [],
      authoredBy: { kind: "user", id: "test" },
    });
    expect(draft.version).toBe(0);
    expect(draft.active).toBe(false);
    expect(draft.publishedAt).toBe(0);
  });

  test("publishDraft creates version 1", () => {
    const draft = createDraft({
      name: "Test",
      nodes: [n.trigger("Start", { type: "manual" })],
      entryNodeIds: [],
      authoredBy: { kind: "user", id: "test" },
    });
    const published = publishDraft(draft);
    expect(published.version).toBe(1);
    expect(published.active).toBe(true);
    expect(published.publishedAt).toBeGreaterThan(0);
    expect(verifyIntegrity(published)).toBe(true);
  });

  test("cannot publish already-published", () => {
    const draft = createDraft({
      name: "Test",
      nodes: [],
      entryNodeIds: [],
      authoredBy: { kind: "user", id: "test" },
    });
    const published = publishDraft(draft);
    expect(() => publishDraft(published)).toThrow("already published");
  });

  test("createNewVersion from published", () => {
    const draft = createDraft({
      name: "Test",
      nodes: [n.trigger("Start", { type: "manual" })],
      entryNodeIds: [],
      authoredBy: { kind: "user", id: "test" },
    });
    const v1 = publishDraft(draft);
    const v2draft = createNewVersion(v1, {
      name: "Test v2",
      authoredBy: { kind: "user", id: "test" },
    });
    expect(v2draft.version).toBe(0);
    expect(v2draft.name).toBe("Test v2");
    expect(v2draft.definitionId).toBe(v1.definitionId);

    const v2 = publishNewVersion(v2draft, 1);
    expect(v2.version).toBe(2);
  });

  test("canMigrateActiveRun accepts compatible versions", () => {
    // Use the same node objects so IDs match
    const t = n.trigger("Start", { type: "manual" });
    const d1 = n.deterministic("Step", "builtin:noop", {}, { dependencies: [t.id] });

    const v1 = publishDraft(createDraft({
      definitionId: "wfd_mig",
      name: "Test",
      nodes: [t, d1],
      entryNodeIds: [t.id],
      authoredBy: { kind: "user", id: "test" },
    }));

    // New version with same nodes + extra (and same d1 with same ID)
    const extra = n.deterministic("Extra", "builtin:noop", {}, { dependencies: [d1.id] });
    const v2 = publishNewVersion(createNewVersion(v1, {
      name: "Test v2",
      nodes: [t, d1, extra],
      entryNodeIds: [t.id],
      authoredBy: { kind: "user", id: "test" },
    }), 1);

    const result = canMigrateActiveRun(v1, v2);
    expect(result.migratable).toBe(true);
  });
});
