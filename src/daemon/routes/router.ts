/** XR Daemon — lightweight route composition utilities. */

import type { Store } from "../../state/workspace-store.ts";
import type { XRConfig } from "../../config/config.ts";
import type { XRShieldService } from "../../security/shield.ts";
import type { WorkspaceManager } from "../../core/workspace.ts";
import type { TrustService } from "../../runtime/trust/service.ts";
import type { XRApp } from "../../core/app.ts";
import type { AgentExecutorHandle } from "../agent-executor.ts";
import type { ResearchJobRegistry } from "../../research/jobs.ts";

export interface DaemonState {
  store: Store;
  shield: XRShieldService;
  workspaceManager: WorkspaceManager;
  /** XR 4.2 — Trust & Isolation service (backend availability, health, classify). */
  trust?: TrustService;
  /**
   * Phase 03 — the daemon's canonical XRApp composition root (lazily booted by
   * the AgentExecutor). Route code must NEVER re-implement agent/workspace
   * orchestration inline; it resolves the canonical services through here.
   */
  app?: XRApp;
  /** Phase 03 — the daemon's AgentService boundary (one execution path). */
  agentExecutor?: AgentExecutorHandle;
  /** Phase 10 — shared research job registry (jobs/cancellation/SSE). */
  researchRegistry?: ResearchJobRegistry;
}

export interface DaemonResponseHelpers {
  json(data: unknown, status?: number): Response;
  html(body: string): Response;
  sse(stream: ReadableStream): Response;
}

export interface DaemonRouteContext extends DaemonResponseHelpers {
  req: Request;
  url: URL;
  path: string;
  method: string;
  token: string;
  host: string;
  state: DaemonState;
  config: XRConfig;
}

export type DaemonRouteHandler = (ctx: DaemonRouteContext) => Response | null | undefined | Promise<Response | null | undefined>;

export interface DaemonRoute {
  id: string;
  match(ctx: DaemonRouteContext): boolean;
  handle: DaemonRouteHandler;
  /** Phase 8 · T1 — contract introspection (drives OpenAPI + validation). */
  methodLabel(): string;
  pathLabel(): string;
  matchesPath(path: string, method: string): boolean;
}

export interface RouteOptions {
  id: string;
  path?: string;
  prefix?: string;
  method?: string | string[];
  handle: DaemonRouteHandler;
}

export function route(options: RouteOptions): DaemonRoute {
  const methods = Array.isArray(options.method)
    ? new Set(options.method.map((m) => m.toUpperCase()))
    : options.method
      ? new Set([options.method.toUpperCase()])
      : null;

  const methodLabel = methods ? [...methods].join(",") : "ANY";
  const pathLabel = options.path ?? options.prefix ?? "/";

  return {
    id: options.id,
    match(ctx) {
      if (methods && !methods.has(ctx.method)) return false;
      if (options.path && ctx.path !== options.path) return false;
      if (options.prefix && !ctx.path.startsWith(options.prefix)) return false;
      return true;
    },
    handle: options.handle,
    methodLabel: () => methodLabel,
    pathLabel: () => pathLabel,
    matchesPath(path: string, method: string): boolean {
      if (methods && !methods.has(method.toUpperCase())) return false;
      if (options.path && path !== options.path) return false;
      if (options.prefix && !path.startsWith(options.prefix)) return false;
      return true;
    },
  };
}

export function createDaemonRouter(routes: ReadonlyArray<DaemonRoute>, notFound: DaemonRouteHandler): DaemonRouteHandler {
  return async (ctx) => {
    for (const item of routes) {
      if (!item.match(ctx)) continue;
      const response = await item.handle(ctx);
      if (response) return response;
    }
    return await notFound(ctx);
  };
}

export function safeJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * Phase 8 · T1 — structured problem response (RFC 9457-flavored).
 * The legacy `error` field is ALWAYS present (client compatibility);
 * title/status/detail/errors add the machine-readable envelope.
 */
export function problem(
  status: number,
  title: string,
  detail?: string,
  errors?: Array<{ path: string; message: string }>,
): Response {
  return safeJson(
    {
      error: detail ?? title.toLowerCase(),
      title,
      status,
      ...(detail ? { detail } : {}),
      ...(errors && errors.length > 0 ? { errors } : {}),
    },
    status,
  );
}

export function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
      "cross-origin-opener-policy": "same-origin",
      /**
       * Phase 4 · T5 — strict CSP. NO unsafe-inline anywhere: the dashboard
       * client application and stylesheet are EXTERNAL assets (script-src
       * 'self', style-src 'self') and every interactive element uses the
       * allowlisted data-xr-action dispatcher (never inline handlers).
       */
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
        "form-action 'self'; object-src 'none'; upgrade-insecure-requests",
    },
  });
}

/** Phase 4 · T5 — external dashboard assets (strict-CSP friendly). */
export function assetResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
