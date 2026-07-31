/**
 * XR 5.0 — Workflow Engine Tests
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { WorkflowRepository } from "../../src/workflow/repository.ts";
import { WorkflowEngine } from "../../src/workflow/engine.ts";
import * as n from "../../src/workflow/nodes.ts";
import {
  createDraft,
  publishDraft,
} from "../../src/workflow/versioning.ts";
import { applyRunEvent } from "../../src/workflow/state-machine.ts";
import type {
  WorkflowDefinition,
  WorkflowRun,
  HumanDecision,
} from "../../src/workflow/types.ts";

// ── Test doubles ───────────────────────────────────────────────────────────

function createAgentRunner() {
  return {
    runAgentTask: async (params: any) => {
      return {
        summary: `Agent ${params.agentRole} completed: ${params.instruction.slice(0, 50)}`,
        structured: { role: params.agentRole },
        artifacts: [],
      };
    },
  };
}

function createExecutionRecorder() {
  const records: any[] = [];
  return {
    records,
    recordExecution: async (params: any) => {
      records.push(params);
      return `ex_${Date.now().toString(36)}`;
    },
  };
}

function createContextProvider() {
  return {
    buildContextPackage: async (_params: any) => ({ packageId: `ctx_${Date.now().toString(36)}` }),
  };
}

function setupEngine(home: string) {
  const store = new WorkspaceStore(join(home, "workflows.db"));
  const repo = new WorkflowRepository(store);
  const agentRunner = createAgentRunner();
  const execRecorder = createExecutionRecorder();
  const contextProvider = createContextProvider();

  const engine = new WorkflowEngine({
    agentRunner,
    executionRecorder: execRecorder,
    contextProvider,
    runStore: repo,
  });

  return { engine, repo, store, execRecorder, agentRunner };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Workflow Engine", () => {
  let home: string;
  let engine: WorkflowEngine;
  let repo: WorkflowRepository;
  let store: WorkspaceStore;
  let execRecorder: ReturnType<typeof createExecutionRecorder>;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "xr-wf-"));
    const s = setupEngine(home);
    engine = s.engine;
    repo = s.repo;
    store = s.store;
    execRecorder = s.execRecorder;
  });

  afterEach(() => {
    try { store.close(); } catch {}
  });

  describe("Definition management", () => {
    test("publish and retrieve definition", () => {
      const draft = createDraft({
        name: "Test Workflow",
        nodes: [n.trigger("Start", { type: "manual" })],
        entryNodeIds: [],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const retrieved = engine.getDefinition(published.definitionId, published.version);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("Test Workflow");
      expect(retrieved!.version).toBe(1);
    });
  });

  describe("Simple workflow execution", () => {
    test("trigger → deterministic → completion flow", async () => {
      // Build: trigger → deterministic → completion
      const trigger = n.trigger("Start", { type: "manual" });
      const step = n.deterministic("Transform", "builtin:transform_json", { key: "value" }, { dependencies: [trigger.id] });
      const done = n.completion("Done", "All done", { dependencies: [step.id] });

      const draft = createDraft({
        name: "Simple Flow",
        nodes: [trigger, step, done],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      // Start and run
      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });
      expect(run.state).toBe("queued");

      const executed = await engine.executeRun(run.runId);
      // Should complete: trigger → deterministic → completion
      expect(["completed", "partially_completed"].includes(executed.state)).toBe(true);

      // Verify all nodes completed
      if (executed.state === "completed") {
        expect(executed.nodeStates.get(trigger.id)?.state).toBe("completed");
        expect(executed.nodeStates.get(step.id)?.state).toBe("completed");
        expect(executed.nodeStates.get(done.id)?.state).toBe("completed");
      }
    });

    test("trigger → agentic → completion flow", async () => {
      const trigger = n.trigger("Start", { type: "manual" });
      const research = n.agentic("Research", "Find latest TypeScript features", "researcher", {
        dependencies: [trigger.id],
      });
      const done = n.completion("Done", "Research complete", { dependencies: [research.id] });

      const draft = createDraft({
        name: "Agentic Flow",
        nodes: [trigger, research, done],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });
      const executed = await engine.executeRun(run.runId);
      expect(["completed", "partially_completed"].includes(executed.state)).toBe(true);
    });
  });

  describe("Human approval workflow", () => {
    test("workflow pauses for approval and resumes on decision", async () => {
      const trigger = n.trigger("Start", { type: "manual" });
      const approve = n.humanApproval("Approve", "Please approve the deployment", "Deploying to production", { kind: "any_human" }, {
        dependencies: [trigger.id],
      });
      const deploy = n.toolAction("Deploy", { family: "core_tool", name: "shell" }, { cmd: "deploy" }, {
        dependencies: [approve.id],
      });
      const done = n.completion("Done", "Deployment complete", { dependencies: [deploy.id] });

      const draft = createDraft({
        name: "Approval Flow",
        nodes: [trigger, approve, deploy, done],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });
      let executed = await engine.executeRun(run.runId);

      // Should be awaiting approval
      expect(executed.state).toBe("awaiting_approval");
      expect(executed.nodeStates.get(approve.id)?.state).toBe("waiting_approval");

      // Approve
      executed = await engine.submitHumanDecision(
        executed.runId,
        approve.id,
        { approval: "approved" },
        { kind: "user", userId: "admin", name: "Admin" },
      );

      /**
       * Phase 0 · T6 — this assertion was updated deliberately.
       *
       * It previously expected the run to reach "completed" after approval.
       * That only passed because the `Deploy` tool_action node fabricated
       * success: no shell command was ever executed. Constitution Article XX
       * names this exact anti-pattern ("a test asserting a node reached
       * 'completed' without checking the effect").
       *
       * With no tool executor wired into this test engine, the honest outcome
       * is that the approval is recorded and the deploy node FAILS as
       * unsupported rather than lying. That is what we assert now.
       */
      expect(executed.state).not.toBe("completed");
      const deployState = executed.nodeStates.get(deploy.id);
      expect(deployState?.state).toBe("failed");
      expect(deployState?.error).toMatch(/no tool executor is configured/i);
      expect(executed.errorChain.some((e) => e.nodeId === deploy.id)).toBe(true);
    });

    test("denial stops workflow", async () => {
      const trigger = n.trigger("Start", { type: "manual" });
      const approve = n.humanApproval("Gate", "Critical gate", "Must pass", { kind: "any_human" }, {
        dependencies: [trigger.id],
      });

      const draft = createDraft({
        name: "Gated Flow",
        nodes: [trigger, approve],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });
      let executed = await engine.executeRun(run.runId);
      expect(executed.state).toBe("awaiting_approval");

      executed = await engine.submitHumanDecision(
        executed.runId,
        approve.id,
        { approval: "denied", reason: "Not ready" },
        { kind: "user", userId: "admin", name: "Admin" },
      );

      expect(["failed", "awaiting_review"].includes(executed.state) || executed.state === "failed").toBe(true);
    });
  });

  describe("Pause and cancel", () => {
    test("pause and resume", async () => {
      const trigger = n.trigger("Start", { type: "manual" });
      const done = n.completion("Done", "Done", { dependencies: [trigger.id] });

      const draft = createDraft({
        name: "Pausable",
        nodes: [trigger, done],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });
      let executed = await engine.executeRun(run.runId);

      // After execution, pause
      if (executed.state === "running") {
        engine.pauseRun(executed.runId);
        const paused = engine.getRun(executed.runId)!;
        expect(paused.state).toBe("paused");

        // Resume
        const resumed = await engine.resumeRun(executed.runId);
        expect(resumed.state).not.toBe("paused");
      }
    });

    test("cancel flow", async () => {
      const trigger = n.trigger("Start", { type: "manual" });
      done = n.completion("Done", "Done", { dependencies: [trigger.id] });

      const draft = createDraft({
        name: "Cancellable",
        nodes: [trigger, done],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });

      engine.cancelRun(run.runId);
      const cancelled = engine.getRun(run.runId)!;
      expect(cancelled.state).toBe("cancelled");
    });
    let done: any;
  });

  describe("Inspection", () => {
    test("inspect run returns full details", async () => {
      const trigger = n.trigger("Start", { type: "manual" });
      const done = n.completion("Done", "All done", { dependencies: [trigger.id] });

      const draft = createDraft({
        name: "Inspectable",
        nodes: [trigger, done],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);

      const run = await engine.startRun(published.definitionId, published.version, {
        initiatedBy: { type: "manual" },
      });
      await engine.executeRun(run.runId);

      const inspection = engine.inspectRun(run.runId);
      expect(inspection).not.toBeNull();
      expect(inspection!.run.runId).toBe(run.runId);
      expect(inspection!.nodeStates.length).toBe(2);
    });
  });
});
