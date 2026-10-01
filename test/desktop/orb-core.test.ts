/**
 * Phase 6 · orb primitives (desktop/src/lib/orbCore.ts).
 *
 * Pure logic only — window ops, native menus and IPC are covered by the
 * Rust unit tests (commands/orb.rs) and the Playwright pass. Includes the
 * negative branches, per house rule: a gate that cannot fail is decoration.
 */
import { describe, expect, test } from "bun:test";

import {
  CLICK_PREVIEW_MS,
  DOUBLE_CLICK_MS,
  DRAG_THRESHOLD_PX,
  ERROR_REVERT_MS,
  ORB_STATES,
  SLEEP_MS_DEFAULT,
  glowIntensityFor,
  isOrbState,
  parseDevMs,
} from "../../desktop/src/lib/orbCore.ts";

describe("Phase 6 · orb states", () => {
  test("all 7 canonical states validate", () => {
    for (const state of ORB_STATES) {
      expect(isOrbState(state)).toBe(true);
    }
    expect(ORB_STATES).toHaveLength(7);
  });

  test("unknown states are rejected", () => {
    expect(isOrbState("listening-hard")).toBe(false);
    expect(isOrbState("")).toBe(false);
    expect(isOrbState(null)).toBe(false);
    expect(isOrbState(42)).toBe(false);
  });
});

describe("Phase 6 · glow intensity per theme", () => {
  test("dark themes keep the full signature glow", () => {
    for (const theme of ["xr-native", "midnight", "graphite"]) {
      expect(glowIntensityFor(theme)).toBe(1);
    }
  });

  test("light themes dim the glow (user prefers calm light UIs)", () => {
    expect(glowIntensityFor("paper")).toBeLessThan(1);
    expect(glowIntensityFor("arctic")).toBeLessThan(1);
  });

  test("unknown themes default to full glow", () => {
    expect(glowIntensityFor("hotdog")).toBe(1);
    expect(glowIntensityFor("")).toBe(1);
  });
});

describe("Phase 6 · dev overrides", () => {
  test("null and garbage fall back", () => {
    expect(parseDevMs(null, SLEEP_MS_DEFAULT)).toBe(SLEEP_MS_DEFAULT);
    expect(parseDevMs("soon", SLEEP_MS_DEFAULT)).toBe(SLEEP_MS_DEFAULT);
    expect(parseDevMs("", SLEEP_MS_DEFAULT)).toBe(SLEEP_MS_DEFAULT);
  });

  test("values clamp to a sane range", () => {
    expect(parseDevMs("0", SLEEP_MS_DEFAULT)).toBe(250);
    expect(parseDevMs("-5000", SLEEP_MS_DEFAULT)).toBe(250);
    expect(parseDevMs("999999999", SLEEP_MS_DEFAULT)).toBe(3_600_000);
  });

  test("valid overrides pass through", () => {
    expect(parseDevMs("3000", SLEEP_MS_DEFAULT)).toBe(3000);
  });
});

describe("Phase 6 · interaction constants (plan §6–7)", () => {
  test("inactivity sleeps after 30 minutes", () => {
    expect(SLEEP_MS_DEFAULT).toBe(30 * 60_000);
  });

  test("pointer timings match the spec", () => {
    expect(CLICK_PREVIEW_MS).toBe(2_000);
    expect(DOUBLE_CLICK_MS).toBe(400);
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });

  test("error revert outlasts the 2s SVG flash", () => {
    expect(ERROR_REVERT_MS).toBeGreaterThan(2_000);
  });
});
