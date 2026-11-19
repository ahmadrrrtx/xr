/**
 * Phase 4 — accounting truth (B7, B10).
 *
 *   • B10: an active reservation is renewed by a heartbeat while its step runs;
 *     the TTL sweep expires only reservations whose heartbeat went stale (a dead
 *     process). Clock values are injected, so a 130 s step is simulated exactly.
 *     The governor really runs the heartbeat timer while a reservation is open.
 *     The schema change is an idempotent, additive ALTER on older databases.
 *   • B7: admission still counts estimated usage; reporting separates it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ReservationRepo, type ReservationStoreLike } from "../../src/state/repos/reservation-repo.ts";
import { spendBreakdown } from "../../src/state/repos/cost-repo.ts";
import { CostGovernor } from "../../src/cost/governor.ts";
import { makeHandler } from "../../src/daemon/server.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "xr-accounting-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const caps = { monthlyCapUsd: null, dailyCapUsd: null, taskUsdCap: null, taskTokenCap: null };
const statusOf = (store: Store, id: string) => (store.query(`SELECT status FROM reservations WHERE id = ?1`).get(id) as { status: string }).status;

describe("B10 — reservation heartbeat", () => {
  test("a 130 s step that keeps renewing survives the sweep; a silent (dead) one expires", () => {
    const store = new Store(join(dir, "s.db"));
    const repo = new ReservationRepo(store);
    const live = repo.admit("env-live", 0.01, 100, caps);
    const dead = repo.admit("env-dead", 0.01, 100, caps);
    if (!live.ok || !dead.ok) throw new Error("admission failed");
    const t0 = Date.now(), ttl = 120_000;
    for (const at of [40_000, 80_000, 120_000]) repo.heartbeat(live.reservationId, t0 + at);
    store.releaseStaleReservations(ttl, t0 + 130_000);
    expect(statusOf(store, live.reservationId)).toBe("active");
    expect(statusOf(store, dead.reservationId)).toBe("expired");
    expect(repo.activeTotals().usd).toBeCloseTo(0.01, 9);
    // Once the live step stops renewing too (its process died), it expires on the next sweep.
    store.releaseStaleReservations(ttl, t0 + 250_000);
    expect(statusOf(store, live.reservationId)).toBe("expired");
    store.close();
  });

  test("a heartbeat never revives a settled or expired reservation", () => {
    const store = new Store(join(dir, "s.db"));
    const repo = new ReservationRepo(store);
    const r = repo.admit("env", 0.01, 100, caps);
    if (!r.ok) throw new Error("admission failed");
    repo.commit(r.reservationId, 0.005, 50);
    repo.heartbeat(r.reservationId);
    expect(statusOf(store, r.reservationId)).toBe("settled");
    store.close();
  });

  test("the governor renews the open reservation on a timer and stops once it is released", async () => {
    const beats: string[] = [];
    const fake: ReservationStoreLike = {
      admit: () => ({ ok: true, reservationId: "r-1" }),
      commit: () => {}, release: () => {}, releaseForEnv: () => {},
      activeTotals: () => ({ usd: 0, tokens: 0 }),
      heartbeat: (id) => { beats.push(id); },
      heartbeatIntervalMs: () => 15,
    };
    const g = new CostGovernor({}, { inPerMTok: 1, outPerMTok: 1 }, undefined, fake, "env-1");
    expect(g.checkBeforeStep().allow).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(new Set(beats)).toEqual(new Set(["r-1"]));
    g.releaseReservation();
    await new Promise((r) => setTimeout(r, 40));
    const settled = beats.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(beats.length).toBe(settled);
  });

  test("an older database gains last_heartbeat_at additively, and reopening is idempotent", () => {
    const path = join(dir, "old.db");
    const old = new Database(path);
    old.exec(`CREATE TABLE reservations (id TEXT PRIMARY KEY, env_id TEXT NOT NULL, est_usd REAL NOT NULL, est_tokens INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, actual_usd REAL, actual_tokens INTEGER)`);
    old.query(`INSERT INTO reservations (id, env_id, est_usd, est_tokens, status, created_at, updated_at) VALUES ('keep', 'e', 0.5, 10, 'settled', 1, 1)`).run();
    old.close();
    for (let i = 0; i < 2; i++) {
      const store = new Store(path);
      const cols = (store.query(`PRAGMA table_info(reservations)`).all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols.filter((c) => c === "last_heartbeat_at")).toHaveLength(1);
      expect(statusOf(store, "keep")).toBe("settled"); // existing rows untouched
      store.close();
    }
  });
});

describe("B7 — estimated usage is counted at admission and reported apart", () => {
  test("getSpendForPeriod counts both; the breakdown and GET /api/budget separate them", async () => {
    const store = new Store(join(dir, "s.db"));
    store.recordCost("s1", "openai", "gpt-6-luna", 1000, 100, 0.25, "provider");
    store.recordCost("voice", "openai", "tts-1", 0, 0, 0.1, "estimated");
    store.recordCost("s2", "mock", "m", 500, 50, 0.05, "estimated");
    expect(store.getSpendForPeriod(0)).toBeCloseTo(0.4, 9);
    const b = spendBreakdown(store, 0);
    expect(b.reported).toBeCloseTo(0.25, 9);
    expect(b.estimated).toBeCloseTo(0.15, 9);
    const res = await makeHandler(store, "acct-fixture")(new Request("http://127.0.0.1/api/budget", { headers: { authorization: "Bearer acct-fixture" } }));
    const body = (await res.json()) as { usage: { monthUsd: number; monthEstimatedUsd: number } };
    expect(body.usage.monthUsd).toBeCloseTo(0.4, 9);
    expect(body.usage.monthEstimatedUsd).toBeCloseTo(0.15, 9);
    store.close();
  });
});
