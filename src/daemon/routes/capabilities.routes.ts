/** XR Daemon — Capability Ecosystem API routes. */
import { CapabilityService, type CapabilityDiscoverQuery } from "../../platform/capabilities/service.ts";
import { CAPABILITY_TYPES, type CapabilityType } from "../../platform/capabilities/types.ts";

/** Untrusted query enums: only schema literals pass, everything else = no
 * filter (previously raw strings were cast blind into the query — A-6 seam). */
function enumParam<T extends string>(raw: string | null, allowed: ReadonlySet<T>): T | undefined {
  return raw != null && allowed.has(raw as T) ? (raw as T) : undefined;
}
const RISK_TIERS = new Set(["tier0", "tier1", "tier2"] as const);
const LOCALITIES = new Set(["local", "private", "internet", "any"] as const);
import { route, type DaemonRoute } from "./router.ts";

async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

function service(ctx: Parameters<DaemonRoute["handle"]>[0]): CapabilityService {
  return new CapabilityService(ctx.state.store, ctx.config);
}

export function capabilityRoutes(): DaemonRoute[] {
  return [
    route({
      id: "capabilities.list",
      path: "/api/capabilities",
      method: "GET",
      handle: (ctx) => {
        const svc = service(ctx);
        const url = ctx.url;
        const task = url.searchParams.get("task") ?? undefined;
        const type = enumParam(url.searchParams.get("type"), new Set(CAPABILITY_TYPES as readonly CapabilityType[]));
        const query: CapabilityDiscoverQuery = {
          task,
          type: type || undefined,
          requires: url.searchParams.get("requires")?.split(",").filter(Boolean),
          excludesPermissions: url.searchParams.get("exclude")?.split(",").filter(Boolean),
          maxRiskTier: enumParam(url.searchParams.get("maxRisk"), RISK_TIERS),
          locality: enumParam(url.searchParams.get("locality"), LOCALITIES),
          certified: url.searchParams.get("certified") === "1" || url.searchParams.get("certified") === "true",
          installedOnly: url.searchParams.get("installed") === "1" || url.searchParams.get("installed") === "true",
          enabledOnly: url.searchParams.get("enabled") === "1" || url.searchParams.get("enabled") === "true",
          limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        };
        const rows = task || type || query.requires?.length || query.excludesPermissions?.length || query.maxRiskTier || query.locality || query.certified || query.installedOnly || query.enabledOnly
          ? svc.discover(query)
          : svc.list();
        return ctx.json({ capabilities: rows, health: svc.health() });
      },
    }),
    route({
      id: "capabilities.health",
      path: "/api/capabilities/health",
      method: "GET",
      handle: (ctx) => ctx.json(service(ctx).health()),
    }),
    route({
      id: "capabilities.inspect",
      path: "/api/capabilities/inspect",
      method: "GET",
      handle: (ctx) => {
        const id = ctx.url.searchParams.get("id") ?? "";
        const descriptor = service(ctx).inspect(id);
        return descriptor ? ctx.json(descriptor) : ctx.json({ error: "capability not found or ambiguous" }, 404);
      },
    }),
    route({
      id: "capabilities.permissions",
      path: "/api/capabilities/permissions",
      method: "GET",
      handle: (ctx) => {
        const id = ctx.url.searchParams.get("id") ?? "";
        const permissions = service(ctx).permissions(id);
        return permissions ? ctx.json(permissions) : ctx.json({ error: "capability not found or ambiguous" }, 404);
      },
    }),
    route({
      id: "capabilities.certify",
      path: "/api/capabilities/certify",
      method: "POST",
      handle: async (ctx) => {
        const body = await readJson(ctx.req);
        const result = service(ctx).certify(String(body.id ?? ""));
        return ctx.json(result, result.ok ? 200 : 400);
      },
    }),
    route({
      id: "capabilities.enable",
      path: "/api/capabilities/enable",
      method: "POST",
      handle: async (ctx) => {
        const body = await readJson(ctx.req);
        const result = await service(ctx).enable(String(body.id ?? ""));
        return ctx.json(result, result.ok ? 200 : 400);
      },
    }),
    route({
      id: "capabilities.disable",
      path: "/api/capabilities/disable",
      method: "POST",
      handle: async (ctx) => {
        const body = await readJson(ctx.req);
        const result = await service(ctx).disable(String(body.id ?? ""));
        return ctx.json(result, result.ok ? 200 : 400);
      },
    }),
    route({
      id: "capabilities.quarantine",
      path: "/api/capabilities/quarantine",
      method: "POST",
      handle: async (ctx) => {
        const body = await readJson(ctx.req);
        const result = await service(ctx).quarantine(String(body.id ?? ""), String(body.reason ?? "manual quarantine"));
        return ctx.json(result, result.ok ? 200 : 400);
      },
    }),
    route({
      id: "capabilities.rollback",
      path: "/api/capabilities/rollback",
      method: "POST",
      handle: async (ctx) => {
        const body = await readJson(ctx.req);
        const result = await service(ctx).rollback(String(body.id ?? ""), body.version ? String(body.version) : undefined);
        return ctx.json(result, result.ok ? 200 : 400);
      },
    }),
  ];
}
