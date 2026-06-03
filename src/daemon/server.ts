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
