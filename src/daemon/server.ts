/**
 * XR — Local Daemon ("xr serve")
 *
 * Thin server shell: binds to localhost, enforces the local bearer token, builds
 * per-request context, and delegates all API/dashboard handling to route groups
 * in src/daemon/routes/.
 */

import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hydrateSecretsAsync, loadConfig } from "../config/config.ts";
import { WorkspaceManager } from "../core/workspace.ts";
import { XRShieldService } from "../security/shield.ts";
import type { Store } from "../state/workspace-store.ts";
import { TrustService } from "../runtime/trust/service.ts";
import { CredentialBroker } from "../runtime/trust/credentials.ts";
import { AuthorityRegistry } from "../runtime/trust/authority.ts";
import { EnvironmentManager } from "../runtime/trust/environment/manager.ts";
import { InProcessBackend } from "../runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../runtime/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../runtime/trust/environment/namespace.ts";
import { ContainerBackend } from "../runtime/trust/environment/container.ts";
import { GVisorBackend } from "../runtime/trust/environment/gvisor.ts";
import { FirecrackerBackend } from "../runtime/trust/environment/firecracker.ts";
import {
  createRouteHandler,
  htmlResponse,
  safeJson,
  sseResponse,
  type DaemonResponseHelpers,
  type DaemonState,
} from "./routes/index.ts";

export interface DaemonOptions {
  port?: number;
  token?: string;
  store?: Store;
}

export interface DaemonHandle {
  port: number;
  token: string;
  stop: () => void;
  handle: (req: Request) => Response | Promise<Response>;
}

/**
 * Bind address resolution (Phase 0 · T12).
 *
 * The daemon hard-bound `127.0.0.1`. Inside a container that address is the
 * container's own loopback, so a published port (`-p 127.0.0.1:7842:7842`)
 * could never reach it — the documented Docker path was broken.
 *
 * A process must bind `0.0.0.0` inside its namespace to be reachable, and
 * safety comes from where the port is PUBLISHED on the host, not from the
 * in-container bind address. So:
 *
 *   · default (bare metal)  → 127.0.0.1, unchanged; no new exposure.
 *   · inside a container    → 0.0.0.0, with the host publishing loopback-only.
 *   · XR_DAEMON_HOST=<addr> → explicit operator override, always wins.
 *
 * The default is still loopback, so an ordinary local install gains no network
 * exposure from this change (Article IX; Commandment 13).
 */
export const DEFAULT_LOOPBACK = "127.0.0.1";
export const CONTAINER_BIND = "0.0.0.0";

/** Detect a container namespace using the standard container markers. */
export function isContainerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.XR_IN_CONTAINER === "1" || env.XR_IN_CONTAINER === "true") return true;
  if (env.KUBERNETES_SERVICE_HOST) return true;
  try {
    // Docker writes /.dockerenv; Podman writes /run/.containerenv.
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}

/**
 * Resolve the address the daemon should bind to.
 *
 * Exported so the behaviour is directly testable without starting a server.
 */
export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.XR_DAEMON_HOST?.trim();
  if (explicit) return explicit;
  return isContainerRuntime(env) ? CONTAINER_BIND : DEFAULT_LOOPBACK;
}

const responseHelpers: DaemonResponseHelpers = {
  json: safeJson,
  html: htmlResponse,
  sse: sseResponse,
};

/**
 * Phase 4 · T5 — daemon session cookie name (HttpOnly, SameSite=Strict).
 * The bearer token remains valid for API clients (curl/scripts); browsers
 * authenticate via the session cookie established by the one-time bootstrap.
 */
export const SESSION_COOKIE = "xr_session";
const SESSION_COOKIE_SET = `${SESSION_COOKIE}=`;

/**
 * One-time bootstrap → secure cookie.
 *
 *   · Authorization: Bearer <token>  — API clients (always allowed).
 *   · Cookie: xr_session=<token>      — browser sessions (always allowed).
 *   · ?token=<token>                  — accepted ONLY to bootstrap a browser
 *     session on a page GET; the handler then redirects to the same path
 *     WITHOUT the token in the URL and sets the HttpOnly/SameSite cookie.
 *     After that the query token is dead (the redirect strips it), so the
 *     secret never lingers in browser history or referrers.
 *
 * The query token NEVER authorizes a mutating request — CSRF-safe.
 */
export function authorizeRequest(
  req: Request,
  token: string,
): { kind: "bearer" } | { kind: "session" } | { kind: "bootstrap"; url: string } | { kind: "denied" } {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization === `Bearer ${token}`) return { kind: "bearer" };

  const cookie = req.headers.get("cookie") ?? "";
  if (cookie.split(";").some((c) => c.trim() === SESSION_COOKIE_SET + token)) return { kind: "session" };

  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken === token) {
    // Bootstrap is page-navigation only (GET). Once the cookie is set the
    // query token is stripped by the redirect — one-time use.
    if (req.method.toUpperCase() === "GET") {
      url.searchParams.delete("token");
      return { kind: "bootstrap", url: url.toString() };
    }
    return { kind: "denied" };
  }
  return { kind: "denied" };
}

/**
 * Phase 4 · T5 — CSRF/Origin enforcement for mutating requests.
 * A browser-authenticated (cookie) request must carry an Origin matching the
 * daemon's own origin; missing/mismatched Origin is refused. Bearer-token
 * API clients (no browser) are exempt — they authenticate out-of-band.
 */
export function originAllowed(
  req: Request,
  auth: { kind: "bearer" } | { kind: "session" } | { kind: "bootstrap" } | { kind: "denied" },
  host: string,
  port: number,
): boolean {
  if (auth.kind !== "session") return true;
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false; // non-browser without bearer → refuse (fail closed)
  try {
    const o = new URL(origin);
    return o.hostname === host && (o.port === String(port) || (o.port === "" && port === 80));
  } catch {
    return false;
  }
}

/** Phase 4 · T5 — fixed-window per-IP rate limiter (memory-only). */
export class RateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the request is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      return true;
    }
    entry.count++;
    if (entry.count > this.limit) {
      // keep counting for Retry-After accuracy
      return false;
    }
    return true;
  }

  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry) return 0;
    return Math.max(1, Math.ceil((entry.windowStart + this.windowMs - now) / 1000));
  }
}

/** Phase 4 · T5 — request body size cap (route caps; fail closed). */
export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB

/** Build a daemon-scoped Trust service (backends are detected lazily on first use). */
function makeDaemonTrust(): TrustService {
  const broker = new CredentialBroker();
  const registry = new AuthorityRegistry();
  const manager = new EnvironmentManager(
    [
      new InProcessBackend(),
      new RestrictedProcessBackend(),
      new NamespaceSandboxBackend(),
      new ContainerBackend(),
      new GVisorBackend(),
      new FirecrackerBackend(),
    ],
    broker,
  );
  return new TrustService({ manager, registry, broker });
}

/** Build the request handler (pure; used by both serve() and tests). */
export function makeHandler(initialStore: Store, token: string, opts: { rateLimit?: number } = {}) {
  const workspaceManager = new WorkspaceManager();
  const state: DaemonState = {
    store: initialStore,
    shield: new XRShieldService(initialStore),
    workspaceManager,
    trust: makeDaemonTrust(),
  };
  const routes = createRouteHandler();
  // Phase 4 · T5 — rate limiting: generous default, but bounded (429).
  const limiter = new RateLimiter(opts.rateLimit ?? 600, 60_000);

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // Health is intentionally open; every other route requires the local token.
    if (path !== "/api/health") {
      const auth = authorizeRequest(req, token);

      // Phase 4 · T5 — one-time bootstrap: set the session cookie and
      // redirect to the token-free URL (the token never lingers).
      if (auth.kind === "bootstrap") {
        const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
        return new Response(null, {
          status: 302,
          headers: { location: auth.url, "set-cookie": cookie },
        });
      }

      if (auth.kind === "denied") {
        return safeJson({ error: "unauthorized — local bearer token or session cookie required" }, 401);
      }

      // Phase 4 · T5 — CSRF/Origin: cookie-authenticated mutating requests
      // must come from the daemon's own origin.
      const host = resolveBindHost();
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (!originAllowed(req, auth, host, port)) {
        return safeJson({ error: "forbidden — cross-origin request refused (CSRF guard)" }, 403);
      }
    }

    // Phase 4 · T5 — per-IP rate limit (fail closed with 429).
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
    if (!limiter.allow(`${ip}:${path}`)) {
      return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(limiter.retryAfterSeconds(`${ip}:${path}`)),
        },
      });
    }

    // Phase 4 · T5 — route caps: reject oversized bodies up front (413).
    // Bun does not always populate content-length, so the cap is enforced on
    // the actual bytes (read from a clone; the original request is untouched
    // for the route handlers).
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const len = req.headers.get("content-length");
      if (len && Number(len) > MAX_REQUEST_BODY_BYTES) {
        return safeJson({ error: "payload too large" }, 413);
      }
      if (!len) {
        const clone = req.clone();
        try {
          const body = await clone.text();
          if (body.length > MAX_REQUEST_BODY_BYTES) {
            return safeJson({ error: "payload too large" }, 413);
          }
        } catch {
          return safeJson({ error: "unreadable request body" }, 400);
        }
      }
    }

    const { config } = loadConfig();
    const response = await routes({
      ...responseHelpers,
      req,
      url,
      path,
      method,
      token,
      host: resolveBindHost(),
      state,
      config,
    });
    return response ?? safeJson({ error: "not found" }, 404);
  };
}

/** Start the local daemon. Prints token + URL once on startup. */
export async function serve(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const port = opts.port ?? 3141;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const workspaceManager = new WorkspaceManager();
  const store = opts.store ?? workspaceManager.getStore(workspaceManager.getActiveId());

  // Prefetch secrets into process.env without blocking the first health check.
  void hydrateSecretsAsync().catch(() => {});

  const handler = makeHandler(store, token);
  const bindHost = resolveBindHost();
  const server = Bun.serve({ hostname: bindHost, port, fetch: handler });
  // Phase 4 · T4 fix — report the ACTUAL bound port: `port: 0` asks the OS to
  // assign an ephemeral port (used by the perf dashboard-bench, which spawns
  // many bench processes; a fixed/random port can collide with the previous
  // process's TIME_WAIT socket → EADDRINUSE → flaky CI).
  // @types/bun types `server.port` as `number | undefined`, so fall back to
  // the requested port when the server does not report one.
  const boundPort = server.port ?? port;
  // Always show a reachable URL: 0.0.0.0 is a bind address, not a destination.
  const displayHost = bindHost === CONTAINER_BIND ? DEFAULT_LOOPBACK : bindHost;
  const url = `http://${displayHost}:${boundPort}/?token=${token}`;

  const { xrCyan, xrGreen, xrDim, xrBold } = await import("../ui/theme.ts");
  console.log(`
  ${xrBold(xrCyan("XR"))} ${xrDim("—")} Local Server
  ${xrGreen("✓")} Listening on  ${xrCyan(`http://${displayHost}:${boundPort}`)}
  ${xrGreen("✓")} Dashboard     ${xrCyan(url)}
  ${xrGreen("✓")} Chat          ${xrCyan(`http://${displayHost}:${boundPort}/chat?token=${token}`)}
  ${xrDim("Token:")} ${xrDim(token)}
  ${xrDim(
    bindHost === CONTAINER_BIND
      ? `Binding: ${bindHost} inside the container — publish it loopback-only on the host (127.0.0.1:${boundPort}:${boundPort})`
      : `Binding: ${bindHost} only — not exposed to the network`,
  )}
`);

  return {
    port: boundPort,
    token,
    stop: () => server.stop(),
    handle: handler,
  };
}
