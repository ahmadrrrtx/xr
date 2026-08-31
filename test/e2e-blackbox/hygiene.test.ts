/**
 * XR — e2e black-box: harness hygiene (Phase 0, M-07).
 *
 * The phase's own acceptance criterion: zero leaked ports, zero leaked
 * processes. This file validates the harness mechanics that make that true:
 *   · stub close() releases the socket (bindable again immediately);
 *   · a killed CLI child leaves no tracked process behind;
 *   · the registry is empty after the suites (no zombie handlers).
 *
 * Green on HEAD.
 */

import { describe, expect, test } from "bun:test";
import { startStubOpenAI } from "../helpers/stub-openai.ts";
import {
  assertStubClosed,
  isPortFree,
  spawnCli,
  waitForExit,
  liveChildCount,
  removeHome,
  freshHome,
} from "./helpers.ts";

describe("harness hygiene (M-07)", () => {
  test("stub close releases its port immediately (zero leaked listeners)", async () => {
    const stub = await startStubOpenAI({ scenario: "sse-ok" });
    expect(await isPortFree(stub.port)).toBe(false);
    await assertStubClosed(stub);
    expect(await isPortFree(stub.port)).toBe(true);
  });

  test("stub close with a HANGING in-flight socket does not leak either", async () => {
    const stub = await startStubOpenAI({ scenario: "hanging" });
    // Open a real connection and leave it hanging.
    const controller = new AbortController();
    fetch(`${stub.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: stub.model, messages: [], stream: true }),
      signal: controller.signal,
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    await assertStubClosed(stub);
    expect(await isPortFree(stub.port)).toBe(true);
  });

  test("a terminated CLI child leaves no tracked process behind", async () => {
    const before = liveChildCount();
    const spawned = spawnCli(["--version"]);
    const r = await waitForExit(spawned, 15_000);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(liveChildCount()).toBe(before);
    removeHome(spawned.home);
  });

  test("SIGKILLed children are reaped by the registry (defensive cleanup)", async () => {
    const spawned = spawnCli(["serve", "--help"], { timeoutMs: 30_000 });
    // --help exits; simulate a stuck child by killing mid-flight:
    spawned.kill("SIGKILL");
    const r = await waitForExit(spawned, 15_000);
    expect(r.timedOut).toBe(false);
    expect(r.signal).toBe("SIGKILL");
    expect(liveChildCount()).toBe(0);
    removeHome(spawned.home);
  });
});
