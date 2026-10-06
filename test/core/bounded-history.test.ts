/**
 * Phase 14 — `boundedHistory`: prior turns the desktop sends with each chat
 * request are threaded into the model context, newest first, bounded by
 * turn count and characters, and never include anything but user/assistant.
 */
import { describe, expect, test } from "bun:test";

import { boundedHistory } from "../../src/core/agent";

describe("boundedHistory", () => {
  test("empty or missing history yields no messages", () => {
    expect(boundedHistory(undefined)).toEqual([]);
    expect(boundedHistory([])).toEqual([]);
  });

  test("keeps chronological order and drops system/blank/non-string turns", () => {
    const out = boundedHistory([
      { role: "system", content: "ignored" },
      { role: "user", content: "one" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "two" },
      { role: "tool", content: "ignored too" },
      // @ts-expect-error — a malformed turn from an older client
      { role: "user", content: 42 },
    ]);
    expect(out).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);
  });

  test("keeps the NEWEST turns when the turn cap is exceeded", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }));
    const out = boundedHistory(many);
    expect(out.length).toBeLessThan(many.length);
    expect(out.at(-1)).toEqual({ role: "assistant", content: "t59" });
    expect(out[0]!.content).toBe(`t${60 - out.length}`);
  });

  test("stops at the character budget, counting from the newest turn", () => {
    const big = "x".repeat(20_000);
    const out = boundedHistory([
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: "latest" },
    ]);
    // 20k + 20k + 6 exceeds the budget; the newest two fit, the oldest is cut.
    expect(out.map((m) => m.content.length)).toEqual([20_000, 6]);
  });
});
