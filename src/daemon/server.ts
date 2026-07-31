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

function isAuthorized(req: Request, token: string): boolean {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization === `Bearer ${token}`) return true;

  // Localhost-only server: query token keeps the first dashboard load smooth.
  const url = new URL(req.url);
  return url.searchParams.get("token") === token;
}

/** Build a daemon-scoped Trust service (backends are detected lazily on first use). */
function makeDaemonTrust(): TrustService {
  const broker = new CredentialBroker();
  const registry = new AuthorityRegistry();
  const manager = new EnvironmentManager(
    [new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend(), new ContainerBackend()],
    broker,
  );
  return new TrustService({ manager, registry, broker });
}

/** Build the request handler (pure; used by both serve() and tests). */
export function makeHandler(initialStore: Store, token: string) {
  const workspaceManager = new WorkspaceManager();
  const state: DaemonState = {
    store: initialStore,
    shield: new XRShieldService(initialStore),
    workspaceManager,
    trust: makeDaemonTrust(),
  };
  const routes = createRouteHandler();

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // Health is intentionally open; every other route requires the local token.
    if (path !== "/api/health" && !isAuthorized(req, token)) {
      return safeJson({ error: "unauthorized — local bearer token required" }, 401);
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
  // Always show a reachable URL: 0.0.0.0 is a bind address, not a destination.
  const displayHost = bindHost === CONTAINER_BIND ? DEFAULT_LOOPBACK : bindHost;
  const url = `http://${displayHost}:${port}/?token=${token}`;

  const { xrCyan, xrGreen, xrDim, xrBold } = await import("../ui/theme.ts");
  console.log(`
  ${xrBold(xrCyan("XR"))} ${xrDim("—")} Local Server
  ${xrGreen("✓")} Listening on  ${xrCyan(`http://${displayHost}:${port}`)}
  ${xrGreen("✓")} Dashboard     ${xrCyan(url)}
  ${xrGreen("✓")} Chat          ${xrCyan(`http://${displayHost}:${port}/chat?token=${token}`)}
  ${xrDim("Token:")} ${xrDim(token)}
  ${xrDim(
    bindHost === CONTAINER_BIND
      ? `Binding: ${bindHost} inside the container — publish it loopback-only on the host (127.0.0.1:${port}:${port})`
      : `Binding: ${bindHost} only — not exposed to the network`,
  )}
`);

  return {
    port,
    token,
    stop: () => server.stop(),
    handle: handler,
  };
}
