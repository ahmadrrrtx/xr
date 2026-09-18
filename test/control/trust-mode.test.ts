/**
 * Phase 4 · Trust Modes — unit coverage for the approval-posture switch.
 *
 * Pins the safety property that matters most: high/critical risk tiers and
 * dangerous-declared permissions ALWAYS require approval — even in
 * "autonomous" — while "careful" widens the gate and "balanced" preserves
 * the historical tool-declared default.
 */
import { describe, expect, test, afterAll } from "bun:test";
import {
  approvalForMode,
  getTrustMode,
  isTrustMode,
  setTrustMode,
} from "../../src/control/trust-mode.ts";

describe("trust-mode validation", () => {
  test("accepts exactly the three documented modes", () => {
    expect(isTrustMode("careful")).toBe(true);
    expect(isTrustMode("balanced")).toBe(true);
    expect(isTrustMode("autonomous")).toBe(true);
    expect(isTrustMode("yolo")).toBe(false);
    expect(isTrustMode("")).toBe(false);
    expect(isTrustMode(undefined)).toBe(false);
  });
});

describe("approvalForMode gate mapping", () => {
  test("balanced = historical default (tool flag only)", () => {
    expect(approvalForMode("balanced", true, false, "low")).toBe(true);
    expect(approvalForMode("balanced", false, true, "low")).toBe(false);
    expect(approvalForMode("balanced", false, false, "high")).toBe(false);
  });

  test("careful widens: dangerous perms or mid+ tiers need approval", () => {
    expect(approvalForMode("careful", false, false, "medium")).toBe(true);
    expect(approvalForMode("careful", false, true, "low")).toBe(true);
    expect(approvalForMode("careful", false, false, "low")).toBe(false);
    expect(approvalForMode("careful", false, false, "unknown")).toBe(false);
  });

  test("autonomous relaxes base flags but NEVER the hard gate", () => {
    // base flag relaxed for benign tools:
    expect(approvalForMode("autonomous", true, false, "low")).toBe(false);
    // hard gate always holds:
    expect(approvalForMode("autonomous", false, false, "high")).toBe(true);
    expect(approvalForMode("autonomous", false, false, "critical")).toBe(true);
    expect(approvalForMode("autonomous", false, true, "low")).toBe(true);
  });
});

describe("trust-mode persistence", () => {
  afterAll(() => {
    // leave the machine on the documented default
    setTrustMode("balanced");
  });

  test("round-trips a mode change and returns to default", () => {
    const before = getTrustMode();
    expect(["careful", "balanced", "autonomous"]).toContain(before);
    expect(setTrustMode("careful")).toBe(true);
    expect(getTrustMode()).toBe("careful");
    expect(setTrustMode("balanced")).toBe(true);
    expect(getTrustMode()).toBe("balanced");
  });

  test("rejects invalid modes", () => {
    // @ts-expect-error deliberate invalid input
    expect(setTrustMode("yolo")).toBe(false);
  });
});
