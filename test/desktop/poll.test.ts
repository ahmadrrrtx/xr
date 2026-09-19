/**
 * Phase 1 · the polling hub (`desktop/src/poll.ts`).
 *
 * The hub replaced five independent `setInterval` pollers that fetched the same
 * engine endpoints on different schedules. These tests pin the properties that
 * made that state bad and the properties the hub promises instead:
 *
 *   · ONE request per key per cycle even with several subscribers  (cost)
 *   · every subscriber of a key sees the SAME observation           (consistency)
 *   · a failed fetch is reported as a failure, never as stale data  (honesty)
 *   · a stopped engine is not polled at full rate                   (backoff)
 *   · a hidden window does not poll; returning refreshes stale keys (desktop)
 *
 * The hub takes its clock, so these are deterministic — no sleeps, no flakes.
 */
import { describe, expect, test } from "bun:test";
import { Poller, type PollKey, type Timers } from "../../desktop/src/poll.ts";

/** A hand-cranked clock: `advance` runs exactly the timers that are due. */
function fakeClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Timers & { advance: (ms: number) => void } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = seq++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, timer] = due[0];
        timers.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = target;
    },
  };
  return clock;
}

const CADENCE: Record<PollKey, number> = {
  health: 1_000,
  providers: 10_000,
  pending: 1_000,
  approvals: 1_000,
  sessions: 1_000,
  agents: 2_000,
};

/** A loader per key that counts calls and resolves to the call number. */
function countingLoaders() {
  const calls = new Map<string, number>();
  const make = (key: string) => () => {
    const n = (calls.get(key) ?? 0) + 1;
    calls.set(key, n);
    return Promise.resolve(`${key}#${n}`);
  };
  return {
    calls,
    loaders: {
      health: make("health"),
      providers: make("providers"),
      pending: make("pending"),
      approvals: make("approvals"),
      sessions: make("sessions"),
      agents: make("agents"),
    } as Record<PollKey, () => Promise<unknown>>,
  };
}

/** Let the hub's promise callbacks run (they are microtasks, not timers). */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("poll hub · one scheduler for the whole shell", () => {
  test("fetches are deduplicated per key, and every subscriber sees the same value", async () => {
    const { loaders, calls } = countingLoaders();
    const clock = fakeClock();
    const poll = new Poller(loaders, CADENCE, clock);

    const a: unknown[] = [];
    const b: unknown[] = [];
    poll.subscribe(["health"], (o) => a.push(o.ok ? o.value : "ERR"));
    poll.subscribe(["health"], (o) => b.push(o.ok ? o.value : "ERR"));

    clock.advance(1_000); // the scheduler tick that makes the first fetch due
    await flush();

    // Two independent consumers, ONE request…
    expect(calls.get("health")).toBe(1);
    // …and identical observations, which is what the old per-component
    // intervals could not guarantee.
    expect(a).toEqual(["health#1"]);
    expect(b).toEqual(["health#1"]);

    clock.advance(1_000);
    await flush();
    expect(calls.get("health")).toBe(2);
    expect(a).toEqual(["health#1", "health#2"]);
    expect(b).toEqual(a);
  });

  test("a key nobody subscribes to is never fetched", async () => {
    const { loaders, calls } = countingLoaders();
    const clock = fakeClock();
    const poll = new Poller(loaders, CADENCE, clock);

    poll.subscribe(["pending"], () => {});
    clock.advance(5_000);
    await flush();

    expect(calls.get("pending")).toBeGreaterThan(0);
    expect(calls.get("providers")).toBeUndefined();
    expect(calls.get("sessions")).toBeUndefined();
  });

  test("the last subscriber leaving stops the scheduler (no orphan timer)", async () => {
    const { loaders, calls } = countingLoaders();
    const clock = fakeClock();
    const poll = new Poller(loaders, CADENCE, clock);

    const off = poll.subscribe(["health"], () => {});
    clock.advance(1_000);
    await flush();
    const afterFirst = calls.get("health");

    off();
    clock.advance(10_000);
    await flush();
    expect(calls.get("health")).toBe(afterFirst);
    expect(poll.stats().keys).toEqual([]);
  });

  test("a failed fetch is reported as a failure — never as stale success", async () => {
    const clock = fakeClock();
    const outcomes: string[] = [];
    const poll = new Poller(
      {
        health: () => Promise.resolve("ok"),
        providers: () => Promise.resolve(null),
        pending: () => Promise.reject(new Error("engine down")),
        approvals: () => Promise.resolve(null),
        sessions: () => Promise.resolve(null),
        agents: () => Promise.resolve(null),
      },
      CADENCE,
      clock,
    );
    poll.subscribe(["pending"], (o) => outcomes.push(o.ok ? "ok" : `ERR:${(o.error as Error).message}`));

    clock.advance(1_000);
    await flush();
    expect(outcomes).toEqual(["ERR:engine down"]);
  });

  test("failure backs off (bounded) and success resets the cadence", async () => {
    const clock = fakeClock();
    let mode: "fail" | "ok" = "fail";
    const calls: number[] = [];
    const poll = new Poller(
      {
        health: () => {
          calls.push(clock.now());
          return mode === "fail" ? Promise.reject(new Error("down")) : Promise.resolve("up");
        },
        providers: () => Promise.resolve(null),
        pending: () => Promise.resolve(null),
        approvals: () => Promise.resolve(null),
        sessions: () => Promise.resolve(null),
        agents: () => Promise.resolve(null),
      },
      CADENCE, // health cadence 1 s
      clock,
    );
    poll.subscribe(["health"], () => {});

    clock.advance(1_000);
    await flush(); // #1 fails → backoff ×2
    clock.advance(1_000);
    await flush(); // not due yet at 1 s cadence, still backed off
    expect(calls.length).toBe(1);

    clock.advance(1_000);
    await flush(); // due at 2 s → #2 fails → backoff ×3
    expect(calls.length).toBe(2);

    // A whole minute of further failure must stay bounded — the old code had no
    // notion of a dead engine at all and kept polling at full rate forever.
    clock.advance(60_000);
    await flush();
    expect(calls.length).toBeLessThan(30);

    // Recovery: once the engine answers, the cadence returns to normal.
    mode = "ok";
    poll.refresh(["health"]);
    await flush();
    const afterRecovery = calls.length;
    clock.advance(1_000);
    await flush();
    expect(calls.length).toBe(afterRecovery + 1);
  });

  test("refresh() forces an immediate fetch, refreshStale() only refreshes what is old", async () => {
    const { loaders, calls } = countingLoaders();
    const clock = fakeClock();
    const poll = new Poller(loaders, CADENCE, clock);
    poll.subscribe(["health", "providers"], () => {});

    poll.refresh(["health"]);
    await flush();
    expect(calls.get("health")).toBe(1);

    // providers (10 s cadence) was never run, so it IS stale → fetched once.
    poll.refreshStale();
    await flush();
    expect(calls.get("providers")).toBe(1);

    // health was just fetched → NOT stale → no extra request.
    poll.refreshStale();
    await flush();
    expect(calls.get("health")).toBe(1);
  });
});
