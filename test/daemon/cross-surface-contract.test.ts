/**
 * Phase 6 — desktop ↔ mobile SAME-CONTRACT confirmation (V1 release).
 *
 * The companion API (V1-P5-001) is a wire-form adapter over the desktop
 * surfaces, not a second authority. This pins the cross-surface invariants
 * against the REAL dispatcher so drift in either direction fails loudly:
 *
 *   · approvals — /api/control/pending and /api/mobile/approvals list the
 *     SAME durable rows (mobile maps title←tool, summary←reason,
 *     workspace←surface); a decision made from EITHER surface resolves the
 *     row for BOTH and the second decision loses (first-wins), with the
 *     deciding actor recorded;
 *   · budget — /api/mobile/budget cents are exactly /api/budget's USD
 *     numbers ×100 (same store, same period boundaries, same persisted cap);
 *   · models — /api/mobile/models is (config.localModels.installed + the
 *     effective selection) and never empty by construction, matching the
 *     resolution order /api/models documents.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "xr-xsurface-"));
process.env.XR_HOME = join(process.env.HOME, "xr-home");
process.env.XR_AUDIT_LOG_DIR = join(process.env.HOME, "audit");

const TOKEN = "cross-surface-token-0123456789";
const BASE = "http://127.0.0.1:7849";
const auth = { authorization: `Bearer ${TOKEN}` };

let store!: import("../../src/state/workspace-store.ts").Store;
type Dispatch = ReturnType<typeof import("../../src/daemon/server.ts").makeHandler>;
let handler!: Dispatch;
let getApprovalStore!: typeof import("../../src/control/approval-store.ts").getApprovalStore;

beforeAll(async () => {
  const { prepareLan } = await import("../../src/cli/serve-lan.ts");
  const { makeHandler } = await import("../../src/daemon/server.ts");
  const { Store } = await import("../../src/state/workspace-store.ts");
  ({ getApprovalStore } = await import("../../src/control/approval-store.ts"));
  const lan = await prepareLan(0);
  store = new Store(join(process.env.HOME!, "xsurface.db"));
  handler = makeHandler(store, TOKEN, { lan: { cert: lan.cert } });
});

afterAll(() => {
  rmSync(process.env.HOME!, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("approvals — one durable plane, two wire forms, first decision wins", () => {
  test("both surfaces list the same row; mobile's mapping is faithful", async () => {
    getApprovalStore(store).request({
      tool: "shell",
      reason: "run the release checks",
      surface: "daemon",
      ttlMs: 60_000,
    });

    const desktop = await handler(get("/api/control/pending", auth));
    expect(desktop.status).toBe(200);
    const dBody = (await desktop.json()) as { pending: { id: string; tool: string; reason: string; surface: string }[] };
    expect(dBody.pending).toHaveLength(1);

    const mobile = await handler(get("/api/mobile/approvals", auth));
    expect(mobile.status).toBe(200);
    const mBody = (await mobile.json()) as { approvals: { id: string; title: string; summary: string; workspace: string; status: string }[] };
    expect(mBody.approvals).toHaveLength(1);

    expect(mBody.approvals[0]!.id).toBe(dBody.pending[0]!.id);
    expect(mBody.approvals[0]!.title).toBe(dBody.pending[0]!.tool);
    expect(mBody.approvals[0]!.summary).toBe(dBody.pending[0]!.reason);
    expect(mBody.approvals[0]!.workspace).toBe(dBody.pending[0]!.surface);
    expect(mBody.approvals[0]!.status).toBe("pending");
  });

  test("deciding from MOBILE resolves the row for BOTH surfaces; a later desktop decide cannot flip it", async () => {
    const before = (await (await handler(get("/api/control/pending", auth))).json()) as { pending: { id: string }[] };
    const id = before.pending[0]!.id;

    const mobileDecide = await handler(post(`/api/mobile/approvals/${id}`, { decision: "deny" }, auth));
    expect(mobileDecide.status).toBe(200);

    // Desktop sees the resolved state immediately — same store, no cache.
    const after = (await (await handler(get("/api/control/pending", auth))).json()) as { pending: unknown[] };
    expect(after.pending).toHaveLength(0);

    // First decision wins from ANY surface. The approvals plane (companion +
    // /api/approvals/:id/decision) reports the loss as 409; the CONTROL
    // surface (/api/control/approve) reports it as 200 {ok:false} — different
    // wire shapes, one invariant: the store only updates rows whose decision
    // is NULL, so a decided approval can never flip.
    const desktopDecide = await handler(post("/api/control/approve", { id, approved: true }, auth));
    expect(desktopDecide.status).toBe(200);
    const dBody = (await desktopDecide.json()) as { ok: boolean };
    expect(dBody.ok).toBe(false);

    const approvalsPlane = await handler(post(`/api/approvals/${id}/decision`, { approved: true }, auth));
    expect(approvalsPlane.status).toBe(409);

    // And the durable decision is still the mobile deny.
    const record = getApprovalStore(store).get(id);
    expect(record?.decision).toBe("denied");
  });

  test("deciding from DESKTOP resolves the row for the MOBILE surface too", async () => {
    const h = getApprovalStore(store).request({ tool: "write_file", reason: "save report", surface: "daemon", ttlMs: 60_000 });
    const desktopDecide = await handler(post("/api/control/approve", { id: h.id, approved: true }, auth));
    expect(desktopDecide.status).toBe(200);
    const mobile = (await (await handler(get("/api/mobile/approvals", auth))).json()) as { approvals: unknown[] };
    expect(mobile.approvals).toHaveLength(0);
  });
});

describe("budget — one authority, cents are exactly the desktop USD ×100", () => {
  test("mobile cents == desktop usage/burn/config ×100 (same store, same boundaries)", async () => {
    const desktop = await handler(get("/api/budget", auth));
    expect(desktop.status).toBe(200);
    const d = (await desktop.json()) as {
      config: { perTaskUsd: number };
      usage: { dayUsd: number; monthUsd: number };
      burn: { monthlyCap: number };
    };

    const mobile = await handler(get("/api/mobile/budget", auth));
    expect(mobile.status).toBe(200);
    const m = (await mobile.json()) as {
      spentTodayCents: number;
      spentMonthCents: number;
      monthCapCents: number;
      perTaskCents: number;
      currency: string;
      dailyCapCents?: number;
    };

    expect(m.spentTodayCents).toBe(Math.round(d.usage.dayUsd * 100));
    expect(m.spentMonthCents).toBe(Math.round(d.usage.monthUsd * 100));
    expect(m.monthCapCents).toBe(Math.round(d.burn.monthlyCap * 100));
    expect(m.perTaskCents).toBe(Math.round(d.config.perTaskUsd * 100));
    expect(m.currency).toBe("USD");
    // The governed budget has NO daily cap — the companion contract must not
    // fabricate one.
    expect(m.dailyCapCents).toBeUndefined();
  });
});

describe("models — the companion list is installed + effective selection, never empty", () => {
  test("mobile models match the /api/models resolution order", async () => {
    const desktop = await handler(get("/api/models", auth));
    const mobile = await handler(get("/api/mobile/models", auth));
    expect(mobile.status).toBe(200);
    const m = (await mobile.json()) as { models: { id: string; provider: string; local: boolean }[] };

    // Never empty by construction (the picker can always show the selection).
    expect(m.models.length).toBeGreaterThan(0);

    if (desktop.status === 200) {
      const d = (await desktop.json()) as { selected: { model: string }; runtimes?: { id: string; models?: { model: string }[] }[] };
      const selected = d.selected?.model;
      const installed = new Set<string>();
      for (const r of d.runtimes ?? []) for (const mo of r.models ?? []) installed.add(mo.model);
      for (const model of m.models) {
        // Every companion entry is either an installed local model or the
        // effective selection — never a fabricated catalog row.
        expect(installed.has(model.id) || model.id === selected).toBe(true);
      }
    }
  });
});
