/**
 * XR Daemon — research routes (Phase 10).
 *
 * Canonical `/api/v1` operations for the research subsystem. Every route is
 * in the API contract (src/daemon/routes/contract.ts), schema-validated, and
 * served through the same provider pool / budget / egress / SSRF boundary as
 * the CLI and tools (one execution path).
 *
 * Operations (synchronous JSON):   search / scrape / map / extract
 * Crawl is started ASYNC (returns the job immediately; poll or stream it).
 * Job management:                  list / get / cancel / stream (SSE).
 *
 * Secrets never appear in responses: the Firecrawl key is resolved inside the
 * provider factory and never serialized into job JSON or SSE events.
 */

import { problem, route, type DaemonRoute, type DaemonState } from "./router.ts";
import type { XRConfig } from "../../config/config.ts";
import { buildResearchPool } from "../../research/factory.ts";
import { ResearchJobRegistry } from "../../research/jobs.ts";
import { runResearchOperation, type RunnerDeps } from "../../research/runner.ts";
import type { ResearchJob, ResearchRequest, ResearchStreamEvent } from "../../research/provider-types.ts";

function registryFor(state: DaemonState): ResearchJobRegistry {
  if (!state.researchRegistry) {
    state.researchRegistry = new ResearchJobRegistry(state.store, state.workspaceManager.getActiveId());
  }
  return state.researchRegistry;
}

function runnerDeps(state: DaemonState, config: XRConfig, opts?: { async?: boolean }): RunnerDeps & { registry: ResearchJobRegistry } {
  const { pool } = buildResearchPool(config);
  const registry = registryFor(state);
  return {
    pool,
    registry,
    egressAllowlist: config.security.egressAllowlist,
    allowedHosts: config.security.allowedHosts,
    workspaceId: state.workspaceManager.getActiveId(),
    audit: (event, detail) => state.store.audit(event, detail),
    onProgress: (event: ResearchStreamEvent) => registry.appendEvent(event.jobId, event),
    async: opts?.async,
  };
}

function jobEnvelope(job: ResearchJob): Record<string, unknown> {
  return { job: { ...job, request: { ...job.request } } };
}

/** Map an operation request body → ResearchRequest. */
function toRequest(intent: ResearchRequest["intent"], body: Record<string, unknown>): ResearchRequest {
  return {
    intent,
    query: typeof body.query === "string" ? body.query : undefined,
    urls: Array.isArray(body.urls) ? (body.urls as unknown[]).map(String) : typeof body.url === "string" ? [body.url] : undefined,
    schema: body.schema && typeof body.schema === "object" ? (body.schema as Record<string, unknown>) : undefined,
    depth: body.depth === "deep" ? "deep" : body.depth === "quick" ? "quick" : undefined,
    limits:
      body.max_pages || body.max_depth
        ? { maxPages: typeof body.max_pages === "number" ? body.max_pages : undefined, maxDepth: typeof body.max_depth === "number" ? body.max_depth : undefined }
        : undefined,
    source: "api",
  };
}

export function researchRoutes(): DaemonRoute[] {
  return [
    // ── search ──────────────────────────────────────────────────────────────
    route({
      id: "research.search",
      path: "/api/research/search",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const body = await readJson(req);
        const job = await runResearchOperation(runnerDeps(state, config), toRequest("search", body));
        return json(jobEnvelope(job));
      },
    }),
    route({
      id: "research.scrape",
      path: "/api/research/scrape",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const body = await readJson(req);
        const job = await runResearchOperation(runnerDeps(state, config), toRequest("scrape", body));
        return json(jobEnvelope(job));
      },
    }),
    route({
      id: "research.map",
      path: "/api/research/map",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const body = await readJson(req);
        const job = await runResearchOperation(runnerDeps(state, config), toRequest("map", body));
        return json(jobEnvelope(job));
      },
    }),
    route({
      id: "research.crawl",
      path: "/api/research/crawl",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const body = await readJson(req);
        const job = await runResearchOperation(runnerDeps(state, config, { async: true }), toRequest("crawl", body));
        return json(jobEnvelope(job));
      },
    }),
    route({
      id: "research.extract",
      path: "/api/research/extract",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const body = await readJson(req);
        const job = await runResearchOperation(runnerDeps(state, config), toRequest("extract", body));
        return json(jobEnvelope(job));
      },
    }),

    // ── job management ──────────────────────────────────────────────────────
    route({
      id: "research.jobs.list",
      path: "/api/research/jobs",
      method: "GET",
      handle: ({ json, state }) => {
        const registry = registryFor(state);
        const live = registry.list().map((j) => ({ id: j.id, kind: j.kind, state: j.state, createdAt: j.createdAt, updatedAt: j.updatedAt }));
        const persisted = registry.listPersisted(50);
        return json({ jobs: live.length ? live : persisted, count: live.length || persisted.length });
      },
    }),
    route({
      id: "research.jobs.get",
      prefix: "/api/research/jobs/",
      method: "GET",
      handle: ({ json, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/research/jobs/".length));
        if (!id) return null;
        const job = registryFor(state).get(id);
        if (!job) return json({ error: "research job not found" }, 404);
        return json(jobEnvelope(job));
      },
    }),
    route({
      id: "research.jobs.cancel",
      prefix: "/api/research/jobs/",
      method: "POST",
      handle: ({ json, path, state }) => {
        const rest = decodeURIComponent(path.slice("/api/research/jobs/".length));
        if (!rest.endsWith("/cancel")) return null;
        const id = rest.slice(0, -"/cancel".length);
        const result = registryFor(state).cancel(id);
        if (!result.ok) return json({ ok: false, error: result.reason }, 409);
        return json({ ok: true, id });
      },
    }),
    route({
      id: "research.jobs.stream",
      prefix: "/api/research/stream/",
      method: "GET",
      handle: ({ sse, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/research/stream/".length));
        const registry = registryFor(state);
        if (!registry.get(id)) return problem(404, "Not Found", "research job not found");
        const encoder = new TextEncoder();
        let sent = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const tick = () => {
              const events = registry.events(id);
              for (let i = sent; i < events.length; i++) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[i])}\n\n`));
              }
              sent = events.length;
              if (registry.isTerminal(id)) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stream_end", jobId: id })}\n\n`));
                controller.close();
                return;
              }
              timer = setTimeout(tick, 300);
            };
            tick();
          },
          cancel() {
            if (timer) clearTimeout(timer);
          },
        });
        return sse(stream);
      },
    }),
  ];
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.clone().text();
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
