/**
 * Phase 0 · T6 — Workflow effect verification.
 *
 * Constitution Article XX.1 requires tests to assert effects, and names the
 * violation these tests replace: "a test asserting a node reached 'completed'
 * without checking the effect".
 *
 * So every success assertion here is anchored to something observable OUTSIDE
 * the workflow engine — bytes on disk, a request received by a real HTTP
 * server, or measured wall-clock time — and every failure assertion proves the
 * engine refuses to claim success when the effect did not happen.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  WorkflowEngine,
  type WorkflowAgentRunner,
  type WorkflowContextProvider,
  type WorkflowExecutionRecorder,
  type WorkflowRunStore,
  type WorkflowTimerScheduler,
  type WorkflowToolExecutor,
} from "../../src/execution/workflow/engine.ts";
import { createDraft, publishDraft } from "../../src/execution/workflow/versioning.ts";
import * as n from "../../src/execution/workflow/nodes.ts";
import type { HumanDecision, WorkflowDefinition, WorkflowRun, WorkflowRunSummary } from "../../src/execution/workflow/types.ts";

// ── Minimal in-memory store ──────────────────────────────────────────────────

class MemoryRunStore implements WorkflowRunStore {
  runs = new Map<string, WorkflowRun>();
  defs = new Map<string, WorkflowDefinition>();
  decisions = new Map<string, HumanDecision>();

  saveRun(run: WorkflowRun): void { this.runs.set(run.runId, run); }
  getRun(runId: string): WorkflowRun | null { return this.runs.get(runId) ?? null; }
  listRuns(): WorkflowRunSummary[] { return []; }
  saveHumanDecision(d: HumanDecision): void { this.decisions.set(d.decisionId, d); }
  getHumanDecision(id: string): HumanDecision | null { return this.decisions.get(id) ?? null; }
  getPendingDecisions(): HumanDecision[] { return []; }
  getDecisionsForRun(): HumanDecision[] { return []; }
  saveDefinition(def: WorkflowDefinition): void { this.defs.set(`${def.definitionId}@${def.version}`, def); }
  getDefinition(id: string, version?: number): WorkflowDefinition | null {
    return this.defs.get(`${id}@${version ?? 1}`) ?? null;
  }
  listDefinitions(): WorkflowDefinition[] { return [...this.defs.values()]; }
}

const recorded: Array<{ nodeId: string; outcome: string; message: string }> = [];

const recorder: WorkflowExecutionRecorder = {
  async recordExecution(p) {
    recorded.push({ nodeId: p.nodeId, outcome: p.outcome, message: p.message });
    return `exec-${recorded.length}`;
  },
};

const agentRunner: WorkflowAgentRunner = {
  async runAgentTask() { return { summary: "agent done" }; },
};

const contextProvider: WorkflowContextProvider = {
  async buildContextPackage() { return { packageId: "ctx-1" }; },
};

// ── A REAL executor: it performs actual side effects ─────────────────────────

let workDir = "";

function realExecutor(httpUrl: string): WorkflowToolExecutor {
  return {
    supports: (c) => c.family === "core_tool" && ["write_file", "http_post"].includes(c.name),
    async executeTool({ capability, inputs }) {
      if (capability.name === "write_file") {
        const path = join(workDir, String(inputs.path));
        await Bun.write(path, String(inputs.content));
        return { ok: true, output: { path, bytes: String(inputs.content).length } };
      }
      if (capability.name === "http_post") {
        const res = await fetch(httpUrl, { method: "POST", body: JSON.stringify(inputs) });
        return { ok: res.ok, output: { status: res.status } };
      }
      return { ok: false, error: `unsupported: ${capability.name}` };
    },
  };
}

/** An executor that honestly reports failure — success must not be inferred. */
const failingExecutor: WorkflowToolExecutor = {
  supports: () => true,
  async executeTool() { return { ok: false, error: "device unavailable" }; },
};

/** An executor that throws — the engine must convert this to a node failure. */
const throwingExecutor: WorkflowToolExecutor = {
  supports: () => true,
  async executeTool() { throw new Error("connection reset"); },
};

const realTimer: WorkflowTimerScheduler = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// ── HTTP fixture: proves an outbound call really happened ────────────────────

const received: Array<Record<string, unknown>> = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    received.push((await req.json()) as Record<string, unknown>);
    return new Response("ok");
  },
});
const fixtureUrl = `http://127.0.0.1:${server.port}/hook`;

afterAll(() => {
  server.stop(true);
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

function buildEngine(executor?: WorkflowToolExecutor, timerScheduler?: WorkflowTimerScheduler): WorkflowEngine {
  return new WorkflowEngine({
    agentRunner,
    executionRecorder: recorder,
    contextProvider,
    runStore: new MemoryRunStore(),
    toolExecutor: executor,
    timerScheduler,
  });
}

type CapabilityFamily = "core_tool" | "mcp_tool" | "control_action" | "plugin_operation" | "skill_operation";

async function runToolWorkflow(
  engine: WorkflowEngine,
  capability: { family: CapabilityFamily; name: string },
  inputs: Record<string, unknown>,
): Promise<WorkflowRun> {
  const trigger = n.trigger("Start", { type: "manual" });
  const action = n.toolAction("Act", capability, inputs, { dependencies: [trigger.id] });
  const draft = createDraft({
    name: "Effect Flow",
    nodes: [trigger, action],
    entryNodeIds: [trigger.id],
    authoredBy: { kind: "user", id: "test" },
  });
  const published = publishDraft(draft);
  engine.publishDefinition(published);
  const run = await engine.startRun(published.definitionId, published.version, { initiatedBy: { type: "manual" } });
  const executed = await engine.executeRun(run.runId);
  // Attach the node id for assertions.
  (executed as WorkflowRun & { __actionId?: string }).__actionId = action.id;
  return executed;
}

beforeEach(() => {
  recorded.length = 0;
  received.length = 0;
  workDir = mkdtempSync(join(tmpdir(), "xr-wf-effect-"));
});

describe("Phase 0 · T6 — workflow nodes never succeed without a verified effect", () => {
  test("EFFECT: a completed write_file node actually wrote the file", async () => {
    const engine = buildEngine(realExecutor(fixtureUrl));
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "write_file" }, {
      path: "artifact.txt",
      content: "written-by-workflow",
    });
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.nodeStates.get(actionId)?.state).toBe("completed");

    // THE EFFECT — the file exists on disk with the right bytes.
    const target = join(workDir, "artifact.txt");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("written-by-workflow");
  });

  test("EFFECT: a completed http_post node actually sent the request", async () => {
    const engine = buildEngine(realExecutor(fixtureUrl));
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "http_post" }, { event: "deploy", id: 42 });
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.nodeStates.get(actionId)?.state).toBe("completed");

    // THE EFFECT — a real server received a real request body.
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ event: "deploy", id: 42 });
  });

  test("NO EXECUTOR: the node fails instead of fabricating success", async () => {
    const engine = buildEngine(undefined);
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "write_file" }, {
      path: "never.txt",
      content: "should not exist",
    });
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.nodeStates.get(actionId)?.state).toBe("failed");
    expect(run.nodeStates.get(actionId)?.error).toMatch(/no tool executor is configured/i);
    expect(run.state).not.toBe("completed");

    // THE EFFECT — nothing was written.
    expect(existsSync(join(workDir, "never.txt"))).toBe(false);
    // And the execution record says "failed", not "succeeded".
    expect(recorded.some((r) => r.nodeId === actionId && r.outcome === "succeeded")).toBe(false);
    expect(recorded.some((r) => r.nodeId === actionId && r.outcome === "failed")).toBe(true);
  });

  test("UNSUPPORTED CAPABILITY: the node fails closed", async () => {
    const engine = buildEngine(realExecutor(fixtureUrl));
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "launch_missiles" }, {});
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.nodeStates.get(actionId)?.state).toBe("failed");
    expect(run.nodeStates.get(actionId)?.error).toMatch(/unsupported capability/i);
  });

  test("EXECUTOR REPORTS FAILURE: ok:false is never upgraded to success", async () => {
    const engine = buildEngine(failingExecutor);
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "write_file" }, { path: "x", content: "y" });
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.nodeStates.get(actionId)?.state).toBe("failed");
    expect(run.nodeStates.get(actionId)?.error).toBe("device unavailable");
    expect(recorded.some((r) => r.outcome === "succeeded")).toBe(false);
  });

  test("EXECUTOR THROWS: the exception becomes a node failure, not a success", async () => {
    const engine = buildEngine(throwingExecutor);
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "write_file" }, { path: "x", content: "y" });
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.nodeStates.get(actionId)?.state).toBe("failed");
    expect(run.nodeStates.get(actionId)?.error).toMatch(/connection reset/);
  });

  test("the failed node is recorded in the run error chain", async () => {
    const engine = buildEngine(failingExecutor);
    const run = await runToolWorkflow(engine, { family: "core_tool", name: "write_file" }, { path: "x", content: "y" });
    const actionId = (run as WorkflowRun & { __actionId: string }).__actionId;

    expect(run.errorChain.some((e) => e.nodeId === actionId && e.error === "device unavailable")).toBe(true);
  });
});

describe("Phase 0 · T6 — timer nodes wait for real or do not claim to have waited", () => {
  async function runTimerWorkflow(engine: WorkflowEngine, durationMs: number): Promise<{ run: WorkflowRun; nodeId: string; elapsed: number }> {
    const trigger = n.trigger("Start", { type: "manual" });
    const wait = n.waitTimer("Wait", { type: "delay", durationMs }, { dependencies: [trigger.id] });
    const draft = createDraft({
      name: "Timer Flow",
      nodes: [trigger, wait],
      entryNodeIds: [trigger.id],
      authoredBy: { kind: "user", id: "test" },
    });
    const published = publishDraft(draft);
    engine.publishDefinition(published);
    const started = await engine.startRun(published.definitionId, published.version, { initiatedBy: { type: "manual" } });

    const t0 = Date.now();
    const run = await engine.executeRun(started.runId);
    return { run, nodeId: wait.id, elapsed: Date.now() - t0 };
  }

  test("EFFECT: with a scheduler, wall-clock time really elapses before completion", async () => {
    const engine = buildEngine(undefined, realTimer);
    const { run, nodeId, elapsed } = await runTimerWorkflow(engine, 120);

    expect(run.nodeStates.get(nodeId)?.state).toBe("completed");
    // THE EFFECT — measured time actually passed (allowing timer slack).
    expect(elapsed).toBeGreaterThanOrEqual(100);
    const outputs = run.nodeStates.get(nodeId)?.outputs as { waited: number; requested: number };
    expect(outputs.requested).toBe(120);
    expect(outputs.waited).toBeGreaterThanOrEqual(100);
  });

  test("NO SCHEDULER: the node waits instead of claiming an instant, fictional wait", async () => {
    const engine = buildEngine(undefined, undefined);
    const { run, nodeId, elapsed } = await runTimerWorkflow(engine, 5_000);

    // It must NOT report completion: no 5-second wait occurred.
    expect(run.nodeStates.get(nodeId)?.state).not.toBe("completed");
    expect(run.nodeStates.get(nodeId)?.error).toMatch(/no timer scheduler configured/i);
    // And it must not have blocked either — it parks for an external scheduler.
    expect(elapsed).toBeLessThan(1_000);
  });
});
