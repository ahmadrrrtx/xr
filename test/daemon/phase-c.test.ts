/**
 * UX Phase C — chat & component architecture (static gates).
 *
 *   · C-1 — the served client script must PARSE (a real regression guard:
 *     an escaping mistake inside the template fragments previously shipped a
 *     SyntaxError that no test caught — the browser-axe sweeps are skipped
 *     without chromium, so a `new Function` parse gate is the cheap truth).
 *   · C-2 — approval cards surface WHAT / WHY / RISK from the real control
 *     plane (action, preview, risk.level/reason/reversible).
 *   · C-3 — streaming transparency: polite live-region announcer + streaming
 *     cursor + mid-code-fence note.
 *   · C-4 — sessions: search + copy-id + honest resume affordance.
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_PAGE, DASHBOARD_SCRIPT, DASHBOARD_CSS } from "../../src/daemon/dashboard.ts";

describe("C-1 — the served client script is valid JavaScript", () => {
  test("new Function(DASHBOARD_SCRIPT) does not throw (syntax gate)", () => {
    expect(() => new Function(DASHBOARD_SCRIPT)).not.toThrow();
  });

  test("no broken escaped-quote attribute patterns remain (lost-backslash bug)", () => {
    // the broken form was `('' + id + '')` inside a data-xr-action — a lost
    // backslash from the template layer. The correct idiom is \'' + id + '\'.
    expect(DASHBOARD_SCRIPT).not.toMatch(/data-xr-action="onbSelectProvider\(''/);
    expect(DASHBOARD_SCRIPT).not.toMatch(/data-xr-action="onbSetLocal\(''/);
    expect(DASHBOARD_SCRIPT).toContain("data-xr-action=\"answerApproval(\\''+a.id+'\\',true)\"");
    expect(DASHBOARD_SCRIPT).toContain("data-xr-action=\"onbSelectProvider(\\'' + p.id + '\\')\"");
  });
});

describe("C-2 — approval cards are WHAT / WHY / RISK, driven by the real plane", () => {
  test("the renderer reads action, preview and risk from /api/control/pending", () => {
    expect(DASHBOARD_SCRIPT).toContain("const risk=a.risk||{}");
    expect(DASHBOARD_SCRIPT).toContain("a.preview || 'This action needs your permission.'");
    expect(DASHBOARD_SCRIPT).toContain("approvalRiskLabel(risk.level)");
    expect(DASHBOARD_SCRIPT).toContain("risk.reversible");
  });

  test("risk levels map to honest badges and human labels", () => {
    expect(DASHBOARD_SCRIPT).toContain('if (level === "destructive") return ["DESTRUCTIVE", "badge-red"]');
    expect(DASHBOARD_SCRIPT).toContain('if (level === "sensitive") return ["SENSITIVE", "badge-amber"]');
    expect(DASHBOARD_SCRIPT).toContain('return ["SAFE", "badge-green"]');
  });

  test("action types become human labels (app/open/type/click/…) — never the raw id", () => {
    expect(DASHBOARD_SCRIPT).toContain('case "app": return "Launch app: "');
    expect(DASHBOARD_SCRIPT).toContain('case "open": return "Open: "');
    expect(DASHBOARD_SCRIPT).toContain('case "type": return "Type text"');
    expect(DASHBOARD_SCRIPT).toContain("default: return String(t).replace(/_/g, \" \")");
    expect(DASHBOARD_SCRIPT).not.toContain("escapeHtml(a.tool || a.id)");
  });

  test("cards are keyboard-accessible groups with an aria-label", () => {
    expect(DASHBOARD_SCRIPT).toContain('role="group" aria-label="Approval: ');
    expect(DASHBOARD_PAGE).toContain('id="approval-list" aria-live="polite"');
    expect(DASHBOARD_PAGE).toContain("Approvals</div>");
    expect(DASHBOARD_PAGE).not.toContain("Jarvis approvals");
  });

  test("approval card styles exist", () => {
    expect(DASHBOARD_CSS).toContain(".approval-what");
    expect(DASHBOARD_CSS).toContain(".approval-risk-reason");
  });
});

describe("C-3 — streaming transparency", () => {
  test("a polite live-region announcer exists and is announced on start/end/stop/error", () => {
    expect(DASHBOARD_PAGE).toContain('id="xr-stream-announcer" class="xr-sr-only" aria-live="polite"');
    /**
     * Phase 12 · Phase D — the wording changed DELIBERATELY, the guarantee did
     * not: every one of start / end / stop / error still reaches the SAME
     * polite live region, and none of them steals focus.
     *
     *   "XR is responding"     → setChatRunStatus("preparing") → announces the
     *                             canonical label. The old string was a vague
     *                             placeholder; the new one names the real state
     *                             and is refined by every subsequent status.
     *   "Response complete"    → still announced, now with the REAL token usage
     *                             from the `usage` event when one arrived.
     *   "Stopped"              → "Cancellation requested". The abort signals the
     *                             daemon, which cancels cooperatively at the
     *                             loop's next checkpoint — claiming it already
     *                             stopped overstated what the UI knows (§17).
     *   "XR hit an error"      → unchanged.
     */
    expect(DASHBOARD_SCRIPT).toContain('setChatRunStatus("preparing", null)');
    expect(DASHBOARD_SCRIPT).toContain("'Response complete'");
    expect(DASHBOARD_SCRIPT).toContain('announceStream("Cancellation requested")');
    expect(DASHBOARD_SCRIPT).toContain('announceStream("XR hit an error")');
    // The announcer must stay polite and must never be given focus.
    expect(DASHBOARD_SCRIPT).not.toContain('getElementById("xr-stream-announcer").focus');
  });

  test("the sr-only utility visually hides the announcer", () => {
    expect(DASHBOARD_CSS).toContain(".xr-sr-only");
    expect(DASHBOARD_CSS).toContain("clip: rect(0 0 0 0)");
  });

  test("a streaming cursor appears on the active message; code fences show a note", () => {
    expect(DASHBOARD_CSS).toContain(".msg.streaming .msg-bubble::after");
    expect(DASHBOARD_CSS).toContain('content: "▍"');
    expect(DASHBOARD_SCRIPT).toContain("function renderStreamNote(m)");
    expect(DASHBOARD_SCRIPT).toContain("…streaming code…");
  });
});

describe("C-4 — sessions search & resume affordances", () => {
  test("a sessions search input exists and filters the cached list client-side", () => {
    expect(DASHBOARD_PAGE).toContain('id="sess-search"');
    expect(DASHBOARD_SCRIPT).toContain("let sessCache = []");
    expect(DASHBOARD_SCRIPT).toContain("function renderSessionList()");
    expect(DASHBOARD_SCRIPT).toContain("sessCache.filter");
    expect(DASHBOARD_SCRIPT).toContain('inp.addEventListener("input", renderSessionList)');
  });

  test("rows offer an honest copy-id action and open the real step inspector", () => {
    expect(DASHBOARD_SCRIPT).toContain("Copy id");
    expect(DASHBOARD_SCRIPT).toContain("act('copyText', s.id)");
    expect(DASHBOARD_SCRIPT).toContain("act('loadSessionDetail', s.id)");
  });

  test("no fake resume is offered (opening a session shows real steps)", () => {
    expect(DASHBOARD_SCRIPT).not.toContain("resumeSession");
    expect(DASHBOARD_SCRIPT).toContain('title="Open session steps"');
  });
});

describe("Phase 12 · Phase D — chat consumes the canonical stream honestly", () => {
  test("the fabricated tool card is gone", () => {
    // This card described work XR was not doing ("Call provider hot-path
    // routing") and was stamped "Completed execution" on every run regardless
    // of outcome — the fake progress brief §7 forbids.
    // Asserted against the EXECUTABLE form: the phrase also appears in the
    // explanatory comment above the replacement, and a comment is not behaviour.
    expect(DASHBOARD_SCRIPT).not.toContain("addToolEvent('AI chat prompt'");
    expect(DASHBOARD_SCRIPT).not.toContain("updateToolEvent(toolId,'done','Completed execution')");
    // The single unconditional card the old code created for every request.
    expect(DASHBOARD_SCRIPT).not.toContain("const toolId = addToolEvent(");
  });

  test("real tool_call / tool_result / usage events are consumed", () => {
    expect(DASHBOARD_SCRIPT).toContain("j.type==='tool_call'");
    expect(DASHBOARD_SCRIPT).toContain("j.type==='tool_result'");
    expect(DASHBOARD_SCRIPT).toContain("j.type==='usage'");
    // A result must land on the SAME card as its call, correlated by event id.
    expect(DASHBOARD_SCRIPT).toContain("chatToolCards[j.id]");
  });

  test("an unobserved tool outcome is never reported as success", () => {
    expect(DASHBOARD_SCRIPT).toContain("No result reported");
  });

  test("the shared status vocabulary is interpolated, not duplicated", () => {
    // Interpolated from src/core/ux-status.ts — the browser copy cannot drift
    // from the kernel copy because there is only one copy.
    expect(DASHBOARD_SCRIPT).toContain("XR_RUN_STATUS_LABEL");
    expect(DASHBOARD_SCRIPT).toContain("function xrStatusLabel(status, detail)");
    // JSON.stringify emits compact JSON — assert the real serialized form.
    expect(DASHBOARD_SCRIPT).toContain('"awaiting_approval":"Waiting for approval"');
  });
});
