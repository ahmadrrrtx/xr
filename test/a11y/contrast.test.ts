/**
 * XR Phase 8 · T3 — programmatic color-contrast gate (WCAG 2.2 · 1.4.3 / 1.4.11).
 *
 * The design tokens are parsed from the actual stylesheet (no duplicated
 * hex constants that could drift) and every text/UI pair the dashboard uses
 * is checked against the WCAG relative-luminance formula. This covers what
 * axe computes dynamically, in a test that runs everywhere (no browser
 * needed) and fails loudly if a future token edit sinks below AA.
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_CSS } from "../../src/daemon/dashboard/styles.ts";

/** WCAG 2.x relative luminance + contrast ratio (normative formulas). */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrastRatio(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull the :root token set out of the stylesheet under test. */
function tokens(): Record<string, string> {
  const root = DASHBOARD_CSS.slice(DASHBOARD_CSS.indexOf(":root {"), DASHBOARD_CSS.indexOf("}", DASHBOARD_CSS.indexOf(":root {")));
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/--([A-Za-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

const T = tokens();
const SURFACES = ["bg", "bg2", "surface", "surface2"] as const;

describe("T3 — text tokens meet AA (4.5:1) on every surface (1.4.3)", () => {
  test("--text is comfortably above 4.5:1 everywhere", () => {
    for (const s of SURFACES) expect(contrastRatio(T.text, T[s])).toBeGreaterThanOrEqual(4.5);
  });
  test("--textDim ≥ 4.5:1 on every surface", () => {
    for (const s of SURFACES) expect(contrastRatio(T.textDim, T[s])).toBeGreaterThanOrEqual(4.5);
  });
  test("--muted (raised in Phase 8 for this) ≥ 4.5:1 on every surface", () => {
    for (const s of SURFACES) expect(contrastRatio(T.muted, T[s])).toBeGreaterThanOrEqual(4.5);
    // regression pin: the pre-Phase-8 value failed everywhere
    expect(contrastRatio("#475569", T.surface)).toBeLessThan(4.5);
  });
  test("semantic text colors keep AA on surfaces", () => {
    for (const c of ["cyan", "green", "amber", "red"]) {
      for (const s of SURFACES) expect(contrastRatio(T[c], T[s])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("T3 — non-text UI boundaries meet 3:1 (1.4.11)", () => {
  test("--border-strong (form controls, toggles, chips) ≥ 3:1 on every surface", () => {
    expect(T["border-strong"]).toBeDefined();
    for (const s of SURFACES) expect(contrastRatio(T["border-strong"], T[s])).toBeGreaterThanOrEqual(3);
  });
  test("focus indicator (cyan) ≥ 3:1 on every surface", () => {
    for (const s of SURFACES) expect(contrastRatio(T.cyan, T[s])).toBeGreaterThanOrEqual(3);
  });
  test("primary action text passes on its own background", () => {
    // .btn-primary: #001018 text on --cyan
    expect(contrastRatio("#001018", T.cyan)).toBeGreaterThanOrEqual(4.5);
    // skip link uses the same pairing
  });
});

describe("T3 — the stylesheet actually wires the tokens to the controls", () => {
  test("form controls draw their boundary from --border-strong", () => {
    expect(DASHBOARD_CSS).toMatch(/\.input, select, textarea \{[^}]*border: 1px solid var\(--border-strong\)/);
  });
  test("toggle unchecked state draws from --border-strong", () => {
    expect(DASHBOARD_CSS).toMatch(/\.toggle-slider \{[^}]*background: var\(--border-strong\)/);
  });
});
