/**
 * XR — e2e black-box: governor budget stop + human-raise path (Phase 0).
 *
 * Deterministic without real money: with a stub provider (unknown provider ⇒
 * $0 pricing — pricing.ts defaults), the per-task TOKEN ceiling
 * (--max-tokens) is the enforceable cap. Two flows:
 *
 *  1. spend stop — a ceiling below the next-step estimate denies the step at
 *     the governor checkpoint; the run stops HONESTLY: exit 1, stopped
 *     "budget", `budget.pause` + `budget.stop` audited, zero provider
 *     requests on the wire (denied before any spend).
 *  2. human raise — same XR_HOME, ceiling raised ⇒ the same task runs to a
 *     real completion (exit 0, session.done).
 *
 * Green on HEAD.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startStubOpenAI, type StubOpenAIHandle } from "../helpers/stub-openai.ts";
import {
  installStubProvider,
  runCli,
  expectExit,
  expectNoTimedOut,
  auditForSession,
  lastSessionId,
  removeHome,
  freshHome,
  assertStubClosed,
} from "./helpers.ts";

let stub: StubOpenAIHandle;

beforeAll(async () => {
  stub = await startStubOpenAI({ scenario: "sse-ok" });
});

afterAll(async () => {
  await assertStubClosed(stub, "budget stub");
});

describe("budget enforcement over the real CLI", () => {
  test("ceiling below the first step estimate: denied before any spend (exit 1, budget audit, zero requests)", async () => {
    const home = freshHome();
    try {
      installStubProvider(home, "budget-stub", stub, { streaming: true });
      const before = stub.chatRequests().length;

      const r = await runCli(
        ["run", "Expensive task", "--provider", "budget-stub", "--max-tokens", "1"],
        { home },
      );
      expectNoTimedOut(r);
      expectExit(r, 1);
      expect(r.stdout + r.stderr).toContain("stopped");

      // Denied at the governor checkpoint: nothing hit the wire.
      expect(stub.chatRequests().length).toBe(before);

      // Audit: honest budget stop, not a fake error and not a done.
      const sid = lastSessionId(home);
      const events = auditForSession(home, sid).map((a) => a.event);
      expect(events).toContain("budget.pause");
      expect(events).toContain("budget.stop");
      expect(events).not.toContain("session.done");
    } finally {
      removeHome(home);
    }
  });

  test("human raise path: same home, raised ceiling → the task completes (exit 0, session.done)", async () => {
    const home = freshHome();
    try {
      installStubProvider(home, "budget-stub", stub, { streaming: true });

      // 1. Denied at the tiny ceiling.
      const denied = await runCli(
        ["run", "Bounded task", "--provider", "budget-stub", "--max-tokens", "1"],
        { home },
      );
      expectExit(denied, 1);

      // 2. The human raises the ceiling (per-task budget is a per-run
      //    envelope; the operator's raise = re-run with an adequate cap).
      const raised = await runCli(
        ["run", "Bounded task", "--provider", "budget-stub", "--max-tokens", "100000"],
        { home },
      );
      expectNoTimedOut(raised);
      expectExit(raised, 0);
      expect(raised.stdout).toContain("done in 1 step(s)");
      expect(raised.stdout).toContain("Hello from stub");

      const sid = lastSessionId(home);
      const events = auditForSession(home, sid).map((a) => a.event);
      expect(events).toContain("session.done");
      expect(events).not.toContain("budget.stop");
    } finally {
      removeHome(home);
    }
  });
});
