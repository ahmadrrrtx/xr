/**
 * UX Phase A · A-1/A-4/A-7 — dashboard honesty gates.
 *
 * Mission rule §31: no fake UI. These tests pin the honest states:
 *   · no simulated voice activation/test outcomes;
 *   · no emoji-as-icons in the chrome (inline SVG only);
 *   · copyText actually exists (the message Copy button was a silent no-op);
 *   · settings save does not claim persistence the daemon does not perform;
 *   · the new honest surfaces (locality, composer meta, voice state) exist.
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_PAGE, DASHBOARD_SCRIPT } from "../../src/daemon/dashboard.ts";

describe("A-1 — voice panel is honest (no fake buttons/outcomes)", () => {
  test("no simulated activation or smoke-test strings remain", () => {
    expect(DASHBOARD_PAGE).not.toContain("Voice activated");
    expect(DASHBOARD_PAGE).not.toContain("smoke test");
    expect(DASHBOARD_PAGE).not.toContain("output OK");
    expect(DASHBOARD_PAGE).not.toContain("Test loop latency");
  });

  test("the panel is terminal-driven with real CLI commands and real config state", () => {
    expect(DASHBOARD_PAGE).toContain("terminal-driven");
    expect(DASHBOARD_PAGE).toContain("id=\"voice-config-state\"");
    expect(DASHBOARD_PAGE).toContain("copyText('xr voice status')");
    expect(DASHBOARD_PAGE).toContain("copyText('xr voice setup')");
    expect(DASHBOARD_PAGE).toContain("copyText('xr voice start')");
  });

  test("the voice copy buttons work (copyText is defined, not allowlisted-only)", () => {
    expect(DASHBOARD_SCRIPT).toContain("function copyText(text)");
    expect(DASHBOARD_SCRIPT).toContain("navigator.clipboard.writeText");
    expect(DASHBOARD_SCRIPT).toContain("function legacyCopy(text)");
  });
});

describe("A-4 — no emoji-as-icons in the dashboard chrome", () => {
  test("no pictograph/emoji codepoints in the markup", () => {
    expect(assertNoBannedEmoji(DASHBOARD_PAGE)).toBe(true);
  });
  test("no pictograph/emoji codepoints in the client script", () => {
    expect(assertNoBannedEmoji(DASHBOARD_SCRIPT)).toBe(true);
  });
});

function assertNoBannedEmoji(s: string): boolean {
  // Banned: real pictographs/emoji (1F000–1FAFF) plus the symbols block
  // (2600–27BF) EXCEPT the typographic symbols that are part of XR's symbol
  // vocabulary across TUI and GUI: ⚠ warning (26A0), ✓ check (2713),
  // ✕ cross (2715). Geometric shapes, arrows and block elements used by the
  // product (◈ ▣ ⬢ › ↻ · …) are not emoji and stay allowed.
  const allowed = new Set([0x26a0, 0x2713, 0x2715]);
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1f000 && cp <= 0x1faff) return false;
    if (cp >= 0x2600 && cp <= 0x27bf && !allowed.has(cp)) return false;
  }
  return true;
}

describe("A-5 — locality surfaces exist and are wired", () => {
  test("locality chip, sidebar badge and composer meta are in the markup", () => {
    expect(DASHBOARD_PAGE).toContain("id=\"chip-locality\"");
    expect(DASHBOARD_PAGE).toContain("id=\"sidebar-locality\"");
    expect(DASHBOARD_PAGE).toContain("id=\"composer-meta\"");
  });
  test("the client derives the badge from real route state (provider.local)", () => {
    expect(DASHBOARD_SCRIPT).toContain("const localRoute = !!(ov.provider && ov.provider.local)");
    expect(DASHBOARD_SCRIPT).toContain('className = "locality-badge " + locTone');
    expect(DASHBOARD_SCRIPT).toContain('locText = "LOCAL"; locTone = "local"');
  });
});

describe("A-6 — composer transparency is honest", () => {
  test("the context line states the real daemon contract (last 10 messages)", () => {
    expect(DASHBOARD_SCRIPT).toContain("Context: last 10 messages");
    expect(DASHBOARD_SCRIPT).toContain("history.slice(-10)");
  });
  test("the budget meter reads /api/budget and never fabricates a cap", () => {
    expect(DASHBOARD_SCRIPT).toContain('api("/api/budget")');
    expect(DASHBOARD_SCRIPT).toContain("no per-task cap");
  });
  test("meter width is set through CSSOM (dashboard CSP: style-src 'self')", () => {
    expect(DASHBOARD_SCRIPT).toContain("fill.style.width");
    expect(DASHBOARD_SCRIPT).not.toContain("meta-progress' + tone + '\" title");
  });
});

describe("A-7 — settings do not fake persistence", () => {
  test("saveAllSettings no longer claims success", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("Settings updated successfully.");
    expect(DASHBOARD_SCRIPT).toContain("read-only in this dashboard build");
  });
  test("settings toggles reflect real config and are disabled", () => {
    expect(DASHBOARD_SCRIPT).toContain("setPtt.checked = voice.mode === \"push-to-talk\"");
    expect(DASHBOARD_SCRIPT).toContain("setAppr.checked = !!sec.requireApproval");
    expect(DASHBOARD_SCRIPT).toContain("setPtt.disabled = true");
    expect(DASHBOARD_SCRIPT).toContain("setEgress.disabled = true");
  });
});
