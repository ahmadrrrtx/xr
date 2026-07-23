import { describe, expect, test } from "bun:test";
import {
  transition,
  isTerminal,
  canRun,
  TERMINAL_STATES,
  STATE_CLASS,
} from "../../src/execution/state-machine.ts";
import type { ExecutionState } from "../../src/execution/types.ts";
import { InvalidExecutionTransitionError } from "../../src/execution/errors.ts";

describe("XR 4.1 execution state machine", () => {
  test("new execution starts at created and may plan/submit_policy/authorize/queue/cancel", () => {
    expect(transition("r1", null, "plan").next).toBe("planned");
    expect(transition("r2", null, "submit_policy").next).toBe("awaiting_policy");
    expect(transition("r3", null, "authorize").next).toBe("authorized");
    expect(transition("r4", null, "queue").next).toBe("queued");
    expect(transition("r5", null, "cancel").next).toBe("cancelled");
    expect(transition("r6", null, "mark_unavailable").next).toBe("unavailable");
  });

  test("planned → submit_policy/authorize/queue/cancel/deny/budget_block", () => {
    const cases: [string, ExecutionState][] = [
      ["submit_policy", "awaiting_policy"],
      ["authorize", "authorized"],
      ["queue", "queued"],
      ["cancel", "cancelled"],
      ["deny", "denied"],
      ["budget_block", "budget_blocked"],
      ["mark_unavailable", "unavailable"],
    ];
    for (const [evt, want] of cases) {
      expect(transition("r", "planned", evt as any).next).toBe(want);
    }
  });

  test("awaiting_approval → grant_approval/deny/cancel/timeout", () => {
    expect(transition("r", "awaiting_approval", "grant_approval").next).toBe("authorized");
    expect(transition("r", "awaiting_approval", "deny").next).toBe("denied");
    expect(transition("r", "awaiting_approval", "cancel").next).toBe("cancelled");
    expect(transition("r", "awaiting_approval", "timeout").next).toBe("timed_out");
  });

  test("running → observe/succeed/partial/fail/cancel/timeout", () => {
    expect(transition("r", "running", "observe").next).toBe("observing");
    expect(transition("r", "running", "succeed").next).toBe("succeeded");
    expect(transition("r", "running", "partial").next).toBe("partially_completed");
    expect(transition("r", "running", "fail").next).toBe("failed");
    expect(transition("r", "running", "cancel").next).toBe("cancelled");
    expect(transition("r", "running", "timeout").next).toBe("timed_out");
  });

  test("invalid transitions throw InvalidExecutionTransitionError", () => {
    expect(() => transition("r", "succeeded", "start")).toThrow(InvalidExecutionTransitionError);
    expect(() => transition("r", "cancelled", "start")).toThrow(InvalidExecutionTransitionError);
    expect(() => transition("r", "denied", "start")).toThrow(InvalidExecutionTransitionError);
    expect(() => transition("r", "running", "grant_approval")).toThrow(InvalidExecutionTransitionError);
    expect(() => transition("r", null as any, "succeed")).toThrow(InvalidExecutionTransitionError);
  });

  test("terminal states are classified correctly", () => {
    for (const s of TERMINAL_STATES) {
      expect(isTerminal(s)).toBe(true);
      expect(STATE_CLASS[s]).toBe("terminal");
    }
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("authorized")).toBe(false);
    expect(isTerminal("queued")).toBe(false);
  });

  test("canRun is true only for authorized/queued", () => {
    expect(canRun("authorized")).toBe(true);
    expect(canRun("queued")).toBe(true);
    expect(canRun("running")).toBe(false);
    expect(canRun("created")).toBe(false);
    expect(canRun("succeeded")).toBe(false);
  });

  test("history entries carry timestamp and reason", () => {
    const now = 1234567890;
    const { entry } = transition("r", null, "plan", "intent accepted", now);
    expect(entry.from).toBeNull();
    expect(entry.to).toBe("planned");
    expect(entry.at).toBe(now);
    expect(entry.reason).toBe("intent accepted");
  });
});
