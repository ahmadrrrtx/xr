/**
 * XR Daemon — desktop UI-state routes (Phase 2 · G-08, experimental).
 *
 *   GET /api/state/ui?keys=a,b   → { workspaceId, entries: [{key, value, updatedAt}] }
 *   PUT /api/state/ui            → { patch: { key: value | null } } → { written, deleted, updatedAt }
 *
 * The renderer owns the meaning of these values; the engine owns their
 * durability and budget (src/state/ui-state.ts). No approval is involved:
 * UI state is not a side effect on the user's files or machine.
 */

import { route, type DaemonRoute } from "./router.ts";
import { UiStateError, UiStateRepo } from "../../state/ui-state.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";

export function uiStateRoutes(): DaemonRoute[] {
  return [
    route({
      id: "state.ui.get",
      path: "/api/state/ui",
      method: "GET",
      handle: ({ json, url, state }) => {
        const store = state.store as unknown as WorkspaceStore;
        const raw = url.searchParams.get("keys");
        const keys = raw ? raw.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
        const repo = new UiStateRepo(store, store.workspaceId);
        return json({ workspaceId: store.workspaceId, entries: repo.get(keys) });
      },
    }),
    route({
      id: "state.ui.patch",
      path: "/api/state/ui",
      method: "PUT",
      handle: async ({ req, json, state }) => {
        const store = state.store as unknown as WorkspaceStore;
        const body = (await req.json().catch(() => null)) as { patch?: unknown } | null;
        if (!body || typeof body.patch !== "object" || body.patch === null || Array.isArray(body.patch)) {
          return json({ error: "expected { patch: { key: value | null } }" }, 400);
        }
        const repo = new UiStateRepo(store, store.workspaceId);
        try {
          return json({ workspaceId: store.workspaceId, ...repo.patch(body.patch as Record<string, unknown>) });
        } catch (e) {
          if (e instanceof UiStateError) return json({ error: e.message }, e.status);
          throw e;
        }
      },
    }),
  ];
}
