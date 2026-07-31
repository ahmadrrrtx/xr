/**
 * Phase 0 · T7 — no stub tools, no no-op "success".
 *
 * Two guarantees are tested:
 *   1. The registry no longer exports tools that cannot act.
 *   2. No tool may report ok:true while announcing that the action did not run.
 *
 * Guarantee 2 is enforced structurally by `assertNoNoOpSuccess`, so the tests
 * exercise the guard directly as well as through the registry.
 */

import { describe, expect, test } from "bun:test";
import {
  SYSTEM_TOOLS,
  REMOVED_STUB_TOOLS,
  assertNoNoOpSuccess,
} from "../../src/computer/system-control.ts";
import { allTools, toolsForMode, getTool } from "../../src/tools/registry.ts";
import type { ToolContext, ToolResult } from "../../src/core/types.ts";

describe("Phase 0 · T7 — stub tools are gone", () => {
  test("no removed stub tool is exported by the system-control module", () => {
    const exported = SYSTEM_TOOLS.map((t) => t.name);
    for (const removed of REMOVED_STUB_TOOLS) {
      expect(exported).not.toContain(removed);
    }
  });

  test("no removed stub tool is reachable through the global registry", () => {
    const registered = allTools().map((t) => t.name);
    for (const removed of REMOVED_STUB_TOOLS) {
      expect(registered).not.toContain(removed);
      expect(getTool(removed)).toBeUndefined();
    }
  });

  test("no removed stub tool is offered in any mode", () => {
    for (const mode of ["agent", "plan", "ask"] as const) {
      const names = toolsForMode(mode).map((t) => t.name);
      for (const removed of REMOVED_STUB_TOOLS) {
        expect(names).not.toContain(removed);
      }
    }
  });

  test("the surviving system tools are the five that actually act", () => {
    expect(SYSTEM_TOOLS.map((t) => t.name).sort()).toEqual(
      ["system_apps", "system_clipboard_read", "system_clipboard_write", "system_notify", "system_open_app"].sort(),
    );
  });
});

describe("Phase 0 · T7 — the no-op-success guard", () => {
  const cases: Array<[string, string]> = [
    ["volume control unavailable in this build", "unavailable"],
    ["battery status unavailable in this build", "unavailable"],
    ["wifi status is not available on this platform", "not available"],
    ["this action is not supported here", "not supported"],
    ["not implemented yet", "not implemented"],
    ["use computer_control for screenshots instead", "redirect"],
  ];

  for (const [output, label] of cases) {
    test(`ok:true + "${label}" is downgraded to a failure`, () => {
      const guarded = assertNoNoOpSuccess({ ok: true, output }, "some_tool");
      expect(guarded.ok).toBe(false);
      expect(guarded.output).toContain("action did not run");
    });
  }

  test("a genuine success is left untouched", () => {
    const result: ToolResult = { ok: true, output: "clipboard updated" };
    expect(assertNoNoOpSuccess(result, "system_clipboard_write")).toEqual(result);
  });

  test("a dry-run preview is exempt (it is a truthful simulation, clearly labelled)", () => {
    const result: ToolResult = { ok: true, output: "[dry-run] would open Safari" };
    expect(assertNoNoOpSuccess(result, "system_open_app").ok).toBe(true);
  });

  test("an explicit failure passes through unchanged", () => {
    const result: ToolResult = { ok: false, output: "clipboard write denied" };
    expect(assertNoNoOpSuccess(result, "system_clipboard_write")).toEqual(result);
  });
});

describe("Phase 0 · T7 — live tool behaviour on this platform", () => {
  const ctx: ToolContext = {
    cwd: process.cwd(),
    dryRun: false,
    approve: async () => false, // deny everything: we are testing refusal paths
    audit: () => {},
    say: () => {},
  } as unknown as ToolContext;

  test("no registered tool returns ok:true while declaring itself unavailable", async () => {
    // Only run the non-approval, read-style tools: approval-gated tools are
    // denied above and must report ok:false, which is asserted separately.
    for (const tool of SYSTEM_TOOLS.filter((t) => !t.requiresApproval)) {
      const result = await tool.run({}, ctx);
      if (result.ok) {
        expect(String(result.output)).not.toMatch(/unavailable|not available|not supported|not implemented/i);
      }
    }
  });

  test("approval-gated tools report failure when approval is denied", async () => {
    for (const tool of SYSTEM_TOOLS.filter((t) => t.requiresApproval)) {
      const result = await tool.run({ name: "x", text: "x", value: "x" }, ctx);
      expect(result.ok).toBe(false);
    }
  });
});
