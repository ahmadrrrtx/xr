/**
 * UX Phase D — TUI parity & polish (static + pure-function gates).
 *
 *   · D-1 — brand indigo reaches the TUI truecolor path (RGB.violet was stale
 *     at the old purple after the official-palette fix); status bar gains
 *     honest context (ctx msgs), real tokens, LOCAL/CLOUD parity word, and
 *     the agent-detail chip; the agent-detail toggle cycles and gates the
 *     real tool-timeline block in the chat feed (no fake reasoning channel).
 *   · D-2 — `?` help is refreshed (Ctrl+T, /inspect, expanded g-chords,
 *     status-bar legend, GUI-mode parity note); the voice glyph is
 *     terminal-safe (no emoji).
 */

import { describe, expect, test } from "bun:test";
import { COLOR, RGB } from "../../src/ui/tokens.ts";
import { glyph } from "../../src/ui/icons.ts";
import { helpBindings } from "../../src/ui/primitives.ts";
import { renderStatusBar, renderMain } from "../../src/interfaces/shell/render.ts";
import { stripAnsi } from "../../src/ui/ansi.ts";
import { cycleAgentDetail, type AgentDetail, type ShellState } from "../../src/interfaces/shell/types.ts";

function fakeState(over: Partial<ShellState> = {}): ShellState {
  return {
    cwd: "/tmp/xr",
    meta: { name: "xr" },
    wm: undefined as never,
    store: undefined as never,
    workspaceId: "default",
    sessionTitle: "new session",
    provider: "ollama",
    model: "qwen2.5:7b",
    mode: "agent",
    agentDetail: "brief",
    budget: 0.25,
    totalSpent: 0.0012,
    totalTokens: 12_345,
    busy: false,
    busyLabel: "idle",
    runAbort: null,
    spinnerIndex: 0,
    view: "chat",
    sidebarIndex: 0,
    focus: "composer",
    overlay: "none",
    input: "",
    cursor: 0,
    inputHistory: [],
    inputHistoryIndex: -1,
    chat: [
      { role: "assistant", at: Date.now(), meta: "XR", content: "welcome" },
      { role: "user", at: Date.now(), content: "hello" },
      { role: "assistant", at: Date.now(), content: "hi there" },
    ],
    chatScroll: 0,
    timeline: [
      { at: Date.now(), title: "read src/x.ts", level: "info" },
      { at: Date.now(), title: "write src/y.ts", detail: "created 12 lines", level: "ok" },
    ],
    notices: [],
    paletteQuery: "",
    paletteIndex: 0,
    startupSection: "workspace",
    workspaceIndex: 0,
    sessionIndex: 0,
    sessions: [],
    research: [],
    exitArmed: false,
    gPending: false,
    shouldExit: false,
    dirty: false,
    showInspector: true,
    bootPhase: 0,
    helpSeen: 0,
    auditValid: true,
    ...over,
  };
}

describe("D-1 — brand indigo reaches the TUI truecolor path", () => {
  test("RGB.violet is the official indigo and matches COLOR.violet", () => {
    expect(RGB.violet).toEqual([96, 72, 248]);
    const [r, g, b] = RGB.violet;
    expect(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase())
      .toBe(COLOR.violet.toUpperCase());
  });
});

describe("D-1 — the agent-detail toggle (pure cycle)", () => {
  test("cycles none → brief → detailed → none", () => {
    expect(cycleAgentDetail("none")).toBe("brief");
    expect(cycleAgentDetail("brief")).toBe("detailed");
    expect(cycleAgentDetail("detailed")).toBe("none");
  });
});

describe("D-1 — status bar carries honest context (real data only)", () => {
  test("wide terminal: LOCAL parity word, ctx messages, tokens, agt detail", () => {
    const out = stripAnsi(renderStatusBar(fakeState(), 132));
    expect(out).toContain("LOCAL");
    expect(out).toContain("default"); // workspace id
    expect(out).toContain("ctx 3");   // real chat length
    expect(out).toContain("12.3k tok");
    expect(out).toContain("agt brief");
    expect(out).toContain("ollama/qwen2.5:7b");
  });

  test("cloud provider shows the CLOUD word (not LOCAL)", () => {
    const out = stripAnsi(renderStatusBar(fakeState({ provider: "openai" }), 132));
    expect(out).toContain("CLOUD");
    expect(out).not.toContain("LOCAL");
  });

  test("narrow terminal omits the wide-only segments (graceful degradation)", () => {
    const out = stripAnsi(renderStatusBar(fakeState(), 70));
    expect(out).not.toContain("LOCAL");
    expect(out).not.toContain("ctx");
    expect(out).not.toContain("tok");
    expect(out).not.toContain("agt");
    expect(out).toContain("ollama/qwen2.5:7b"); // model chip always visible
  });
});

describe("D-1 — chat feed shows the REAL tool timeline per detail level", () => {
  test("brief: titles of agent work appear in the chat feed", () => {
    const out = stripAnsi(renderMain(fakeState(), 90, 24).join("\n"));
    expect(out).toContain("agent work");
    expect(out).toContain("read src/x.ts");
  });

  test("detailed: titles AND detail lines appear", () => {
    const out = stripAnsi(renderMain(fakeState({ agentDetail: "detailed" }), 90, 24).join("\n"));
    expect(out).toContain("write src/y.ts");
    expect(out).toContain("created 12 lines");
  });

  test("none: no agent-work block (final answers only)", () => {
    const out = stripAnsi(renderMain(fakeState({ agentDetail: "none" }), 90, 24).join("\n"));
    expect(out).not.toContain("agent work");
    expect(out).not.toContain("read src/x.ts");
  });
});

describe("D-2 — ? help is refreshed and matches the keymap", () => {
  test("help lists Ctrl+T, /inspect, the expanded g-chords and the status legend", () => {
    const body = stripAnsi(helpBindings(100).join("\n"));
    expect(body).toContain("Ctrl+T");
    expect(body).toContain("none / brief / detailed");
    expect(body).toContain("/inspect");
    expect(body).toContain("g d/c/s/w/r/t/a/m/b/x/./n");
    expect(body).toContain("status bar: ● locality · mode · model · $ spend · ctx msgs · agt detail");
    expect(body).toContain("GUI parity");
  });
});

describe("D-2 — glyph vocabulary is terminal-safe (no emoji in chrome)", () => {
  test("the voice glyph is a typographic symbol, not an emoji", () => {
    const g = glyph("voice");
    expect([...g].some((ch) => ch.codePointAt(0)! >= 0x1f000 && ch.codePointAt(0)! <= 0x1faff)).toBe(false);
    expect(g).toContain("♪");
  });
});
