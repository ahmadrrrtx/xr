/**
 * XR Phase 2 · T7 — dashboard split is behaviour-preserving.
 * XR Phase 4 · T5 — dashboard hardening changed the composed document
 * DELIBERATELY (CSP-safe external assets, data-xr-action handlers, utility
 * classes). This test now pins the POST-hardening document by SHA-256 so any
 * future unplanned change fails loudly — exactly as the original pin did.
 *
 * The Phase 4 changes (all intentional):
 *   · inline <style>/<script> → external /assets/dashboard.css + .js links
 *     (strict CSP `script-src 'self'`, no unsafe-inline);
 *   · inline onclick="…" → data-xr-action="…" (whitelist dispatcher);
 *   · inline style="…" → generated .xr-s-N utility classes.
 */

import { describe, expect, test } from "bun:test";
import {
  dashboardHtml,
  DASHBOARD_CSS,
  DASHBOARD_SCRIPT,
  DASHBOARD_PAGE,
} from "../../src/daemon/dashboard.ts";

/**
 * Recorded from the post-Phase-4-T5 implementation with
 * `dashboardHtml("TESTTOKEN")`. Bump deliberately when the dashboard is
 * intentionally changed — the pin is a deliberate-change guard.
 *
 * Phase 8 · T3 bump (2026-08-02, WCAG 2.2 AA conformance work — DELIBERATE):
 *   · nav anchors → natively operable <button>s; aria-current state machine;
 *   · skip link, single <main> landmark, palette as modal combobox dialog;
 *   · every form control labelled; decorative SVGs hidden from AT;
 *   · tokens raised for AA contrast; :focus-visible indicator, 24px targets;
 *   · reduced-motion support; live-region toasts; panel focus management.
 *
 * Phase 9 bump (2026-08-05, 7.0.1 → 7.1.0 release stamp — DELIBERATE):
 *   the rendered document embeds the stamped version (one occurrence); the
 *   7.0.1→7.0.1 back-substitution reproduces the Phase-8 pin exactly, proving
 *   the only delta is the deliberate version stamp.
 *
 * Phase A bump (2026-08-13, UX Phase A — DELIBERATE):
 *   · voice panel honesty (fake Enable/Test buttons removed; real config
 *     state + copy-to-clipboard CLI commands; no simulated outcomes);
 *   · locality chips (topbar + sidebar) fed by real route state;
 *   · composer meta row (real budget meter + honest context line);
 *   · composer flag chips, skills/security/research categories, shield
 *     heading and emergency stop: emoji → inline SVG line icons;
 *   · settings toggles reflect real config and are disabled (read-only).
 *
 * Phase B bump (2026-08-13, UX Phase B — DELIBERATE):
 *   · first-run onboarding overlay (real engines: provider key via the
 *     secrets vault, local-model set, budget cap, audit completion);
 *   · chat empty-state hero (avatar + suggested prompts + capability chips);
 *   · shell refinements: sidebar relabels (Start/Ask/Capabilities/Guard/
 *     System), default view = Chat, sidebar-collapse + inspector toggles.
 *
 * Phase C bump (2026-08-13, UX Phase C — DELIBERATE):
 *   · C-1 component split (byte-identical fragments for client / page / CSS;
 *     the three dashboard waivers were retired);
 *   · fixed a REAL served-script SyntaxError in the onboarding code
 *     (lost-backslash escaping: onbSelectProvider/onbSetLocal/copyText/
 *     onbGo attributes) — new parse gate in phase-c.test.ts;
 *   · C-2 approval cards render WHAT / WHY / RISK from the real plane;
 *   · C-3 streaming: polite live-region announcer + cursor + code note;
 *   · C-4 sessions: search + copy-id.
 */
const POST_PHASE4_SHA256 = "9771c81abace6fac24b06aa5f0f954392b82d2f26e6186a00f83c60ff0c29ade";
const PRE_SPLIT_LENGTH = -1;

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

describe("T7 — dashboard split preserves behaviour exactly (Phase 4 hardened output)", () => {
  test("the rendered document matches the pinned post-hardening hash", () => {
    const html = dashboardHtml("TESTTOKEN");
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("style=\"");
    expect(sha256(html)).toBe(POST_PHASE4_SHA256);
  });

  test("the token is NOT embedded in the dashboard HTML (Phase 4 T5)", () => {
    const html = dashboardHtml("secret-token-abc");
    // The one-time bootstrap is server-side (cookie); the HTML never carries
    // the token, so it cannot leak into history/referrers.
    expect(html).not.toContain("secret-token-abc");
    expect(html).not.toContain("__TOKEN__");
  });

  test("version placeholders are substituted", () => {
    const html = dashboardHtml("t");
    for (const placeholder of [
      "__XR_VERSION__",
      "__XR_CORE_VERSION__",
      "__XR_PKG_NAME__",
      "__XR_REPO__",
      "__XR_HOMEPAGE__",
    ]) {
      expect(html).not.toContain(placeholder);
    }
  });

  test("the document is well-formed: external assets, no inline blocks", () => {
    const html = dashboardHtml("t");
    expect(html).toContain('<link rel="stylesheet" href="/assets/dashboard.css">');
    expect(html).toContain('<script src="/assets/dashboard.js" defer></script>');
    expect((html.match(/<script[\s>]/g) ?? []).length).toBe(1);
    expect((html.match(/<style[\s>]/g) ?? []).length).toBe(0);
  });

  test("the fragments are separately addressable and non-trivial", () => {
    expect(DASHBOARD_PAGE.length).toBeGreaterThan(10_000);
    expect(DASHBOARD_CSS.length).toBeGreaterThan(1_000);
    expect(DASHBOARD_SCRIPT.length).toBeGreaterThan(5_000);
    // Phase 4 · T5 — the client app contains the CSP-safe action dispatcher.
    expect(DASHBOARD_SCRIPT).toContain("data-xr-action");
    expect(DASHBOARD_SCRIPT).toContain("XR_ACTIONS");
  });
});
