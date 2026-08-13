/**
 * UX Phase A · A-2/A-3 — token drift lock.
 *
 * The dashboard's `:root` must source every shared semantic color from
 * src/ui/tokens.ts (the single token authority). If tokens.ts changes and the
 * dashboard CSS is not regenerated, this file fails loudly — the same drift
 * guard the audit flagged as F-2/F-3.
 */

import { describe, expect, test } from "bun:test";
import { COLOR, GRADIENT, cssVarsBlock } from "../../src/ui/tokens.ts";
import { DASHBOARD_CSS } from "../../src/daemon/dashboard/styles.ts";

/** Extract the :root token hexes from the evaluated stylesheet string. */
function dashboardRootTokens(): Record<string, string> {
  const start = DASHBOARD_CSS.indexOf(":root {");
  const end = DASHBOARD_CSS.indexOf("}", start);
  const root = DASHBOARD_CSS.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/--([A-Za-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const MAPPING: Record<string, string> = {
  bg: COLOR.bg,
  bg2: COLOR.bg2,
  surface: COLOR.surface,
  surface2: COLOR.surface2,
  border: COLOR.border,
  border2: COLOR.border2,
  cyan: COLOR.primary,
  violet: COLOR.violet,
  green: COLOR.success,
  amber: COLOR.warning,
  red: COLOR.error,
  muted: COLOR.muted,
  text: COLOR.text,
  textDim: COLOR.textDim,
};

describe("A-2 — dashboard :root is derived from tokens.ts (one source of truth)", () => {
  test("every shared semantic color in the dashboard equals its token", () => {
    const root = dashboardRootTokens();
    for (const [cssName, tokenValue] of Object.entries(MAPPING)) {
      expect(root[cssName], `--${cssName} should equal token ${tokenValue}`).toBe(tokenValue);
    }
  });

  test("the cssVarsBlock() emission matches tokens (web consumers)", () => {
    const block = cssVarsBlock();
    expect(block).toContain(`--xr-bg: ${COLOR.bg};`);
    expect(block).toContain(`--xr-muted: ${COLOR.muted};`);
    expect(block).toContain(`--xr-violet: ${COLOR.violet};`);
    expect(block).toContain(`--xr-gradient-brand: ${GRADIENT.brand}`);
  });
});

describe("A-3 — official brand indigo (pixel-verified #6048F8) is the secondary", () => {
  test("tokens.violet is the official indigo", () => {
    expect(COLOR.violet).toBe("#6048F8");
  });
  test("the brand gradient ends on the official indigo", () => {
    expect(GRADIENT.brand).toContain("#6048F8");
  });
  test("muted is the Phase 8 AA-verified neutral across all surfaces", () => {
    expect(COLOR.muted).toBe("#7A8FB0");
  });
});
