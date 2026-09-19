/**
 * XR — Local Daemon ("xr serve")
 *
 * Thin server shell: binds to localhost, enforces the local bearer token, builds
 * per-request context, and delegates all API/dashboard handling to route groups
 * in src/daemon/routes/.
 *
 * Phase 1 hardening: token hygiene — write token to 0600 file for desktop pairing,
 * never print token in URL query in console, QR/paste flow.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { hydrateSecretsAsync, loadConfig } from "../config/config.ts";
import { WorkspaceManager } from "../core/workspace.ts";
import { XRShieldService } from "../hygiene/scanner.ts";
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
import { createAgentExecutor } from "./agent-executor.ts";
import {
  createRouteHandler,
  htmlResponse,
  resolveMount,
  matchRouteId,
  unmatchedCategory,
  safeJson,
  sseResponse,
  type DaemonResponseHelpers,
  type DaemonState,
} from "./routes/index.ts";
import {
  initObservability,
  shutdownObservability,
  httpServerSpan,
  endHttpServerSpan,
  structuredLog,
  xrMetrics,
} from "../observability/index.ts";
import { CORE_VERSION } from "../core/version.ts";
import { AUTH_PAGE_CSP, authPageHtml } from "./auth-page.ts";

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

export const DEFAULT_LOOPBACK = "127.0.0.1";
export const CONTAINER_BIND = "0.0.0.0";

export function isContainerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.XR_IN_CONTAINER === "1" || env.XR_IN_CONTAINER === "true") return true;
  if (env.KUBERNETES_SERVICE_HOST) return true;
  try {
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}

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

export const SESSION_COOKIE = "xr_session";
const SESSION_COOKIE_SET = `${SESSION_COOKIE}=`;

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
    if (req.method.toUpperCase() === "GET") {
      url.searchParams.delete("token");
      return { kind: "bootstrap", url: url.toString() };
    }
    return { kind: "denied" };
  }
  return { kind: "denied" };
}

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
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.hostname === host && (o.port === String(port) || (o.port === "" && port === 80));
  } catch {
    return false;
  }
}

export class RateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: now, count: 1 });
      return true;
    }
    entry.count++;
    if (entry.count > this.limit) {
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

export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

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

export function makeHandler(initialStore: Store, token: string, opts: { rateLimit?: number } = {}) {
  const workspaceManager = new WorkspaceManager();
  const agentExecutor = createAgentExecutor();
  const state: DaemonState = {
    store: initialStore,
    shield: new XRShieldService(initialStore),
    workspaceManager,
    trust: makeDaemonTrust(),
    agentExecutor,
  };
  const routes = createRouteHandler();
  const limiter = new RateLimiter(opts.rateLimit ?? 600, 60_000);

  async function dispatch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    if (path !== "/api/health" && path !== "/api/v1/health" && path !== "/assets/auth.js") {
      const auth = authorizeRequest(req, token);

      if (auth.kind === "bootstrap") {
        const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
        return new Response(null, {
          status: 302,
          headers: { location: auth.url, "set-cookie": cookie },
        });
      }

      if (auth.kind === "denied") {
        const accept = req.headers.get("accept") ?? "";
        if (method === "GET" && accept.includes("text/html")) {
          return new Response(authPageHtml(path), {
            status: 401,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": AUTH_PAGE_CSP,
              "cache-control": "no-store",
            },
          });
        }
        return safeJson({ error: "unauthorized — local bearer token or session cookie required" }, 401);
      }

      const host = resolveBindHost();
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (!originAllowed(req, auth, host, port)) {
        return safeJson({ error: "forbidden — cross-origin request refused (CSRF guard)" }, 403);
      }
    }

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
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const mount = resolveMount(url.pathname);
    const canonical = mount.kind === "v1" ? mount.canonical : url.pathname;
    const routeId = matchRouteId(canonical, method);
    const span = httpServerSpan({ routeId, method, path: canonical, mount: mount.kind });
    const started = Date.now();
    let status = 500;
    try {
      const response = await dispatch(req);
      status = response.status;
      return response;
    } catch (err) {
      span.setStatus("error", (err as Error)?.name ?? "Error");
      throw err;
    } finally {
      endHttpServerSpan(span, status);
      const durationMs = Date.now() - started;
      const statusClass = `${Math.floor(status / 100)}xx`;
      xrMetrics.httpRequests.inc({ route: routeId, method, status: statusClass });
      xrMetrics.httpDuration.observe({ route: routeId }, durationMs);
      if (routeId === "unmatched" && mount.kind !== "surface") {
        xrMetrics.httpUnmatchedRoutes.inc({
          method,
          mount: mount.kind,
          category: unmatchedCategory(canonical),
        });
      }
      structuredLog("info", "http.request", {
        route: routeId,
        method,
        mount: mount.kind,
        status,
        duration_ms: durationMs,
      });
    }
  };
}

/** Phase 1 hardening · token hygiene: write token to 0600 file for desktop pairing */
function writeTokenFile(token: string, port: number): string | null {
  try {
    const dir = join(homedir(), ".xr");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "daemon-token");
    const payload = JSON.stringify({ token, port, createdAt: Date.now(), version: "1.0.0-phase1", note: "0600 pairing file — XR Desktop reads automatically, do not share" });
    writeFileSync(file, payload, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* Windows ACL best effort */ }
    return file;
  } catch {
    return null;
  }
}

/** Start the local daemon — Phase 1 hardened token hygiene, no token in URL query in console. */
export async function serve(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const port = opts.port ?? 3141;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const workspaceManager = new WorkspaceManager();
  const store = opts.store ?? workspaceManager.getStore(workspaceManager.getActiveId());

  void hydrateSecretsAsync().catch(() => {});

  void import("../local/hardware.ts").then(({ startHardwareBackgroundRefresh }) => {
    startHardwareBackgroundRefresh();
  }).catch(() => {});
  void import("../local/runtimes.ts").then(({ detectAllRuntimes }) => {
    void detectAllRuntimes().catch(() => {});
  }).catch(() => {});

  const handler = makeHandler(store, token);

  const { config: bootConfig } = loadConfig();
  const obsHandle = initObservability({
    fileConfig: bootConfig.telemetry,
    version: CORE_VERSION,
  });
  if (obsHandle.config.enabled) {
    structuredLog("info", "telemetry.enabled", {
      endpoint: obsHandle.config.endpoint,
      content_prompt: obsHandle.config.content.prompt,
      content_tool_args: obsHandle.config.content.toolArgs,
      note: "telemetry is opt-in, structural-by-default, redacted, cardinality-bounded",
    });
  }

  const bindHost = resolveBindHost();
  const server = Bun.serve({ hostname: bindHost, port, fetch: handler });
  const boundPort = server.port ?? port;
  const displayHost = bindHost === CONTAINER_BIND ? DEFAULT_LOOPBACK : bindHost;
  const tokenFile = writeTokenFile(token, boundPort);
  const urlNoToken = `http://${displayHost}:${boundPort}/`;

  const { xrCyan, xrGreen, xrDim, xrBold } = await import("../ui/theme.ts");
  console.log(`
  ${xrBold(xrCyan("XR"))} ${xrDim("—")} Local Server — Phase 1 Hardened (Token Hygiene SEC-04 fixed)
  ${xrGreen("✓")} Listening on  ${xrCyan(`http://${displayHost}:${boundPort}`)}
  ${xrGreen("✓")} Dashboard     ${xrCyan(urlNoToken)} (token required — see below, no token in URL history)
  ${xrGreen("✓")} API           ${xrCyan(`http://${displayHost}:${boundPort}/api/v1/health`)} (open)
  ${xrDim("Token:")} ${xrDim(token)}
  ${xrDim(tokenFile ? `Token file: ${tokenFile} (0600, for XR Desktop pairing — auto-read by Tauri shell)` : "Token file: could not write — using stdout only (check ~/.xr permissions)")}
  ${xrDim("Pairing: XR Desktop reads the 0600 file automatically; browsers: paste token on sign-in page (token never lingers in URL history/referrers)")}
  ${xrDim(
    bindHost === CONTAINER_BIND
      ? `Binding: ${bindHost} inside the container — publish it loopback-only on the host (127.0.0.1:${boundPort}:${boundPort})`
      : `Binding: ${bindHost} only — not exposed to the network`,
  )}
  ${xrDim("Security: bearer → HttpOnly SameSite=Strict cookie, 401 JSON otherwise, CSRF guard, rate limit 600/60s, 2 MiB cap, egress allowlist, private-IP block, hash-chained audit")}
  ${xrDim("Phase 1 DoD: install→pair→Home→open run anatomy on 3 OSes — token hygiene fixed, path normalization robust, boundary CI")}
`);

  let stopTriggers: () => void = () => {};
  try {
    const { TriggerService } = await import("../automation/triggers.ts");
    const tickMs = bootConfig.triggers?.tickMs ?? 15_000;
    stopTriggers = new TriggerService(store).startLoop(tickMs).stop;
  } catch {
    /* scheduler is additive — a missing table must not prevent serve */
  }

  return {
    port: boundPort,
    token,
    stop: () => {
      stopTriggers();
      server.stop();
      void shutdownObservability();
    },
    handle: handler,
  };
}
