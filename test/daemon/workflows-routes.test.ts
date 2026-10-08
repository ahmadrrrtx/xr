/**
 * Phase 19 — custom agents + visual workflows over the real daemon handler.
 * LLM nodes run through an injected agent runner (no provider in CI); every
 * other node (tool, human check, branch, output) exercises the real engine,
 * repository, approval plane and SSE stream.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { setWorkflowRuntimeOptionsForTests } from "../../src/daemon/workflow-runtime.ts";
import { resetCustomAgentStoreForTests } from "../../src/daemon/routes/custom-agents.routes.ts";
import { defaultConfig } from "../../src/execution/workflow/canvas.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";

const TOKEN = "test-token-phase19";
const home = mkdtempSync(join(tmpdir(), "xr-p19-routes-"));
const prevHome = process.env.XR_HOME;
let store: Store;
let h: (req: Request) => Promise<Response>;
const instructions: string[] = [];

beforeAll(() => {
  process.env.XR_HOME = home;
  resetCustomAgentStoreForTests();
  setWorkflowRuntimeOptionsForTests({
    agentRunner: {
      runAgentTask: async (p) => {
        instructions.push(p.instruction);
        p.say("thinking…");
        return { summary: `JOKE(${p.instruction.slice(-12)})`, cost: { usd: 0.0123, tokensIn: 120, tokensOut: 30 } };
      },
    },
  });
  store = new Store(join(home, "xr-test.db"));
  h = makeHandler(store, TOKEN);
});

afterAll(() => {
  setWorkflowRuntimeOptionsForTests(null);
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  try {
    store.close();
  } catch {
    /* closed */
  }
  rmSync(home, { recursive: true, force: true });
});

const req = (p: string, init?: { method?: string; body?: unknown }) =>
  new Request(`http://127.0.0.1:7842${p}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
const call = async (p: string, init?: { method?: string; body?: unknown }) => {
  const res = await h(req(p, init));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
};

function frames(text: string): Array<Record<string, any>> {
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]" && !l.startsWith(":"))
    .map((l) => JSON.parse(l) as Record<string, any>);
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const jokeGraph = {
  nodes: [
    { id: "n_in", kind: "input", label: "Topic", position: { x: 0, y: 0 }, config: { ...defaultConfig("input"), paramName: "topic", required: true } },
    { id: "n_llm", kind: "llm", label: "Write a joke", position: { x: 280, y: 0 }, config: { ...defaultConfig("llm"), instruction: "Write a one-liner about {{topic}}", maxUsd: 0.2 } },
    { id: "n_out", kind: "output", label: "Done", position: { x: 560, y: 0 }, config: { ...defaultConfig("output"), message: "{{n_llm.summary}}" } },
  ],
  edges: [
    { id: "e1", source: "n_in", target: "n_llm" },
    { id: "e2", source: "n_llm", target: "n_out" },
  ],
};

describe("custom agents API", () => {
  test("GET /api/agents is additive: roles stay, agents[] (builtin + custom) and tools[] appear", async () => {
    const r = await call("/api/v1/agents");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.roles)).toBe(true);
    expect(r.json.agents.some((a: any) => a.id === "researcher" && a.builtin === true)).toBe(true);
    expect(r.json.tools.map((t: any) => t.name)).toContain("read_file");
  });

  test("create → list → get → patch (version 2) → duplicate → delete; invalid input answers 422 with field problems", async () => {
    // Shape errors are caught by the contract layer (400); semantic ones by the store (422) — both carry field paths.
    const shape = await call("/api/v1/agents/custom", { method: "POST", body: { name: "", systemPrompt: "short" } });
    expect(shape.status).toBe(400);
    expect(shape.json.errors.map((e: any) => e.path).sort()).toEqual(["name", "systemPrompt"]);
    const bad = await call("/api/v1/agents/custom", { method: "POST", body: { name: "Bad tools", systemPrompt: "A long enough system prompt for the test.", tools: ["nope"], role: "wizard" } });
    expect(bad.status).toBe(422);
    expect(bad.json.errors.map((e: any) => e.path).sort()).toEqual(["role", "tools"]);

    const created = await call("/api/v1/agents/custom", { method: "POST", body: { name: "PR describer", systemPrompt: "Write crisp pull-request descriptions from a diff.", tools: ["read_file"], emoji: "📝" } });
    expect(created.status).toBe(201);
    const id = created.json.agent.id as string;
    expect(id.startsWith("custom-")).toBe(true);
    expect(created.json.agent.version).toBe(1);

    const list = await call("/api/v1/agents/custom");
    expect(list.json.agents.map((a: any) => a.id)).toEqual([id]);
    const all = await call("/api/v1/agents");
    expect(all.json.agents.find((a: any) => a.id === id)?.builtin).toBe(false);

    const patched = await call(`/api/v1/agents/custom/${id}`, { method: "PATCH", body: { description: "From diffs", budget: { perRunUsd: 0.25 } } });
    expect(patched.status).toBe(200);
    expect(patched.json.agent.version).toBe(2);
    expect(patched.json.agent.budget.perRunUsd).toBe(0.25);
    expect(patched.json.agent.systemPrompt).toContain("pull-request");

    const dup = await call(`/api/v1/agents/custom/${id}/duplicate`, { method: "POST", body: {} });
    expect(dup.status).toBe(201);
    expect(dup.json.agent.name).toBe("PR describer copy");

    const imported = await call("/api/v1/agents/custom/import", { method: "POST", body: { ...created.json.agent, name: "Imported twin" } });
    expect(imported.status).toBe(201);
    expect(imported.json.agent.id).not.toBe(id); // never overwrites an existing id

    expect((await call(`/api/v1/agents/custom/${id}`, { method: "DELETE" })).json).toEqual({ ok: true });
    expect((await call(`/api/v1/agents/custom/${id}`)).status).toBe(404);
    expect((await call("/api/v1/agents/custom/not-an-id")).status).toBe(404);
  });
});

describe("workflows API", () => {
  let definitionId = "";

  test("inspect lints without saving; create refuses graphs with errors (422, per-node) and publishes v1 otherwise", async () => {
    const broken = structuredClone(jokeGraph);
    broken.nodes[1]!.config = { ...broken.nodes[1]!.config, instruction: "" };
    const insp = await call("/api/v1/workflows/inspect", { method: "POST", body: { graph: broken } });
    expect(insp.status).toBe(200);
    expect(insp.json.ok).toBe(false);
    expect(insp.json.problems.find((p: any) => p.code === "agentic_no_instruction")?.nodeId).toBe("n_llm");
    expect(insp.json.summary).toEqual({ nodes: 3, tools: 0, humanChecks: 0, llmSteps: 1 });

    const refused = await call("/api/v1/workflows", { method: "POST", body: { name: "Joke", graph: broken } });
    expect(refused.status).toBe(422);
    expect(refused.json.errors[0].path).toBe("n_llm");
    expect((await call("/api/v1/workflows")).json.workflows).toEqual([]);

    const created = await call("/api/v1/workflows", { method: "POST", body: { name: "Joke of the day", description: "Input → LLM → Output", graph: jokeGraph, tags: ["demo"] } });
    expect(created.status).toBe(201);
    definitionId = created.json.workflow.definitionId;
    expect(created.json.workflow.version).toBe(1);
    expect(created.json.workflow.contentHash.startsWith("v2:")).toBe(true);
    expect(created.json.workflow.parameters).toEqual([{ name: "topic", type: "string", required: true }]);
    expect(created.json.graph.nodes.map((n: any) => n.kind)).toEqual(["input", "llm", "output"]);
    expect(created.json.versions).toEqual([1]);

    const list = await call("/api/v1/workflows");
    expect(list.json.workflows).toHaveLength(1);
    expect(list.json.workflows[0]).toMatchObject({ definitionId, name: "Joke of the day", version: 1, nodeCount: 3, summary: { nodes: 3, llmSteps: 1 }, lastRun: null });
  });

  test("update publishes an immutable new version (stale baseVersion → 409); old versions stay readable", async () => {
    const got = await call(`/api/v1/workflows/${definitionId}`);
    expect(got.status).toBe(200);
    const graph = got.json.graph;
    graph.nodes[1].config.instruction = "Write a two-liner about {{topic}}";
    const stale = await call(`/api/v1/workflows/${definitionId}`, { method: "PATCH", body: { graph, baseVersion: 7 } });
    expect(stale.status).toBe(409);
    const updated = await call(`/api/v1/workflows/${definitionId}`, { method: "PATCH", body: { graph, baseVersion: 1, name: "Joke of the day v2" } });
    expect(updated.status).toBe(200);
    expect(updated.json.workflow.version).toBe(2);
    expect(updated.json.workflow.name).toBe("Joke of the day v2");
    expect(updated.json.versions).toEqual([1, 2]);
    const v1 = await call(`/api/v1/workflows/${definitionId}?version=1`);
    expect(v1.json.workflow.version).toBe(1);
    expect(v1.json.workflow.active).toBe(false);
    expect(v1.json.graph.nodes[1].config.instruction).toBe("Write a one-liner about {{topic}}");
    expect((await call("/api/v1/workflows")).json.workflows).toHaveLength(1);
  });

  test("run: missing required parameter → 400; a real run streams engine events, renders templates, accumulates cost", async () => {
    const missing = await call(`/api/v1/workflows/${definitionId}/run`, { method: "POST", body: {} });
    expect(missing.status).toBe(400);
    expect(missing.json.detail).toContain("topic");

    const started = await call(`/api/v1/workflows/${definitionId}/run`, { method: "POST", body: { parameters: { topic: "sandboxes" } } });
    expect(started.status).toBe(202);
    const runId = started.json.run.runId as string;
    expect(started.json.run.definitionVersion).toBe(2);

    const res = await h(req(`/api/v1/workflows/runs/${runId}/stream`));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const evs = frames(await res.text());
    const types = evs.map((e) => e.type);
    expect(types[0]).toBe("run_state");
    expect(types).toContain("log");
    expect(types).toContain("cost_update");
    expect(types[types.length - 2]).toBe("run_end");
    expect(types[types.length - 1]).toBe("stream_end");
    const llmDone = evs.find((e) => e.type === "node_state" && e.nodeId === "n_llm" && e.state === "completed");
    expect(instructions.at(-1)).toBe("Write a two-liner about sandboxes");
    expect(llmDone?.outputs?.summary).toBe("JOKE(ut sandboxes)");

    const run = await call(`/api/v1/workflows/runs/${runId}`);
    expect(run.json.run.state).toBe("completed");
    expect(run.json.run.cost.actualUsd).toBeCloseTo(0.0123, 5);
    expect(run.json.run.nodes.find((n: any) => n.nodeId === "n_out").outputs.message).toBe("JOKE(ut sandboxes)");

    // a second subscriber gets the buffered replay and ends immediately
    const again = frames(await (await h(req(`/api/v1/workflows/runs/${runId}/stream`))).text());
    expect(again.map((e) => e.type)).toEqual(types);

    const list = await call("/api/v1/workflows");
    expect(list.json.workflows[0].lastRun).toMatchObject({ runId, state: "completed" });
    expect((await call(`/api/v1/workflows/${definitionId}/runs`)).json.runs.map((r: any) => r.runId)).toEqual([runId]);
    expect((await call("/api/v1/workflows/runs")).json.runs.some((r: any) => r.runId === runId)).toBe(true);
  });

  test("human approval parks the run as a durable approval; the Shield decision endpoint resumes it", async () => {
    const graph = {
      nodes: [
        { id: "a", kind: "input", label: "Start", position: { x: 0, y: 0 }, config: defaultConfig("input") },
        { id: "h", kind: "human_approval", label: "Ship it?", position: { x: 1, y: 0 }, config: { ...defaultConfig("human_approval"), summary: "Publish the release notes", riskLevel: "medium" } },
        { id: "o", kind: "output", label: "Shipped", position: { x: 2, y: 0 }, config: { ...defaultConfig("output"), message: "shipped" } },
      ],
      edges: [
        { id: "e1", source: "a", target: "h" },
        { id: "e2", source: "h", target: "o" },
      ],
    };
    const created = await call("/api/v1/workflows", { method: "POST", body: { name: "Gated", graph } });
    expect(created.status).toBe(201);
    const started = await call(`/api/v1/workflows/${created.json.workflow.definitionId}/run`, { method: "POST", body: {} });
    const runId = started.json.run.runId as string;

    const pendingApproval = await waitFor(async () => {
      const list = (await call("/api/v1/approvals")).json.pending as Array<any>;
      return list.find((p) => p.tool === "workflow.human_approval" && p.runId === runId);
    });
    expect(pendingApproval.reason).toBe("Publish the release notes");
    const parked = await call(`/api/v1/workflows/runs/${runId}`);
    expect(parked.json.run.state).toBe("awaiting_approval");
    expect(parked.json.run.pendingHuman).toEqual([{ nodeId: "h", approvalId: pendingApproval.id, kind: "approval", summary: "Publish the release notes" }]);

    const decided = await call(`/api/v1/approvals/${pendingApproval.id}/decision`, { method: "POST", body: { approved: true } });
    expect(decided.status).toBe(200);
    const done = await waitFor(async () => {
      const r = await call(`/api/v1/workflows/runs/${runId}`);
      return r.json.run.state === "completed" ? r.json.run : null;
    });
    expect(done.nodes.find((n: any) => n.nodeId === "o").outputs.message).toBe("shipped");
    const evs = frames(await (await h(req(`/api/v1/workflows/runs/${runId}/stream`))).text());
    expect(evs.find((e) => e.type === "approval_required")).toMatchObject({ nodeId: "h", approvalId: pendingApproval.id, kind: "approval" });
  });

  test("the inline canvas decision goes through the same approval record; a denial fails the run (stop_workflow)", async () => {
    const graph = {
      nodes: [
        { id: "a", kind: "input", label: "Start", position: { x: 0, y: 0 }, config: defaultConfig("input") },
        { id: "h", kind: "human_approval", label: "Gate", position: { x: 1, y: 0 }, config: { ...defaultConfig("human_approval"), summary: "Delete the staging bucket", riskLevel: "high" } },
        { id: "o", kind: "output", label: "Out", position: { x: 2, y: 0 }, config: defaultConfig("output") },
      ],
      edges: [
        { id: "e1", source: "a", target: "h" },
        { id: "e2", source: "h", target: "o" },
      ],
    };
    const created = await call("/api/v1/workflows", { method: "POST", body: { name: "Gated 2", graph } });
    const started = await call(`/api/v1/workflows/${created.json.workflow.definitionId}/run`, { method: "POST", body: {} });
    const runId = started.json.run.runId as string;
    const pendingApproval = await waitFor(async () => ((await call("/api/v1/approvals")).json.pending as Array<any>).find((p) => p.runId === runId));

    const bad = await call(`/api/v1/workflows/runs/${runId}/human-decision`, { method: "POST", body: { nodeId: "o", decision: "approve" } });
    expect(bad.status).toBe(400);
    const denied = await call(`/api/v1/workflows/runs/${runId}/human-decision`, { method: "POST", body: { nodeId: "h", decision: "deny", comment: "not today" } });
    expect(denied.status).toBe(200);
    expect(denied.json.run.state).toBe("failed");
    expect(denied.json.run.pendingHuman).toEqual([]);
    expect(getApprovalStore(store as any).get(pendingApproval.id)?.decision).toBe("denied");
    expect(((await call("/api/v1/approvals")).json.pending as Array<any>).some((p) => p.id === pendingApproval.id)).toBe(false);
  });

  test("cancel stops a waiting run and withdraws its approval; retire hides the workflow from the list", async () => {
    const graph = {
      nodes: [
        { id: "a", kind: "input", label: "Start", position: { x: 0, y: 0 }, config: defaultConfig("input") },
        { id: "w", kind: "wait", label: "Wait", position: { x: 1, y: 0 }, config: { ...defaultConfig("wait"), durationMs: 60_000 } },
        { id: "o", kind: "output", label: "Out", position: { x: 2, y: 0 }, config: defaultConfig("output") },
      ],
      edges: [
        { id: "e1", source: "a", target: "w" },
        { id: "e2", source: "w", target: "o" },
      ],
    };
    const created = await call("/api/v1/workflows", { method: "POST", body: { name: "Slow", graph } });
    const id = created.json.workflow.definitionId as string;
    const started = await call(`/api/v1/workflows/${id}/run`, { method: "POST", body: {} });
    const runId = started.json.run.runId as string;
    await waitFor(async () => {
      const r = await call(`/api/v1/workflows/runs/${runId}`);
      return r.json.run.nodes.find((n: any) => n.nodeId === "w")?.state === "waiting_timer" ? true : null;
    });
    const cancelled = await call(`/api/v1/workflows/runs/${runId}/cancel`, { method: "POST", body: {} });
    expect(cancelled.json).toEqual({ ok: true, state: "cancelled" });
    const evs = frames(await (await h(req(`/api/v1/workflows/runs/${runId}/stream`))).text());
    expect(evs.filter((e) => e.type === "run_end")).toHaveLength(1);
    expect(evs.find((e) => e.type === "run_end")?.summary?.state).toBe("cancelled");

    expect((await call(`/api/v1/workflows/${id}`, { method: "DELETE" })).json).toEqual({ ok: true });
    expect((await call("/api/v1/workflows")).json.workflows.some((w: any) => w.definitionId === id)).toBe(false);
    expect((await call(`/api/v1/workflows/${id}`)).status).toBe(200); // history stays readable
    expect((await call("/api/v1/workflows/nope")).status).toBe(404);
  });
});
