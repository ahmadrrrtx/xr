/**
 * XR Phase 8 · T4 — progressive disclosure, honest readiness, undo surfaces,
 * and capability badges (static structural contracts).
 *
 * These tests pin the STRUCTURE of Phase-8 T4 work so a refactor cannot
 * silently regress it. Behavioural proof lives in test/ux/undo.test.ts (route
 * + ledger evidence) and the live browser sweep in test/a11y/browser-axe.test.ts
 * (panels still reachable after disclosure defaults collapse).
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_SCRIPT } from "../../src/daemon/dashboard/client-script.ts";
import { DASHBOARD_PAGE } from "../../src/daemon/dashboard/markup.ts";
import { DASHBOARD_CSS } from "../../src/daemon/dashboard/styles.ts";

describe("T4 static — progressive disclosure", () => {
  test("sidebar areas collapse under accessible toggle buttons (aria-expanded)", () => {
    expect(DASHBOARD_SCRIPT).toContain('className = "sidebar-label area-toggle"');
    expect(DASHBOARD_SCRIPT).toContain('t.setAttribute("aria-expanded", open ? "true" : "false")');
    // The collapse/expand caret is decorative only (announced state is on the button).
    expect(DASHBOARD_SCRIPT).toContain('class="area-caret" aria-hidden="true"');
  });

  test("disclosure persists per-user, per-browser (localStorage), never server-side", () => {
    expect(DASHBOARD_SCRIPT).toContain('var AREA_KEY = "xr.nav.areas.v1"');
    expect(DASHBOARD_SCRIPT).toContain("localStorage.setItem(AREA_KEY");
    expect(DASHBOARD_SCRIPT).toContain("localStorage.getItem(AREA_KEY");
  });

  test("default disclosure is only 'Start here' expanded — overwhelm is opt-out", () => {
    expect(DASHBOARD_SCRIPT).toContain('start.dataset.area = "start-here"');
    expect(DASHBOARD_SCRIPT).toContain('startLabel.setAttribute("aria-expanded", "true")');
    expect(DASHBOARD_SCRIPT).toContain('var open = id in saved ? !!saved[id] : id === "start-here"');
  });

  test("'Start here' assembles the four first-run essentials from REAL nav items (clones)", () => {
    expect(DASHBOARD_SCRIPT).toContain('["dashboard", "chat", "models", "settings"].forEach');
    expect(DASHBOARD_SCRIPT).toContain("src.cloneNode(true)");
    // Clones navigate through the REAL dispatcher — no parallel handlers.
    expect(DASHBOARD_SCRIPT).toContain('clone.addEventListener("click", function () { navigateTo(pid); })');
  });

  test("panels reachable by palette/shortcut auto-reveal their collapsed area", () => {
    expect(DASHBOARD_SCRIPT).toContain("var _navigateTo = navigateTo;");
    expect(DASHBOARD_SCRIPT).toContain("revealAreaFor(id);");
    expect(DASHBOARD_SCRIPT).toContain("window.__xrT4 = {");
    expect(DASHBOARD_SCRIPT).toContain("revealAreaFor: revealAreaFor");
  });

  test("area toggles themselves are <button>s (keyboard + AT native), and base markup stays clean", () => {
    // Base markup still uses a simple label element — the script upgrades it
    // to a button at init time; markup alone must remain operable semantics.
    expect(DASHBOARD_PAGE).toMatch(/<div class="sidebar-label">/);
    expect(DASHBOARD_SCRIPT).toContain('document.createElement("button")');
    expect(DASHBOARD_SCRIPT).toContain("sec.replaceChild(btn, label)");
  });
});

describe("T4 static — honest readiness", () => {
  test("the readiness banner is a polite live region (status changes announce, never scream)", () => {
    expect(DASHBOARD_SCRIPT).toContain('el.id = "readiness-banner"');
    expect(DASHBOARD_SCRIPT).toContain('el.setAttribute("role", "status")');
  });

  test("readiness is COMPUTED from live endpoints — not a static marketing string", () => {
    expect(DASHBOARD_SCRIPT).toContain('await api("/api/overview")');
    expect(DASHBOARD_SCRIPT).toContain('await api("/api/models")');
    expect(DASHBOARD_SCRIPT).toContain('await api("/api/context")');
    // Every verdict branch must exist — degrading honestly is the whole point.
    for (const word of ['"Degraded"', '"Setup required"', '"Your call needed"', '"Ready"']) {
      expect(DASHBOARD_SCRIPT).toContain(`word: ${word}`);
    }
    // The unreachable branch is honest too (daemon/API failure is a verdict, not a crash).
    expect(DASHBOARD_SCRIPT).toContain('badge-red">Unreachable</span>');
    expect(DASHBOARD_SCRIPT).toContain("Could not compute readiness");
  });

  test("dishonest paths are explicit: audit degradation beats a green 'Ready'", () => {
    const degraded = DASHBOARD_SCRIPT.indexOf('word: "Degraded"');
    const auditCheck = DASHBOARD_SCRIPT.indexOf("ov.audit.chain.valid");
    const ready = DASHBOARD_SCRIPT.indexOf('word: "Ready"');
    expect(auditCheck).toBeGreaterThan(-1);
    expect(degraded).toBeGreaterThan(auditCheck); // audit is checked first
    expect(ready).toBeGreaterThan(degraded); // "Ready" is reachable only after every failure branch
  });

  test("actionable readiness routes to the owning panel (setup → models, consent → memory)", () => {
    expect(DASHBOARD_SCRIPT).toContain('action: ["Set up a model", "models"]');
    expect(DASHBOARD_SCRIPT).toContain('action: ["Review memory", "memory"]');
    expect(DASHBOARD_SCRIPT).toContain('action: ["Open audit log", "audit"]');
  });

  test("readiness recomputes whenever the dashboard panel reloads (wrap, not replace)", () => {
    expect(DASHBOARD_SCRIPT).toContain("var _loadDashboard = loadDashboard;");
    expect(DASHBOARD_SCRIPT).toContain("await updateReadiness();");
    // …and the INITIAL paint is covered too (the wrapper only sees later loads).
    const initBlock = DASHBOARD_SCRIPT.slice(DASHBOARD_SCRIPT.indexOf("window.__xrT4 = {"));
    expect(initBlock).toContain("updateReadiness();");
  });
});

describe("T4 static — undo surface", () => {
  test("undo is a first-class, titled button on Durable Memory (never hidden in a menu)", () => {
    expect(DASHBOARD_SCRIPT).toContain('btn.id = "mem-undo-btn"');
    expect(DASHBOARD_SCRIPT).toContain("Undo the most recent memory/context mutation");
    expect(DASHBOARD_SCRIPT).toContain("↶ Undo last change");
    expect(DASHBOARD_SCRIPT).toContain('document.getElementById("mem-undo-btn")'); // idempotent init
  });

  test("undo calls the daemon ledger route and reports the RESTORED TARGET honestly", () => {
    expect(DASHBOARD_SCRIPT).toContain('apiPost("/api/context/undo", {})');
    expect(DASHBOARD_SCRIPT).toContain("res.restoredTarget.table");
    expect(DASHBOARD_SCRIPT).toContain("res.restoredTarget.id");
    expect(DASHBOARD_SCRIPT).toContain('toast("Nothing to undo", "info")'); // empty ledger is honest, not fake-success
  });

  test("memory view refreshes from the server after undo (no stale local fiction)", () => {
    const undoBlock = DASHBOARD_SCRIPT.slice(DASHBOARD_SCRIPT.indexOf('btn.id = "mem-undo-btn"'));
    expect(undoBlock.indexOf("loadMemory();")).toBeGreaterThan(-1);
  });
});

describe("T4 static — capability badges", () => {
  test("exactly four badge states exist, mapped from real lifecycle/certification data", () => {
    for (const state of ['"works-now"', '"setup-required"', '"experimental"', '"unsupported-here"']) {
      expect(DASHBOARD_SCRIPT).toContain(state);
    }
    expect(DASHBOARD_SCRIPT).toContain("c.lifecycle.state");
    expect(DASHBOARD_SCRIPT).toContain("c.lifecycle.enabled");
    expect(DASHBOARD_SCRIPT).toContain("c.certification.status");
  });

  test("every badge carries its WHY as a tooltip (hover/focus explains the state)", () => {
    for (const why of [
      "Quarantined — blocked from running",
      "Experimental — unverified",
      "Installed but not enabled",
      "Enabled and verified to work",
    ]) {
      expect(DASHBOARD_SCRIPT).toContain(why);
    }
    expect(DASHBOARD_SCRIPT).toContain(`title="' + escapeHtml(b[2]) + '">'`);
  });

  test("badge colours are semantic classes, and badge styles exist with AA-legible colours", () => {
    for (const cls of ["badge-red", "badge-violet", "badge-amber", "badge-green"]) {
      expect(DASHBOARD_SCRIPT).toContain(`"${cls}"`);
      expect(DASHBOARD_CSS).toContain(`.${cls}`);
    }
    expect(DASHBOARD_SCRIPT).toContain("window.__xrT4 = {");
    expect(DASHBOARD_SCRIPT).toContain("capabilityBadge: capabilityBadge");
  });
});
