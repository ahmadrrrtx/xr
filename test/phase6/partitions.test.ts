/**
 * Phase 6 · Step 2 — PARTITION LEDGER properties (the F-12 kill suite).
 *
 * The acceptance line: "No workflow can spend more than its root envelope +
 * one in-flight reservation." Tested as ledger math, then again end-to-end
 * through the real loop in worker-budget.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { PartitionRepo, ROOT_CHILD_ID } from "../../src/state/repos/partition-repo.ts";

let tmp: string;
let store: WorkspaceStore;
let repo: PartitionRepo;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-part-"));
  store = new WorkspaceStore(join(tmp, "xr.db"));
  repo = new PartitionRepo(store, 250); // short TTL for the expiry tests
});
afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

const children = (n: number, w = 1) =>
  Array.from({ length: n }, (_, i) => ({ childId: `t_${i}`, weight: w }));

describe("partition math — the root invariant", () => {
  test("Σ child caps ≤ root cap for a spread of weights and sizes (property)", () => {
    for (const [count, weights, rootUsd] of [
      [5, [1, 2, 3, 4, 5], 0.5],
      [7, [0.4, 0.5, 1, 2, 2.5, 3, 1], 0.123456789],
      [2, [1, 1], 0.03],
      [11, Array.from({ length: 11 }, (_, i) => 1 + i * 0.37), 2.0],
    ] as Array<[number, number[], number]>) {
      const wfId = `wf_p${count}_${weights.length}_${rootUsd}`;
      repo.openTask(wfId, { capUsd: rootUsd, capTokens: 100_000 });
      const r = repo.partition(
        wfId,
        weights.map((w, i) => ({ childId: `t_${i}`, weight: w })),
        { floorUsd: 0, floorTokens: 1000 },
      );
      const sum = r.children.filter((c) => c.childId !== ROOT_CHILD_ID).reduce((s, c) => s + c.capUsd, 0);
      expect(sum).toBeLessThanOrEqual(rootUsd + 1e-9);
      for (const c of r.children.filter((x) => x.childId !== ROOT_CHILD_ID)) expect(c.capTokens).toBeGreaterThan(0);
      // Unallocated remainder stays headroom (fragment-edit funding pool).
      expect(r.headroom.usd).toBeGreaterThanOrEqual(0);
    }
  });

  test("a root the template floors cannot fund DENIES the child — no silent zero-slice run", () => {
    repo.openTask("wf_tiny", { capUsd: 0.005, capTokens: 100_000 });
    const r = repo.partition("wf_tiny", children(5), { floorUsd: 0.01, floorTokens: 1000 });
    expect(r.denied.length).toBeGreaterThan(0);
    // Admitting on an unfunded child fails closed.
    const a = repo.admit("wf_tiny", r.denied[0]!.childId, 0.001, 100);
    expect(a.ok).toBe(false);
  });

  test("re-partition is an idempotent MERGE — a resume never re-cuts live caps", () => {
    repo.openTask("wf_idem", { capUsd: 1, capTokens: 40_000 });
    const first = repo.partition("wf_idem", children(3), { floorUsd: 0.01, floorTokens: 1000 });
    // One child has spent:
    const spend = repo.admit("wf_idem", "t_0", 0.05, 500);
    expect(spend.ok).toBe(true);
    if (spend.ok) repo.commit("wf_idem", "t_0", spend.reservationId, 0.06, 600);
    const second = repo.partition("wf_idem", children(3, 99), { floorUsd: 0.01, floorTokens: 1000 });
    expect(second.children).toHaveLength(first.children.length);
    const t0 = second.children.find((c) => c.childId === "t_0")!;
    expect(t0.capUsd).toBe(first.children.find((c) => c.childId === "t_0")!.capUsd); // UNCHANGED
    expect(t0.consumedUsd).toBeCloseTo(0.06, 10); // spend preserved
  });
});

describe("admission — child ceiling, root ceiling, in-flight honesty", () => {
  test("an admitted step may overshoot once; the NEXT admission denies", () => {
    repo.openTask("wf_ceil", { capUsd: 0.01, capTokens: 20_000 });
    repo.partition("wf_ceil", [{ childId: "t_0", weight: 1 }], { floorUsd: 0.01, floorTokens: 20_000 });
    const a1 = repo.admit("wf_ceil", "t_0", 0.01, 19_000); // fits exactly
    expect(a1.ok).toBe(true);
    if (a1.ok) repo.commit("wf_ceil", "t_0", a1.reservationId, 0.02, 40_000); // ACTUAL overshoot — settled, never clawed back
    const a2 = repo.admit("wf_ceil", "t_0", 0.001, 1000);
    expect(a2.ok).toBe(false); // ceiling reached
    if (!a2.ok) expect(a2.reason).toMatch(/ceiling reached/);
  });

  test("a corrupted/legacy inflated child cap cannot trample the root for its siblings", () => {
    // Σ child caps ≤ root by CONSTRUCTION, so the root row is a backstop: it
    // fires when a partition's stored cap exceeds its fair share (pre-P6 row,
    // manual DB edit) — exactly the F-12 shape this phase kills.
    repo.openTask("wf_root", { capUsd: 0.1, capTokens: 100_000 });
    repo.partition("wf_root", children(2), { floorUsd: 0.04, floorTokens: 40_000 });
    store.query("UPDATE budget_partitions SET cap_usd = 0.09 WHERE task_id = ? AND child_id = ?").run("wf_root", "t_0");
    const a = repo.admit("wf_root", "t_0", 0.09, 40_000); // inside the INFLATED usd cap AND the token slice — only USD can trample here
    expect(a.ok).toBe(true);
    if (a.ok) repo.commit("wf_root", "t_0", a.reservationId, 0.09, 40_000);
    // Sibling t_1 stays inside its OWN cap — but the root is spent. The backstop denies.
    const b = repo.listPartitions("wf_root").find((r) => r.childId === "t_1")!;
    expect(b.consumedUsd).toBe(0);
    const over = repo.admit("wf_root", "t_1", 0.02, 1000);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toMatch(/root envelope/);
  });

  test("un-partitioned children are REFUSED (a wiring bug cannot spend)", () => {
    repo.openTask("wf_nofund", { capUsd: 5, capTokens: 50_000 });
    const a = repo.admit("wf_nofund", "t_ghost", 0.01, 1000);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/never funded/);
  });

  test("release returns reserved headroom; settle-once semantics on commit", () => {
    repo.openTask("wf_rel", { capUsd: 0.02, capTokens: 20_000 });
    repo.partition("wf_rel", [{ childId: "t_0", weight: 1 }], { floorUsd: 0.02, floorTokens: 20_000 });
    const a = repo.admit("wf_rel", "t_0", 0.02, 20_000);
    expect(a.ok).toBe(true);
    if (a.ok) {
      repo.release("wf_rel", "t_0", a.reservationId);
      repo.commit("wf_rel", "t_0", a.reservationId, 0.02, 20_000); // double-settle must be a no-op
    }
    const rows = repo.listPartitions("wf_rel");
    expect(rows.find((r) => r.childId === "t_0")!.consumedUsd).toBe(0);
    const again = repo.admit("wf_rel", "t_0", 0.02, 20_000); // released → headroom restored
    expect(again.ok).toBe(true);
  });
});

describe("crash honesty — kill between admit and commit cannot double-spend", () => {
  test("stale in-flight estimates expire on the next admission; settled spend survives reopen", async () => {
    repo.openTask("wf_crash", { capUsd: 0.05, capTokens: 50_000 });
    repo.partition("wf_crash", [{ childId: "t_0", weight: 1 }], { floorUsd: 0.05, floorTokens: 50_000 });
    // Admit + settle one real step…
    const a = repo.admit("wf_crash", "t_0", 0.01, 1000);
    if (a.ok) repo.commit("wf_crash", "t_0", a.reservationId, 0.01, 1000);
    // …then admit and CRASH before commit (row left 'active').
    const b = repo.admit("wf_crash", "t_0", 0.01, 1000);
    expect(b.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 320)); // past the 250ms TTL
    store.close();
    // RESTART: fresh store, fresh ledger view — resume re-asks the model.
    store = new WorkspaceStore(join(tmp, "xr.db"));
    repo = new PartitionRepo(store, 250);
    const rows = repo.listPartitions("wf_crash");
    expect(rows.find((x) => x.childId === "t_0")!.consumedUsd).toBeCloseTo(0.01, 10); // real spend survived
    const after = repo.admit("wf_crash", "t_0", 0.03, 3000); // orphaned estimate swept by TTL at admit time
    expect(after.ok).toBe(true); // no phantom reservation blocks legitimate work
    if (after.ok) repo.commit("wf_crash", "t_0", after.reservationId, 0.03, 3000);
    const over = repo.admit("wf_crash", "t_0", 0.001, 100); // 0.01+0.03 of 0.05 spent; next tiny step is still within root+child… but:
    expect(over.ok).toBe(true); // 0.041 fits; the 0.05 ceiling bites at the NEXT one
    if (over.ok) repo.commit("wf_crash", "t_0", over.reservationId, 0.011, 100);
    const denied = repo.admit("wf_crash", "t_0", 0.001, 1);
    expect(denied.ok).toBe(false);
  });

  test("closed tree refuses every admission", () => {
    repo.openTask("wf_closed", { capUsd: 1, capTokens: 50_000 });
    repo.partition("wf_closed", children(2), { floorUsd: 0.01, floorTokens: 1000 });
    repo.close("wf_closed");
    expect(repo.admit("wf_closed", "t_0", 0.01, 100).ok).toBe(false);
  });
});

describe("headroom — the fragment-edit funding pool", () => {
  test("unallocated root remainder is exactly the headroom edits may draw from", () => {
    repo.openTask("wf_head", { capUsd: 1.0, capTokens: 100_000 });
    const r = repo.partition("wf_head", [{ childId: "t_a", weight: 1 }, { childId: "t_b", weight: 1 }, { childId: "t_c", weight: 1 }], {
      floorUsd: 0.01,
      floorTokens: 1000,
    });
    const allocated = r.children.filter((c) => c.childId !== ROOT_CHILD_ID).reduce((s, c) => s + c.capUsd, 0);
    expect(allocated + r.headroom.usd).toBeCloseTo(1.0, 6);
    expect(r.headroom.usd).toBeGreaterThan(0); // thirds cannot split a dollar exactly
  });
});
