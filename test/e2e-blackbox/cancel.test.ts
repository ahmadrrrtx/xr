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

/**
 * Per-test budget. Both tests spawn the REAL CLI: a cold boot on a loaded
 * hosted runner (kernel + audit auto-keying + provider resolution) can take
 * longer than Bun's 5 s default all by itself, and this file waits for the
 * request to reach the stub and then for a graceful exit. Without an explicit
 * budget the runner's timeout fired first and KILLED the child ("killed 1
 * dangling process") — so the assertion saw `code: null` (SIGKILL) and the
 * lane reported a signal-handling bug that does not exist. Same policy as
 * run-lifecycle.test.ts; the real ceilings stay in the helper calls.
 */
const T = 60_000;

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
  }, T);

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
  }, T);
});
