/**
 * XR — e2e black-box: cooperative cancellation (Phase 0, A-19 at the boundary).
 *
 * A run against a HANGING provider is the worst case for cancellation: the
 * model call is in flight with no response. SIGINT must abort the child's
 * request chain (caller signal → transport), stop the loop at a checkpoint,
 * and end with the honest outcome: exit 130 (POSIX SIGINT convention),
 * "interrupted by user", audit `session.cancelled` — never a fake success,
 * never a silent kill.
 *
 * Green on HEAD (A-19 verified in the plan).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startStubOpenAI, type StubOpenAIHandle } from "../helpers/stub-openai.ts";
import {
  installStubProvider,
  spawnCli,
  waitForExit,
  auditForSession,
  lastSessionId,
  removeHome,
  assertStubClosed,
  freshHome,
} from "./helpers.ts";

let stub: StubOpenAIHandle;

beforeAll(async () => {
  stub = await startStubOpenAI({ scenario: "hanging" });
});

afterAll(async () => {
  await assertStubClosed(stub, "cancel stub");
});

describe("xr run against a hanging provider", () => {
  test("SIGINT mid-flight: exit 130, interrupted-by-user message, honest audited cancel", async () => {
    const home = freshHome();
    try {
      installStubProvider(home, "cancel-stub", stub, { streaming: true });
      const spawned = spawnCli(["run", "Cancel me please", "--provider", "cancel-stub"], {
        home,
      });

      // Deterministic sync point: the request has actually reached the wire
      // (the run is genuinely blocked on the model call).
      await stub.waitForChatRequests(1, 20_000);

      const killed = spawned.kill("SIGINT");
      expect(killed).toBe(true);

      const r = await waitForExit(spawned, 20_000);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(130);
      expect(r.stdout + r.stderr).toContain("interrupted by user");

      // Audit truth: the run reported cancellation, not success.
      const sid = lastSessionId(home);
      const events = auditForSession(home, sid).map((a) => a.event);
      expect(events).toContain("session.cancelled");
      expect(events).not.toContain("session.done");

      // The run must not have "completed" — no fake success text.
      expect(r.stdout).not.toContain("done in");
    } finally {
      removeHome(home);
    }
  });

  test("a second SIGINT force-exits (POSIX 130) instead of hanging forever", async () => {
    const home = freshHome();
    try {
      installStubProvider(home, "cancel-stub", stub, { streaming: true });
      const spawned = spawnCli(["run", "Force cancel", "--provider", "cancel-stub"], { home });
      const before = stub.chatRequests().length;
      await stub.waitForChatRequests(before + 1, 20_000);

      // First SIGINT → cooperative path armed; second → force exit.
      spawned.kill("SIGINT");
      await new Promise((r) => setTimeout(r, 250));
      spawned.kill("SIGINT");

      const r = await waitForExit(spawned, 15_000);
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(130);
    } finally {
      removeHome(home);
    }
  });
});
