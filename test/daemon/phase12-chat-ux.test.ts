/**
 * Phase 12 — dashboard/chat UX static gates.
 *
 * Served JS must parse, consume the Phase 05 stream contract, send the
 * runtime mode, and never advertise fake slash commands or Loading… spinners.
 */
import { describe, expect, test } from "bun:test";
import { DASHBOARD_SCRIPT, DASHBOARD_PAGE, DASHBOARD_CSS } from "../../src/daemon/dashboard.ts";
import { SLASH_COMMANDS } from "../../src/ui/slash-catalog.ts";

describe("Phase 12 · served client still parses", () => {
  test("new Function(DASHBOARD_SCRIPT) does not throw", () => {
    expect(() => new Function(DASHBOARD_SCRIPT)).not.toThrow();
  });
});

describe("Phase 12 · streaming consumption", () => {
  test("chat client handles token, tool_call, tool_result, usage, done, error, status", () => {
    expect(DASHBOARD_SCRIPT).toContain('j.type === "token"');
    expect(DASHBOARD_SCRIPT).toContain('j.type === "tool_call"');
    expect(DASHBOARD_SCRIPT).toContain('j.type === "tool_result"');
    expect(DASHBOARD_SCRIPT).toContain('j.type === "usage"');
    expect(DASHBOARD_SCRIPT).toContain('j.type === "done"');
    expect(DASHBOARD_SCRIPT).toContain('j.type === "error"');
    expect(DASHBOARD_SCRIPT).toContain('j.type === "status"');
    expect(DASHBOARD_SCRIPT).toContain("approval_required");
  });
  test("history is still last-10 (honest context contract)", () => {
    expect(DASHBOARD_SCRIPT).toContain(".slice(-10)");
    expect(DASHBOARD_SCRIPT).toContain("Context: last 10 messages");
  });
  test("the POST body includes runtime mode (ask|plan|agent), not a fake Research mode", () => {
    expect(DASHBOARD_SCRIPT).toContain("mode: apiMode(chatState.mode)");
    expect(DASHBOARD_SCRIPT).toContain("const modes=['Ask','Plan','Agent']");
    expect(DASHBOARD_SCRIPT).not.toContain("const modes=['Ask','Plan','Research','Agent']");
  });
  test("no Loading… spinner copy for generation", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("Loading...");
    expect(DASHBOARD_SCRIPT).toContain("xrStatusLabel");
    expect(DASHBOARD_SCRIPT).toContain("Selecting provider");
  });
});

describe("Phase 12 · slash commands are catalog-backed", () => {
  test("chat slash handlers exist for every chat-surface catalog command except those that fall through to streamChat", () => {
    const chatCmds = SLASH_COMMANDS.filter((c) => c.surfaces.includes("chat"));
    for (const c of chatCmds) {
      expect(DASHBOARD_SCRIPT).toContain(`/${c.name}`);
    }
  });
  test("/compact is honest (does not pretend to compact)", () => {
    expect(DASHBOARD_SCRIPT).toContain("will not pretend to compact");
  });
  test("/help is served from the injected catalog, not a hand-copied list", () => {
    expect(DASHBOARD_SCRIPT).toContain("const XR_SLASH = ");
    expect(DASHBOARD_SCRIPT).toContain("function xrSlashHelp()");
  });
});

describe("Phase 12 · progressive disclosure + approval", () => {
  test("disclosure chips and run-status live region exist", () => {
    expect(DASHBOARD_PAGE).toContain('id="chat-run-status"');
    expect(DASHBOARD_SCRIPT).toContain("function renderDisclosures");
    expect(DASHBOARD_SCRIPT).toContain("function toggleDisclosure");
    expect(DASHBOARD_SCRIPT).toContain("function answerChatApproval");
    expect(DASHBOARD_CSS).toContain(".disclosure-chip");
    expect(DASHBOARD_CSS).toContain(".chat-run-status");
  });
  test("approval buttons are allowlisted and hit /api/chat/approve", () => {
    expect(DASHBOARD_SCRIPT).toContain('XR_ACTIONS = new Set([');
    expect(DASHBOARD_SCRIPT).toContain('"answerChatApproval"');
    expect(DASHBOARD_SCRIPT).toContain('"toggleDisclosure"');
    expect(DASHBOARD_SCRIPT).toContain('apiPost("/api/chat/approve"');
  });
  test("Esc interrupt is truthful (checkpoint wait, not instant stopped)", () => {
    expect(DASHBOARD_SCRIPT).toContain("Cancellation requested. Waiting for a safe checkpoint");
    expect(DASHBOARD_SCRIPT).not.toContain("_Stopped by administrator._");
  });
});

describe("Phase 12 · first paint does not block chat on the dashboard bundle", () => {
  test("chat-first route skips loadDashboard()", () => {
    expect(DASHBOARD_SCRIPT).toContain('if (routeMarker === "dashboard")');
    expect(DASHBOARD_SCRIPT).toContain("loadProviderChip()");
    // The unconditional loadDashboard() on boot is gone.
    expect(DASHBOARD_SCRIPT).not.toMatch(/navigateTo\(routeMarker\);\s*loadDashboard\(\)/);
  });
  test("New task is a primary overview action", () => {
    expect(DASHBOARD_PAGE).toContain("New task");
    expect(DASHBOARD_PAGE).toContain("navigateTo('chat')");
  });
});

describe("Phase 12 · empty states teach the next action", () => {
  test("sessions/memory/research empty copy is not 'No data.'", () => {
    expect(DASHBOARD_SCRIPT).toContain("No sessions yet.");
    expect(DASHBOARD_SCRIPT).toContain("No memory yet.");
    expect(DASHBOARD_SCRIPT).toContain("No research yet.");
    expect(DASHBOARD_SCRIPT).not.toContain("No data.");
  });
});

describe("Phase 12 · keyboard: Ctrl+K and Alt+P work even in the composer", () => {
  test("palette and provider shortcuts are bound before the input early-return", () => {
    expect(DASHBOARD_SCRIPT).toContain('e.key === "k" && (e.metaKey || e.ctrlKey)');
    expect(DASHBOARD_SCRIPT).toContain("e.altKey");
    expect(DASHBOARD_SCRIPT).toContain('navigateTo("providers")');
  });
});
