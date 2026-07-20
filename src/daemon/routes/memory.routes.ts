/** XR Daemon — durable memory routes. */

import { isMemoryEnabled } from "../../config/config.ts";
import { MemoryStore } from "../../memory/store.ts";
import { route, type DaemonRoute } from "./router.ts";

export function memoryRoutes(): DaemonRoute[] {
  return [
    route({
      id: "memory.list",
      path: "/api/memory",
      method: "GET",
      handle: ({ json, state }) => {
        const mem = new MemoryStore(state.store);
        const entries = mem.list().map((e) => ({
          id: e.id,
          category: e.category,
          content: e.content,
          scope: e.scope,
          source: e.source,
          tags: e.tags,
          importance: e.importance,
          expiresAt: e.expiresAt ?? null,
          updatedAt: e.updatedAt,
        }));
        return json({ enabled: isMemoryEnabled(), count: mem.count(), stats: mem.stats(), health: mem.health(), entries });
      },
    }),
    route({
      id: "memory.health",
      path: "/api/memory/health",
      method: "GET",
      handle: ({ json, state }) => {
        const mem = new MemoryStore(state.store);
        return json({ enabled: isMemoryEnabled(), ...mem.health() });
      },
    }),
    route({
      id: "memory.search",
      path: "/api/memory/search",
      method: "GET",
      handle: ({ json, url, state }) => {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (!q) return json({ results: [] });
        const mem = new MemoryStore(state.store);
        const results = mem.search(q).map((e) => ({
          id: e.id,
          category: e.category,
          content: e.content,
          scope: e.scope,
          tags: e.tags,
          importance: e.importance,
        }));
        return json({ query: q, results });
      },
    }),
    route({
      id: "memory.delete",
      prefix: "/api/memory/",
      method: "DELETE",
      handle: ({ json, path, state }) => {
        const key = decodeURIComponent(path.slice("/api/memory/".length));
        const mem = new MemoryStore(state.store);
        if (key === "*" || key === "all") {
          const n = mem.clear();
          state.store.audit("memory.clear_all", { removed: n });
          return json({ ok: true, removed: n });
        }
        const r = mem.remove(key);
        state.store.audit("memory.delete", { id: key, ok: r.ok });
        return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
      },
    }),
  ];
}
