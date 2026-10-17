/** XR Daemon — route composition + API v1 contract mount (Phase 8 · T1). */

import { metaRoutes } from "./meta.routes.ts";
import { listBaseRoutes, apiRegistry, type ApiOperation } from "./registry.ts";
import { createDaemonRouter, problem, type DaemonRoute, type DaemonRouteHandler } from "./router.ts";
import { declaredKeys, unknownFieldPaths } from "./body-strictness.ts";
import {
  API_CONTRACT,
  LEGACY_SUNSET_HTTP_DATE,
  V1_PREFIX,
  type ApiOperationMeta,
} from "./contract.ts";

const NOT_FOUND_BODY = Object.freeze({ error: "not found" });

/** Every daemon route, in dispatch order (base groups + Phase-8 meta routes). */
export function listDaemonRoutes(): DaemonRoute[] {
  return [...listBaseRoutes(), ...metaRoutes()];
}

type Mount = { kind: "v1"; canonical: string } | { kind: "legacy"; canonical: string } | { kind: "surface" };

/**
 * Resolve which mount a request path belongs to.
 *   /api/v1/x → v1 mount, canonical /api/x
 *   /api/x    → legacy mount (deprecation headers; removed ≥ XR 2.0.0)
 *   other     → HTML/asset surface, untouched
 */
export function resolveMount(path: string): Mount {
  if (path === V1_PREFIX) return { kind: "v1", canonical: "/api" };
  if (path.startsWith(V1_PREFIX + "/")) return { kind: "v1", canonical: "/api" + path.slice(V1_PREFIX.length) };
  if (path.startsWith("/api/") || path === "/api") return { kind: "legacy", canonical: path };
  return { kind: "surface" };
}

/** Deprecation headers for the legacy mount (RFC 8594 + Sunset draft). */
export function legacyDeprecationHeaders(canonical: string): Record<string, string> {
  return {
    deprecation: "true",
    sunset: LEGACY_SUNSET_HTTP_DATE,
    link:
      `<${v1PathFromRegistry(canonical)}>; rel="alternate", ` +
      `<https://github.com/ahmadrrrtx/xr/blob/main/docs/api/COMPATIBILITY.md>; rel="deprecation"`,
    "x-xr-api-version": "v0-legacy",
  };
}

// Local alias (registry owns the mapping; re-exported below for consumers).
import { v1Path as v1PathFromRegistry } from "./registry.ts";

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

interface ZodLike {
  safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/**
 * Contract validation (fail-closed 400 problem+json; each handler keeps its
 * own semantic checks underneath — validation never relaxes behavior).
 * Reads a CLONE so the original body stream stays intact for the route.
 * Phase 34 · R2 (P1-6): after safeParse succeeds, unknown write fields are
 * gated per mount (v1 rejects; legacy names them — body-strictness.ts).
 */
async function validateBody(
  ctx: Parameters<DaemonRouteHandler>[0],
  meta: ApiOperationMeta,
  mount: "v1" | "legacy",
  opId: string,
): Promise<{ bad: Response | null; ignored: string[] }> {
  const none = { bad: null, ignored: [] as string[] };
  const method = ctx.method.toUpperCase();
  if (!meta.request || method === "GET" || method === "HEAD") return none;
  let raw: unknown = {};
  try {
    const clone = ctx.req.clone();
    const text = await clone.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    // Unparseable bodies keep the historical handler-level 400 behavior.
    return none;
  }
  const parsed = (meta.request as unknown as ZodLike).safeParse(raw);
  if (!parsed.success) {
    const issues = (parsed.error?.issues ?? []).slice(0, 10).map((i) => ({
      path: i.path.map(String).join("."), message: i.message,
    }));
    return { bad: problem(400, "Bad Request", "Request body does not match the published schema", issues), ignored: [] };
  }
  const unknown = [...new Set(unknownFieldPaths(meta.request, raw))].sort();
  if (unknown.length === 0) return none;
  if (mount === "legacy") return { bad: null, ignored: unknown.slice(0, 10) };
  const accepted = declaredKeys(meta.request).join(", ");
  const errors = unknown.map((path) => ({ path, message: `Unknown field. ${opId} accepts: ${accepted}.` }));
  return { bad: problem(400, "Bad Request", "Request body contains fields the operation does not accept", errors), ignored: [] };
}

/**
 * The id of the first route that would serve this (canonical) path/method,
 * or "unmatched" — used for observability labels and contract lookup.
 */
export function matchRouteId(path: string, method: string, routes: DaemonRoute[] = listDaemonRoutes()): string {
  for (const r of routes) {
    if (r.matchesPath(path, method)) return r.id;
  }
  return "unmatched";
}

/**
 * Phase 02 — bounded observability label for an UNMATCHED request.
 *
 * Returns the first canonical path segment (e.g. "/api/v1/skills/nope" →
 * "skills") but ONLY when that segment is a known route namespace; anything
 * else folds into "other". This keeps unmatched-route metrics actionable
 * ("the skills namespace is 404ing") while bounding cardinality — a raw URL
 * label would let any caller mint unbounded series. Never carries the query
 * string, tokens, headers, or bodies.
 */
export function unmatchedCategory(canonicalPath: string, routes: DaemonRoute[] = listDaemonRoutes()): string {
  if (!canonicalPath.startsWith("/api")) return "other";
  const segment = canonicalPath.slice("/api".length).split("/").filter(Boolean)[0];
  if (!segment) return "root";
  for (const r of routes) {
    const known = r.pathLabel().slice("/api".length).split("/").filter(Boolean)[0];
    if (known && known === segment) return segment;
  }
  return "other";
}

/** Find the contract metadata + op id of the FIRST route that would serve this request. */
function contractFor(path: string, method: string, routes: DaemonRoute[]): { id: string; meta: ApiOperationMeta } | null {
  for (const r of routes) {
    if (!r.matchesPath(path, method)) continue;
    const meta = API_CONTRACT[r.id];
    if (!meta) return null;
    return { id: r.id, meta };
  }
  return null;
}

export function createRouteHandler(): DaemonRouteHandler {
  const routes = listDaemonRoutes();
  const router = createDaemonRouter(routes, ({ json }) => json({ ...NOT_FOUND_BODY }, 404));

  return async (ctx) => {
    const mount = resolveMount(ctx.path);
    if (mount.kind === "surface") return await router(ctx);

    const effectiveCtx = mount.kind === "v1" ? { ...ctx, path: mount.canonical } : ctx;

    let ignoredFields: { op: string; fields: string[] } | null = null;
    const hit = contractFor(effectiveCtx.path, effectiveCtx.method, routes);
    if (hit) {
      const { bad, ignored } = await validateBody(effectiveCtx, hit.meta, mount.kind, hit.id);
      if (bad) {
        return mount.kind === "legacy"
          ? withHeaders(bad, legacyDeprecationHeaders(mount.canonical))
          : withHeaders(bad, { "x-xr-api-version": "v1" });
      }
      if (ignored.length > 0) ignoredFields = { op: hit.id, fields: ignored };
    }

    const response = await router(effectiveCtx);
    const finalResponse = response ?? problem(404, "Not Found");
    if (mount.kind === "legacy") {
      const headers = legacyDeprecationHeaders(mount.canonical);
      if (ignoredFields) { // names unknowns so legacy clients can migrate before the sunset
        headers["x-xr-ignored-fields"] = ignoredFields.fields.join(",");
        try { ctx.state?.store.audit("api.ignored_fields", { op: ignoredFields.op, fields: ignoredFields.fields }); }
        catch { /* audit must never break the request path */ }
      }
      return withHeaders(finalResponse, headers);
    }
    return withHeaders(finalResponse, { "x-xr-api-version": "v1" });
  };
}

export * from "./router.ts";
export * from "./registry.ts";
export { API_CONTRACT, API_PREFIX, API_VERSION, V1_PREFIX } from "./contract.ts";
export { type ApiOperation };
