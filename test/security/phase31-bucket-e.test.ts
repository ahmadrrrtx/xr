/**
 * Phase 31 · Bucket E (In-App Screen Fixes) regression tests · 2026-10-15
 *
 * The bucket doc was written against an older snapshot: five themes, the
 * memory graph, the Builder IDE, real research streaming and the collapsing
 * rail all shipped in earlier phases. What was actually broken — and is
 * pinned here — is the Graphite theme (2.68:1 body text), sub-AA faint
 * text in every other theme, the missing ⌘1–⌘9 area shortcuts, and the
 * Research outline/copy actions.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { headingSlug, reportOutline } from "../../desktop/src/research/core";

const DESK = join(import.meta.dir, "..", "..", "desktop");
const read = (rel: string) => readFileSync(join(DESK, rel), "utf8");

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEME_IDS = ["xr-native", "graphite", "midnight", "paper", "arctic"];

function themeTokens(css: string, id: string): Record<string, string> {
  const start = css.indexOf(`html[data-theme='${id}'] {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/gi)) out[m[1]!] = m[2]!;
  return out;
}

describe("Phase 31 E1/E6 — five themes survive, each one AA", () => {
  const css = read("src/styles/themes.css");

  test("the theme store offers the five themes plus system", () => {
    const store = read("src/stores/theme.ts");
    for (const id of THEME_IDS) expect(store, id).toContain(`'${id}'`);
    expect(store).toContain("ThemePreference = ThemeId | 'system'");
    expect(read("src/screens/Settings/tabs/AppearanceTab.tsx")).toContain('role="radiogroup"');
    expect(read("src/screens/Onboarding/StepPrefs.tsx")).toContain("THEMES.map");
  });

  test("every theme's text ramp meets 4.5:1 on page and card surfaces", () => {
    for (const id of THEME_IDS) {
      const t = themeTokens(css, id);
      for (const fg of ["text-primary", "text-secondary", "text-tertiary"]) {
        for (const bg of ["bg-ink", "bg-raised"]) {
          expect(contrast(t[fg]!, t[bg]!), `${id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // button text on the accent
      expect(contrast(t["accent-contrast"]!, t["accent"]!), `${id}: text on accent`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Phase 31 E7 — Graphite is the light matte theme now", () => {
  const css = read("src/styles/themes.css");
  const t = themeTokens(css, "graphite");

  test("light surfaces, ink text, muted steel primary", () => {
    expect(luminance(t["bg-ink"]!)).toBeGreaterThan(0.9);
    expect(t["text-primary"]).toBe("#1a1d23");
    expect(t["accent"]).toBe("#4a7a90"); // spec #5B8A9E fails AA under white text
  });

  test("flat shadow, no glow halo, matte orb scaling", () => {
    const graphite = css.slice(css.indexOf("html[data-theme='graphite'] {"), css.indexOf("\n}", css.indexOf("html[data-theme='graphite'] {")));
    expect(graphite).toContain("--glass-shadow: 0 12px 32px rgba(20, 30, 50, 0.08);");
    expect(graphite).not.toContain("40px -8px");
    expect(css).toContain("--avatar-glow-strength: 0px;\n  --accent-2: #4a7a90;");
  });

  test("graphite tooltip keeps AA (near-white on ink)", () => {
    expect(css).toContain("--tooltip-bg: var(--text-primary);\n  --tooltip-fg: var(--bg-ink);");
  });
});

describe("Phase 31 E6 — keyboard: ⌘1–⌘9 switch areas", () => {
  test("shortcut registry and shell agree with the canonical nav order", () => {
    const shortcuts = read("src/lib/shortcuts.ts");
    for (let n = 1; n <= 9; n++) expect(shortcuts, `mod+${n}`).toContain(`combo: 'mod+${n}'`);
    expect(shortcuts).toContain("{ id: 'nav-builder', label: 'Go to Builder', scope: 'app', combo: 'mod+4' }");
    const shell = read("src/components/layout/AppShell.tsx");
    expect(shell).toContain("NAV_ITEMS.slice(0, 9).map((item)");
    expect(shell).toContain("combo(`nav-${item.id}`)");
  });
});

describe("Phase 31 E2/E3/E5 — shipped screens stay shipped (no placeholder regressions)", () => {
  test("builder is the real IDE; memory renders the engine graph", () => {
    const router = read("src/router.tsx");
    expect(router).toContain("element: <BuilderScreen />");
    expect(read("src/screens/Builder/components/PreviewPane.tsx")).toContain('sandbox="allow-scripts');
    const memory = read("src/screens/Memory/components/MemoryGraph.tsx");
    expect(memory).toContain("from '@xyflow/react'");
    expect(memory).toContain("Try again"); // honest error state, no fake fallback
    expect(read("src/screens/Memory/index.tsx")).toContain("MemoryGraph");
  });

  test("rail collapses with persisted state and labeled toggle", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    expect(sidebar).toContain("COLLAPSED_WIDTH");
    expect(sidebar).toContain("aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}");
    expect(read("src/stores/sidebar.ts")).toContain("writeSettingJSON");
  });

  test("the orb is one smooth sphere, reduced-motion aware", () => {
    const orb = read("src/components/brand/CompanionOrb.tsx");
    expect(orb).toContain("Glossy black sphere");
    expect(orb.toLowerCase()).not.toContain("segment");
    expect(orb).toContain("useReducedMotion");
  });
});

describe("Phase 31 E4 — Research outline helpers (runtime behavior)", () => {
  test("outline parses headings, skips code fences, de-duplicates slugs", () => {
    const report = ["# Topic", "", "## Findings [s2]", "text", "```", "# not a heading", "```", "## Findings", "### Detail *One*"].join("\n");
    expect(reportOutline(report)).toEqual([
      { level: 1, text: "Topic", slug: "topic" },
      { level: 2, text: "Findings", slug: "findings" },
      { level: 2, text: "Findings", slug: "findings-2" },
      { level: 3, text: "Detail One", slug: "detail-one" },
    ]);
  });

  test("slug rules stay URL-safe", () => {
    expect(headingSlug("What's new in 2.0?")).toBe("what-s-new-in-2-0");
    expect(headingSlug("")).toBe("section");
  });

  test("screen wiring: outline nav, heading ids, copy action", () => {
    const view = read("src/screens/Research/components/ReportView.tsx");
    expect(view).toContain("reportOutline(body)");
    expect(view).toContain('data-testid="report-outline"');
    expect(view).toContain("`report-${headingSlug(plainHeading(text))}`");
    expect(read("src/screens/Research/components/QueryPanel.tsx")).toContain('data-testid="research-copy"');
  });

  test("research streams from the engine, never setTimeout samples", () => {
    const api = read("src/research/api.ts");
    expect(api).toContain("/research/run/${encodeURIComponent(runId)}/stream");
    expect(api).toContain("readSse");
    expect(read("src/screens/Research/ResearchScreen.tsx")).not.toContain("SAMPLE");
  });
});
