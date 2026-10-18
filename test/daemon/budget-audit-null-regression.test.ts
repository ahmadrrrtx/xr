/**
 * Phase 34 · R2 (P1-6) regression — the audit's exact forward path.
 *
 * test/daemon/body-strictness.test.ts pins the strictness REVERSAL itself
 * (v1 400 + legacy header), but not what used to happen next: the failed
 * request persisted a phantom `budget.update` audit event whose per-field
 * detail was all null — the `audit:null` line. This test proves the chain
 * end-to-end: v1 400 on `{"usd": 50}` → NO `budget.update` event exists,
 * and a subsequent valid set audits normally — so a future refactor of
 * validateBody/store can never quietly drift back to "200 + null".
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHandler } from "../../src/daemon/server.ts";
import { Store } from "../../src/state/workspace-store.ts";

const TOKEN = "phase34-budget-audit-null-token";

let server: ReturnType<typeof Bun.serve>;
let base: string;
let store: Store;
let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-phase34-budget-null-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

const authed = { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const budgetUpdates = () => store.recentAudit(100).filter((e) => e.event === "budget.update");

describe("budget.set audit:null regression (P1-6)", () => {
  test("v1 rejects {\"usd\":50}; NO phantom budget.update event is persisted", async () => {
    const res = await fetch(`${base}/api/v1/budget/set`, { // same route the audit hit
      method: "POST",
      headers: authed,
      body: JSON.stringify({ usd: 50 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors?: { path: string }[] };
    expect(body.errors?.[0]?.path).toBe("usd");
    // The rejected body must not have reached the handler at all: zero
    // budget.update audit events on a fresh store (the phantom line was the bug).
    expect(budgetUpdates()).toEqual([]);
  });

  test("a subsequent VALID set persists + audits normally — strictness never blocks the real path", async () => {
    const res = await fetch(`${base}/api/v1/budget/set`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ perTaskUsd: 5 }),
    });
    expect(res.status).toBe(200);
    const events = budgetUpdates();
    expect(events).toHaveLength(1);
    const detail = JSON.parse(events[0].detail) as { perTaskUsd?: number };
    expect(detail.perTaskUsd).toBe(5);
  });
});
