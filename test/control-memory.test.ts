/**
 * XR v0.8.2 — tests for the plan-memory layer.
 *
 * All tests use a temp XR_HOME so they never touch the user's real DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import {
  fingerprintTask, isPlanRememberable, rememberPlan, recallPlan,
  listRemembered, forgetPlan, clearAllMemory,
} from "../src/control/memory.ts";
import type { Plan } from "../src/control/types.ts";

let tmp: string;
let prevHome: string | undefined;
let store: Store;

function makeStore(): Store {
  return new Store(join(tmp, "xr.db"));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-mem-test-"));
  prevHome = process.env.XR_HOME;
  process.env.XR_HOME = tmp;
  store = makeStore();
});

afterEach(() => {
  store.close();
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  rmSync(tmp, { recursive: true, force: true });
});

// ── fingerprint ─────────────────────────────────────────────────────────────

describe("fingerprintTask()", () => {
  it("normalizes punctuation and whitespace", () => {
    expect(fingerprintTask("Open GitHub!")).toBe(fingerprintTask("open github"));
    expect(fingerprintTask("  open   GITHUB  ")).toBe(fingerprintTask("Open GitHub"));
  });
  it("does NOT collapse semantically different tasks", () => {
    expect(fingerprintTask("open github")).not.toBe(fingerprintTask("open gitlab"));
  });
  it("returns a 'control:'-prefixed id", () => {
    expect(fingerprintTask("anything")).toMatch(/^control:[0-9a-f]+$/);
  });
});

// ── rememberable gates ──────────────────────────────────────────────────────

describe("isPlanRememberable()", () => {
  const plan = (actions: any[]): Plan => ({ task: "x", actions });

  it("accepts plain safe/sensitive plans", () => {
    const p = plan([
      { type: "browser", op: "goto", value: "https://example.com" },
      { type: "browser", op: "click", selector: "a" },
    ]);
    expect(isPlanRememberable(p).ok).toBe(true);
  });

  it("rejects plans with a sensitive value", () => {
    const p = plan([
      { type: "browser", op: "fill", selector: "#pw", value: "x", sensitive: true },
    ]);
    const r = isPlanRememberable(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("sensitive");
  });

  it("rejects plans with destructive actions", () => {
    const p = plan([
      { type: "key", keys: ["enter"] }, // Enter is destructive
    ]);
    const r = isPlanRememberable(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("destructive");
  });

  it("rejects empty plans", () => {
    expect(isPlanRememberable(plan([])).ok).toBe(false);
  });

  it("rejects plans over MAX_CACHED_ACTIONS", () => {
    const a: any = { type: "scroll", direction: "down", amount: 1 };
    const big = Array.from({ length: 25 }, () => a);
    expect(isPlanRememberable(plan(big)).ok).toBe(false);
  });
});

// ── remember / recall round-trip ────────────────────────────────────────────

describe("remember/recall round-trip", () => {
  const plan: Plan = {
    task: "open github and search xr",
    actions: [
      { type: "browser", op: "goto", value: "https://github.com" } as any,
      { type: "browser", op: "fill", selector: "input[name=q]", value: "xr" } as any,
    ],
  };

  it("refuses to remember unless allowMemory is true", () => {
    const r = rememberPlan(store, { task: plan.task, plan, allowMemory: false });
    expect(r.ok).toBe(false);
  });

  it("stores then recalls the same plan", () => {
    const r = rememberPlan(store, { task: plan.task, plan, allowMemory: true });
    expect(r.ok).toBe(true);

    const hit = recallPlan(store, plan.task);
    expect(hit).not.toBeNull();
    expect(hit!.task).toBe(plan.task);
    expect(hit!.actions.length).toBe(2);
    expect(hit!.actions[0].type).toBe("browser");
  });

  it("matches by normalized fingerprint, not raw string", () => {
    rememberPlan(store, { task: "Open GitHub", plan, allowMemory: true });
    expect(recallPlan(store, "  open   github!  ")).not.toBeNull();
  });

  it("misses on different tasks", () => {
    rememberPlan(store, { task: "open github", plan, allowMemory: true });
    expect(recallPlan(store, "open gitlab")).toBeNull();
  });

  it("bumps hit counter on recall", () => {
    rememberPlan(store, { task: "x", plan, allowMemory: true });
    const a = recallPlan(store, "x")!;
    const b = recallPlan(store, "x")!;
    expect(b.hits).toBe(a.hits + 1);
  });

  it("updates in place instead of creating duplicates", () => {
    rememberPlan(store, { task: "x", plan, allowMemory: true });
    const newer: Plan = { ...plan, actions: [...plan.actions, { type: "browser", op: "close" } as any] };
    const r2 = rememberPlan(store, { task: "x", plan: newer, allowMemory: true });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.reason).toBe("updated");
    expect(listRemembered(store).length).toBe(1);
    expect(recallPlan(store, "x")!.actions.length).toBe(3);
  });
});

// ── safety re-validation on recall ──────────────────────────────────────────

describe("recallPlan() — safety re-validation", () => {
  it("invalidates entries whose stored action no longer parses", () => {
    // Manually plant a corrupt cache payload.
    const skillId = fingerprintTask("ghost task");
    (store as any).db.query(`INSERT INTO skills (id,version,source,why,active,created_at) VALUES (?,1,'learned','x',1,?)`).run(skillId, Date.now());
    (store as any).db.query(`INSERT INTO frozen_baselines (id,skill_id,skill_version,steps_json,verifier_json,frozen_at) VALUES (?,?,1,?,?,?)`)
      .run("bad", skillId, JSON.stringify({ cacheVersion: 1, task: "ghost task", actions: [{ type: "totally_invalid" }], rememberedAt: Date.now(), hits: 0 }),
        JSON.stringify({ kind: "user_approved" }), Date.now());

    expect(recallPlan(store, "ghost task")).toBeNull();
  });
});

// ── list / forget / clear ───────────────────────────────────────────────────

describe("list/forget/clear", () => {
  const a: Plan = { task: "a", actions: [{ type: "browser", op: "goto", value: "https://a.com" } as any] };
  const b: Plan = { task: "b", actions: [{ type: "browser", op: "goto", value: "https://b.com" } as any] };

  it("lists all remembered plans", () => {
    rememberPlan(store, { task: "a", plan: a, allowMemory: true });
    rememberPlan(store, { task: "b", plan: b, allowMemory: true });
    expect(listRemembered(store).length).toBe(2);
  });

  it("forgets by task or by skillId", () => {
    rememberPlan(store, { task: "a", plan: a, allowMemory: true });
    rememberPlan(store, { task: "b", plan: b, allowMemory: true });
    expect(forgetPlan(store, "a").ok).toBe(true);
    expect(listRemembered(store).length).toBe(1);
    expect(recallPlan(store, "a")).toBeNull();
  });

  it("clearAllMemory wipes only control: entries", () => {
    rememberPlan(store, { task: "a", plan: a, allowMemory: true });
    rememberPlan(store, { task: "b", plan: b, allowMemory: true });
    // Insert a non-control skill — clear must NOT delete it.
    (store as any).db.query(`INSERT INTO skills (id,version,source,why,active,created_at) VALUES (?,1,'preloaded',null,1,?)`).run("normal-skill", Date.now());

    const n = clearAllMemory(store);
    expect(n).toBe(2);
    expect(listRemembered(store).length).toBe(0);
    const remaining = (store as any).db.query(`SELECT id FROM skills`).all() as Array<{ id: string }>;
    expect(remaining.some((r) => r.id === "normal-skill")).toBe(true);
  });
});
