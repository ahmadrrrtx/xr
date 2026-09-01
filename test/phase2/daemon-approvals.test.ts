/**
 * XR Phase 2 · F-11 — daemon approval endpoints, route-level tests.
 *
 * GET  /api/approvals                 → durable pending list (cross-surface)
 * POST /api/approvals/:id/decision    → 400 missing approved / 404 unknown /
 *                                        409 decided-or-timed-out / 200 ok
 *
 * A request raised in THIS process (the daemon's own chat surface) must appear
 * in the list and be decidable through the endpoint, resolving the raiser's
 * waiter — the canonical remote-consent loop.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { ApprovalStore, getApprovalStore, resetApprovalStores } from "../../src/control/approval-store.ts";
import { approvalRoutes } from "../../src/daemon/routes/approvals.routes.ts";
import type { DaemonRouteContext, DaemonRouteHandler } from "../../src/daemon/routes/router.ts";

let tmp: string;
let store: WorkspaceStore;
let listHandle: DaemonRouteHandler;
let decideHandle: DaemonRouteHandler;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p2-daemon-ap-"));
  resetApprovalStores();
  store = new WorkspaceStore("w", join(tmp, "xr.db"));
  const routes = approvalRoutes();
  listHandle = routes[0].handle;
  decideHandle = routes[1].handle;
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** Invoke a route handler; every call in this suite must produce a response. */
async function callHandle(h: DaemonRouteHandler, c: DaemonRouteContext): Promise<Response> {
  const res = await h(c);
  if (!res) throw new Error("route handler returned null");
  return res;
}

function ctx(extra: Partial<DaemonRouteContext> = {}): DaemonRouteContext {
  return {
    json,
    state: { store, workspaceManager: {}, shield: {} } as any,
    config: undefined as any, // absent → schema defaults must apply
    req: new Request("http://x/api/approvals"),
    url: new URL("http://x/api/approvals"),
    path: "/api/approvals",
    method: "GET",
    token: "",
    host: "x",
    ...extra,
  } as DaemonRouteContext;
}

describe("daemon durable approval endpoints", () => {
  test("GET /api/approvals lists a durable pending request raised on the daemon surface", async () => {
    const approvals = new ApprovalStore(store);
    const handle = approvals.request({
      tool: "write_file",
      reason: "create a config file",
      args: { path: "cfg.json" },
      surface: "daemon",
      riskTier: "tier1",
      ttlMs: 30_000,
    });

    const res = await callHandle(listHandle, ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: Array<{ id: string; tool: string; riskTier: string; ttlMs: number; expiresAt: number }>;
    };
    expect(body.pending.map((p) => p.id)).toContain(handle.id);
    const entry = body.pending.find((p) => p.id === handle.id)!;
    expect(entry.tool).toBe("write_file");
    expect(entry.riskTier).toBe("tier1");
    expect(entry.ttlMs).toBe(30_000);
    expect(entry.expiresAt).toBeGreaterThan(entry.ttlMs);
  });

  test("POST decision approves the record and resolves the raiser's waiter", async () => {
    const approvals = getApprovalStore(store); // same cached instance the route uses
    const handle = approvals.request({
      tool: "shell",
      reason: "run a build",
      surface: "daemon",
      ttlMs: 30_000,
    });

    const res = await callHandle(decideHandle,
      ctx({
        path: `/api/approvals/${handle.id}/decision`,
        req: new Request("http://x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: true, userId: "op-1" }),
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decision: "approved" });

    const outcome = await handle.outcome;
    expect(outcome.approved).toBe(true);
    expect(outcome.decidedBy?.channel).toBe("daemon");
    expect(approvals.get(handle.id)?.decidedBy?.userId).toBe("op-1");

    // Decided records leave the pending list.
    const list = (await (await callHandle(listHandle, ctx())).json()) as { pending: unknown[] };
    expect(list.pending).toHaveLength(0);
  });

  test("400 when `approved` is missing", async () => {
    const res = await callHandle(decideHandle,
      ctx({
        path: "/api/approvals/anything/decision",
        req: new Request("http://x", { method: "POST", body: "{}" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("404 for an unknown approval id", async () => {
    const res = await callHandle(decideHandle,
      ctx({
        path: "/api/approvals/ap_doesnotexist/decision",
        req: new Request("http://x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: true }),
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test("409 when the record is already decided (first writer wins)", async () => {
    const approvals = new ApprovalStore(store);
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "daemon", ttlMs: 30_000 });
    approvals.decide(handle.id, false, { channel: "cli" });

    const res = await callHandle(decideHandle,
      ctx({
        path: `/api/approvals/${handle.id}/decision`,
        req: new Request("http://x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: true }),
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { decision: string }).decision).toBe("denied");
  });

  test("an unanswered request hits the TTL and the endpoint then reports 409 (never stuck)", async () => {
    const approvals = new ApprovalStore(store, { defaultTtlMs: 120 });
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "daemon", ttlMs: 120 });
    const outcome = await handle.outcome;
    expect(outcome.timedOut).toBe(true);

    const res = await callHandle(decideHandle,
      ctx({
        path: `/api/approvals/${handle.id}/decision`,
        req: new Request("http://x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: true }),
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { decision: string }).decision).toBe("timed_out");
  });
});
