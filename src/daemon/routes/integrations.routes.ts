/**
 * XR Daemon — integrations routes (Phase 22).
 *
 * Thin HTTP adapters over IntegrationService. Routes do not decide what is
 * connected, what is refreshed or what is stored: the service does that, and the
 * CredentialVault holds every secret. Responses never include tokens or keys.
 */

import { integrationServiceFor, type IntegrationHost } from "../../integrations/runtime.ts";
import { IntegrationError, type IntegrationService } from "../../integrations/service.ts";
import type { DaemonRouteContext } from "./router.ts";
import { McpManager } from "../../mcp/manager.ts";
import { syncIntegrationMcpServer } from "../../integrations/mcp-bridge.ts";
import { route, type DaemonRoute } from "./router.ts";

const MAX_BODY_BYTES = 16 * 1024;

function hostOf(ctx: DaemonRouteContext): IntegrationHost {
  return ctx.state.store as unknown as IntegrationHost;
}

function connectorIdFrom(path: string): string {
  // /api/integrations/{id}/...
  return decodeURIComponent(path.split("/")[3] ?? "");
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return null;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Runs a service call and maps IntegrationError to its HTTP status. Other errors never leak detail. */
/** Keeps the MCP registry in line with the connection state (see mcp-bridge.ts). */
async function syncMcp(ctx: DaemonRouteContext, connectorId: string, connected: boolean) {
  try {
    return await syncIntegrationMcpServer(new McpManager(ctx.state.store as never), connectorId, connected);
  } catch (err) {
    return { serverId: null, registered: false, reason: err instanceof Error ? err.message : "mcp sync failed" };
  }
}

async function withService(
  ctx: DaemonRouteContext,
  run: (svc: IntegrationService) => unknown | Promise<unknown>,
): Promise<Response> {
  try {
    const svc = await integrationServiceFor(hostOf(ctx));
    const body = await run(svc);
    return ctx.json(body && typeof body === "object" ? { ok: true, ...body } : { ok: true });
  } catch (err) {
    if (err instanceof IntegrationError) {
      return ctx.json({ ok: false, code: err.code, error: err.message }, err.httpStatus);
    }
    return ctx.json({ ok: false, code: "internal", error: "Integration request failed." }, 500);
  }
}

export function integrationRoutes(): DaemonRoute[] {
  return [
    route({
      id: "integrations.list",
      path: "/api/integrations",
      method: "GET",
      handle: (ctx) => withService(ctx, (svc) => ({ connectors: svc.list() })),
    }),
    route({
      id: "integrations.get",
      pattern: /^\/api\/integrations\/[^/]+$/,
      method: "GET",
      handle: (ctx) => withService(ctx, (svc) => ({ connector: svc.view(connectorIdFrom(ctx.path)) })),
    }),
    route({
      id: "integrations.app_credentials",
      pattern: /^\/api\/integrations\/[^/]+\/app$/,
      method: "PUT",
      handle: async (ctx) => {
        const body = await readBody(ctx.req);
        if (!body || typeof body.clientId !== "string" || typeof body.clientSecret !== "string") {
          return ctx.json({ ok: false, code: "invalid_body", error: "Send clientId and clientSecret." }, 400);
        }
        const { clientId, clientSecret } = body as { clientId: string; clientSecret: string };
        return withService(ctx, (svc) => ({ connector: svc.saveAppCredentials(connectorIdFrom(ctx.path), { clientId, clientSecret }) }));
      },
    }),
    route({
      id: "integrations.oauth.start",
      pattern: /^\/api\/integrations\/[^/]+\/oauth\/start$/,
      method: "POST",
      handle: (ctx) => withService(ctx, (svc) => svc.startOAuth(connectorIdFrom(ctx.path))),
    }),
    route({
      id: "integrations.oauth.complete",
      path: "/api/integrations/oauth/complete",
      method: "POST",
      handle: async (ctx) => {
        const body = await readBody(ctx.req);
        if (!body || typeof body.state !== "string") {
          return ctx.json({ ok: false, code: "invalid_body", error: "Send state with code or error." }, 400);
        }
        const state = body.state;
        if (typeof body.error === "string") {
          // The provider sent back a denial. Consume the state and report it.
          return withService(ctx, (svc) => svc.cancelOAuth(state));
        }
        if (typeof body.code !== "string") {
          return ctx.json({ ok: false, code: "invalid_body", error: "Send code and state." }, 400);
        }
        const code = body.code;
        return withService(ctx, async (svc) => {
          const connector = await svc.completeOAuth({ code, state });
          return { connector, mcp: await syncMcp(ctx, connector.id, connector.status === "connected") };
        });
      },
    }),
    route({
      id: "integrations.connect",
      pattern: /^\/api\/integrations\/[^/]+\/connect$/,
      method: "POST",
      handle: async (ctx) => {
        const body = await readBody(ctx.req);
        if (!body) return ctx.json({ ok: false, code: "invalid_body", error: "Send a JSON object." }, 400);
        const config = (body.config && typeof body.config === "object" ? body.config : body) as Record<string, unknown>;
        return withService(ctx, async (svc) => {
          const connector = await svc.connectApiKey(connectorIdFrom(ctx.path), config);
          return { connector, mcp: await syncMcp(ctx, connector.id, connector.status === "connected") };
        });
      },
    }),
    route({
      id: "integrations.sync",
      pattern: /^\/api\/integrations\/[^/]+\/sync$/,
      method: "POST",
      handle: (ctx) => withService(ctx, async (svc) => ({ connector: await svc.sync(connectorIdFrom(ctx.path)) })),
    }),
    route({
      id: "integrations.disconnect",
      pattern: /^\/api\/integrations\/[^/]+\/disconnect$/,
      method: "POST",
      handle: (ctx) => withService(ctx, async (svc) => {
        const connectorId = connectorIdFrom(ctx.path);
        const result = await svc.disconnect(connectorId);
        return { ...result, mcp: await syncMcp(ctx, connectorId, false) };
      }),
    }),
  ];
}
