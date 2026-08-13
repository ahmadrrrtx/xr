/**
 * UX Phase B — shell refinements + empty state + onboarding (static gates).
 *
 * These are cheap, deterministic guards for the Phase B surfaces. Runtime
 * behavior is verified by the route tests and the live probe; these pin the
 * structure so a future change cannot silently drop a surface.
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_PAGE, DASHBOARD_SCRIPT, DASHBOARD_CSS } from "../../src/daemon/dashboard.ts";

describe("B-2 — information-architecture shell", () => {
  test("sidebar groups use the user-language labels", () => {
    for (const label of ["Start", "Ask", "Capabilities", "Guard", "System"]) {
      expect(DASHBOARD_PAGE).toContain(`<div class="sidebar-label">${label}</div>`);
    }
    // the old group names must not appear as rendered labels (comments may
    // still carry the historical section titles)
    for (const gone of ["Mission Hub", "AI Resources", "Platforms & Tools", "Governance & Trust", "Core Services"]) {
      expect(DASHBOARD_PAGE).not.toContain(`<div class="sidebar-label">${gone}</div>`);
    }
  });

  test("the default landing view is Chat", () => {
    expect(DASHBOARD_PAGE).toContain('class="nav-item active" data-panel="chat" aria-current="page"');
    expect(DASHBOARD_PAGE).toContain('id="panel-chat">');
    expect(DASHBOARD_PAGE).toContain('class="panel xr-s-10 active"');
    expect(DASHBOARD_PAGE).not.toContain('class="nav-item active" data-panel="dashboard"');
    expect(DASHBOARD_PAGE).toContain('id="breadcrumb-active" class="xr-s-4" aria-current="page">Chat Sessions</span>');
  });

  test("sidebar collapse and inspector toggle exist and persist", () => {
    expect(DASHBOARD_PAGE).toContain('data-xr-action="toggleSidebar()"');
    expect(DASHBOARD_PAGE).toContain('data-xr-action="toggleInspector()"');
    expect(DASHBOARD_SCRIPT).toContain("const SIDEBAR_KEY = \"xr.sidebar.collapsed\"");
    expect(DASHBOARD_SCRIPT).toContain("const INSPECTOR_KEY = \"xr.inspector.hidden\"");
    expect(DASHBOARD_SCRIPT).toContain("applyShellPrefs()");
    expect(DASHBOARD_CSS).toContain(".app.sidebar-collapsed .sidebar");
    expect(DASHBOARD_CSS).toContain(".chat-wrap.inspector-hidden");
  });
});

describe("B-3 — chat empty-state hero (real prompts, real navigation)", () => {
  test("the hero exists with the official avatar and suggested prompts", () => {
    expect(DASHBOARD_PAGE).toContain('id="chat-empty-state" hidden');
    expect(DASHBOARD_PAGE).toContain('src="__XR_AVATAR__"');
    expect(DASHBOARD_PAGE).toContain("What can I help you with?");
    for (const cmd of ["/status", "/budget", "/memory"]) {
      expect(DASHBOARD_PAGE).toContain(`quickPrompt('${cmd}')`);
    }
    // the /plan prompt fills the composer instead (it needs an argument)
    expect(DASHBOARD_PAGE).toContain("insertHint('/plan ')");
  });

  test("the prompts run real slash commands (quickPrompt is defined)", () => {
    expect(DASHBOARD_SCRIPT).toContain("function quickPrompt(text)");
    expect(DASHBOARD_SCRIPT).toContain("sendChatMessage(text)");
  });

  test("capability chips navigate to real panels", () => {
    for (const panel of ["models", "providers", "skills", "memory", "shield", "budget"]) {
      expect(DASHBOARD_PAGE).toContain(`navigateTo('${panel}')`);
    }
  });

  test("renderMessages toggles the hero instead of stamping a placeholder", () => {
    expect(DASHBOARD_SCRIPT).toContain('const emptyState = document.getElementById("chat-empty-state")');
    expect(DASHBOARD_SCRIPT).toContain("emptyState.hidden = false");
    expect(DASHBOARD_SCRIPT).not.toContain("Operating Command Composer");
  });
});

describe("B-1 — onboarding overlay (honest, real engines)", () => {
  test("the overlay is a labelled modal, not another panel", () => {
    expect(DASHBOARD_PAGE).toContain('class="onboarding-overlay" id="onboarding-root" hidden');
    expect(DASHBOARD_PAGE).toContain('role="dialog" aria-modal="true" aria-label="Set up XR"');
    expect(DASHBOARD_PAGE).toContain('id="onb-progress" aria-label="Setup steps"');
    // the 26-panel count must be untouched
    const panels = DASHBOARD_PAGE.match(/<div class="panel[^"]*" tabindex="-1" id="panel-/g) ?? [];
    expect(panels.length).toBe(26);
  });

  test("the steps are the real engines, exposed honestly", () => {
    expect(DASHBOARD_PAGE).toContain("onbPickMode('cloud')");
    expect(DASHBOARD_PAGE).toContain("onbPickMode('local')");
    expect(DASHBOARD_PAGE).toContain("onbPickMode('both')");
    expect(DASHBOARD_PAGE).toContain("Save &amp; test connection");
    expect(DASHBOARD_PAGE).toContain("Monthly cap (USD)");
  });

  test("the client wires the state machine and only writes through real routes", () => {
    expect(DASHBOARD_SCRIPT).toContain('apiPost("/api/onboarding/provider"');
    expect(DASHBOARD_SCRIPT).toContain('apiPost("/api/onboarding/complete"');
    expect(DASHBOARD_SCRIPT).toContain('apiPost("/api/budget/set"');
    expect(DASHBOARD_SCRIPT).toContain('apiPost("/api/models/select"');
    expect(DASHBOARD_SCRIPT).toContain('api("/api/onboarding/status")');
    expect(DASHBOARD_SCRIPT).toContain('api("/api/providers/catalog")');
    expect(DASHBOARD_SCRIPT).toContain("function onboardingInit()");
    expect(DASHBOARD_SCRIPT).toContain("if (status.needsSetup && !dismissed) onbShow()");
  });

  test("onboarding actions are allowlisted (dispatcher can run them)", () => {
    const allow = DASHBOARD_SCRIPT.match(/var XR_ACTIONS = new Set\(\[([^\]]+)\]/)?.[1] ?? "";
    for (const fn of ["onbGo", "onbNext", "onbBack", "onbPickMode", "onbSelectProvider", "onbConnectProvider", "onbSetLocal", "onbSetBudget", "onbComplete", "onbSkip", "quickPrompt", "toggleSidebar", "toggleInspector"]) {
      expect(allow).toContain(`"${fn}"`);
    }
  });
});
