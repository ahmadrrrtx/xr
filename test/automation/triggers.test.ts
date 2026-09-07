/**
 * XR Phase 9 — governed trigger table: consent+budget, pause-all, due-check,
 * quiet hours, event notify, audit trail. Fire path is injected (the spine
 * seam); defaultFire is executeOnSurface and is not invoked here.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { TriggerService } from "../../src/automation/triggers.ts";
import {
  shouldFire,
  inQuietHours,
  validateTriggerInput,
  cronMatches,
  interpolateTask,
} from "../../src/automation/trigger-spec.ts";
import { TokenBucket, KeyedTokenBuckets } from "../../src/automation/token-bucket.ts";
import type { Trigger } from "../../src/automation/trigger-spec.ts";

let store: Store;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "xr-tr-"));
  process.env.XR_HOME = join(dir, "home");
  store = new Store(join(dir, "t.db"));
});

function cronTrigger(over: Partial<Trigger> = {}): Trigger {
  return {
    id: "tr_daily",
    kind: "cron",
    spec: { kind: "cron", expr: "* * * * *" },
    taskTemplate: "audit the repo",
    budget: { maxUsd: 0.1 },
    approvalMode: "inherit",
    enabled: true,
    consentRef: "cli:user:test",
    createdAt: 1,
    spentUsd: 0,
    spentTokens: 0,
    ...over,
  };
}

test("creating a trigger requires consent and a budget declaration", () => {
  const svc = new TriggerService(store, { skipReload: true, fire: async () => ({ stopped: "done" }) });
  expect(() =>
    svc.create({
      kind: "cron",
      spec: { kind: "cron", expr: "0 9 * * *" },
      taskTemplate: "x",
      budget: {},
      consentRef: "cli:user",
    } as any),
  ).toThrow(/budget/);
  expect(() =>
    svc.create({
      kind: "cron",
      spec: { kind: "cron", expr: "0 9 * * *" },
      taskTemplate: "x",
      budget: { maxUsd: 0.1 },
      consentRef: "",
    }),
  ).toThrow(/consent/);
  const t = svc.create({
    id: "morning",
    kind: "cron",
    spec: { kind: "cron", expr: "0 9 * * *" },
    taskTemplate: "audit",
    budget: { maxUsd: 0.1 },
    consentRef: "cli:user:1",
  });
  expect(t.id).toBe("morning");
  expect(store.recentAudit().some((e) => e.event === "trigger.created")).toBe(true);
});

test("validateSpec rejects structurally broken cron", () => {
  const bad = validateTriggerInput({
    kind: "cron",
    spec: { kind: "cron", expr: "0 9 * *" },
    taskTemplate: "x",
    budget: { maxUsd: 1 },
    consentRef: "c",
  });
  expect(bad.ok).toBe(false);
});

test("cronMatches understands 5-field expr", () => {
  const d = new Date("2026-09-07T09:00:00");
  expect(cronMatches("0 9 * * *", d)).toBe(true);
  expect(cronMatches("0 10 * * *", d)).toBe(false);
  expect(cronMatches("* * * * *", d)).toBe(true);
});

test("shouldFire respects pause, disable, quiet hours, and due-check", () => {
  const now = new Date("2026-09-07T09:00:00");
  expect(shouldFire(cronTrigger(), { pausedAll: true, now }).reason).toBe("paused");
  expect(shouldFire(cronTrigger({ enabled: false }), { pausedAll: false, now }).reason).toBe("disabled");
  expect(
    shouldFire(cronTrigger({ quietHours: { start: "08:00", end: "10:00" } }), { pausedAll: false, now }).reason,
  ).toBe("quiet");
  expect(shouldFire(cronTrigger(), { pausedAll: false, now }).fire).toBe(true);
  expect(shouldFire(cronTrigger({ spec: { kind: "cron", expr: "0 10 * * *" } }), { pausedAll: false, now }).reason).toBe(
    "not-due",
  );
});

test("inQuietHours wraps midnight", () => {
  const late = new Date("2026-09-07T23:30:00");
  const early = new Date("2026-09-07T06:00:00");
  const noon = new Date("2026-09-07T12:00:00");
  const qh = { start: "22:00", end: "07:00" };
  expect(inQuietHours(qh, late)).toBe(true);
  expect(inQuietHours(qh, early)).toBe(true);
  expect(inQuietHours(qh, noon)).toBe(false);
});

test("tick fires a due cron through the injected spine seam and audits", async () => {
  const fires: string[] = [];
  const svc = new TriggerService(store, {
    skipReload: true,
    now: () => Date.parse("2026-09-07T09:00:00Z"),
    fire: async ({ trigger, task, envelopeId }) => {
      fires.push(`${trigger.id}:${task}:${envelopeId}`);
      return { stopped: "done", sessionId: "s1", spentUsd: 0.01 };
    },
  });
  svc.create({
    id: "due",
    kind: "cron",
    spec: { kind: "cron", expr: "* * * * *" },
    taskTemplate: "ping {{triggerId}}",
    budget: { maxUsd: 0.05, maxTokens: 1000 },
    consentRef: "cli:user",
    approvalMode: "require",
  });
  const results = await svc.tick(Date.parse("2026-09-07T09:00:00Z"));
  expect(results[0]?.fired).toBe(true);
  expect(fires.length).toBe(1);
  expect(fires[0]).toContain("due:ping due:");
  const events = store.recentAudit().map((e) => e.event);
  expect(events).toContain("trigger.fired");
  expect(events).toContain("trigger.created");
  const row = svc.get("due")!;
  expect(row.lastEnvelopeId).toBeTruthy();
  expect(row.spentUsd).toBeCloseTo(0.01);
});

test("pause-all stops NEW fires and is visible; in-flight is not cancelled by pause", async () => {
  let release!: () => void;
  const started = new Promise<void>((r) => {
    release = r;
  });
  let entered = false;
  const svc = new TriggerService(store, {
    skipReload: true,
    now: () => Date.parse("2026-09-07T09:00:00Z"),
    fire: async () => {
      entered = true;
      await started;
      return { stopped: "done" };
    },
  });
  svc.create({
    id: "cron_a",
    kind: "cron",
    spec: { kind: "cron", expr: "* * * * *" },
    taskTemplate: "x",
    budget: { maxUsd: 0.1 },
    consentRef: "c",
  });
  const inflight = svc.tick(Date.parse("2026-09-07T09:00:00Z"));
  // Wait until fire started.
  for (let i = 0; i < 20 && !entered; i++) await Bun.sleep(5);
  expect(entered).toBe(true);
  expect(svc.inflightCount()).toBe(1);
  svc.pauseAll("test");
  expect(svc.isPausedAll()).toBe(true);
  const pausedTick = await svc.tick(Date.parse("2026-09-07T09:01:00Z"));
  expect(pausedTick.every((r) => r.reason === "paused" || r.inFlight)).toBe(true);
  release();
  const first = await inflight;
  expect(first[0]?.fired).toBe(true);
  expect(store.recentAudit().some((e) => e.event === "triggers.paused")).toBe(true);
  svc.resumeAll("test");
  expect(svc.isPausedAll()).toBe(false);
});

test("event triggers fire only via notify, never the tick", async () => {
  const fires: string[] = [];
  const svc = new TriggerService(store, {
    skipReload: true,
    fire: async ({ trigger }) => {
      fires.push(trigger.id);
      return { stopped: "done" };
    },
  });
  svc.create({
    id: "on_done",
    kind: "event",
    spec: { kind: "event", event: "session.done" },
    taskTemplate: "summarize",
    budget: { maxUsd: 0.01 },
    consentRef: "c",
  });
  const ticked = await svc.tick(Date.now());
  expect(ticked.every((r) => r.fired === false)).toBe(true);
  expect(fires).toEqual([]);
  const n = await svc.notify("session.done");
  expect(n[0]?.fired).toBe(true);
  expect(fires).toEqual(["on_done"]);
});

test("watch trigger fires when mtime is newer than lastFiredAt", async () => {
  const fires: string[] = [];
  const svc = new TriggerService(store, {
    skipReload: true,
    mtimeMs: () => 2_000,
    fire: async ({ trigger }) => {
      fires.push(trigger.id);
      return { stopped: "done" };
    },
  });
  svc.create({
    id: "watch1",
    kind: "watch",
    spec: { kind: "watch", path: "/tmp/x" },
    taskTemplate: "reload",
    budget: { maxTokens: 10 },
    consentRef: "c",
  });
  const r = await svc.tick(2_000);
  expect(r[0]?.fired).toBe(true);
  expect(fires).toEqual(["watch1"]);
  const r2 = await svc.tick(3_000);
  expect(r2[0]?.reason).toBe("not-due");
});

test("interpolateTask fills {{placeholders}}", () => {
  expect(interpolateTask("run {{id}} on {{env}}", { id: "a", env: "prod" })).toBe("run a on prod");
});

test("token bucket burst then refill", () => {
  const b = new TokenBucket(2, 1, 0);
  expect(b.take(1, 0)).toBe(true);
  expect(b.take(1, 0)).toBe(true);
  expect(b.take(1, 0)).toBe(false);
  expect(b.take(1, 1000)).toBe(true);
  const keyed = new KeyedTokenBuckets({ tokens: 1, refillPerSec: 0 });
  expect(keyed.allow("u1", 0)).toBe(true);
  expect(keyed.allow("u1", 0)).toBe(false);
  expect(keyed.allow("u2", 0)).toBe(true);
});
