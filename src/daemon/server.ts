/**
 * XR — Local Daemon ("xr serve")
 *
 * Thin server shell: binds to localhost, enforces the local bearer token, builds
 * per-request context, and delegates all API/dashboard handling to route groups
 * in src/daemon/routes/.
 */

import { existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
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
import { authPageCSP, authPageHtml, generateCspNonce } from "./auth-page.ts";
import { applySecurityHeaders, SECURITY_TXT_URL } from "./security-headers.ts";
import { envSecretCompatEnabled, setSecretReadAuditor } from "../security/secret-broker.ts";
import { installDevGlobal, isDevMode } from "../util/dev-mode.ts";
import { PRIVATE_PROVIDER_WARNING, privateProviderAllowed } from "../providers/provider-url-guard.ts";
import { TelegramManager } from "../telegram/manager.ts";
import { DiscordManager } from "../discord/manager.ts";
import { WhatsAppManager } from "../whatsapp/manager.ts";

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

/**
 * Phase 31 · A10 — pairing endpoints get a much stricter limiter than the
 * general per-IP limiter: codes are 6 digits, so 10 attempts/minute/IP is
 * already generous. Keyed by client IP only (not IP+path): an attacker
 * rotating across the pairing endpoints still faces one budget.
 */
export const STRICT_PAIRING_PATHS: ReadonlySet<string> = new Set([
  "/api/telegram/pair",
  "/api/telegram/pair/open",
  "/api/discord/pair/open",
  "/api/whatsapp/pair",
  "/api/mobile/pair",
]);

/**
 * Phase 31 · A10 — exponential backoff after repeated pairing failures:
 * the 5th consecutive failure blocks the IP for 1 minute, doubling on each
 * further failure (2m → 4m → 8m cap). A success clears the counter.
 */
export class PairingFailureBackoff {
  private state = new Map<string, { failures: number; blockedUntil: number }>();

  check(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const entry = this.state.get(key);
    if (!entry || now >= entry.blockedUntil) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) };
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.state.get(key) ?? { failures: 0, blockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= 5) {
      const steps = Math.min(entry.failures - 5, 3); // 1m, 2m, 4m, 8m cap
      entry.blockedUntil = now + 60_000 * 2 ** steps;
    }
    this.state.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.state.delete(key);
  }

  /** Test seam: consecutive failures recorded for a key. */
  failuresFor(key: string): number {
    return this.state.get(key)?.failures ?? 0;
  }
}

/** Signature-verified webhooks are exempt from per-IP rate limits (A10). */
function isSignatureWebhook(path: string): boolean {
  return path === "/api/telegram/webhook" || path === "/api/discord/webhook";
}

/** Phase 31 · A12 — production error mode (never in an XR_DEV shell). */
function isProductionMode(): boolean {
  return process.env.NODE_ENV === "production" && !isDevMode();
}

/** Phase 4 · T5 — request body size cap (route caps; fail closed). */
export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB

/**
 * Phase 18 — the ONE route allowed a larger body: a research PDF upload
 * (authenticated, loopback, multipart; parsed in memory and never persisted).
 * Keyed by both mounts so the cap cannot be dodged through the other prefix.
 */
const ROUTE_BODY_CAPS: Readonly<Record<string, number>> = {
  "/api/research/upload-pdf": 20 * 1024 * 1024 + 64 * 1024, // 20 MiB + multipart framing
  "/api/v1/research/upload-pdf": 20 * 1024 * 1024 + 64 * 1024,
  // Phase 21 — memory import bundle (≤5,000 entries × ≤2,000 chars, plus JSON overhead).
  "/api/memory/import": 8 * 1024 * 1024,
  "/api/v1/memory/import": 8 * 1024 * 1024,
};
export function bodyCapFor(path: string): number {
  return ROUTE_BODY_CAPS[path] ?? MAX_REQUEST_BODY_BYTES;
}

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
export function makeHandler(
  initialStore: Store,
  token: string,
  opts: { rateLimit?: number; telegram?: TelegramManager; discord?: DiscordManager; whatsapp?: WhatsAppManager } = {},
) {
  const workspaceManager = new WorkspaceManager();
  const agentExecutor = createAgentExecutor();
  const state: DaemonState = {
    store: initialStore,
    shield: new XRShieldService(initialStore),
    workspaceManager,
    trust: makeDaemonTrust(),
    // Phase 03 — the daemon uses the SAME AgentService composition root as the
    // CLI (lazily booted on first task/workspace-switch). Chat and workspace
    // switching route through it instead of duplicating orchestration.
    agentExecutor,
    telegram: opts.telegram ?? new TelegramManager({ store: initialStore }),
    // Phase 26 — Discord is configured through its own routes; nothing starts
    // until a token exists and start/autoStart asks for it.
    discord: opts.discord ?? new DiscordManager({ store: initialStore }),
    // Phase 26 — WhatsApp links as a companion device. Nothing connects until
    // the user pairs (QR) or auto-start finds sealed credentials.
    whatsapp: opts.whatsapp ?? new WhatsAppManager({ store: initialStore }),
  };
  const routes = createRouteHandler();
  // Phase 4 · T5 — rate limiting: generous default, but bounded (429).
  const limiter = new RateLimiter(opts.rateLimit ?? 600, 60_000);
  // Phase 31 · A10 — strict pairing limiter (10/min/IP) + failure backoff.
  const pairingLimiter = new RateLimiter(10, 60_000);
  const pairingBackoff = new PairingFailureBackoff();

  async function dispatch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();
    // Canonical (mount-free) path for policy checks: /api/v1/* ≡ /api/*.
    const canonicalPath = path.startsWith("/api/v1/") ? `/api${path.slice(7)}` : path;

    // Phase 31 · A13 — security.txt lives on the website; the daemon just
    // redirects there. Open path: no bearer token needed for a redirect.
    if (path === "/.well-known/security.txt" && (method === "GET" || method === "HEAD")) {
      return new Response(null, { status: 308, headers: { location: SECURITY_TXT_URL } });
    }

    // Health is intentionally open (both mounts); everything else requires the token.
    // Phase 8 · T3: the sign-in page's behaviour script is the one other open
    // path — a static script with no data/endpoints that the pre-auth page
    // needs (see src/daemon/auth-page.ts).
    // Phase 24: Telegram cannot send the XR token. The webhook authenticates
    // with Telegram's secret_token header inside the route instead.
    // Phase 26: same story for Discord's interactions webhook, whose
    // authenticator is an Ed25519 signature over the raw body (the gateway,
    // the default mode, needs no open path at all).
    if (
      path !== "/api/health" &&
      path !== "/api/v1/health" &&
      path !== "/assets/auth.js" &&
      path !== "/api/telegram/webhook" &&
      path !== "/api/discord/webhook"
    ) {
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
        // Phase 8 · T3 (WCAG 2.2 · 3.3.8): browser page navigations get an
        // ACCESSIBLE sign-in page instead of raw JSON — labelled field,
        // paste-friendly token entry, announced error. API clients (no
        // text/html Accept) keep the Phase-4 JSON contract unchanged.
        const accept = req.headers.get("accept") ?? "";
        if (method === "GET" && accept.includes("text/html")) {
          // Phase 31 · Bucket A follow-up (#6): per-response CSP nonce —
          // removes the previous `style-src 'unsafe-inline'` carve-out.
          // The nonce is generated fresh for every 401, embedded in both the
          // `<style nonce="…">` tag and the `style-src 'nonce-…'` directive,
          // so a reflected-XSS attacker cannot inject a `<style>` block that
          // the browser will honour.
          const nonce = generateCspNonce();
          return new Response(authPageHtml(path, nonce), {
            status: 401,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": authPageCSP(nonce),
              "cache-control": "no-store",
            },
          });
        }
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
    // Phase 31 · A10 — signature-verified webhooks are exempt: their
    // authenticator is the signature, and a chatty Telegram/Discord
    // delivery burst must not 429 legitimate updates.
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
    if (!isSignatureWebhook(canonicalPath) && !limiter.allow(`${ip}:${path}`)) {
      return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(limiter.retryAfterSeconds(`${ip}:${path}`)),
        },
      });
    }

    // Phase 31 · A10 — strict pairing limits: failure backoff first (a
    // blocked IP is refused even inside the rate window), then 10/min/IP.
    const isPairing = method === "POST" && STRICT_PAIRING_PATHS.has(canonicalPath);
    if (isPairing) {
      const backoff = pairingBackoff.check(ip);
      if (!backoff.allowed) {
        return new Response(JSON.stringify({ error: "too many failed pairing attempts — try again later" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": String(backoff.retryAfterSeconds) },
        });
      }
      if (!pairingLimiter.allow(ip)) {
        return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(pairingLimiter.retryAfterSeconds(ip)),
          },
        });
      }
    }

    // Phase 4 · T5 — route caps: reject oversized bodies up front (413).
    // Bun does not always populate content-length, so the cap is enforced on
    // the actual bytes (read from a clone; the original request is untouched
    // for the route handlers).
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const cap = bodyCapFor(path);
      const len = req.headers.get("content-length");
      if (len && Number(len) > cap) {
        return safeJson({ error: "payload too large" }, 413);
      }
      if (!len) {
        const clone = req.clone();
        try {
          const body = await clone.text();
          if (body.length > cap) {
            return safeJson({ error: "payload too large" }, 413);
          }
        } catch {
          return safeJson({ error: "unreadable request body" }, 400);
        }
      }
    }

    const { config } = loadConfig();
    const response =
      (await routes({
        ...responseHelpers,
        req,
        url,
        path,
        method,
        token,
        host: resolveBindHost(),
        state,
        config,
      })) ?? safeJson({ error: "not found" }, 404);

    // Phase 31 · A10 — pairing outcomes feed the failure backoff.
    if (isPairing) {
      if (response.status >= 200 && response.status < 300) pairingBackoff.recordSuccess(ip);
      else pairingBackoff.recordFailure(ip);
    }
    return response;
  }

  /**
   * Phase 8 · T2 — every request is a root server span with route/mount
   * labels; status and duration are recorded as structural metrics; one
   * trace-correlated log line per request. No prompts, bodies, or content
   * are ever captured here (structural-only, Art. XXI).
   */
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
      // Phase 31 · A1 acceptance — HEAD is routed as GET (the route table
      // is method-exact, so every HEAD used to 404, including `curl -I`
      // health probes). Mutations stay unreachable: only GET routes can
      // match. Bun.serve strips the body of HEAD responses itself.
      const response = await dispatch(
        method === "HEAD" ? new Request(req.url, { headers: req.headers }) : req,
      );
      status = response.status;
      // Phase 31 · A1/A6 — security headers + strict CORS on EVERY response.
      return applySecurityHeaders(response, req);
    } catch (err) {
      span.setStatus("error", (err as Error)?.name ?? "Error");
      // Phase 31 · A12 — production clients get an opaque error + correlation
      // id; the full error is logged server-side only. Dev shells keep the
      // throw so failures surface loudly during development.
      if (!isProductionMode()) throw err;
      const id = randomUUID();
      structuredLog("error", "http.unhandled", {
        id,
        route: routeId,
        method,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      status = 500;
      return applySecurityHeaders(safeJson({ error: "internal error", id }, 500), req);
    } finally {
      endHttpServerSpan(span, status);
      const durationMs = Date.now() - started;
      const statusClass = `${Math.floor(status / 100)}xx`;
      xrMetrics.httpRequests.inc({ route: routeId, method, status: statusClass });
      xrMetrics.httpDuration.observe({ route: routeId }, durationMs);
      // Phase 02 — silent route drift is observable: count requests that
      // matched no route, with bounded structural labels only.
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

/** Start the local daemon. Prints token + URL once on startup. */
export async function serve(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  // Phase 31 · A12 — publish the dev-mode flag for surfaces that read
  // globalThis.__XR_DEV__ (set only via XR_DEV=1; production never sets it).
  installDevGlobal();
  // Phase 31 · A5 — the SSRF escape hatch is loud at boot, by design.
  if (privateProviderAllowed()) {
    structuredLog("warn", "security.private_provider_allowed", { warning: PRIVATE_PROVIDER_WARNING });
    console.warn(`\n  ⚠ ${PRIVATE_PROVIDER_WARNING}\n`);
  }
  // Review item #4 — XR_SECRETS_ENV_COMPAT is opt-in and default-OFF. When
  // an operator turns it on, provider API keys hydrate into process.env
  // (legacy 1.x behaviour). The flag is scheduled for removal in v2.0
  // (KNOWN_LIMITATIONS #4); until then, make the posture visible at boot.
  if (envSecretCompatEnabled()) {
    const msg =
      "XR_SECRETS_ENV_COMPAT is ON — provider API keys are hydrated into process.env. " +
      "This is the legacy 1.x behaviour, scheduled for removal in v2.0. " +
      "Turn it off to keep keys in the OS keychain / AES-GCM file store only.";
    structuredLog("warn", "security.secrets_env_compat_on", { warning: msg });
    console.warn(`\n  ⚠ ${msg}\n`);
  }
  // Review item #4 — wire the secret-broker audit hook. Every key read
  // emits a `secret.read` structured-log line with the key NAME and source
  // (never the value). This makes provider key access visible in the
  // audit trail without leaking key material.
  setSecretReadAuditor((event) => {
    structuredLog("info", "secret.read", {
      name: event.name,
      context: event.context ?? null,
      source: event.source,
      path: event.path,
    });
  });
  const port = opts.port ?? 3141;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const workspaceManager = new WorkspaceManager();
  const store = opts.store ?? workspaceManager.getStore(workspaceManager.getActiveId());

  // Prefetch secrets into process.env without blocking the first health check.
  void hydrateSecretsAsync().catch(() => {});

  // Phase 01 — probe hardware + runtimes in the BACKGROUND so the first
  // dashboard load hits warm caches instead of paying 3.5 s + N×2.5 s of
  // detection on the request path. Never blocks startup or /api/health.
  void import("../local/hardware.ts").then(({ startHardwareBackgroundRefresh }) => {
    startHardwareBackgroundRefresh();
  }).catch(() => {});
  void import("../local/runtimes.ts").then(({ detectAllRuntimes }) => {
    void detectAllRuntimes().catch(() => {});
  }).catch(() => {});

  // Phase 24 — the Telegram lifecycle is owned by the daemon: auto-start on
  // boot when enabled, and a clean stop on shutdown.
  const telegram = new TelegramManager({ store });
  // Phase 26 — same lifecycle for Discord. The dashboard URL is passed in so
  // the approval cards' "Open XR" button points at the real bound port.
  const discord = new DiscordManager({ store, dashboardBaseUrl: `http://127.0.0.1:${port}/` });
  // Phase 26 — WhatsApp. Pairing is the QR dialog; auto-start only reconnects a
  // device that is already linked.
  const whatsapp = new WhatsAppManager({ store, dashboardBaseUrl: `http://127.0.0.1:${port}/` });
  const handler = makeHandler(store, token, { telegram, discord, whatsapp });
  void telegram.autoStartOnBoot().catch((err) => {
    structuredLog("warn", "telegram.autostart_failed", { reason: err instanceof Error ? err.message : String(err) });
  });
  void discord.autoStartOnBoot().catch((err) => {
    structuredLog("warn", "discord.autostart_failed", { reason: err instanceof Error ? err.message : String(err) });
  });
  void whatsapp.autoStartOnBoot().catch((err) => {
    structuredLog("warn", "whatsapp.autostart_failed", { reason: err instanceof Error ? err.message : String(err) });
  });

  // Phase 8 · T2 — observability lifecycle: resolves the telemetry config
  // (file + env; OPT-IN, disabled by default) and starts the OTLP exporter
  // ONLY when enabled. When disabled there is zero telemetry network work.
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
  // Phase 14 — SSE streams send a keepalive comment every 5 s (chat.routes),
  // so a 120 s idle ceiling only ever closes a connection whose peer is gone;
  // the Bun default (10 s) cut cold local-model streams before the first token.
  const server = Bun.serve({ hostname: bindHost, port, fetch: handler, idleTimeout: 120 });
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
      void telegram.shutdown();
      void discord.shutdown();
      void whatsapp.shutdown();
      // Phase 2 · G-05: every interactive shell this daemon owns gets the
      // closing-window treatment (SIGHUP → SIGKILL) — the engine going away
      // must never leave user shells orphaned. Lazy import keeps the
      // minimal-server contexts (tests) free of the PTY module.
      void import("./pty-sessions.ts")
        .then((m) => m.getPtyRegistry().closeAll())
        .catch(() => {
          /* best-effort on shutdown */
        });
      // Phase 17 · Builder: dev servers the engine started die with it too.
      void import("./dev-servers.ts")
        .then((m) => m.getDevServers().stopAll())
        .catch(() => {
          /* best-effort on shutdown */
        });
      server.stop();
      void shutdownObservability();
    },
    handle: handler,
  };
}
