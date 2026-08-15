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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 06 · Step 4 — STATE MACHINE INTEGRITY.
// Invalid transitions must be REJECTED, never silently accepted. Terminal and
// post-terminal states must not quietly re-enter the active lifecycle.
// ═══════════════════════════════════════════════════════════════════════════
describe("Phase 06 · state machine integrity (spec step 4)", () => {
  test("the canonical happy-path lifecycle is valid end to end", () => {
    let s: any = null;
    s = transition("r", s, "plan").next;            // task_accepted → plan_recorded
    expect(s).toBe("planned");
    s = transition("r", s, "submit_policy").next;   // → policy_admitted path
    expect(s).toBe("awaiting_policy");
    s = transition("r", s, "authorize").next;       // policy admitted
    expect(s).toBe("authorized");
    s = transition("r", s, "queue").next;           // env/step ready
    expect(s).toBe("queued");
    s = transition("r", s, "start").next;           // step_started
    expect(s).toBe("running");
    s = transition("r", s, "observe").next;         // tool/model turn observed
    expect(s).toBe("observing");
    s = transition("r", s, "succeed").next;         // step_completed / cleanup
    expect(s).toBe("succeeded");
  });

  test("terminal states reject re-entry into the active lifecycle", () => {
    // cancelled → tool_call_completed must NOT be accepted
    expect(() => transition("r", "cancelled", "observe")).toThrow();
    expect(() => transition("r", "cancelled", "succeed")).toThrow();
    expect(() => transition("r", "cancelled", "start")).toThrow();
    // succeeded/cleanup_completed → step_started must NOT silently succeed
    expect(() => transition("r", "succeeded", "start")).toThrow();
    expect(() => transition("r", "succeeded", "queue")).toThrow();
    expect(() => transition("r", "failed", "start")).toThrow();
    expect(() => transition("r", "timed_out", "observe")).toThrow();
  });

  test("skipping required stages is rejected", () => {
    // cannot start running before authorize/queue
    expect(() => transition("r", "created", "start")).toThrow();
    expect(() => transition("r", "planned", "start")).toThrow();
    // cannot succeed from created without ever running
    expect(() => transition("r", "created", "succeed")).toThrow();
  });

  test("retry is only legal from failed/timed_out (pre-side-effect), enforced by service", () => {
    expect(transition("r", "failed", "retry").next).toBe("queued");
    expect(transition("r", "timed_out", "retry").next).toBe("queued");
    // running cannot 'retry' itself mid-flight
    expect(() => transition("r", "running", "retry")).toThrow();
    // succeeded cannot retry
    expect(() => transition("r", "succeeded", "retry")).toThrow();
  });

  test("every transition is explicit + auditable (returns entry with from/to)", () => {
    const { next, entry } = transition("r", "authorized", "queue", "ready");
    expect(next).toBe("queued");
    expect(entry.from).toBe("authorized");
    expect(entry.to).toBe("queued");
    expect(entry.reason).toBe("ready");
  });
});
