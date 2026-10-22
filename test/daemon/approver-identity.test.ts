/**
 * XR-LAUNCH-030 — approvals record the SERVER-derived caller, never a
 * client-supplied identity.
 *
 * The daemon derives `actor` at its auth seam (src/daemon/server.ts):
 *   bearer token        → "local:token"
 *   dashboard session   → "browser:<first 12 hex of SHA-256(session id)>"
 *   paired phone        → "mobile:<device id>"
 * A body `userId` / `decidedBy` / `actorId` is accepted for compatibility and
 * ignored (it used to default to — or be trusted as — "admin"/"vscode").
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { BrowserSessions } from "../../src/daemon/session-auth.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";
import { businessRoutes } from "../../src/daemon/routes/business.routes.ts";
import type { DaemonRouteContext } from "../../src/daemon/routes/router.ts";

const TOKEN = "approver-identity-token-0123456789abcdef";
const BASE = "http://127.0.0.1:7842";

function fresh() {
  const tmp = mkdtempSync(join(tmpdir(), "xr-approver-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  const browser = new BrowserSessions();
  return { store, browser, h: makeHandler(store, TOKEN, { browser }) };
}

function pending(store: Store) {
  return getApprovalStore(store).request({ tool: "shell", reason: "run a build", surface: "daemon", ttlMs: 30_000 });
}

const decide = (id: string, headers: Record<string, string>, body: unknown) =>
  new Request(`${BASE}/api/approvals/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("XR-LAUNCH-030 · /api/approvals/:id/decision", () => {
  test("a bearer caller is recorded as local:token — a body userId cannot impersonate anyone", async () => {
    const { store, h } = fresh();
    const handle = pending(store);
    const res = await h(decide(handle.id, { authorization: `Bearer ${TOKEN}` }, { approved: true, userId: "admin" }));
    expect(res.status).toBe(200);
    expect((await handle.outcome).approved).toBe(true);
    expect(getApprovalStore(store).get(handle.id)?.decidedBy?.userId).toBe("local:token");
    expect(JSON.stringify(store.recentAudit(20))).not.toContain('"admin"');
  });

  test("a dashboard session is recorded as browser:<label>; the label is a digest, never the session id", async () => {
    const { store, browser, h } = fresh();
    const sid = browser.create();
    const handle = pending(store);
    const res = await h(decide(handle.id, { cookie: `xr_session=${sid}`, origin: BASE }, { approved: false, userId: "vscode" }));
    expect(res.status).toBe(200);
    const label = createHash("sha256").update(sid).digest("hex").slice(0, 12);
    const by = getApprovalStore(store).get(handle.id)?.decidedBy?.userId;
    expect(by).toBe(`browser:${label}`);
    expect(by).not.toContain(sid);
    expect(JSON.stringify(store.recentAudit(20))).not.toContain(sid);
  });

  test("two different browser sessions get two different labels", () => {
    const b = new BrowserSessions();
    const s1 = b.create();
    const s2 = b.create();
    const l1 = b.labelFromCookie(`xr_session=${s1}`, "xr_session");
    const l2 = b.labelFromCookie(`xr_session=${s2}`, "xr_session");
    expect(l1).toMatch(/^[0-9a-f]{12}$/);
    expect(l1).not.toBe(l2);
    expect(b.labelFromCookie("xr_session=not-a-session", "xr_session")).toBeNull();
  });
});

describe("XR-LAUNCH-030 · /api/control/approve", () => {
  test("the audit row names the server-derived caller", async () => {
    const { store, h } = fresh();
    const res = await h(
      new Request(`${BASE}/api/control/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ id: "no-such-approval", approved: true, userId: "admin" }),
      }),
    );
    expect(res.status).toBe(200);
    const row = store.recentAudit(20).find((r) => r.event === "control.approve.granted");
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.detail)).toMatchObject({ id: "no-such-approval", by: "local:token" });
  });
});

describe("XR-LAUNCH-030 · Business OS decisions", () => {
  function fakeBusiness() {
    const calls: Array<{ op: string; who: unknown }> = [];
    const os = {
      approvals: { decide: (_id: string, d: { decidedBy: unknown }) => (calls.push({ op: "decide", who: d.decidedBy }), { ok: true }) },
      workerGovernance: {
        setEnabled: (_id: string, on: boolean, a: { actorId: unknown }) => (calls.push({ op: on ? "enable" : "disable", who: a.actorId }), { ok: true }),
      },
    };
    return { calls, registry: { resolve: () => os } };
  }

  async function call(path: string, body: unknown, actor: string | undefined, registry: unknown) {
    const ctx = {
      json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
      req: new Request(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body) }),
      url: new URL(`${BASE}${path}`),
      path,
      method: "POST",
      token: "",
      host: "127.0.0.1",
      state: {},
      config: {},
      registry,
      ...(actor ? { actor } : {}),
    } as unknown as DaemonRouteContext;
    for (const r of businessRoutes()) {
      if (!r.match(ctx)) continue;
      const res = await r.handle(ctx);
      if (res) return res;
    }
    throw new Error(`no business route for ${path}`);
  }

  test("decidedBy / actorId come from the caller, not the body (no more 'admin' default)", async () => {
    const { calls, registry } = fakeBusiness();
    await call("/api/business/approvals/a1/decide", { decidedBy: "ceo", outcome: "approved" }, "browser:0123456789ab", registry);
    await call("/api/business/workers/w1/disable", { actorId: "ceo" }, "local:token", registry);
    await call("/api/business/workers/w1/enable", { actorId: "ceo" }, "mobile:dev-1", registry);
    await call("/api/business/approvals/a2/decide", { decidedBy: "ceo" }, undefined, registry);
    expect(calls).toEqual([
      { op: "decide", who: "browser:0123456789ab" },
      { op: "disable", who: "local:token" },
      { op: "enable", who: "mobile:dev-1" },
      { op: "decide", who: "anonymous" },
    ]);
  });
});
