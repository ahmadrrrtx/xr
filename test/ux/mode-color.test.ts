/**
 * XR Phase 8 · T4 — mode-coloured TUI.
 *
 * The active mode (agent / plan / ask) must look IDENTICAL on every shell
 * surface. Pre-Phase-8 the header breadcrumb painted `plan` violet while the
 * composer chip painted every mode cyan — the same state had two different
 * colour languages. These tests pin the single canonical mapping and that
 * both persistent surfaces consume it.
 *
 * Colour is redundant with the mode word by design (never the only signal),
 * which these tests also enforce: the plain text always says the mode, even
 * when the terminal colour mode is "none"/"mono".
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modePaint, composerPrompt } from "../../src/ui/primitives.ts";
import { xrCyan, xrViolet, xrDim, xrAmber, setColorMode, getColorMode } from "../../src/ui/theme.ts";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Rendering is colour-mode-dependent; pin "truecolor" so the assertions are
// deterministic in CI, then restore whatever the environment detected so no
// later test file in the shared bun-test process is perturbed.
const detected = getColorMode();
setColorMode("truecolor");
afterAll(() => setColorMode(detected));

describe("T4 — canonical mode colour map", () => {
  test("all three modes render their word in plain text (colour is redundant, never the only signal)", () => {
    for (const mode of ["agent", "plan", "ask"]) {
      expect(stripAnsi(modePaint(mode))).toBe(mode);
    }
  });

  test("each mode maps to EXACTLY the design-token colour (agent=cyan accent, plan=violet, ask=dim)", () => {
    expect(modePaint("agent")).toBe(xrCyan("agent"));
    expect(modePaint("plan")).toBe(xrViolet("plan"));
    expect(modePaint("ask")).toBe(xrDim("ask"));
  });

  test("the three modes map to three DISTINCT renderings under colour", () => {
    const set = new Set([modePaint("agent"), modePaint("plan"), modePaint("ask")]);
    expect(set.size).toBe(3);
  });

  test("authority semantics: ask renders dim (read-only, visually recessive)", () => {
    expect(modePaint("ask")).toContain("\x1b[2m");
    expect(modePaint("agent")).not.toContain("\x1b[2m");
    expect(modePaint("plan")).not.toContain("\x1b[2m");
  });

  test("colourless terminals still communicate mode (nothing is carried by colour alone)", () => {
    setColorMode("none");
    try {
      expect(modePaint("agent")).toBe("agent");
      expect(modePaint("plan")).toBe("plan");
      expect(modePaint("ask")).toBe("ask");
      expect(stripAnsi(composerPrompt("plan", false))).toContain("plan");
    } finally {
      setColorMode("truecolor");
    }
  });

  test("busy ALWAYS wins over mode colour (an in-flight composer is never mislabelled as a mode)", () => {
    expect(stripAnsi(composerPrompt("agent", true))).not.toContain("agent");
    expect(stripAnsi(composerPrompt("agent", true))).toContain("busy");
    expect(composerPrompt("agent", true)).toContain(xrAmber("busy"));
    // Busy is mode-independent: the whole prompt is identical regardless of mode.
    expect(composerPrompt("agent", true)).toBe(composerPrompt("plan", true));
  });

  test("the idle composer chip IS the canonical paint (no local colour fork)", () => {
    expect(composerPrompt("agent", false)).toContain(modePaint("agent"));
    expect(composerPrompt("plan", false)).toContain(modePaint("plan"));
  });
});

describe("T4 — every mode chip consumes the single map (structure)", () => {
  const renderSrc = readFileSync(join(import.meta.dir, "../../src/interfaces/shell/render.ts"), "utf8");

  test("the shell header no longer carries its own divergent mode ternary", () => {
    expect(renderSrc).not.toContain('state.mode === "agent" ? xrCyan');
    expect(renderSrc).toContain("modePaint(state.mode)");
  });

  test("recent-session rows use the same map (mode looks the same in history as in the header)", () => {
    expect(renderSrc).toContain("modePaint(s.mode)");
  });

  test("the composer chip routes through modePaint, not inline colour", () => {
    const primSrc = readFileSync(join(import.meta.dir, "../../src/ui/primitives.ts"), "utf8");
    expect(primSrc).toContain('busy ? xrAmber("busy") : modePaint(mode)');
    // modePaint is exported through the design-system barrel for every future surface.
    const barrel = readFileSync(join(import.meta.dir, "../../src/ui/index.ts"), "utf8");
    expect(barrel).toContain("modePaint,");
  });
});
