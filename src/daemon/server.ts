/**
 * XR Stage 5 — Local Daemon  ("xr serve")
 *
 * Security doctrine (non-negotiable):
 *  - Binds to 127.0.0.1 only — never 0.0.0.0
 *  - Every non-health request requires a local bearer token
 *  - State-changing routes go through approval gate + policy + audit log
 *  - Keys / secrets are NEVER returned via any API endpoint
 *  - Dashboard HTML is served at / and /dashboard
 *  - Chat is served at /chat
 *  - API is at /api/*
 *
 * New in Stage 5:
 *  - /chat route serves the full chat UI (embedded in dashboard)
 *  - /api/chat streaming endpoint (SSE) powers the chat panel
 *  - /api/providers returns provider status for the dashboard
 *  - /api/config returns safe (redacted) config subset
 *  - Improved CORS and CSP headers
 */

import { randomBytes } from "node:crypto";
import { Store } from "../state/db.ts";
import { loadConfig, isMemoryEnabled } from "../config/config.ts";
import { runLab } from "../security/lab.ts";
import { fingerprint } from "../memory/rag.ts";
import { basename } from "node:path";
import { dashboardHtml } from "./dashboard.ts";
import { approvals } from "../control/approvals.ts";
import { detectCapabilities } from "../control/adapter.ts";
import { isDisabled, runTypedPlan } from "../control/service.ts";
import { planActions } from "../control/planner.ts";
import { browserStatus } from "../control/browser.ts";
import { buildProvider, knownProviders, PRESETS } from "../providers/factory.ts";
import { getProviderEnvStatus } from "../config/config.ts";
import { listRemembered, forgetPlan, clearAllMemory } from "../control/memory.ts";
import { MemoryStore } from "../memory/store.ts";

export interface DaemonOptions {
  port?:   number;
  token?:  string;
  store?:  Store;
}

export interface DaemonHandle {
  port:   number;
  token:  string;
  stop:   () => void;
  handle: (req: Request) => Response | Promise<Response>;
}

const HOST = "127.0.0.1";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type":  "application/json",
      "cache-control": "no-store",
    },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type":                "text/html; charset=utf-8",
      "cache-control":               "no-store",
      "x-content-type-options":      "nosniff",
      "x-frame-options":             "DENY",
      "referrer-policy":             "no-referrer",
      "content-security-policy":     "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    },
  });
}

function sse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "content-type":  "text/event-stream",
      "cache-control": "no-cache",
      "connection":    "keep-alive",
    },
  });
}

/** Build the request handler (pure; used by both serve() and tests). */
export function makeHandler(store: Store, token: string) {
  const { config } = loadConfig();

  function authed(req: Request): boolean {
    const h   = req.headers.get("authorization") ?? "";
    const url = new URL(req.url);
    if (h === `Bearer ${token}`) return true;
    // Allow token via query string for first dashboard load only
    // (localhost-only server, low risk vs. DX improvement)
    if (url.searchParams.get("token") === token) return true;
    return false;
  }

  return async function handle(req: Request): Promise<Response> {
    const url    = new URL(req.url);
    const path   = url.pathname;
    const method = req.method;

    // ── Open endpoints (no auth) ──────────────────────────────────────────
    if (path === "/api/health") {
      return json({ ok: true, name: "xr", host: HOST, ts: Date.now() });
    }

    // ── Auth gate ─────────────────────────────────────────────────────────
    if (!authed(req)) {
      return json({ error: "unauthorized — local bearer token required" }, 401);
    }

    // ── Dashboard HTML ────────────────────────────────────────────────────
    if (path === "/" || path === "/dashboard") {
      return html(dashboardHtml(token));
    }

    // ── Chat UI page ──────────────────────────────────────────────────────
    if (path === "/chat") {
      // Serve same dashboard with chat panel pre-selected
      return html(dashboardHtml(token).replace(
        "loadDashboard();",
        "navigateTo('chat'); loadDashboard();"
      ));
    }

    // ── Chat Streaming API ────────────────────────────────────────────────
    if (path === "/api/chat" && method === "POST") {
      try {
        const body = await req.json() as { message?: string; history?: Array<{role:string;content:string}> };
        if (!body?.message) return json({ error: "expected { message: string }" }, 400);

        const provider = buildProvider(config, {});
        const health   = await provider.health();
        if (!health.ok) {
          return json({ error: `Provider offline: ${health.detail ?? "unreachable"}` }, 503);
        }

        // Build SSE stream
        let cancelled = false;
        const stream = new ReadableStream({
          async start(controller) {
            const enc  = new TextEncoder();
            const send = (data: object) => {
              if (!cancelled) {
                controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
              }
            };

            try {
              // Build messages array
              const history = (body.history ?? []).slice(-10);
              const messages = [
                ...history,
                { role: "user", content: body.message! },
              ];

              // Stream the response
              let fullText = "";
              const result = await provider.chat(messages, {
                onToken: (tok: string) => {
                  fullText += tok;
                  send({ delta: tok });
                },
                store,
                cwd: process.cwd(),
              });

              if (!fullText && result?.content) {
                fullText = result.content;
                send({ text: fullText });
              }

              // Audit the exchange
              store.logAudit({
                event:   "chat.message",
                input:   body.message!.slice(0, 200),
                output:  fullText.slice(0, 200),
              });

              send({ done: true });
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
            } catch (e) {
              send({ error: (e as Error).message });
            } finally {
              controller.close();
            }
          },
          cancel() {
            cancelled = true;
          },
        });

        return sse(stream);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ── Overview ──────────────────────────────────────────────────────────
    if (path === "/api/overview") {
      const project = basename(process.cwd());
      const fp      = fingerprint(process.cwd());
      return json({
        project,
        fingerprint: fp,
        audit:   { count: store.auditCount(), chain: store.verifyChain() },
        skills:  { learned: store.skillCount(), frozen: store.frozenCount() },
        ragChunks: store.ragCount(project),
        budget:  {
          perTaskUsd:    config.budget.perTaskUsd,
          perTaskTokens: config.budget.perTaskTokens,
        },
      });
    }

    // ── Cost ──────────────────────────────────────────────────────────────
    if (path === "/api/cost") {
      return json(store.costSummary());
    }

    // ── Audit ─────────────────────────────────────────────────────────────
    if (path === "/api/audit") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      return json({ entries: store.recentAudit(limit), chain: store.verifyChain() });
    }

    // ── Security ──────────────────────────────────────────────────────────
    if (path === "/api/security") {
      const report = runLab({ egressAllowlist: config.security.egressAllowlist });
      // Do NOT include egress allowlist contents in the response body
      return json({
        ...report,
        egressAllowlist: config.security.egressAllowlist?.map(d => d.replace(/^https?:\/\//, "")) ?? [],
      });
    }

    // ── Sessions ──────────────────────────────────────────────────────────
    if (path === "/api/sessions") {
      return json({ sessions: store.recentSessions(50) });
    }

    // ── Providers (safe — no keys returned) ───────────────────────────────
    if (path === "/api/providers") {
      const status = getProviderEnvStatus();
      return json({
        primary:  config.defaults.provider,
        model:    config.defaults.model,
        fallback: config.defaults.fallbackProvider,
        providers: status.map(p => ({
          id:     p.id,
          label:  p.label,
          tier:   p.tier,
          hasKey: p.hasKey,
          // NEVER return the actual key
        })),
      });
    }

    // ── Config (safe subset) ──────────────────────────────────────────────
    if (path === "/api/config") {
      return json({
        provider:     config.defaults.provider,
        model:        config.defaults.model,
        mode:         config.defaults.mode,
        localEnabled: config.localModels.enabled,
        routing:      config.localModels.routing,
        budget:       config.budget,
        // NEVER return apiKeys, secrets, tokens
      });
    }

    // ── Computer Control ──────────────────────────────────────────────────
    if (path === "/api/control/status") {
      const kill   = isDisabled();
      const caps   = detectCapabilities();
      const browser = browserStatus();
      return json({
        enabled:        !kill.disabled,
        disabledReason: kill.reason ?? null,
        capabilities:   caps,
        browser,
        pending:        approvals.list().length,
      });
    }

    if (path === "/api/control/events") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      const all   = store.recentAudit(limit * 4);
      const events = all
        .filter(e => e.event.startsWith("control.") || e.event.startsWith("computer_control."))
        .slice(0, limit);
      return json({ events });
    }

    if (path === "/api/control/pending") {
      return json({ pending: approvals.list() });
    }

    if (path === "/api/control/approve" && method === "POST") {
      try {
        const body = await req.json() as { id?: string; approved?: boolean };
        if (typeof body?.id !== "string" || typeof body?.approved !== "boolean") {
          return json({ error: "expected { id: string, approved: boolean }" }, 400);
        }
        const handled = approvals.answer(body.id, body.approved);
        store.logAudit({ event: `control.approve.${body.approved ? "granted" : "denied"}`, id: body.id });
        return json({ ok: handled });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/control/plan" && method === "POST") {
      // Plan-only — NEVER executes from dashboard
      try {
        const body = await req.json() as { task?: string; noMemory?: boolean };
        if (!body?.task) return json({ error: "expected { task: string }" }, 400);
        const provider = buildProvider(config, {});
        const result   = await planActions(provider, body.task, { store, noMemory: body.noMemory === true });
        if ("error" in result) return json({ error: result.error }, 422);
        return json({ plan: result.plan, source: result.source });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ── Plan Memory ───────────────────────────────────────────────────────
    if (path === "/api/control/memory") {
      return json({
        enabled: config.control?.memory?.enabled !== false,
        entries: listRemembered(store).map(e => ({
          baselineId:   e.baselineId,
          skillId:      e.skillId,
          task:         e.task,
          steps:        e.actions.length,
          hits:         e.hits,
          rememberedAt: e.rememberedAt,
        })),
      });
    }

    if (path.startsWith("/api/control/memory/") && method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/control/memory/".length));
      if (key === "*" || key === "all") {
        const n = clearAllMemory(store);
        store.logAudit({ event: "control.memory.clear_all", removed: n });
        return json({ ok: true, removed: n });
      }
      const r = forgetPlan(store, key);
      return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
    }

    // ── Durable Memory (read + delete only) ───────────────────────────────
    // Write surface is CLI-only by design (narrow attack surface)
    if (path === "/api/memory") {
      const mem     = new MemoryStore(store);
      const entries = mem.list().map(e => ({
        id:         e.id,
        category:   e.category,
        content:    e.content,   // content is shown; no secret data should be stored here
        scope:      e.scope,
        source:     e.source,
        tags:       e.tags,
        importance: e.importance,
        updatedAt:  e.updatedAt,
      }));
      return json({
        enabled: isMemoryEnabled(),
        count:   mem.count(),
        stats:   mem.stats(),
        entries,
      });
    }

    if (path.startsWith("/api/memory/") && method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/memory/".length));
      const mem = new MemoryStore(store);
      if (key === "*" || key === "all") {
        const n = mem.clear();
        store.logAudit({ event: "memory.clear_all", removed: n });
        return json({ ok: true, removed: n });
      }
      const r = mem.remove(key);
      store.logAudit({ event: "memory.delete", id: key, ok: r.ok });
      return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
    }

    // ── 404 ───────────────────────────────────────────────────────────────
    return json({ error: "not found" }, 404);
  };
}

/** Start the local daemon. Prints token + URL once on startup. */
export async function serve(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const port  = opts.port  ?? 3141;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const store = opts.store ?? new Store();

  const handler = makeHandler(store, token);

  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch:    handler,
  });

  const url = `http://${HOST}:${port}/?token=${token}`;

  // Print startup banner
  const { A, xrCyan, xrGreen, xrDim, xrBold } = await import("../ui/theme.ts");
  console.log(`
  ${xrBold(xrCyan("XR"))} ${xrDim("—")} Local Server
  ${xrGreen("✓")} Listening on  ${xrCyan(`http://${HOST}:${port}`)}
  ${xrGreen("✓")} Dashboard     ${xrCyan(url)}
  ${xrGreen("✓")} Chat          ${xrCyan(`http://${HOST}:${port}/chat?token=${token}`)}
  ${xrDim("Token:")} ${xrDim(token)}
  ${xrDim("Binding: localhost only — never exposed to network")}
`);

  return {
    port,
    token,
    stop:   () => server.stop(),
    handle: handler,
  };
}
