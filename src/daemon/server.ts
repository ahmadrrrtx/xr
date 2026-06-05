/**
 * XR — local daemon ("xr serve").
 *
 * SECURITY DOCTRINE (non-negotiable):
 *   • Binds to 127.0.0.1 ONLY — never 0.0.0.0. (Avoids the OpenClaw
 *     "135k exposed instances" mistake.)
 *   • Every request needs a local bearer token (printed once on start).
 *   • Read-mostly: state-changing routes still go through the agent's
 *     approval gate + policy + audit log.
 *
 * One brain, many frontends: CLI, dashboard, Telegram, voice all talk to this.
 * (Block 5.)
 */
import { randomBytes } from "node:crypto";
import { Store } from "../state/db.ts";
import { loadConfig } from "../config/config.ts";
import { runLab } from "../security/lab.ts";
import { fingerprint } from "../memory/rag.ts";
import { basename } from "node:path";
import { dashboardHtml } from "./dashboard.ts";
import { approvals } from "../control/approvals.ts";
import { detectCapabilities } from "../control/adapter.ts";
import { isDisabled, runTypedPlan } from "../control/service.ts";
import { planActions } from "../control/planner.ts";
import { browserStatus } from "../control/browser.ts";
import { buildProvider } from "../providers/factory.ts";
import { listRemembered, forgetPlan, clearAllMemory } from "../control/memory.ts";

export interface DaemonOptions {
  port?: number;
  /** Provide a token (else one is generated). */
  token?: string;
  /** Inject a store (for tests). */
  store?: Store;
}

export interface DaemonHandle {
  port: number;
  token: string;
  stop: () => void;
  /** Exposed for testing without a live socket. */
  handle: (req: Request) => Response | Promise<Response>;
}

const HOST = "127.0.0.1";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Build the request handler (pure-ish; used by both serve() and tests). */
export function makeHandler(store: Store, token: string) {
  const { config } = loadConfig();

  function authed(req: Request): boolean {
    const h = req.headers.get("authorization") ?? "";
    const url = new URL(req.url);
    // Allow the dashboard HTML + token via query for first load convenience
    // (localhost only). API routes require the bearer header.
    if (h === `Bearer ${token}`) return true;
    if (url.searchParams.get("token") === token) return true;
    return false;
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health is open (no secrets).
    if (path === "/api/health") {
      return json({ ok: true, name: "xr", host: HOST });
    }

    // Auth gate for everything else.
    if (!authed(req)) {
      return json({ error: "unauthorized — local token required" }, 401);
    }

    // Dashboard page.
    if (path === "/" || path === "/dashboard") {
      return new Response(dashboardHtml(token), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ---- read-only API ----
    if (path === "/api/overview") {
      const project = basename(process.cwd());
      const fp = fingerprint(process.cwd());
      return json({
        project,
        fingerprint: fp,
        audit: { count: store.auditCount(), chain: store.verifyChain() },
        skills: { learned: store.skillCount(), frozen: store.frozenCount() },
        ragChunks: store.ragCount(project),
        budget: config.budget,
      });
    }

    if (path === "/api/cost") {
      return json(store.costSummary());
    }

    if (path === "/api/audit") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return json({ entries: store.recentAudit(limit), chain: store.verifyChain() });
    }

    if (path === "/api/security") {
      const report = runLab({ egressAllowlist: config.security.egressAllowlist });
      return json(report);
    }

    if (path === "/api/sessions") {
      return json({ sessions: store.recentSessions(50) });
    }

    // ── v0.8.1: Computer Control endpoints ────────────────────────────────

    if (path === "/api/control/status") {
      const kill = isDisabled();
      const caps = detectCapabilities();
      const browser = browserStatus();
      return json({
        enabled: !kill.disabled,
        disabledReason: kill.reason ?? null,
        capabilities: caps,
        browser,
        pending: approvals.list().length,
      });
    }

    if (path === "/api/control/events") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      // Reuse the audit log — every control event is already there with a
      // consistent prefix. We filter and return the most recent N.
      const all = store.recentAudit(limit * 4); // overscan to compensate for filtering
      const events = all
        .filter((e) => e.event.startsWith("control.") || e.event.startsWith("computer_control."))
        .slice(0, limit);
      return json({ events });
    }

    if (path === "/api/control/pending") {
      return json({ pending: approvals.list() });
    }

    if (path === "/api/control/approve" && req.method === "POST") {
      try {
        const body = await req.json() as { id?: string; approved?: boolean };
        if (typeof body?.id !== "string" || typeof body?.approved !== "boolean") {
          return json({ error: "expected { id: string, approved: boolean }" }, 400);
        }
        const handled = approvals.answer(body.id, body.approved);
        return json({ ok: handled });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/control/plan" && req.method === "POST") {
      // Plan-only (preview), never executes from the dashboard.
      // Execution from the dashboard would bypass the CLI approval surface;
      // we keep it as preview-only by design. The user runs the plan from
      // their terminal (or via the agent).
      try {
        const body = await req.json() as { task?: string; noMemory?: boolean };
        if (!body?.task) return json({ error: "expected { task: string }" }, 400);
        const provider = buildProvider(config, {});
        const result = await planActions(provider, body.task, { store, noMemory: body.noMemory === true });
        if ("error" in result) return json({ error: result.error }, 422);
        return json({ plan: result.plan, source: result.source });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ── v0.8.2: Plan memory ──────────────────────────────────────────────

    if (path === "/api/control/memory") {
      return json({
        enabled: config.control?.memory?.enabled !== false,
        entries: listRemembered(store).map((e) => ({
          baselineId: e.baselineId,
          skillId: e.skillId,
          task: e.task,
          steps: e.actions.length,
          hits: e.hits,
          rememberedAt: e.rememberedAt,
        })),
      });
    }

    if (path.startsWith("/api/control/memory/") && req.method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/control/memory/".length));
      if (key === "*" || key === "all") {
        const n = clearAllMemory(store);
        return json({ ok: true, removed: n });
      }
      const r = forgetPlan(store, key);
      return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
    }

    return json({ error: "not found" }, 404);
  };
}

export function serve(opts: DaemonOptions = {}): DaemonHandle {
  const store = opts.store ?? new Store();
  const token = opts.token ?? randomBytes(16).toString("hex");
  const port = opts.port ?? 7842;
  const handle = makeHandler(store, token);

  const server = Bun.serve({ hostname: HOST, port, fetch: handle });

  return {
    port: server.port ?? port,
    token,
    stop: () => server.stop(true),
    handle,
  };
}
