/**
 * XR Daemon — full research runs for the desktop (Phase 18).
 *
 * The Phase 10 routes expose single provider operations (search / scrape /
 * crawl / map / extract). This family runs the REAL orchestrator —
 * `runResearch()` from src/research/engine.ts, built exactly the way the CLI
 * builds it (src/research/run-deps.ts) — and streams its structured progress:
 *
 *   POST /api/research/run                  start (async) → { runId }
 *   GET  /api/research/run/{id}             run status (+ result once over)
 *   GET  /api/research/run/{id}/stream      SSE: replay buffer → live → stream_end
 *   POST /api/research/run/{id}/cancel      abort (reaches model + fetch sockets)
 *   POST /api/research/upload-pdf           multipart PDF → extracted text (memory only)
 *   GET/PATCH /api/research/settings        research.allowPublicWeb + search availability
 *   POST /api/research/{sessionId}/remember save the finding to durable memory (explicit)
 *
 * Nothing here spends or fetches on its own: the budget guard, the egress
 * allow-list and the SSRF proxy are the same objects the CLI run uses.
 */

import { problem, route, type DaemonRoute, type DaemonState } from "./router.ts";
import { loadConfig, saveConfig, type XRConfig } from "../../config/config.ts";
import { newSessionId, runResearch, type RunDocument } from "../../research/engine.ts";
import { buildRunDeps } from "../../research/run-deps.ts";
import { ResearchRunRegistry } from "../../research/run-registry.ts";
import { runResult, type ResearchRunEvent } from "../../research/run-events.ts";
import { extractPdfText, PdfTextError, PDF_MAX_BYTES } from "../../research/pdf-text.ts";
import { rememberResearch } from "../../research/remember.ts";
import { DEPTH_BUDGETS, type ResearchDepth, type ResearchMode, type ResearchSession } from "../../research/types.ts";

const RUN_PREFIX = "/api/research/run/";
const DEPTHS: ReadonlySet<string> = new Set(["quick", "deep", "thorough"]);
const MODES: ReadonlySet<string> = new Set(["quick", "deep", "thorough", "compare", "factcheck", "briefing"]);
const MAX_DOCUMENTS = 20;
const MAX_DOCUMENT_CHARS = 600_000;

function registryFor(state: DaemonState): ResearchRunRegistry {
  if (!state.researchRunRegistry) state.researchRunRegistry = new ResearchRunRegistry();
  return state.researchRunRegistry;
}

function searchHost(): string {
  const raw = process.env.XR_SEARXNG ?? "https://searx.be";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw;
  }
}

function settingsView(config: XRConfig): Record<string, unknown> {
  const host = searchHost();
  const allow = config.security.egressAllowlist ?? [];
  const searchAvailable = allow.some((d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()));
  return {
    allowPublicWeb: config.research.allowPublicWeb,
    searchAvailable,
    searchHost: host,
    egressAllowlist: allow,
    budgets: DEPTH_BUDGETS,
    provider: config.defaults.provider,
    model: config.defaults.model,
  };
}

function parseDocuments(raw: unknown): RunDocument[] {
  if (!Array.isArray(raw)) return [];
  const out: RunDocument[] = [];
  for (const d of raw.slice(0, MAX_DOCUMENTS)) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.slice(0, MAX_DOCUMENT_CHARS) : "";
    if (!text.trim()) continue;
    out.push({ name: typeof o.name === "string" ? o.name.slice(0, 160) : `document ${out.length + 1}`, text, kind: o.kind === "pdf" ? "pdf" : "local" });
  }
  return out;
}

export function researchRunRoutes(): DaemonRoute[] {
  return [
    // ── start ───────────────────────────────────────────────────────────────
    route({
      id: "research.run.start",
      path: "/api/research/run",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const query = typeof body.query === "string" ? body.query.trim() : "";
        if (!query) return problem(400, "Bad Request", "query is required");
        if (query.length > 2000) return problem(400, "Bad Request", "query is too long (max 2000 characters)");
        const depth = (DEPTHS.has(String(body.depth)) ? body.depth : "deep") as ResearchDepth;
        const mode = (MODES.has(String(body.mode)) ? body.mode : depth) as ResearchMode;
        const documents = parseDocuments(body.documents);
        const registry = registryFor(state);
        if (!registry.canStart()) return problem(429, "Too Many Requests", "two research runs are already in flight — cancel one or wait");

        const { run, signal } = registry.create(query);
        const startedAt = Date.now();
        const built = buildRunDeps(state.store, config, {
          provider: typeof body.provider === "string" ? body.provider : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
          allowPublicWeb: typeof body.allowPublicWeb === "boolean" ? body.allowPublicWeb && config.research.allowPublicWeb : undefined,
          signal,
          say: (line) => registry.emit(run.id, { type: "log", line }),
          onEvent: (event) => registry.emit(run.id, event),
        });

        const sessionId = newSessionId();
        registry.emit(run.id, {
          type: "run_started",
          sessionId,
          topic: query,
          depth,
          mode,
          provider: built.providerId,
          model: built.model,
          searchAvailable: built.searchAvailable,
          publicWeb: built.publicWeb,
        });
        if (built.fallbackReason) registry.emit(run.id, { type: "log", line: `⚠ global budget: ${built.fallbackReason} — running on the local model` });

        void (async () => {
          try {
            const session = await runResearch(built.deps, { topic: query, depth, mode, documents, sessionId });
            registry.emit(run.id, {
              type: "run_completed",
              result: runResult(session, { usage: built.usage(), provider: built.providerId, model: built.model, startedAt }),
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const code = /unauthori[sz]ed|api key|401/i.test(message) ? "provider_auth" : /econnrefused|fetch failed|network|timeout/i.test(message) ? "provider_unreachable" : "engine_error";
            state.store.audit("research.error", { runId: run.id, code, message: message.slice(0, 300) });
            registry.emit(run.id, { type: "run_error", code, message: message.slice(0, 500) });
          }
        })();

        return json({ runId: run.id, state: run.state, provider: built.providerId, model: built.model, searchAvailable: built.searchAvailable, publicWeb: built.publicWeb, depth, mode, documents: documents.length }, 202);
      },
    }),

    // ── status ──────────────────────────────────────────────────────────────
    route({
      id: "research.run.get",
      prefix: RUN_PREFIX,
      pattern: /^\/api\/research\/run\/[^/]+$/,
      method: "GET",
      handle: ({ json, path, state }) => {
        const rest = decodeURIComponent(path.slice(RUN_PREFIX.length));
        if (!rest || rest.includes("/")) return null;
        const run = registryFor(state).get(rest);
        if (!run) return problem(404, "Not Found", "research run not found");
        return json({ run });
      },
    }),

    // ── stream ──────────────────────────────────────────────────────────────
    route({
      id: "research.run.stream",
      prefix: RUN_PREFIX,
      pattern: /^\/api\/research\/run\/[^/]+\/stream$/,
      method: "GET",
      handle: ({ sse, path, state }) => {
        const rest = decodeURIComponent(path.slice(RUN_PREFIX.length));
        if (!rest.endsWith("/stream")) return null;
        const id = rest.slice(0, -"/stream".length);
        const registry = registryFor(state);
        if (!registry.get(id)) return problem(404, "Not Found", "research run not found");
        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let keepalive: ReturnType<typeof setInterval> | undefined;
        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: ResearchRunEvent | { type: "stream_end"; runId: string }) => {
              if (closed) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };
            const finish = () => {
              if (closed) return;
              send({ type: "stream_end", runId: id });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              closed = true;
              unsubscribe?.();
              if (keepalive) clearInterval(keepalive);
              controller.close();
            };
            // Subscribe BEFORE replaying so nothing emitted in between is lost;
            // the replay set de-duplicates by identity.
            const seen = new Set<ResearchRunEvent>();
            unsubscribe = registry.subscribe(id, (e) => {
              if (seen.has(e)) return;
              send(e);
              if (e.type === "run_completed" || e.type === "run_error") finish();
            });
            for (const e of registry.replay(id)) {
              seen.add(e);
              send(e);
            }
            if (registry.isTerminal(id)) {
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

    // ── cancel ──────────────────────────────────────────────────────────────
    route({
      id: "research.run.cancel",
      prefix: RUN_PREFIX,
      pattern: /^\/api\/research\/run\/[^/]+\/cancel$/,
      method: "POST",
      handle: ({ json, path, state }) => {
        const rest = decodeURIComponent(path.slice(RUN_PREFIX.length));
        if (!rest.endsWith("/cancel")) return null;
        const id = rest.slice(0, -"/cancel".length);
        const result = registryFor(state).cancel(id);
        if (!result.ok) return json({ ok: false, error: result.reason }, 409);
        state.store.audit("research.cancel", { runId: id });
        return json({ ok: true, id });
      },
    }),

    // ── PDF upload (text extraction in memory) ──────────────────────────────
    route({
      id: "research.upload.pdf",
      path: "/api/research/upload-pdf",
      method: "POST",
      handle: async ({ req, json, state }) => {
        let bytes: Uint8Array | null = null;
        let name = "document.pdf";
        const ctype = req.headers.get("content-type") ?? "";
        try {
          if (ctype.includes("multipart/form-data")) {
            const form = await req.formData();
            const file = form.get("file");
            if (!(file instanceof Blob)) return problem(400, "Bad Request", "multipart field 'file' is required");
            if (file.size > PDF_MAX_BYTES) return problem(413, "Payload Too Large", "PDF too large (max 20MB)");
            name = (typeof (file as File).name === "string" && (file as File).name) || name;
            bytes = new Uint8Array(await file.arrayBuffer());
          } else {
            // Raw body (application/pdf) with the name in a header.
            const buf = await req.arrayBuffer();
            if (buf.byteLength > PDF_MAX_BYTES) return problem(413, "Payload Too Large", "PDF too large (max 20MB)");
            bytes = new Uint8Array(buf);
            const header = req.headers.get("x-xr-filename");
            if (header) {
              try {
                name = decodeURIComponent(header);
              } catch {
                name = header;
              }
            }
          }
        } catch {
          return problem(400, "Bad Request", "unreadable upload");
        }
        const size = bytes.byteLength; // pdf.js detaches the buffer it parses
        try {
          const result = await extractPdfText(bytes);
          state.store.audit("research.pdf.extract", { name: name.slice(0, 120), bytes: size, pages: result.pages, chars: result.chars });
          return json({ name: name.slice(0, 160), bytes: size, ...result });
        } catch (e) {
          if (e instanceof PdfTextError) {
            return problem(e.code === "too_large" ? 413 : 422, "Unprocessable Content", e.message);
          }
          return problem(500, "Internal Server Error", "PDF extraction failed");
        }
      },
    }),

    // ── settings ────────────────────────────────────────────────────────────
    route({
      id: "research.settings.get",
      path: "/api/research/settings",
      method: "GET",
      handle: ({ json, config }) => json(settingsView(config)),
    }),
    route({
      id: "research.settings.set",
      path: "/api/research/settings",
      method: "PATCH",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { allowPublicWeb?: unknown };
        if (typeof body.allowPublicWeb !== "boolean") return problem(400, "Bad Request", "allowPublicWeb must be a boolean");
        const next = loadConfig().config;
        next.research.allowPublicWeb = body.allowPublicWeb;
        saveConfig(next);
        state.store.audit("research.settings.update", { allowPublicWeb: body.allowPublicWeb });
        return json(settingsView(next));
      },
    }),

    // ── remember (explicit save to memory) ──────────────────────────────────
    route({
      id: "research.remember",
      prefix: "/api/research/",
      pattern: /^\/api\/research\/[^/]+\/remember$/,
      method: "POST",
      handle: async ({ json, path, state }) => {
        const rest = decodeURIComponent(path.slice("/api/research/".length));
        if (!rest.endsWith("/remember")) return null;
        const id = rest.slice(0, -"/remember".length);
        if (!id || id.includes("/")) return null;
        const row = state.store.getResearch(id);
        if (!row) return problem(404, "Not Found", "research session not found");
        let session: ResearchSession;
        try {
          session = JSON.parse(row.data) as ResearchSession;
        } catch {
          return problem(500, "Internal Server Error", "research session data is invalid");
        }
        const result = await rememberResearch(state.store, session);
        state.store.audit("research.remember", { id, ok: result.ok, duplicate: result.ok ? result.duplicate : false });
        if (!result.ok) return json({ ok: false, reason: result.reason, detail: result.detail ?? null }, result.reason === "memory_disabled" ? 409 : 400);
        return json({ ok: true, memoryId: result.memoryId, duplicate: result.duplicate, linkedSources: result.linkedSources });
      },
    }),
  ];
}
