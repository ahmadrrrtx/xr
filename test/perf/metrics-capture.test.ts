/**
 * XR Phase 3 · T7 — streaming-metrics capture tests.
 *
 * The collector must:
 *   - record a turn with TTFT, tokens/s, token counts, high-water;
 *   - persist to the bounded JSONL log (cross-process reportability);
 *   - aggregate p50/p95 summary;
 *   - never record secrets: only provider/model ids + numbers (a probe
 *     asserting the JSONL lines contain no key-like strings);
 *   - wrap a provider via withTurnMetrics without changing its behavior.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, readFileSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import { StreamingMetricsCollector, withTurnMetrics } from "../../src/providers/stream-metrics.ts";
import type { ModelTurn, Provider } from "../../src/core/types.ts";

function fakeProvider(delayMs = 5): Provider {
  return {
    id: "test-provider",
    label: "Test",
    async chat(): Promise<ModelTurn> {
      await Bun.sleep(delayMs);
      return { message: "hello world", toolCalls: [], done: true, usage: { inTokens: 10, outTokens: 20 } };
    },
    async health() {
      return { ok: true };
    },
  };
}

describe("Phase 3 · T7 — streaming metrics capture", () => {
  test("records TTFT, tokens/s, token counts and persists to the bounded log", async () => {
    const home = join(tmpdir(), `xr-metrics-${process.pid}`);
    mkdirSync(home, { recursive: true });
    process.env.XR_HOME = home;
    const collector = new StreamingMetricsCollector();
    collector.reset();

    const wrapped = withTurnMetrics(fakeProvider(10), collector, "test-model");
    await wrapped.chat([], []);
    const recent = collector.recentTurns();
    expect(recent.length).toBe(1);
    const m = recent[0]!;
    expect(m.providerId).toBe("test-provider");
    expect(m.outTokens).toBe(20);
    expect(m.totalMs).toBeGreaterThanOrEqual(10);
    expect(m.tokensPerSec).toBeGreaterThan(0);
    expect(m.ttftMs).toBeGreaterThanOrEqual(0);

    const persisted = collector.persistedTurns();
    expect(persisted.length).toBe(1);
    const summary = collector.summary();
    expect(summary.turns).toBe(1);
    expect(summary.p95TtftMs).toBeGreaterThanOrEqual(0);
  });

  test("log lines contain no secret-like material (provider/model ids + numbers only)", async () => {
    const home = join(tmpdir(), `xr-metrics-${process.pid}-sec`);
    mkdirSync(home, { recursive: true });
    process.env.XR_HOME = home;
    const collector = new StreamingMetricsCollector();
    collector.reset();
    const wrapped = withTurnMetrics(fakeProvider(1), collector, "llama3:8b");
    await wrapped.chat([], []);
    const path = join(home, "cache", "metrics", "streaming.jsonl");
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    // Whitelist: only provider/model ids + numeric measurements may be logged.
    const allowedKeys = new Set(["providerId", "model", "ttftMs", "totalMs", "outTokens", "inTokens", "tokensPerSec", "cancelLatencyMs", "highWaterKb", "at"]);
    for (const k of Object.keys(parsed)) expect(allowedKeys.has(k), `unexpected metrics key: ${k}`).toBe(true);
    // And no secret-shaped values anywhere in the line.
    expect(lines[0]).not.toMatch(/(api[_-]?key|secret|bearer|authorization|sk-[a-z0-9]{8,})/i);
    expect(lines[0]).toContain("test-provider");
  });

  test("withTurnMetrics preserves provider behavior and failure paths", async () => {
    const collector = new StreamingMetricsCollector();
    const failing: Provider = {
      id: "fail-provider",
      label: "Fail",
      async chat() {
        throw new Error("boom");
      },
      async health() {
        return { ok: false, detail: "nope" };
      },
    };
    const wrapped = withTurnMetrics(failing, collector, "m");
    await expect(wrapped.chat([], [])).rejects.toThrow("boom");
    expect((await wrapped.health()).ok).toBe(false);
    // A failed turn is still recorded (with 0 tokens) — observability of failure.
    const rec = collector.recentTurns();
    expect(rec.some((r) => r.providerId === "fail-provider" && r.outTokens === 0)).toBe(true);
  });
});
