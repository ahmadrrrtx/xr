/**
 * XR Phase 02 — performance sanity gate (Task 2.20).
 *
 * NOT a benchmark and NOT a performance-optimization phase: this only asserts
 * that canonical path propagation did not introduce a pathological regression
 * on the two endpoints Phase 02 touched. The result is recorded PASS/FAIL
 * against a deliberately loose p95 budget (<500 ms); absolute numbers belong to
 * the Phase 00 baseline artifacts, not to this gate.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "phase02-perf-token";
const P95_BUDGET_MS = 500;
const SAMPLES = 20;

let handler: (req: Request) => Promise<Response> | Response;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-phase02-perf-"));
  process.env.XR_HOME = join(tmp, "home");
  handler = makeHandler(new Store(join(tmp, "d.db")), TOKEN);
});

afterAll(() => {
  delete process.env.XR_HOME;
});

async function p95(path: string): Promise<number> {
  const durations: number[] = [];
  // Warm-up: the first request pays module/DB init that is not per-request cost.
  await handler(new Request(`http://127.0.0.1${path}`, { headers: { authorization: `Bearer ${TOKEN}` } }));

  for (let i = 0; i < SAMPLES; i++) {
    const started = performance.now();
    const res = await handler(new Request(`http://127.0.0.1${path}`, { headers: { authorization: `Bearer ${TOKEN}` } }));
    await res.arrayBuffer(); // include body materialization
    durations.push(performance.now() - started);
    expect(res.status).toBe(200);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.min(durations.length - 1, Math.ceil(0.95 * durations.length) - 1)];
}

describe("Phase 02 performance sanity (PASS/FAIL only)", () => {
  for (const path of ["/api/v1/skills", "/api/v1/plugins", "/api/skills", "/api/plugins"]) {
    test(`${path} p95 < ${P95_BUDGET_MS}ms`, async () => {
      const value = await p95(path);
      // Recorded for the phase report; the assertion is the gate.
      console.log(`[perf-sanity] ${path} p95=${value.toFixed(1)}ms budget=${P95_BUDGET_MS}ms`);
      expect(value).toBeLessThan(P95_BUDGET_MS);
    });
  }

  test("the v1 mount adds no material overhead over the legacy mount", async () => {
    const [v1, legacy] = [await p95("/api/v1/skills"), await p95("/api/skills")];
    console.log(`[perf-sanity] mount delta: v1=${v1.toFixed(1)}ms legacy=${legacy.toFixed(1)}ms`);
    // Canonicalization is a string slice; allow generous slack for CI noise.
    expect(v1).toBeLessThan(Math.max(legacy * 3, 50));
  });
});
