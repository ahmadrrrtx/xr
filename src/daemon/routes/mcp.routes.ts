/**
 * XR Daemon — MCP server management routes.
 *
 * The dashboard's Extensions → MCP tab (and any remote surface) manages the
 * SAME registry the `xr mcp` CLI uses (`~/.xr/mcp/registry.json` via
 * McpManager). Before these routes existed the panel called endpoints that
 * did not exist and silently rendered "No MCP connections registered"
 * forever (audit P1-5). Every response here is live registry data.
 *
 *   GET    /api/mcp              → { servers: [...] }        (live registry)
 *   POST   /api/mcp/add          → register a server          (CLI-parity input)
 *   POST   /api/mcp/remove       → remove a server by id
 *   POST   /api/mcp/enable       → enable a server by id
 *   POST   /api/mcp/disable      → disable a server by id
 *   GET    /api/mcp/health       → health summary (best-effort, bounded)
 */

import { route, type DaemonRoute } from "./router.ts";
import { McpManager } from "../../mcp/manager.ts";
import type { McpServerConfigInput } from "../../mcp/types.ts";

/** Build the CLI-parity registry input from a simple dashboard payload. */
function buildInput(body: Record<string, unknown>): { ok: true; input: McpServerConfigInput } | { ok: false; reason: string } {
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const transport = typeof body.transport === "string" ? body.transport : "stdio";
  if (!id) return { ok: false, reason: "id is required" };
  if (!/^[a-z0-9_-]+$/i.test(id)) return { ok: false, reason: "id may contain letters, digits, - and _ only" };
  if (!["stdio", "sse", "http", "streamable-http"].includes(transport)) {
    return { ok: false, reason: "transport must be one of stdio | sse | http | streamable-http" };
  }
  const enable = body.enabled === true;

  const input: McpServerConfigInput = {
    id,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : id,
    version: "0.1.0",
    description: `MCP server ${id}`,
    source: "manual",
    transport: transport as McpServerConfigInput["transport"],
    localOrRemote: transport === "stdio" ? "local" : "remote",
    installedAt: Date.now(),
    updatedAt: Date.now(),
    enabled: enable,
    trustLevel: "unknown",
    invocationCount: 0,
    declaredCapabilities: { tools: true, resources: true, prompts: true },
    declaredPermissions: [],
    grantedPermissions: [],
  };

  if (transport === "stdio") {
    // Accept `cmd`/`command` + `args[]` (dashboard form) or a single
    // command string with args (CLI parity).
    const rawCmd = typeof body.cmd === "string" ? body.cmd : typeof body.command === "string" ? body.command : "";
    const rawArgs = Array.isArray(body.args) ? body.args.map(String) : [];
    if (!rawCmd && !rawArgs.length) return { ok: false, reason: "stdio transport requires a command" };
    const parts = rawCmd ? rawCmd.split(" ").filter(Boolean) : rawArgs;
    input.command = parts[0];
    input.args = parts.slice(1).concat(rawCmd ? rawArgs : []);
  } else {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return { ok: false, reason: `${transport} transport requires a url` };
    input.url = url;
  }
  return { ok: true, input };
}

export function mcpRoutes(): DaemonRoute[] {
  return [
    route({
      id: "mcp.list",
      path: "/api/mcp",
      method: "GET",
      handle: ({ json, state }) => {
        const mgr = new McpManager(state.store);
        const servers = mgr.listServers().map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          transport: s.transport,
          command: s.command ?? null,
          args: s.args ?? [],
          url: s.url ?? null,
          enabled: s.enabled,
          health: s.health,
          trust: s.trustLevel,
          lifecycleState: s.lifecycleState ?? "installed",
          tools: s.declaredCapabilities?.tools ?? false,
          installedAt: s.installedAt,
        }));
        return json({ servers });
      },
    }),
    route({
      id: "mcp.add",
      path: "/api/mcp/add",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const built = buildInput(body);
        if (!built.ok) return json({ error: built.reason }, 400);
        const mgr = new McpManager(state.store);
        const res = await mgr.addServer(built.input);
        if (!res.ok) return json({ error: res.reason ?? "registration failed" }, 400);
        if (built.input.enabled) mgr.enable(built.input.id);
        return json({ ok: true, server: { id: built.input.id } });
      },
    }),
    route({
      id: "mcp.remove",
      path: "/api/mcp/remove",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { id?: string };
        if (!body.id) return json({ error: "id is required" }, 400);
        const mgr = new McpManager(state.store);
        const res = mgr.remove(body.id);
        if (!res.ok) return json({ error: res.reason ?? "remove failed" }, 400);
        return json({ ok: true });
      },
    }),
    route({
      id: "mcp.enable",
      path: "/api/mcp/enable",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { id?: string };
        if (!body.id) return json({ error: "id is required" }, 400);
        const mgr = new McpManager(state.store);
        const res = mgr.enable(body.id);
        if (!res.ok) return json({ error: res.reason ?? "enable failed" }, 400);
        return json({ ok: true });
      },
    }),
    route({
      id: "mcp.disable",
      path: "/api/mcp/disable",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { id?: string };
        if (!body.id) return json({ error: "id is required" }, 400);
        const mgr = new McpManager(state.store);
        const res = await mgr.disable(body.id);
        if (!res.ok) return json({ error: res.reason ?? "disable failed" }, 400);
        return json({ ok: true });
      },
    }),
    route({
      id: "mcp.health",
      path: "/api/mcp/health",
      method: "GET",
      handle: async ({ json, state }) => {
        const mgr = new McpManager(state.store);
        // Bounded health probe: this may spawn/connect, so it is its own
        // endpoint (the list view never blocks on it).
        const reports = await mgr.healthCheck();
        return json({ reports });
      },
    }),
  ];
}
