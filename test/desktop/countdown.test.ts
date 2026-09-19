/**
 * Phase 1 · approval countdown: the renderer counts the ENGINE's deadline
 * down and never invents one.
 */
import { describe, expect, test } from "bun:test";
import { deadlineOf, formatRemaining, remainingMs, urgencyOf } from "../../desktop/src/countdown.ts";

describe("approval countdown · engine-owned deadline", () => {
  test("uses the engine's expiresAt when present, else requestedAt + ttlMs", () => {
    expect(deadlineOf({ expiresAt: 1_000 })).toBe(1_000);
    expect(deadlineOf({ requestedAt: 500, ttlMs: 300 })).toBe(800);
    expect(deadlineOf({ expiresAt: 1_000, requestedAt: 500, ttlMs: 300 })).toBe(1_000);
  });

  test("no TTL in the payload ⇒ null, never a made-up timer", () => {
    expect(deadlineOf({})).toBeNull();
    expect(deadlineOf({ requestedAt: 500 })).toBeNull();
    expect(deadlineOf({ ttlMs: 300 })).toBeNull();
    expect(remainingMs({}, 0)).toBeNull();
    expect(urgencyOf(null)).toBeNull();
  });

  test("remaining time is clamped at zero and urgency escalates at 60 s / 10 s / 0", () => {
    const d = { requestedAt: 0, ttlMs: 120_000 };
    expect(remainingMs(d, 0)).toBe(120_000);
    expect(urgencyOf(remainingMs(d, 0))).toBe("calm");
    expect(urgencyOf(remainingMs(d, 61_000))).toBe("soon");
    expect(urgencyOf(remainingMs(d, 111_000))).toBe("critical");
    expect(remainingMs(d, 500_000)).toBe(0);
    expect(urgencyOf(remainingMs(d, 500_000))).toBe("expired");
  });

  test("formatting rounds UP to whole seconds so the display never says 0:00 while time remains", () => {
    expect(formatRemaining(272_000)).toBe("4:32");
    expect(formatRemaining(7_000)).toBe("0:07");
    expect(formatRemaining(400)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
  });
});
