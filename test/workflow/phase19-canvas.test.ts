/**
 * Phase 19 — canvas compiler, definition linter and the engine additions
 * (events, cost accumulation, branch skipping, templates).
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { WorkflowRepository } from "../../src/execution/workflow/repository.ts";
import { WorkflowEngine } from "../../src/execution/workflow/engine.ts";
import { compileCanvas, decompileDefinition, defaultConfig, type CanvasGraph } from "../../src/execution/workflow/canvas.ts";
import { lintDefinition } from "../../src/execution/workflow/lint.ts";
import { createDraft, publishDraft } from "../../src/execution/workflow/versioning.ts";
import type { WorkflowRunEvent } from "../../src/execution/workflow/events.ts";

const home = mkdtempSync(join(tmpdir(), "xr-p19-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

function graph(): CanvasGraph {
  return {
    nodes: [
      { id: "n_in", kind: "input", label: "Topic", position: { x: 0, y: 0 }, config: { ...defaultConfig("input"), paramName: "topic", required: true } },
      { id: "n_llm", kind: "llm", label: "Joke", position: { x: 280, y: 0 }, config: { ...defaultConfig("llm"), instruction: "Write a one-liner joke about {{topic}}", maxUsd: 0.2 } },
      { id: "n_out", kind: "output", label: "Done", position: { x: 560, y: 0 }, config: { ...defaultConfig("output"), message: "{{n_llm.summary}}" } },
    ],
    edges: [
      { id: "e1", source: "n_in", target: "n_llm" },
      { id: "e2", source: "n_llm", target: "n_out" },
    ],
  };
}

function engineWith(events: WorkflowRunEvent[], runner?: (p: { instruction: string }) => Promise<{ summary: string; cost?: { usd: number; tokensIn: number; tokensOut: number } }>) {
  const store = new WorkspaceStore(join(home, `wf-${Math.random().toString(36).slice(2)}.db`));
  const repo = new WorkflowRepository(store);
  const engine = new WorkflowEngine({
    agentRunner: {
      runAgentTask: async (p) =>
        runner ? runner(p) : { summary: `echo: ${p.instruction}`, cost: { usd: 0.01, tokensIn: 100, tokensOut: 20 } },
    },
    executionRecorder: { recordExecution: async () => "ex_1" },
    contextProvider: { buildContextPackage: async () => ({ packageId: "ctx" }) },
    runStore: repo,
    onEvent: (e) => events.push(e),
  });
  return { engine, repo };
}

describe("Phase 19 · canvas compiler", () => {
  test("compiles Input → LLM → Output to canonical nodes with stable ids, deps and parameters", () => {
    const compiled = compileCanvas(graph());
    expect(compiled.nodes.map((n) => n.id)).toEqual(["n_in", "n_llm", "n_out"]);
    expect(compiled.nodes.map((n) => n.kind)).toEqual(["trigger", "agentic", "completion"]);
    expect(compiled.nodes[1]!.dependencies).toEqual(["n_in"]);
    expect(compiled.nodes[2]!.dependencies).toEqual(["n_llm"]);
    expect(compiled.entryNodeIds).toEqual(["n_in"]);
    expect(compiled.parameters).toEqual([{ name: "topic", type: "string", required: true }]);
    expect(compiled.nodes[1]!.metadata?.canvas).toMatchObject({ x: 280, y: 0, kind: "llm" });
  });

  test("branch handles become trueNodes / falseNodes", () => {
    const g: CanvasGraph = {
      nodes: [
        { id: "a", kind: "input", label: "In", position: { x: 0, y: 0 }, config: defaultConfig("input") },
        { id: "b", kind: "branch", label: "Check", position: { x: 1, y: 0 }, config: { ...defaultConfig("branch"), field: "a", operator: "eq", value: "1" } },
        { id: "t", kind: "output", label: "Yes", position: { x: 2, y: 0 }, config: defaultConfig("output") },
        { id: "f", kind: "output", label: "No", position: { x: 2, y: 1 }, config: defaultConfig("output") },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", sourceHandle: "true", target: "t" },
        { id: "e3", source: "b", sourceHandle: "false", target: "f" },
      ],
    };
    const compiled = compileCanvas(g);
    const branch = compiled.nodes.find((n) => n.kind === "branch");
    expect(branch && branch.kind === "branch" ? { t: branch.trueNodes, f: branch.falseNodes } : null).toEqual({ t: ["t"], f: ["f"] });
  });

  test("round-trips through decompile (positions, kinds, config, branch handles)", () => {
    const compiled = compileCanvas(graph());
    const back = decompileDefinition({ nodes: compiled.nodes });
    expect(back.nodes.map((n) => [n.id, n.kind, n.position.x])).toEqual([["n_in", "input", 0], ["n_llm", "llm", 280], ["n_out", "output", 560]]);
    expect(back.nodes[1]!.config.instruction).toBe("Write a one-liner joke about {{topic}}");
    expect(back.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["n_in>n_llm", "n_llm>n_out"]);
  });

  test("sub-agent nodes resolve through the agent resolver and fail on unknown ids", () => {
    const g: CanvasGraph = {
      nodes: [{ id: "s", kind: "subagent", label: "Reviewer", position: { x: 0, y: 0 }, config: { ...defaultConfig("subagent"), agentId: "reviewer", instruction: "review" } }],
      edges: [],
    };
    const resolved = compileCanvas(g, {
      resolveAgent: (id) =>
        id === "reviewer"
          ? ({ id, role: "reviewer", label: "Reviewer", description: "", version: "1", enabledByDefault: true, capabilities: [], permissions: { writeFiles: false, shell: false, network: false, plugins: false, mcp: false, memoryRead: true, memoryWrite: false, computerControl: false, secrets: false, destructiveExec: false }, toolScope: { mode: "allowlist", tools: ["read_file"] }, memoryScope: { kind: "workflow", sharedWithSupervisor: true, maxEntries: 2 }, providerScope: { model: "m" } } as const)
          : undefined,
    });
    const node = resolved.nodes[0]!;
    expect(node.kind === "agentic" ? [node.agentRole, node.agentId, node.toolScope.tools, node.providerScope.model] : null).toEqual(["reviewer", "reviewer", ["read_file"], "m"]);
    expect(() => compileCanvas(g, { resolveAgent: () => undefined })).toThrow(/Unknown agent/);
  });
});

describe("Phase 19 · definition linter", () => {
  test("clean graph has no errors (a missing Output is only a warning)", () => {
    const { nodes } = compileCanvas(graph());
    const res = lintDefinition(nodes);
    expect(res.ok).toBe(true);
    expect(res.problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  test("reports cycles, unreachable nodes, empty instructions and dangling nodes per node", () => {
    const g = graph();
    g.nodes[1]!.config = { ...g.nodes[1]!.config, instruction: "" };
    g.nodes.push({ id: "n_x", kind: "tool", label: "Lonely", position: { x: 0, y: 0 }, config: { ...defaultConfig("tool"), tool: "read_file" } });
    g.nodes.push({ id: "n_c1", kind: "wait", label: "C1", position: { x: 0, y: 0 }, config: defaultConfig("wait") });
    g.nodes.push({ id: "n_c2", kind: "wait", label: "C2", position: { x: 0, y: 0 }, config: defaultConfig("wait") });
    g.edges.push({ id: "c1", source: "n_c1", target: "n_c2" }, { id: "c2", source: "n_c2", target: "n_c1" });
    const { nodes, entryNodeIds } = compileCanvas(g);
    const res = lintDefinition(nodes, entryNodeIds);
    const codes = res.problems.map((p) => `${p.code}:${p.nodeId ?? "-"}`);
    expect(res.ok).toBe(false);
    expect(codes).toContain("agentic_no_instruction:n_llm");
    expect(codes.some((c) => c.startsWith("cycle:"))).toBe(true);
    expect(codes).toContain("unreachable:n_c1");
    expect(codes).toContain("dangling:n_x");
  });
});

describe("Phase 19 · engine additions", () => {
  test("emits node/run events, resolves {{templates}}, accumulates cost and ends with run_end", async () => {
    const events: WorkflowRunEvent[] = [];
    const seen: string[] = [];
    const { engine } = engineWith(events, async (p) => {
      seen.push(p.instruction);
      return { summary: "Why did the AI cross the road?", cost: { usd: 0.02, tokensIn: 300, tokensOut: 40 } };
    });
    const compiled = compileCanvas(graph());
    const def = publishDraft(createDraft({ name: "Joke", nodes: compiled.nodes, entryNodeIds: compiled.entryNodeIds, parameters: compiled.parameters, authoredBy: { kind: "user", id: "u" } }));
    engine.publishDefinition(def);
    const run = await engine.startRun(def.definitionId, def.version, { initiatedBy: { type: "manual" }, resolvedParameters: { topic: "AI assistants" } });
    const done = await engine.executeRun(run.runId);

    expect(seen).toEqual(["Write a one-liner joke about AI assistants"]);
    expect(done.state).toBe("completed");
    expect(done.nodeStates.get("n_out")?.outputs?.message).toBe("Why did the AI cross the road?");
    expect(done.cost.actualUsd).toBeCloseTo(0.02, 5);
    expect(done.cost.breakdown.n_llm?.tokensIn).toBe(300);

    const kinds = events.map((e) => e.type);
    expect(kinds[0]).toBe("run_state");
    expect(kinds).toContain("cost_update");
    expect(kinds[kinds.length - 1]).toBe("run_end");
    const llmStates = events.filter((e): e is Extract<WorkflowRunEvent, { type: "node_state" }> => e.type === "node_state" && e.nodeId === "n_llm").map((e) => e.state).filter((st) => st !== "pending" && st !== "ready");
    expect(llmStates).toEqual(["running", "completed"]);
    expect(events.filter((e) => e.type === "run_end")).toHaveLength(1);
    const runStates = events.filter((e): e is Extract<WorkflowRunEvent, { type: "run_state" }> => e.type === "run_state").map((e) => e.state);
    expect(runStates[0]).toBe("running");
    expect(runStates[runStates.length - 1]).toBe("completed");
  });

  test("branch: the untaken path is skipped (not left pending) and the run completes", async () => {
    const events: WorkflowRunEvent[] = [];
    const { engine } = engineWith(events);
    const g: CanvasGraph = {
      nodes: [
        { id: "a", kind: "input", label: "In", position: { x: 0, y: 0 }, config: { ...defaultConfig("input"), paramName: "go" } },
        { id: "b", kind: "branch", label: "Check", position: { x: 1, y: 0 }, config: { ...defaultConfig("branch"), conditionType: "field_exists", field: "nope" } },
        { id: "t", kind: "output", label: "Yes", position: { x: 2, y: 0 }, config: { ...defaultConfig("output"), message: "yes" } },
        { id: "f", kind: "notification", label: "No", position: { x: 2, y: 1 }, config: { ...defaultConfig("notification"), message: "took false" } },
        { id: "f2", kind: "output", label: "End", position: { x: 3, y: 1 }, config: { ...defaultConfig("output"), message: "{{f.message}}" } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", sourceHandle: "true", target: "t" },
        { id: "e3", source: "b", sourceHandle: "false", target: "f" },
        { id: "e4", source: "f", target: "f2" },
      ],
    };
    const compiled = compileCanvas(g);
    const def = publishDraft(createDraft({ name: "Branchy", nodes: compiled.nodes, entryNodeIds: compiled.entryNodeIds, authoredBy: { kind: "user", id: "u" } }));
    engine.publishDefinition(def);
    const run = await engine.startRun(def.definitionId, def.version, { initiatedBy: { type: "manual" } });
    const done = await engine.executeRun(run.runId);
    expect(done.nodeStates.get("t")?.state).toBe("skipped");
    expect(done.nodeStates.get("f")?.state).toBe("completed");
    expect(done.nodeStates.get("f2")?.outputs?.message).toBe("took false");
    expect(done.state).toBe("completed");
  });

  test("human approval parks the run, emits the waiting node, and a denial with stop_workflow fails it", async () => {
    const events: WorkflowRunEvent[] = [];
    const { engine } = engineWith(events);
    const g: CanvasGraph = {
      nodes: [
        { id: "a", kind: "input", label: "In", position: { x: 0, y: 0 }, config: defaultConfig("input") },
        { id: "h", kind: "human_approval", label: "Ship it?", position: { x: 1, y: 0 }, config: { ...defaultConfig("human_approval"), summary: "Deploy to prod" } },
        { id: "o", kind: "output", label: "Out", position: { x: 2, y: 0 }, config: defaultConfig("output") },
      ],
      edges: [
        { id: "e1", source: "a", target: "h" },
        { id: "e2", source: "h", target: "o" },
      ],
    };
    const compiled = compileCanvas(g);
    const def = publishDraft(createDraft({ name: "Gate", nodes: compiled.nodes, entryNodeIds: compiled.entryNodeIds, authoredBy: { kind: "user", id: "u" } }));
    engine.publishDefinition(def);
    const run = await engine.startRun(def.definitionId, def.version, { initiatedBy: { type: "manual" } });
    const parked = await engine.executeRun(run.runId);
    expect(parked.state).toBe("awaiting_approval");
    expect(events.some((e) => e.type === "node_state" && e.nodeId === "h" && e.state === "waiting_approval")).toBe(true);
    const after = await engine.submitHumanDecision(run.runId, "h", { approval: "denied", reason: "not today" }, { kind: "user", userId: "u" });
    expect(after.state).toBe("failed");
    expect(events[events.length - 1]?.type).toBe("run_end");
  });
});
