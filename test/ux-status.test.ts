/**
 * XR Phase 12 · Phase C — the canonical UX status vocabulary.
 *
 * These tests protect the property the whole phase exists for: ONE state model,
 * many interfaces. Two of them are anti-drift gates — if the browser copy of the
 * vocabulary ever stops matching the kernel copy, or a status loses its label,
 * the suite fails instead of the surfaces quietly diverging again.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RUN_STATUSES,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  TERMINAL_RUN_STATUSES,
  UX_STATUS_JS,
  isActiveRunStatus,
  isRunStatus,
  isTerminalRunStatus,
  runStatusLabel,
  runStatusTone,
} from "../src/core/ux-status.ts";
import { runAgent } from "../src/core/agent.ts";
import { Store } from "../src/state/workspace-store.ts";
import type { ChatStreamEvent, Message, ModelTurn, Provider, Tool } from "../src/core/types.ts";

describe("Phase 12 · C — the vocabulary is complete and self-consistent", () => {
  test("every status has a non-empty label", () => {
    for (const s of RUN_STATUSES) {
      expect(typeof RUN_STATUS_LABEL[s]).toBe("string");
      expect(RUN_STATUS_LABEL[s].length).toBeGreaterThan(0);
    }
  });

  test("every status has a tone, and the tone set is closed", () => {
    const tones = new Set(["idle", "active", "wait", "ok", "warn", "error"]);
    for (const s of RUN_STATUSES) {
      expect(tones.has(RUN_STATUS_TONE[s])).toBe(true);
    }
  });

  test("no label is duplicated — one state, one name", () => {
    const labels = RUN_STATUSES.map((s) => RUN_STATUS_LABEL[s]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("terminal statuses are exactly done/error and are not 'active'", () => {
    expect(TERMINAL_RUN_STATUSES).toEqual(["done", "error"]);
    for (const s of TERMINAL_RUN_STATUSES) {
      expect(isTerminalRunStatus(s)).toBe(true);
      expect(isActiveRunStatus(s)).toBe(false);
    }
    expect(isActiveRunStatus("generating")).toBe(true);
    expect(isActiveRunStatus("tool_running")).toBe(true);
  });

  test("awaiting_approval is a 'wait', never an 'active' state", () => {
    // A run blocked on a human must not spin as if it were progressing.
    expect(RUN_STATUS_TONE.awaiting_approval).toBe("wait");
    expect(isActiveRunStatus("awaiting_approval")).toBe(false);
  });

  test("the brief's §7 states that have no emission point are NOT declared", () => {
    // Declaring a status nothing ever emits would be fake progress by another
    // name. If a future phase wires these up for real, this test should be
    // updated deliberately — not by accident.
    for (const absent of ["searching_web", "reading_source", "retrying", "provider_switching"]) {
      expect(isRunStatus(absent)).toBe(false);
    }
  });
});

describe("Phase 12 · C — unknown ids degrade honestly instead of throwing", () => {
  test("an unknown id is humanised, not hidden", () => {
    expect(runStatusLabel("provider_ready")).toBe("Provider ready");
    expect(runStatusLabel("some_legacy_state")).toBe("Some legacy state");
    expect(runStatusLabel("")).toBe("Working");
  });

  test("an unknown id is treated as active (something is happening)", () => {
    expect(runStatusTone("some_legacy_state")).toBe("active");
  });

  test("detail is appended only when the caller really has it", () => {
    expect(runStatusLabel("tool_running", "read_file")).toBe("Running tool · read_file");
    expect(runStatusLabel("tool_running")).toBe("Running tool");
  });
});

describe("Phase 12 · C — the served dashboard copy cannot drift from the kernel", () => {
  test("UX_STATUS_JS is valid JavaScript", () => {
    expect(() => new Function(UX_STATUS_JS)).not.toThrow();
  });

  test("the interpolated labels/tones equal the TypeScript source exactly", () => {
    // This is the anti-drift gate: the browser gets the same table by
    // construction, so the Control Center and the Shell cannot disagree about
    // what a status means.
    const sandbox: Record<string, unknown> = {};
    new Function(
      "out",
      `${UX_STATUS_JS}\nout.label = XR_RUN_STATUS_LABEL; out.tone = XR_RUN_STATUS_TONE;
       out.labelOf = xrStatusLabel; out.toneOf = xrStatusTone;`,
    )(sandbox);

    expect(sandbox.label).toEqual(RUN_STATUS_LABEL);
    expect(sandbox.tone).toEqual(RUN_STATUS_TONE);

    const labelOf = sandbox.labelOf as (s: string, d?: string) => string;
    const toneOf = sandbox.toneOf as (s: string) => string;
    for (const s of RUN_STATUSES) {
      expect(labelOf(s)).toBe(runStatusLabel(s));
      expect(toneOf(s)).toBe(runStatusTone(s));
    }
    // Unknown-id behaviour must match too.
    expect(labelOf("some_legacy_state")).toBe(runStatusLabel("some_legacy_state"));
    expect(labelOf("tool_running", "read_file")).toBe(runStatusLabel("tool_running", "read_file"));
    expect(toneOf("some_legacy_state")).toBe(runStatusTone("some_legacy_state"));
  });
});

// ── The loop really emits these ──────────────────────────────────────────────

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ux-"));
  process.env.XR_HOME = join(tmp, "home");
});

function mockProvider(turns: ModelTurn[]): Provider {
  let i = 0;
  return {
    id: "mock",
    label: "Mock",
    async chat(_m: Message[], _t: Tool[]): Promise<ModelTurn> {
      return turns[Math.min(i++, turns.length - 1)]!;
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  };
}

function statusesOf(events: ChatStreamEvent[]): string[] {
  return events
    .filter((e): e is Extract<ChatStreamEvent, { type: "status" }> => e.type === "status")
    .map((e) => e.status);
}

describe("Phase 12 · C — the loop publishes truthful progress", () => {
  test("a plain run emits provider_ready → compacting_context → generating → finishing", async () => {
    const store = new Store(join(tmp, "a.db"));
    const events: ChatStreamEvent[] = [];
    const result = await runAgent("hello", "ask", {
      provider: mockProvider([{ message: "Hi there.", toolCalls: [], done: true }]),
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => true,
      onStreamEvent: (e) => events.push(e),
      maxSteps: 3,
    });

    const statuses = statusesOf(events);
    expect(result.stopped).toBe("done");
    // Order matters: these describe a real sequence, so assert the sequence.
    expect(statuses).toEqual(["provider_ready", "compacting_context", "generating", "finishing"]);
    // Every emitted status must be a member of the canonical vocabulary — this
    // is what stops a surface receiving a label it cannot render.
    for (const s of statuses) expect(isRunStatus(s)).toBe(true);
    store.close();
  });

  test("a tool call emits tool_running carrying the real tool name", async () => {
    const store = new Store(join(tmp, "b.db"));
    const events: ChatStreamEvent[] = [];
    const echoTool: Tool = {
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      requiresApproval: false,
      async run(args: Record<string, unknown>) {
        return { ok: true, output: String(args.text ?? "") };
      },
    };
    await runAgent("echo hi", "agent", {
      provider: mockProvider([
        { message: "calling", toolCalls: [{ tool: "echo", args: { text: "hi" } }], done: false },
        { message: "done", toolCalls: [], done: true },
      ]),
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => true,
      onStreamEvent: (e) => events.push(e),
      extraTools: [echoTool],
      maxSteps: 5,
    });

    const toolRunning = events.filter(
      (e): e is Extract<ChatStreamEvent, { type: "status" }> =>
        e.type === "status" && e.status === "tool_running",
    );
    expect(toolRunning.length).toBe(1);
    // The tool name rides in `message`, which is what the Shell footer and the
    // Control Center status chip both render — no surface has to scrape say().
    expect(toolRunning[0]!.message).toBe("echo");

    // Two tool_running steps means two turns ran; each turn compacts first.
    expect(statusesOf(events).filter((s) => s === "generating").length).toBe(2);
    store.close();
  });
});
