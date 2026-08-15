/**
 * XR Phase 8 · T3 — static accessibility contracts (WCAG 2.2 AA).
 *
 * These tests pin the ACCESSIBILITY STRUCTURE of the dashboard sources so a
 * future refactor cannot silently drop a landmark, un-label an input, or
 * reintroduce click-only divs. They complement (never replace) the live
 * browser axe sweep in browser-axe.test.ts — see docs/a11y/CONFORMANCE.md
 * for the honest scope statement.
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_PAGE } from "../../src/daemon/dashboard/markup.ts";
import { DASHBOARD_CSS } from "../../src/daemon/dashboard/styles.ts";
import { DASHBOARD_SCRIPT } from "../../src/daemon/dashboard/client-script.ts";
import { authPageHtml, AUTH_PAGE_CSP } from "../../src/daemon/auth-page.ts";

describe("T3 static — landmarks & navigation", () => {
  test("exactly one <main> landmark, with an id the skip link targets", () => {
    const mains = DASHBOARD_PAGE.match(/<main\b/g) ?? [];
    expect(mains.length).toBe(1);
    expect(DASHBOARD_PAGE).toContain('<main class="main" id="main-content" tabindex="-1">');
  });

  test("skip link is the first focusable element in the body", () => {
    const bodyIdx = DASHBOARD_PAGE.indexOf("<body>");
    const skipIdx = DASHBOARD_PAGE.indexOf('<a class="skip-link"');
    expect(skipIdx).toBeGreaterThan(bodyIdx);
    // Nothing focusable (a/button/input/select/textarea) may precede it.
    const before = DASHBOARD_PAGE.slice(bodyIdx, skipIdx);
    expect(before).not.toMatch(/<(a|button|input|select|textarea)\b/);
    expect(DASHBOARD_PAGE).toContain('href="#main-content"');
  });

  test("the primary nav is a labelled landmark", () => {
    expect(DASHBOARD_PAGE).toContain('<nav class="sidebar" aria-label="Mission navigation">');
    expect(DASHBOARD_PAGE).toContain('aria-label="Breadcrumb"');
    expect(DASHBOARD_PAGE).toContain('aria-label="Command palette"');
  });

  test("every nav item is a native <button> (never a href-less <a>)", () => {
    expect(DASHBOARD_PAGE).not.toMatch(/<a class="nav-item/);
    const buttons = DASHBOARD_PAGE.match(/<button type="button" class="nav-item/g) ?? [];
    expect(buttons.length).toBe(26);
    // Exactly one carries the current-page state at render time.
    expect((DASHBOARD_PAGE.match(/aria-current="page"/g) ?? []).length).toBe(2); // nav button + breadcrumb span
  });

  test("nav clicks swap aria-current in the client", () => {
    expect(DASHBOARD_SCRIPT).toContain('el.setAttribute("aria-current", "page")');
    expect(DASHBOARD_SCRIPT).toContain('el.removeAttribute("aria-current")');
  });

  test("panels are programmatic focus targets (tabindex=-1)", () => {
    const panels = DASHBOARD_PAGE.match(/<div class="panel[^"]*" tabindex="-1" id="panel-/g) ?? [];
    expect(panels.length).toBe(26);
    expect(DASHBOARD_SCRIPT).toContain('panel.focus({ preventScroll: true })');
  });
});

describe("T3 static — live regions & dialogs", () => {
  test("toast stack is a polite live region; errors escalate to role=alert", () => {
    expect(DASHBOARD_PAGE).toContain('id="toasts" role="status" aria-live="polite"');
    expect(DASHBOARD_SCRIPT).toContain('el.setAttribute("role", type === "err" ? "alert" : "status")');
  });

  test("command palette is a modal dialog with combobox semantics", () => {
    expect(DASHBOARD_PAGE).toContain('role="dialog" aria-modal="true" aria-label="Command palette"');
    expect(DASHBOARD_PAGE).toContain('role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant');
    expect(DASHBOARD_PAGE).toContain('role="listbox" aria-label="Commands"');
    // Focus returns to the invoker on close and Tab is trapped inside.
    expect(DASHBOARD_SCRIPT).toContain("paletteReturnFocus && document.contains(paletteReturnFocus)");
    expect(DASHBOARD_SCRIPT).toContain("paletteReturnFocus.focus({ preventScroll: true })");
    expect(DASHBOARD_SCRIPT).toContain('e.key === "Tab") { e.preventDefault();');
  });
});

describe("T3 static — every form control has an accessible name (4.1.2 / 3.3.2)", () => {
  test("no unlabeled input/select/textarea in the markup", () => {
    const tags = DASHBOARD_PAGE.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
    const unlabeled = tags.filter((t) => {
      if (t.includes("aria-label")) return false;
      // wrapped in an explicit <label> (budget toggles)
      if (t.includes('id="bud-toggle-')) return false;
      return true;
    });
    expect(unlabeled).toEqual([]);
  });

  test("every decorative inline SVG is hidden from assistive tech", () => {
    const svgs = DASHBOARD_PAGE.match(/<svg\b[^>]*>/g) ?? [];
    const exposed = svgs.filter((t) => !t.includes('aria-hidden="true"'));
    expect(exposed).toEqual([]);
  });

  test("SVG-only icon buttons carry aria-labels", () => {
    expect(DASHBOARD_PAGE).toContain('id="chat-send-btn" data-xr-action="sendChatMessage()" aria-label="Send message"');
    expect(DASHBOARD_PAGE).toContain('aria-label="Open command palette (Ctrl+K)"');
  });

  test("click-only dynamic elements are keyboard-operable (role=button + tabindex)", () => {
    // NOTE: DASHBOARD_SCRIPT is the *evaluated* JS source — author-level
    // \${...} escapes appear as literal ${...} in the string.
    expect(DASHBOARD_SCRIPT).toContain('chat-session-item ${c.id === chatState.activeId ? "active" : ""}" role="button" tabindex="0"');
    expect(DASHBOARD_SCRIPT).toContain('class="tool-head" role="button" tabindex="0" aria-expanded="false"');
    // Marketplace cards are NOT role="button": the card contains real
    // <button> children (Details / Install / Enable), and a widget role
    // wrapping interactive descendants is an axe `nested-interactive`
    // violation (WCAG 4.1.2). Before Phase 02 the skills marketplace 404'd,
    // so this panel always rendered empty and the live axe sweep never saw
    // a card. With the canonical route fixed the cards render, so the card
    // is now a plain container and every action is a native button.
    expect(DASHBOARD_SCRIPT).toContain('mp-skill-card${sel}" data-xr-action=');
    expect(DASHBOARD_SCRIPT).not.toContain('mp-skill-card${sel}" role="button"');
    expect(DASHBOARD_SCRIPT).toContain('aria-label="Details for ');
    expect(DASHBOARD_SCRIPT).toContain('badge-x" aria-label="Remove attachment ');
    // Enter/Space bridge for non-native action elements:
    expect(DASHBOARD_SCRIPT).toContain(`if (ev.key !== 'Enter' && ev.key !== ' ') return;`);
    expect(DASHBOARD_SCRIPT).toContain(`el.hasAttribute('data-xr-action')`);
  });
});

describe("T3 static — CSS layer", () => {
  test("a :focus-visible indicator exists AFTER every outline reset", () => {
    // Selector-leading resets (comments are excluded on purpose: they only
    // document the pattern) must all precede the global focus indicator so
    // the indicator always wins for keyboard users.
    const resets = [...DASHBOARD_CSS.matchAll(/^[^\s{}/*][^{]*\{[^}]*outline: ?none/gm)]
      .filter((m) => !m[0].startsWith(".panel") && !m[0].includes(":focus")) // intentional programmatic-focus exemption
      .map((m) => m.index!);
    expect(resets.length).toBeGreaterThan(0);
    const focusRule = DASHBOARD_CSS.indexOf(":focus-visible {");
    expect(focusRule).toBeGreaterThan(-1);
    expect(focusRule).toBeGreaterThan(Math.max(...resets));
    expect(DASHBOARD_CSS).toContain("outline: 2px solid var(--cyan);");
  });

  test("skip link is visually hidden until focused", () => {
    expect(DASHBOARD_CSS).toMatch(/\.skip-link \{[^}]*top: -96px/);
    expect(DASHBOARD_CSS).toContain(".skip-link:focus-visible { top: 12px;");
  });

  test("keyboard-unreachable panels/main are exempt only from the painted outline", () => {
    expect(DASHBOARD_CSS).toContain(".panel:focus, .panel:focus-visible");
  });

  test("24px minimum targets on the historical tiny controls (2.5.8)", () => {
    expect(DASHBOARD_CSS).toMatch(/\.msg-act-btn \{[^}]*min-height: 24px/);
    expect(DASHBOARD_CSS).toMatch(/\.badge-x \{[^}]*min-width: 24px;\s*min-height: 24px/s);
    expect(DASHBOARD_CSS).toMatch(/\.toggle \{[^}]*width: 44px; height: 24px/);
    expect(DASHBOARD_CSS).toMatch(/\.status-chip \{[^}]*min-height: 26px/);
    expect(DASHBOARD_CSS).toMatch(/\.composer-flag-chip \{[^}]*min-height: 24px/);
    expect(DASHBOARD_CSS).toMatch(/\.mp-chip, \.mp-tab \{[^}]*min-height: 24px/);
  });

  test("prefers-reduced-motion collapses animation", () => {
    expect(DASHBOARD_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(DASHBOARD_CSS).toContain("animation-duration: 0.01ms !important");
  });

  test("focus is protected from obscuring overlays (2.4.11 defence)", () => {
    expect(DASHBOARD_CSS).toContain("scroll-margin-block: 16px");
  });
});

describe("T3 static — accessible authentication (3.3.8)", () => {
  test("the sign-in page is a labelled, paste-friendly token form", () => {
    const html = authPageHtml("/");
    expect(html).toContain('<label for="token">Access token</label>');
    expect(html).toContain('type="password"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="token-hint"');
    expect(html).toContain("method=\"get\"");
    expect(html).toContain("paste is never blocked");
    expect(html).not.toContain("__TOKEN__");
  });

  test("the sign-in page ships no inline scripts (CSP allows same-origin only)", () => {
    const html = authPageHtml("/");
    expect(html).not.toContain("<script>");
    expect(html).toContain('src="/assets/auth.js"');
    expect(AUTH_PAGE_CSP).toContain("default-src 'none'");
    expect(AUTH_PAGE_CSP).toContain("script-src 'self'");
    expect(AUTH_PAGE_CSP).toContain("form-action 'self'");
  });

  test("the action URL is attribute-escaped and rooted", () => {
    expect(authPageHtml('//evil.example" onclick="x')).toContain('action="/"');
    expect(authPageHtml("/settings?x=1&y=2")).toContain('action="/settings?x=1&amp;y=2"');
  });
});
