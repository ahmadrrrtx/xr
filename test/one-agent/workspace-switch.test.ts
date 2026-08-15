/**
 * Phase 03 · T3.2 + T3.24 — daemon workspace switch routes through the
 * canonical XRApp.switchWorkspace lifecycle (never inline).
 *
 * Proves: the route delegates to switchWorkspace, re-syncs the daemon's
 * store/shield/manager from the app, audits the transition, and maps the
 * canonical WorkspaceSwitchFailedError to a stable 503 without corrupting the
 * active workspace.
 */
import { test, expect } from "bun:test";
import { providersRoutes } from "../../src/daemon/routes/providers.routes.ts";
import type { DaemonRouteContext, DaemonState } from "../../src/daemon/routes/router.ts";
import { WorkspaceSwitchFailedError } from "../../src/core/errors.ts";
import { Tokens } from "../../src/core/tokens.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const switchRoute = providersRoutes().find((r) => r.id === "workspaces.switch")!;

function makeContext(overrides: { executor?: any; store?: any; wm?: any }) {
  const audit: any[] = [];
  const store = overrides.store ?? { audit: (e: string, d: unknown) => audit.push({ e, d }) };
  const wm = overrides.wm ?? { getActiveId: () => "default" };
  const state: DaemonState = {
    store: store as any,
    shield: {} as any,
    workspaceManager: wm as any,
    agentExecutor: overrides.executor,
  };
  return { audit, state };
}

async function call(route: typeof switchRoute, state: DaemonState, id: string): Promise<Response> {
  const res = await route.handle({
    json,
    req: new Request("http://x/api/workspaces/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
    state,
  } as any as DaemonRouteContext);
  return res!;
}

test("switch delegates to the canonical XRApp.switchWorkspace", async () => {
  const switched: string[] = [];
  const audit: any[] = [];
  const mockStore: any = { audit: (e: string, d: unknown) => audit.push({ e, d }) };
  const executor = {
    switchWorkspace: async (id: string) => { switched.push(id); },
    get app() {
      return {
        workspaces: { getActiveId: () => "ws2" },
        registry: { resolve: (t: unknown) => (t === Tokens.Store ? mockStore : null) },
      } as any;
    },
  };
  const { state } = makeContext({ executor });
  const res = await call(switchRoute, state, "ws2");

  expect(res.status).toBe(200);
  expect(switched).toEqual(["ws2"]);
  // Re-synced routing state from the app.
  expect(state.store).toBe(mockStore);
  expect((state.workspaceManager as any).getActiveId()).toBe("ws2");
  // Audited transition on the new workspace store.
  expect(audit.some((a) => a.e === "workspace.switch" && a.d.from === "default" && a.d.to === "ws2")).toBe(true);
});

test("workspace switch failure maps to stable 503 and preserves the previous workspace", async () => {
  const executor = {
    switchWorkspace: async () => { throw new WorkspaceSwitchFailedError("default", "bad", "activate_workspace", new Error("boom")); },
    get app() { return null; },
  };
  const { audit, state } = makeContext({ executor });
  const res = await call(switchRoute, state, "bad");

  expect(res.status).toBe(503);
  const body: any = await res.json();
  expect(body.error).toContain("failed during");
  expect(body.workspace.from).toBe("default");
  expect(body.workspace.to).toBe("bad");
  // Failure is observable in the audit log.
  expect(audit.some((a) => a.e === "workspace.switch_failed" && a.d.to === "bad")).toBe(true);
});

test("invalid/missing id returns 400", async () => {
  const { state } = makeContext({ executor: { switchWorkspace: async () => {} } });
  const res = await call(switchRoute, state, "");
  expect(res.status).toBe(400);
});
