/**
 * Phase 03 · T3.11 + T3.24 — Execution Lane Queue tests.
 *
 * Proves the single-writer semantics that keep CLI/dashboard/chat runs on the
 * SAME session/workspace from corrupting transcript/checkpoint state:
 *   · same key → serialized (never concurrent)
 *   · different keys → concurrent (not globally serialized)
 *   · bounded wait → LaneBusyError (→ 429 at the HTTP edge)
 *   · cancellation while queued → no phantom execution
 */
import { test, expect } from "bun:test";
import {
  ExecutionLaneQueue,
  LaneBusyError,
  LANE_DEFAULT_TIMEOUT_MS,
} from "../../src/execution/lane.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("same key is serialized (second run starts only after the first completes)", async () => {
  const q = new ExecutionLaneQueue();
  const order: string[] = [];
  const p1 = q.runExclusive("ws1", async () => {
    order.push("A-start");
    await sleep(20);
    order.push("A-end");
    return 1;
  });
  const p2 = q.runExclusive("ws1", async () => {
    order.push("B-start");
    order.push("B-end");
    return 2;
  });
  const results = await Promise.all([p1, p2]);
  expect(results).toEqual([1, 2]);
  // B must never interleave with A's body.
  expect(order).toEqual(["A-start", "A-end", "B-start", "B-end"]);
});

test("different keys run concurrently (not globally serialized)", async () => {
  const q = new ExecutionLaneQueue();
  const order: string[] = [];
  const a = q.runExclusive("wsA", async () => {
    order.push("A-start");
    await sleep(30);
    order.push("A-end");
  });
  // Give A a head start so it is active before B starts.
  await sleep(5);
  const b = q.runExclusive("wsB", async () => {
    order.push("B-start");
    order.push("B-end");
  });
  await Promise.all([a, b]);
  // B started before A ended → concurrency across keys.
  expect(order).toContain("B-start");
  expect(order.indexOf("B-start")).toBeLessThan(order.indexOf("A-end"));
});

test("queued task times out with LaneBusyError (retryable)", async () => {
  const q = new ExecutionLaneQueue();
  let release!: () => void;
  const p1 = q.runExclusive("ws1", () => new Promise<void>((res) => { release = res; }));
  const p2 = q
    .runExclusive("ws1", async () => "never", { timeoutMs: 40 })
    .then(() => "resolved")
    .catch((e) => e);
  await sleep(60);
  const outcome = await p2;
  expect(outcome).toBeInstanceOf(LaneBusyError);
  expect((outcome as LaneBusyError).retryable).toBe(true);
  expect((outcome as LaneBusyError).key).toBe("ws1");
  release();
  await p1;
});

test("cancellation while queued rejects with AbortError and no phantom run", async () => {
  const q = new ExecutionLaneQueue();
  let release!: () => void;
  const p1 = q.runExclusive("ws1", () => new Promise<void>((res) => { release = res; }));
  const ac = new AbortController();
  const ran: string[] = [];
  const p2 = q
    .runExclusive("ws1", async () => { ran.push("ran"); return "ran"; }, { signal: ac.signal })
    .then(() => "resolved")
    .catch((e) => e);
  ac.abort();
  await sleep(5);
  const outcome = await p2;
  expect((outcome as Error).name).toBe("AbortError");
  expect(ran).toEqual([]); // the queued task never executed
  release();
  await p1;
});

test("acquire returns a release that frees the lane (reservation pattern for 429)", async () => {
  const q = new ExecutionLaneQueue();
  const release = await q.acquire("ws1", { timeoutMs: 100 });
  expect(q.isActive("ws1")).toBe(true);
  const waiting = q
    .acquire("ws1", { timeoutMs: 2000 })
    .then(() => "got-lane")
    .catch((e) => e);
  // Busy until release is called.
  expect(q.queueDepth("ws1")).toBe(1);
  release();
  expect(await waiting).toBe("got-lane");
});

test("LANE_DEFAULT_TIMEOUT_MS targets the 30s bound", () => {
  expect(LANE_DEFAULT_TIMEOUT_MS).toBe(30_000);
});
