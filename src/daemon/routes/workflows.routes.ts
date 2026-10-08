/**
 * Phase 19 — visual workflows API.
 *
 * The desktop canvas sends a `CanvasGraph` (React Flow nodes/edges). The
 * server compiles it DOWN to the canonical `WorkflowDefinition` with the
 * engine's own node factories, lints it, and publishes an immutable,
 * content-hashed version through the WorkflowRepository. Runs go through the
 * daemon WorkflowRuntime (the real engine) and stream the engine's events.
 */

import { listAgents } from "../../agents/registry.ts";
import { CustomAgentStore, toAgentDefinition } from "../../agents/custom-store.ts";
import { allTools } from "../../tools/registry.ts";
import { CanvasCompileError, compileCanvas, decompileDefinition, type CanvasGraph } from "../../execution/workflow/canvas.ts";
import { lintDefinition, type WorkflowProblem as WorkflowLintProblem } from "../../execution/workflow/lint.ts";
import { createDraft, createNewVersion, publishDraft, publishNewVersion } from "../../execution/workflow/versioning.ts";
import { hashDefinition, type HumanDecision, type WorkflowDefinition, type WorkflowNode, type WorkflowRun } from "../../execution/workflow/types.ts";
import type { WorkflowRunEvent } from "../../execution/workflow/events.ts";
import { getWorkflowRuntime, WorkflowRuntimeError, type WorkflowRuntime } from "../workflow-runtime.ts";
import { problem, route, type DaemonRoute, type DaemonRouteContext, type DaemonState } from "./router.ts";
import type { XRConfig } from "../../config/config.ts";

const BASE = "/api/workflows";
const RUNS = `${BASE}/runs/`;

type Ctx = DaemonRouteContext;

function runtimeFor(state: DaemonState, config: XRConfig): WorkflowRuntime {
  return getWorkflowRuntime(state, config);
}

function agentResolver(): (id: string) => ReturnType<typeof toAgentDefinition> | ReturnType<typeof listAgents>[number] | undefined {
  const builtin = new Map(listAgents({ includeDisabled: true }).map((a) => [a.id, a]));
  const custom = new CustomAgentStore({ knownTools: allTools().map((t) => t.name) });
  return (id) => builtin.get(id) ?? (custom.get(id) ? toAgentDefinition(custom.get(id)!) : undefined);
}

export function graphSummary(nodes: WorkflowNode[]): { nodes: number; tools: number; humanChecks: number; llmSteps: number } {
  return {
    nodes: nodes.length,
    tools: nodes.filter((n) => n.kind === "tool_action").length,
    humanChecks: nodes.filter((n) => n.kind === "human_approval" || n.kind === "human_review").length,
    llmSteps: nodes.filter((n) => n.kind === "agentic").length,
  };
}

/** Compile + lint; a compile error becomes a single `graph` problem. */
export function compileAndLint(graph: CanvasGraph): {
  compiled: ReturnType<typeof compileCanvas> | null;
  problems: WorkflowLintProblem[];
  ok: boolean;
} {
  try {
    const compiled = compileCanvas(graph, { resolveAgent: agentResolver() });
    const lint = lintDefinition(compiled.nodes, compiled.entryNodeIds);
    return { compiled, problems: lint.problems, ok: lint.ok };
  } catch (err) {
    const nodeId = err instanceof CanvasCompileError ? err.nodeId : undefined;
    return { compiled: null, problems: [{ severity: "error", code: "graph", message: err instanceof Error ? err.message : String(err), ...(nodeId ? { nodeId } : {}) }], ok: false };
  }
}

function parseGraph(body: Record<string, unknown>): CanvasGraph | null {
  const g = body.graph;
  if (!g || typeof g !== "object" || !Array.isArray((g as CanvasGraph).nodes) || !Array.isArray((g as CanvasGraph).edges)) return null;
  return g as CanvasGraph;
}

function definitionDoc(def: WorkflowDefinition) {
  return def;
}

export function runView(run: WorkflowRun, pending: Array<{ nodeId: string; approvalId: string; kind: "approval" | "review"; summary: string }>) {
  const nodes = [...run.nodeStates.values()].map((ns) => ({
    nodeId: ns.nodeId,
    kind: ns.kind,
    state: ns.state,
    attempt: ns.attempt,
    ...(ns.error ? { error: ns.error } : {}),
    ...(ns.outputs ? { outputs: ns.outputs } : {}),
    ...(ns.startedAt ? { startedAt: ns.startedAt } : {}),
    ...(ns.endedAt ? { endedAt: ns.endedAt } : {}),
  }));
  return {
    runId: run.runId,
    definitionId: run.definitionId,
    definitionVersion: run.definitionVersion,
    name: run.definitionSnapshot.name,
    state: run.state,
    nodes,
    cost: run.cost,
    createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.error ? { error: run.error } : {}),
    resolvedParameters: run.resolvedParameters,
    pendingHuman: pending.map((p) => ({ nodeId: p.nodeId, approvalId: p.approvalId, kind: p.kind, summary: p.summary })),
    artifacts: run.artifacts.map((a) => ({ artifactId: a.artifactId, nodeId: a.nodeId, location: a.location })),
  };
}

function workflowResponse(rt: WorkflowRuntime, def: WorkflowDefinition) {
  const versions = allVersions(rt, def.definitionId);
  const lint = lintDefinition(def.nodes, def.entryNodeIds);
  return { workflow: definitionDoc(def), graph: decompileDefinition(def), problems: lint.problems, versions };
}

function allVersions(rt: WorkflowRuntime, definitionId: string): number[] {
  const out: number[] = [];
  const latest = rt.getDefinition(definitionId);
  if (!latest) return out;
  for (let v = latest.version; v >= 1; v--) if (rt.getDefinition(definitionId, v)) out.push(v);
  return out.reverse();
}

function latestPerDefinition(defs: WorkflowDefinition[]): WorkflowDefinition[] {
  const byId = new Map<string, WorkflowDefinition>();
  for (const d of defs) {
    const cur = byId.get(d.definitionId);
    if (!cur || d.version > cur.version) byId.set(d.definitionId, d);
  }
  return [...byId.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}

function fail(err: unknown): Response {
  if (err instanceof WorkflowRuntimeError) {
    const status = err.code === "not_found" ? 404 : err.code === "busy" ? 429 : err.code === "conflict" ? 409 : 400;
    return problem(status, status === 404 ? "Not Found" : status === 429 ? "Too Many Requests" : status === 409 ? "Conflict" : "Bad Request", err.message);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) return problem(404, "Not Found", msg);
  if (/not awaiting|cannot|is not|already/i.test(msg)) return problem(409, "Conflict", msg);
  return problem(500, "Internal Server Error", msg);
}

async function body(req: Request): Promise<Record<string, unknown>> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

const AUTHOR = { kind: "user" as const, id: "desktop", name: "XR Desktop" };

export function workflowsRoutes(): DaemonRoute[] {
  return [
    // ── inspect (compile + lint, no save) ──────────────────────────────────
    route({
      id: "workflows.inspect",
      path: `${BASE}/inspect`,
      method: "POST",
      handle: async ({ req, json }: Ctx) => {
        const graph = parseGraph(await body(req));
        if (!graph) return problem(400, "Bad Request", "graph { nodes, edges } is required");
        const res = compileAndLint(graph);
        return json({ ok: res.ok, problems: res.problems, summary: graphSummary(res.compiled?.nodes ?? []) });
      },
    }),

    // ── runs (collection + per-run) — before the {id} routes ───────────────
    route({
      id: "workflows.runs.list",
      path: `${BASE}/runs`,
      method: "GET",
      handle: ({ json, state, config, url }: Ctx) => {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
        return json({ runs: runtimeFor(state, config).listRuns({ limit }) });
      },
    }),
    route({
      id: "workflows.runs.get",
      prefix: RUNS,
      pattern: /^\/api\/workflows\/runs\/[^/]+$/,
      method: "GET",
      handle: ({ json, path, state, config }: Ctx) => {
        const runId = decodeURIComponent(path.slice(RUNS.length));
        const rt = runtimeFor(state, config);
        const run = rt.getRun(runId);
        if (!run) return problem(404, "Not Found", "workflow run not found");
        return json({ run: runView(run, rt.pendingFor(runId)) });
      },
    }),
    route({
      id: "workflows.runs.stream",
      prefix: RUNS,
      pattern: /^\/api\/workflows\/runs\/[^/]+\/stream$/,
      method: "GET",
      handle: ({ sse, path, state, config }: Ctx) => {
        const runId = decodeURIComponent(path.slice(RUNS.length, -"/stream".length));
        const rt = runtimeFor(state, config);
        if (!rt.getRun(runId)) return problem(404, "Not Found", "workflow run not found");
        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let keepalive: ReturnType<typeof setInterval> | undefined;
        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: WorkflowRunEvent | { type: "stream_end"; runId: string }) => {
              if (closed) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };
            const finish = () => {
              if (closed) return;
              send({ type: "stream_end", runId });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              closed = true;
              unsubscribe?.();
              if (keepalive) clearInterval(keepalive);
              controller.close();
            };
            // Subscribe BEFORE replaying so nothing emitted in between is lost;
            // the replay set de-duplicates by identity.
            const seen = new Set<WorkflowRunEvent>();
            unsubscribe = rt.subscribe(runId, (e) => {
              if (seen.has(e)) return;
              send(e);
              if (e.type === "run_end") finish();
            });
            for (const e of rt.replay(runId)) {
              seen.add(e);
              send(e);
            }
            if (rt.isTerminal(runId)) {
              finish();
              return;
            }
            keepalive = setInterval(() => {
              if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
            }, 5000);
          },
          cancel() {
            closed = true;
            unsubscribe?.();
            if (keepalive) clearInterval(keepalive);
          },
        });
        return sse(stream);
      },
    }),
    route({
      id: "workflows.runs.cancel",
      prefix: RUNS,
      pattern: /^\/api\/workflows\/runs\/[^/]+\/cancel$/,
      method: "POST",
      handle: ({ json, path, state, config }: Ctx) => {
        const runId = decodeURIComponent(path.slice(RUNS.length, -"/cancel".length));
        try {
          const run = runtimeFor(state, config).cancel(runId);
          return json({ ok: true, state: run.state });
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "workflows.runs.pause",
      prefix: RUNS,
      pattern: /^\/api\/workflows\/runs\/[^/]+\/pause$/,
      method: "POST",
      handle: ({ json, path, state, config }: Ctx) => {
        const runId = decodeURIComponent(path.slice(RUNS.length, -"/pause".length));
        try {
          const run = runtimeFor(state, config).pause(runId);
          return json({ ok: true, state: run.state });
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "workflows.runs.resume",
      prefix: RUNS,
      pattern: /^\/api\/workflows\/runs\/[^/]+\/resume$/,
      method: "POST",
      handle: async ({ json, path, state, config }: Ctx) => {
        const runId = decodeURIComponent(path.slice(RUNS.length, -"/resume".length));
        try {
          const run = await runtimeFor(state, config).resume(runId);
          return json({ ok: true, state: run.state });
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "workflows.runs.decide",
      prefix: RUNS,
      pattern: /^\/api\/workflows\/runs\/[^/]+\/human-decision$/,
      method: "POST",
      handle: async ({ req, json, path, state, config }: Ctx) => {
        const runId = decodeURIComponent(path.slice(RUNS.length, -"/human-decision".length));
        const b = await body(req);
        const nodeId = typeof b.nodeId === "string" ? b.nodeId : "";
        const choice = typeof b.decision === "string" ? b.decision : "";
        const comment = typeof b.comment === "string" ? b.comment.slice(0, 2000) : undefined;
        if (!nodeId) return problem(400, "Bad Request", "nodeId is required");
        const rt = runtimeFor(state, config);
        const run = rt.getRun(runId);
        if (!run) return problem(404, "Not Found", "workflow run not found");
        const node = run.definitionSnapshot.nodes.find((n) => n.id === nodeId);
        if (!node || (node.kind !== "human_approval" && node.kind !== "human_review")) return problem(400, "Bad Request", "nodeId is not a human check in this run");
        let decision: HumanDecision["decision"];
        if (node.kind === "human_approval") {
          if (choice === "approve") decision = { approval: "approved" };
          else if (choice === "deny" || choice === "reject") decision = { approval: "denied", reason: comment };
          else return problem(400, "Bad Request", "decision must be approve or deny for an approval node");
        } else if (choice === "approve") decision = { review: "approved" };
        else if (choice === "changes_requested") decision = { review: "changes_requested", changes: comment ?? "Changes requested" };
        else if (choice === "reject" || choice === "deny") decision = { review: "rejected", reason: comment ?? "Rejected" };
        else return problem(400, "Bad Request", "decision must be approve, changes_requested or reject for a review node");
        try {
          const after = await rt.decide(runId, nodeId, decision, { userId: "desktop", channel: "desktop" }, comment);
          return json({ run: runView(after, rt.pendingFor(runId)) });
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // ── definitions ────────────────────────────────────────────────────────
    route({
      id: "workflows.list",
      path: BASE,
      method: "GET",
      handle: ({ json, state, config }: Ctx) => {
        const rt = runtimeFor(state, config);
        const defs = latestPerDefinition(rt.listDefinitions({ limit: 500 })).filter((d) => d.active);
        const runs = rt.listRuns({ limit: 500 });
        const workflows = defs.map((d) => {
          const last = runs.filter((r) => r.definitionId === d.definitionId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return {
            definitionId: d.definitionId,
            name: d.name,
            ...(d.description ? { description: d.description } : {}),
            version: d.version,
            nodeCount: d.nodes.length,
            summary: graphSummary(d.nodes),
            tags: d.tags,
            publishedAt: d.publishedAt,
            lastRun: last ? { runId: last.runId, state: last.state, updatedAt: last.updatedAt } : null,
          };
        });
        return json({ workflows });
      },
    }),
    route({
      id: "workflows.create",
      path: BASE,
      method: "POST",
      handle: async ({ req, json, state, config }: Ctx) => {
        const b = await body(req);
        const name = typeof b.name === "string" ? b.name.trim() : "";
        if (!name) return problem(400, "Bad Request", "name is required");
        const graph = parseGraph(b);
        if (!graph) return problem(400, "Bad Request", "graph { nodes, edges } is required");
        const res = compileAndLint(graph);
        if (!res.ok || !res.compiled) return problem(422, "Unprocessable Entity", "the workflow has errors — fix them before saving", res.problems.filter((p) => p.severity === "error").map((p) => ({ path: p.nodeId ?? "", message: p.message })));
        const rt = runtimeFor(state, config);
        const draft = createDraft({
          name,
          description: typeof b.description === "string" ? b.description.trim() || undefined : undefined,
          nodes: res.compiled.nodes,
          entryNodeIds: res.compiled.entryNodeIds,
          parameters: res.compiled.parameters.length ? res.compiled.parameters : undefined,
          tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 12) : [],
          authoredBy: AUTHOR,
        });
        const published = rt.publish(publishDraft(draft));
        state.store.audit("workflow.published", { definitionId: published.definitionId, version: published.version, contentHash: published.contentHash });
        return json(workflowResponse(rt, published), 201);
      },
    }),
    route({
      id: "workflows.get",
      prefix: `${BASE}/`,
      pattern: /^\/api\/workflows\/[^/]+$/,
      method: "GET",
      handle: ({ json, path, url, state, config }: Ctx) => {
        const id = decodeURIComponent(path.slice(BASE.length + 1));
        const rt = runtimeFor(state, config);
        const v = url.searchParams.get("version");
        const def = rt.getDefinition(id, v ? Number(v) : undefined);
        if (!def) return problem(404, "Not Found", "workflow not found");
        return json(workflowResponse(rt, def));
      },
    }),
    route({
      id: "workflows.update",
      prefix: `${BASE}/`,
      pattern: /^\/api\/workflows\/[^/]+$/,
      method: "PATCH",
      handle: async ({ req, json, path, state, config }: Ctx) => {
        const id = decodeURIComponent(path.slice(BASE.length + 1));
        const rt = runtimeFor(state, config);
        const latest = rt.getDefinition(id);
        if (!latest) return problem(404, "Not Found", "workflow not found");
        const b = await body(req);
        const baseVersion = Number(b.baseVersion);
        if (!Number.isInteger(baseVersion) || baseVersion < 1) return problem(400, "Bad Request", "baseVersion is required");
        if (baseVersion !== latest.version) return problem(409, "Conflict", `workflow is at v${latest.version}; you edited v${baseVersion}. Reload before saving.`);
        const graph = parseGraph(b);
        if (!graph) return problem(400, "Bad Request", "graph { nodes, edges } is required");
        const res = compileAndLint(graph);
        if (!res.ok || !res.compiled) return problem(422, "Unprocessable Entity", "the workflow has errors — fix them before saving", res.problems.filter((p) => p.severity === "error").map((p) => ({ path: p.nodeId ?? "", message: p.message })));
        const draft = createNewVersion(latest, {
          name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined,
          description: typeof b.description === "string" ? b.description.trim() || undefined : undefined,
          nodes: res.compiled.nodes,
          entryNodeIds: res.compiled.entryNodeIds,
          parameters: res.compiled.parameters.length ? res.compiled.parameters : undefined,
          tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 12) : undefined,
          authoredBy: AUTHOR,
        });
        const published = rt.publish(publishNewVersion(draft, latest.version, `supersedes v${latest.version} (${latest.contentHash})`));
        // The previous version is no longer the active one (the hash covers `active`, so re-sign it).
        const retired: WorkflowDefinition = { ...latest, active: false };
        retired.contentHash = hashDefinition(retired);
        rt.publish(retired);
        state.store.audit("workflow.published", { definitionId: published.definitionId, version: published.version, contentHash: published.contentHash, supersedes: latest.contentHash });
        return json(workflowResponse(rt, published));
      },
    }),
    route({
      id: "workflows.delete",
      prefix: `${BASE}/`,
      pattern: /^\/api\/workflows\/[^/]+$/,
      method: "DELETE",
      handle: ({ json, path, state, config }: Ctx) => {
        const id = decodeURIComponent(path.slice(BASE.length + 1));
        const rt = runtimeFor(state, config);
        const versions = allVersions(rt, id);
        if (!versions.length) return problem(404, "Not Found", "workflow not found");
        for (const v of versions) {
          const def = rt.getDefinition(id, v);
          if (!def || !def.active) continue;
          const retired: WorkflowDefinition = { ...def, active: false };
          retired.contentHash = hashDefinition(retired);
          rt.publish(retired);
        }
        state.store.audit("workflow.retired", { definitionId: id, versions });
        return json({ ok: true });
      },
    }),
    route({
      id: "workflows.run",
      prefix: `${BASE}/`,
      pattern: /^\/api\/workflows\/[^/]+\/run$/,
      method: "POST",
      handle: async ({ req, json, path, state, config }: Ctx) => {
        const id = decodeURIComponent(path.slice(BASE.length + 1, -"/run".length));
        const rt = runtimeFor(state, config);
        if (!rt.canStart()) return problem(429, "Too Many Requests", "three workflow runs are already in flight — wait for one to finish or cancel it");
        const b = await body(req);
        const version = Number.isInteger(Number(b.version)) && Number(b.version) >= 1 ? Number(b.version) : undefined;
        const parameters = b.parameters && typeof b.parameters === "object" && !Array.isArray(b.parameters) ? (b.parameters as Record<string, unknown>) : undefined;
        try {
          const run = await rt.start(id, version, { parameters, initiatedBy: { type: "manual" } });
          return json({ run: runView(run, []) }, 202);
        } catch (err) {
          return fail(err);
        }
      },
    }),
    route({
      id: "workflows.runs.history",
      prefix: `${BASE}/`,
      pattern: /^\/api\/workflows\/[^/]+\/runs$/,
      method: "GET",
      handle: ({ json, path, state, config }: Ctx) => {
        const id = decodeURIComponent(path.slice(BASE.length + 1, -"/runs".length));
        return json({ runs: runtimeFor(state, config).listRuns({ definitionId: id, limit: 100 }) });
      },
    }),
  ];
}
