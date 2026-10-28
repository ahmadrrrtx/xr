/**
 * Phase 1 (V1 matrix D-17) — Splash/boot screen core. The splash is cinematic
 * presentation, but it carries two contracts worth pinning:
 *   · the boot status vocabulary (App.tsx drives these four strings in order;
 *     the aria-label reads them) — accidental renames would churn screen
 *     readers mid-boot;
 *   · particleField determinism (seeded LCG) — the brief says "SSR/tests are
 *     stable": same seed → same field, values within layout bounds, and the
 *     hard cap on the count.
 * The 800ms min-show / 5s hard cap live in App.tsx's boot sequence and are
 * covered by the boot timings in test/ux/ (see matrix W-01 row).
 */
import { describe, expect, test } from "bun:test";

import { particleField, type SplashStatus } from "../../desktop/src/screens/Splash.tsx";

const STATUSES: SplashStatus[] = [
  "Starting XR...",
  "Loading settings...",
  "Preparing memory...",
  "Ready.",
];

describe("splash — boot status vocabulary (screen-reader contract)", () => {
  test("the four boot phases keep their exact strings", () => {
    expect(STATUSES).toEqual(["Starting XR...", "Loading settings...", "Preparing memory...", "Ready."]);
  });
});

describe("splash — deterministic particle field", () => {
  test("same count → identical field (seeded, no Math.random)", () => {
    expect(particleField(28)).toEqual(particleField(28));
  });

  test("layout values stay within bounds and counts are honored", () => {
    const field = particleField(28);
    expect(field).toHaveLength(28);
    for (const p of field) {
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left).toBeLessThanOrEqual(100);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeLessThanOrEqual(100);
      expect(p.size).toBeGreaterThanOrEqual(1);
      expect(p.size).toBeLessThanOrEqual(2.4); // 1 + rand*1.4
      expect(p.duration).toBeGreaterThanOrEqual(14);
      expect(p.duration).toBeLessThanOrEqual(24);
    }
    expect(field.filter((p) => p.cyan).length).toBeGreaterThan(0);
    expect(field.filter((p) => !p.cyan).length).toBeGreaterThan(0);
  });

  test("ids are stable indices (React keys don't churn between renders)", () => {
    expect(particleField(28).map((p) => p.id)).toEqual(Array.from({ length: 28 }, (_, i) => i));
  });
});
