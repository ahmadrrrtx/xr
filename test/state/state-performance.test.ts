/**
 * Phase 5 — state performance and identity (B8, B9, B11, B14).
 *
 *   • B8/B14: with ~20k audit rows and ~20k cost rows, opening the store stays
 *     within a generous bound; the first open in a process is one full pass, a
 *     later open verifies only rows after the process checkpoint;
 *   • tamper detection is not weakened: a recent row is caught at open, an old
 *     row by the background full pass (and by explicit verification), and a
 *     broken chain still refuses audit appends;
 *   • B9: the cost_events indexes exist and the spend window uses one;
 *   • B11: WorkspaceManager opens each workspace with its real id, and caches it.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { auditRowHash, openStats } from "../../src/state/audit-verify.ts";
import { WorkspaceManager } from "../../src/core/workspace.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "xr-state-perf-")), "state.db");

/** Append `n` valid chain rows straight into audit_log, continuing from the current head. */
function seedAudit(store: Store, n: number): void {
  const head = store.query(`SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`).get() as { hash: string } | null;
  let prev = head?.hash ?? "xr-genesis";
  const insert = store.query(`INSERT INTO audit_log (session_id, event, detail, prev_hash, hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`);
  store.transaction(() => {
    for (let i = 0; i < n; i++) {
      const row = { event: "seed.event", detail: JSON.stringify({ i }), created_at: 1_700_000_000_000 + i };
      const hash = auditRowHash(row, prev);
      insert.run(null, row.event, row.detail, prev, hash, row.created_at);
      prev = hash;
    }
  })();
}

describe("B8/B14 — open cost no longer grows with every construction", () => {
  test("20k audit + 20k cost rows: a later open is incremental and the whole path stays well inside the bound", () => {
    const path = fresh();
    const started = Date.now();
    const seed = new Store("ws", path);
    seedAudit(seed, 20_000);
    const cost = seed.query(`INSERT INTO cost_events (session_id, provider, model, in_tokens, out_tokens, usd, created_at, usage_source) VALUES (?1, 'p', 'm', 10, 1, 0.001, ?2, 'provider')`);
    seed.transaction(() => { for (let i = 0; i < 20_000; i++) cost.run(`s${i % 50}`, 1_700_000_000_000 + i); })();

    const first = new Store("ws", path); // first open after the history exists: one full pass
    expect(openStats).toEqual({ rows: 20_000, incremental: false });
    expect(first.auditChainCorrupted).toBe(false);
    const again = new Store("ws", path); // new chat / new instance: only rows after the checkpoint
    expect(openStats).toEqual({ rows: 0, incremental: true });
    expect(again.auditChainCorrupted).toBe(false);
    expect(again.getSpendForPeriod(0)).toBeCloseTo(20, 6);
    expect(Date.now() - started).toBeLessThan(20_000); // generous CI bound, not a micro-benchmark
    seed.close();
  });
});

describe("B8 — incremental verification does not weaken tamper detection", () => {
  test("a recent row edited after the checkpoint is caught at open, and appends are refused", () => {
    const path = fresh();
    const a = new Store("ws", path);
    seedAudit(a, 50);
    new Store("ws", path); // full pass → checkpoint at row 50
    seedAudit(a, 5);
    a.query(`UPDATE audit_log SET detail = '{"i":"forged"}' WHERE id = (SELECT MAX(id) FROM audit_log)`).run();
    const b = new Store("ws", path);
    expect(openStats.incremental).toBe(true);
    expect(b.auditChainCorrupted).toBe(true);
    expect(() => b.audit("after.tamper", {})).toThrow();
    a.close();
  });

  test("an OLD row edited behind the checkpoint is caught by the background full pass and by explicit verify", async () => {
    const path = fresh();
    const a = new Store("ws", path);
    seedAudit(a, 50);
    new Store("ws", path); // checkpoint at row 50
    a.query(`UPDATE audit_log SET detail = '{"i":"forged"}' WHERE id = 5`).run();
    const b = new Store("ws", path);
    expect(openStats).toEqual({ rows: 0, incremental: true });
    await new Promise((r) => setTimeout(r, 50)); // the scheduled background full pass
    expect(b.auditChainCorrupted).toBe(true);
    expect(new Store("ws", join(path)).chainStatus().valid).toBe(false); // explicit verification is a full pass
    a.close();
  });
});

describe("B9 — cost_events indexes", () => {
  test("both indexes exist, reopening is idempotent, and the spend window uses one", () => {
    const path = fresh();
    for (let i = 0; i < 2; i++) {
      const s = new Store("ws", path);
      const names = (s.query(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cost_events'`).all() as Array<{ name: string }>).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(["idx_cost_events_created", "idx_cost_events_session"]));
      const plan = (s.query(`EXPLAIN QUERY PLAN SELECT COALESCE(SUM(usd), 0) FROM cost_events WHERE created_at >= ?1`).all(0) as Array<{ detail: string }>).map((r) => r.detail).join(" ");
      expect(plan).toContain("idx_cost_events_created");
      s.close();
    }
  });
});

describe("B11 — workspace identity and the store cache", () => {
  test("getStore opens a workspace with its real id, returns one cached instance, and honours fresh/closed", () => {
    const wm = new WorkspaceManager();
    const id = `team-${Date.now()}`;
    const s1 = wm.getStore(id);
    expect(s1.workspaceId).toBe(id); // the path-only constructor forced "default"
    expect(wm.getStore(id)).toBe(s1);
    const independent = wm.getStore(id, { fresh: true });
    expect(independent).not.toBe(s1);
    expect(independent.workspaceId).toBe(id);
    independent.close(); // a fresh instance is its caller's to close; B17: an open workspace cannot be deleted
    s1.close();
    const reopened = wm.getStore(id);
    expect(reopened).not.toBe(s1);
    expect(reopened.isClosed).toBe(false);
    expect(wm.deleteWorkspace(id)).toBe(true);
  });
});
