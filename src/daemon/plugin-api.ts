/** XR Stage 10 — local dashboard plugin management API. */
import type { Store } from "../state/workspace-store.ts";
import { PluginManager } from "../plugins/manager.ts";
import { searchCatalog } from "../plugins/catalog.ts";
import { isPermissionScope, type PermissionScope } from "../plugins/types.ts";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Plugin management sub-API adapter.
 *
 * `path` is the CANONICAL route path (`/api/plugins/...`) resolved by the
 * mount layer in routes/index.ts — NOT `url.pathname`, which still carries
 * the external transport prefix (`/api/v1/...`) for versioned requests.
 * `url` remains the source of query parameters only.
 *
 * Route precedence is deterministic: the dedicated `/api/plugins/catalog`
 * collection route is matched BEFORE the `/api/plugins/{id}` pattern, so
 * "catalog" is never mistaken for a plugin id.
 */
export async function handlePluginApi(req: Request, url: URL, path: string, store: Store): Promise<Response | null> {
  if (!path.startsWith("/api/plugins")) return null;
  const mgr = new PluginManager(store, process.cwd());

  if (path === "/api/plugins/catalog" && req.method === "GET") {
    return json({ plugins: searchCatalog(url.searchParams.get("q") ?? "") });
  }

  if (path === "/api/plugins" && req.method === "GET") {
    await mgr.loadEnabled();
    return json({ summary: mgr.summary(), plugins: mgr.health().map((h) => ({
      id: h.entry.id,
      name: h.manifest?.name ?? h.entry.id,
      version: h.manifest?.version ?? h.entry.version,
      type: h.manifest?.type ?? h.entry.type,
      description: h.manifest?.description ?? "",
      enabled: h.entry.enabled,
      status: h.status.kind,
      loaded: h.status.loaded,
      detail: h.status.detail,
      permissions: h.manifest?.permissions ?? [],
      grantedPermissions: h.entry.grantedPermissions,
      capabilities: h.manifest?.capabilities ?? h.entry.capabilities ?? [],
      trustLevel: h.entry.trustLevel ?? h.manifest?.trustLevel ?? "unknown",
      source: h.entry.source ?? h.manifest?.sourceUrl,
      health: h.entry.health,
    })) });
  }

  const m = path.match(/^\/api\/plugins\/([^/]+)(?:\/(enable|disable|remove|permissions|inspect))?$/);
  if (!m) return json({ error: "unknown plugin API route" }, 404);
  const id = decodeURIComponent(m[1]);
  const action = m[2] ?? "inspect";

  if (action === "inspect" && req.method === "GET") return json(mgr.inspect(id));
  if (action === "enable" && req.method === "POST") return json(mgr.enable(id));
  if (action === "disable" && req.method === "POST") return json(await mgr.disable(id));
  if (action === "remove" && req.method === "DELETE") return json(await mgr.remove(id));
  if (action === "permissions" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { permissions?: unknown };
    const rawPerms = Array.isArray(body.permissions) ? body.permissions : [];
    const perms = rawPerms.filter((p: unknown): p is PermissionScope => typeof p === "string" && isPermissionScope(p));
    return json(mgr.setPermissions(id, perms));
  }

  return json({ error: "method not allowed" }, 405);
}
