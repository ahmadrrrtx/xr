/**
 * XR — e2e black-box: run lifecycle (Phase 0).
 *
 * Fresh XR_HOME → install a stub provider → `xr run` in a REAL child process →
 * assert the process contract: exit code, stdout shape, audit events and the
 * hash chain, config state. Nothing here constructs services in-process:
 * every claim is about the boundary a user actually hits.
 *
 * Green on HEAD (current honest behavior). The F-02/F-03 *kill* proofs live
 * in streaming-matrix.test.ts and are RED on HEAD by design until Phase 1.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startStubOpenAI, type StubOpenAIHandle } from "../helpers/stub-openai.ts";
import {
  installStubProvider,
  runWithProvider,
  expectExit,
  expectNoTimedOut,
  auditRows,
  auditEvents,
  auditForSession,
  lastSessionId,
  readConfig,
  removeHome,
  freshHome,
  assertStubClosed,
} from "./helpers.ts";

/** Spawn-heavy lane: per-test wall-clock budget above bun's 5s default. */
const T = 60_000;

let stub: StubOpenAIHandle;
let home: string;

beforeAll(async () => {
  stub = await startStubOpenAI({ scenario: "sse-ok" });
  home = freshHome();
  installStubProvider(home, "lifecycle-stub", stub);
});

afterAll(async () => {
  await assertStubClosed(stub, "run-lifecycle stub");
  removeHome(home);
});

describe("xr run — default task path over the real CLI", () => {
  test("fresh XR_HOME → run → exit 0, done contract on stdout", async () => {
    const r = await runWithProvider(["run", "Say hello", "--provider", "lifecycle-stub"], stub, "lifecycle-stub");
    expectNoTimedOut(r);
    expectExit(r, 0);
    expect(r.stdout).toContain("done in 1 step(s)");
    expect(r.stdout).toContain("Hello from stub");
    expect(r.stdout).not.toContain("(no response)");
  }, T);

  test("audit chain: session.start → session.done, hashes link (tamper-evident)", async () => {
    const r = await runWithProvider(["run", "Chain check", "--provider", "lifecycle-stub"], stub, "lifecycle-stub");
    expectNoTimedOut(r);
    expectExit(r, 0);

    const events = auditEvents(r.home);
    expect(events).toContain("session.start");
    expect(events).toContain("session.done");

    // Hash chain: every row's prev_hash equals the previous row's hash, and
    // the genesis row anchors at the seed.
    const rows = auditRows(r.home);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]!.prev_hash).toBe("xr-genesis");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.hash);
      expect(rows[i]!.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, T);

  test("session.done records honest accounting for a fresh run", async () => {
    const r = await runWithProvider(["run", "Metered hello", "--provider", "lifecycle-stub"], stub, "lifecycle-stub");
    expectNoTimedOut(r);
    expectExit(r, 0);
    const sid = lastSessionId(r.home);
    const done = auditForSession(r.home, sid).filter((a) => a.event === "session.done");
    expect(done.length).toBe(1);
    const detail = JSON.parse(done[0]!.detail) as { steps: number; snapshot: { totalTokens: number } };
    expect(detail.steps).toBe(1);
    expect(detail.snapshot.totalTokens).toBeGreaterThan(0);
  }, T);

  test("config state: provider record survives a run unmodified", async () => {
    const config = readConfig(home);
    const custom = (config.providerEngine?.customProviders ?? []) as Array<Record<string, unknown>>;
    const ours = custom.find((c) => c.id === "lifecycle-stub");
    expect(ours).toBeDefined();
    expect(ours!.baseUrl).toBe(stub.baseUrl);
    expect(ours!.defaultModel).toBe(stub.model);
  }, T);

  // GREEN capture: with --no-color the run path never emits 24-bit/256-color
  // codes (the theme resolves to "none"). The residual hardcoded dim/yellow/
  // cyan/red decorations (src/core/agent.ts say() calls) are a KNOWN GAP —
  // proven RED by "with --no-color the run path emits zero ANSI escape codes"
  // in streaming-matrix.test.ts kill proofs (Phase 1 removes them).
  test("provider stdout banner: no truecolor/256-color codes with --no-color", async () => {
    const r = await runWithProvider(["run", "No color", "--provider", "lifecycle-stub"], stub, "lifecycle-stub");
    expectNoTimedOut(r);
    expectExit(r, 0);
    expect(r.stdout).not.toMatch(/\x1b\[38;2/); // truecolor fg
    expect(r.stdout).not.toMatch(/\x1b\[48;2/); // truecolor bg
    expect(r.stdout).not.toMatch(/\x1b\[38;5/); // 256-color fg
    expect(r.stdout).not.toMatch(/\x1b\[48;5/); // 256-color bg
  }, T);
});
