/**
 * XR — Local Daemon ("xr serve")
 *
 * Thin server shell: binds to localhost, enforces the local bearer token, builds
 * per-request context, and delegates all API/dashboard handling to route groups
 * in src/daemon/routes/.
 */

import { randomBytes } from "node:crypto";
import { hydrateSecretsAsync, loadConfig } from "../config/config.ts";
import { WorkspaceManager } from "../core/workspace.ts";
import { XRShieldService } from "../security/shield.ts";
import type { Store } from "../state/workspace-store.ts";
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

const HOST = "127.0.0.1";

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

/** Build the request handler (pure; used by both serve() and tests). */
export function makeHandler(initialStore: Store, token: string) {
  const workspaceManager = new WorkspaceManager();
  const state: DaemonState = {
    store: initialStore,
    shield: new XRShieldService(initialStore),
    workspaceManager,
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
      host: HOST,
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
  const server = Bun.serve({ hostname: HOST, port, fetch: handler });
  const url = `http://${HOST}:${port}/?token=${token}`;

  const { xrCyan, xrGreen, xrDim, xrBold } = await import("../ui/theme.ts");
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
    stop: () => server.stop(),
    handle: handler,
  };
}
