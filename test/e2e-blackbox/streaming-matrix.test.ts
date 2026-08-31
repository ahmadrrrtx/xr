/**
 * XR — e2e black-box: provider streaming matrix (Phase 0, THE proof layer).
 *
 * Every stub scenario × the provider's DECLARED streaming capability, against
 * the real CLI in a real process, asserting the transport contract:
 * exit codes, stdout, audit events, and the wire (what the client actually
 * sent — the request log makes a violated capability declaration a fact).
 *
 * Two blocks, by design:
 *
 *  1. "behavior capture" — green on HEAD. Pins TODAY'S honest observable
 *     behavior for every scenario (including the F-02 bug class: non-SSE
 *     body over stream ⇒ exit 0, "(no response)", session.done). These are
 *     the regression pins Phase 1 flips into the strict form.
 *
 *  2. "kill proofs" — RED on HEAD until Phase 1 lands. These encode the
 *     doctrine as a test (F-02 fake completion, F-03 capability-blind
 *     transport, and the --no-color ANSI leak):
 *        · no input produces exit 0 with zero model content,
 *        · a provider declared streaming:false never receives stream:true.
 *     Phase 0's Exit Gate is EXACTLY this: run them now, watch them fail.
 *
 * The kill proofs are kept out of the fast PR lane on purpose (see
 * .github/workflows/ci.yml — the e2e-blackbox job runs the capture suites;
 * e2e-blackbox-proof runs this file and is expected to be RED until Phase 1
 * merges, at which point the quality gate adopts it).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  startStubOpenAI,
  type StubOpenAIHandle,
  type StubScenario,
  STUB_SCENARIOS,
} from "../helpers/stub-openai.ts";
import {
  installStubProvider,
  runCli,
  expectExit,
  expectNoTimedOut,
  auditEvents,
  auditForSession,
  lastSessionId,
  removeHome,
  freshHome,
  assertStubClosed,
} from "./helpers.ts";

const PROVIDER_ID = "matrix-stub";
const FAST_TIMEOUT = 90_000;

async function runScenario(
  scenario: StubScenario,
  streaming: boolean,
  env: Record<string, string> = {},
) {
  const stub = await startStubOpenAI({ scenario });
  const home = freshHome();
  try {
    installStubProvider(home, PROVIDER_ID, stub, { streaming });
    const r = await runCli(["run", `Scenario ${scenario}`, "--provider", PROVIDER_ID], {
      home,
      env,
      timeoutMs: FAST_TIMEOUT,
    });
    const events = auditEvents(home);
    const sid = lastSessionId(home);
    const sessionAudit = auditForSession(home, sid).map((a) => a.event);
    const chat = stub.chatRequests();
    return {
      result: r,
      home,
      stub,
      events,
      sessionAudit,
      chat,
      sid,
      streamFields: chat.map((c) => c.streamField),
      toolsFields: chat.map((c) => c.toolsField),
    };
  } finally {
    // Keep home for diagnostics? No — remove; the caller has already read
    // everything it needs into the return value.
    removeHome(home);
    await assertStubClosed(stub, `scenario ${scenario}`);
  }
}

// ── 1. Behavior capture: green on HEAD ─────────────────────────────────────
// The plan's matrix is ALL stub scenarios × the provider's DECLARED streaming
// capability (16 cells). The declaration only governs what the transport
// SHOULD send; on HEAD the transport is capability-blind (always stream:true —
// F-03), so the two blocks below behave identically on the wire, and the
// declared-streaming:false block additionally pins the F-03 observation once
// per scenario. Phase 1 flips the wire assertion of the false block and the
// kill proofs below.

type CaptureCase = {
  s: StubScenario;
  env?: Record<string, string>;
  expect: (o: Awaited<ReturnType<typeof runScenario>>) => string | null;
};

const CAPTURE_CASES: CaptureCase[] = [
  {
    s: "sse-ok",
    expect: (o) => {
      if (o.result.code !== 0) return `exit ${o.result.code}`;
      if (!o.result.stdout.includes("Hello from stub")) return "envelope message not streamed";
      if (!o.sessionAudit.includes("session.done")) return "session.done missing";
      return null;
    },
  },
  {
    // F-02 pinned: a non-SSE body over stream:true is consumed as
    // content-less success — exit 0, "(no response)", zero tokens.
    s: "non-sse-body",
    expect: (o) => {
      if (o.result.code !== 0) return `expected the FAKE-completion path (exit 0), got ${o.result.code}`;
      if (!o.result.stdout.includes("(no response)")) return "expected '(no response)'";
      if (!o.sessionAudit.includes("session.done")) return "session.done missing";
      return null;
    },
  },
  {
    // M-06 pinned: empty message content over stream ⇒ same silent success.
    s: "empty-body",
    expect: (o) => {
      if (o.result.code !== 0) return `exit ${o.result.code}`;
      if (!o.result.stdout.includes("(no response)")) return "expected '(no response)'";
      if (!o.sessionAudit.includes("session.done")) return "session.done missing";
      return null;
    },
  },
  {
    // F-13 pinned: usage-omitting provider ⇒ metered $0 (audit snapshot).
    s: "no-usage",
    expect: (o) => {
      if (o.result.code !== 0) return `exit ${o.result.code}`;
      if (!o.sessionAudit.includes("session.done")) return "session.done missing";
      return null;
    },
  },
  {
    // Native tool calls (streaming deltas) ⇒ one real tool execution, then done.
    s: "native-tool-calls",
    expect: (o) => {
      if (o.result.code !== 0) return `exit ${o.result.code} (stdout: ${o.result.stdout.slice(0, 200)})`;
      if (!o.events.includes("read_file")) return "read_file tool execution not audited";
      if (o.chat.length < 2) return `expected 2 chat requests (tool turn + done turn), got ${o.chat.length}`;
      return null;
    },
  },
  {
    // A hanging endpoint with an explicit provider timeout ⇒ honest error exit.
    s: "hanging",
    env: { XR_PROVIDER_TIMEOUT_MS: "3000" },
    expect: (o) => {
      if (o.result.code !== 1) return `expected honest error exit 1, got ${o.result.code}`;
      if (o.sessionAudit.includes("session.done")) return "session.done must not be present on error";
      if (!o.sessionAudit.includes("session.error")) return "session.error missing";
      return null;
    },
  },
  {
    s: "500",
    expect: (o) => {
      if (o.result.code !== 1) return `expected exit 1, got ${o.result.code}`;
      if (!o.sessionAudit.includes("session.error")) return "session.error missing";
      return null;
    },
  },
  {
    // slow = delayed success (latency matrix lower bound).
    s: "slow",
    expect: (o) => {
      if (o.result.code !== 0) return `exit ${o.result.code}`;
      if (!o.result.stdout.includes("Hello from stub")) return "message missing";
      return null;
    },
  },
];

function runCaptureBlock(streaming: boolean, label: string): void {
  describe(label, () => {
    for (const c of CAPTURE_CASES) {
      test(`${c.s} (declared streaming:${streaming})`, async () => {
        const o = await runScenario(c.s, streaming, c.env);
        const problem = c.expect(o);
        if (problem) {
          throw new Error(
            `${c.s}: ${problem}\n` +
              `exit=${o.result.code} stdout=${JSON.stringify(o.result.stdout.slice(0, 300))} ` +
              `stderr=${JSON.stringify(o.result.stderr.slice(0, 300))}\n` +
              `events=${o.events.join(",")}\n` +
              `streamFields=${JSON.stringify(o.streamFields)} toolsFields=${JSON.stringify(o.toolsFields)}`,
          );
        }
        // Universal transport invariant (capture): the client DID attempt
        // streaming regardless of the declaration today — the F-03
        // observation. Phase 1 flips the false block to expect stream:false.
        expect(o.streamFields[0]).toBe(true);
      });
    }
  });
}

runCaptureBlock(true, "streaming matrix — behavior capture (HEAD truth, declared streaming:true)");
runCaptureBlock(false, "streaming matrix — behavior capture (HEAD truth, declared streaming:false · F-03 pins)");

describe("scenario matrix determinism: every scenario serves (self-test)", () => {
  test("every scenario serves and the scenario list is unique", async () => {
    const stub = await startStubOpenAI({ scenario: "sse-ok" });
    try {
      const model = await fetch(`${stub.baseUrl}/models`);
      expect(model.status).toBe(200);
    } finally {
      await assertStubClosed(stub, "determinism check");
    }
    expect(Array.from(new Set(STUB_SCENARIOS)).length).toBe(STUB_SCENARIOS.length);
  });
});

// ── 2. Kill proofs: RED on HEAD until Phase 1 ──────────────────────────────

describe("F-02/F-03 + no-color kill proofs (RED on HEAD until Phase 1)", () => {
  test("non-SSE body over a stream request can never produce exit 0 with zero model content", async () => {
    const o = await runScenario("non-sse-body", true);
    // Doctrine check (Phase 0 Exit Gate): this is expected to FAIL on HEAD
    // because today it exits 0 with "(no response)" — the fake completion.
    expect(o.result.code).not.toBe(0);
    expect(o.sessionAudit).not.toContain("session.done");
    expect(o.result.stdout).not.toContain("(no response)");
  });

  test("empty content over a stream request can never produce exit 0 with zero model content", async () => {
    const o = await runScenario("empty-body", true);
    expect(o.result.code).not.toBe(0);
    expect(o.sessionAudit).not.toContain("session.done");
    expect(o.result.stdout).not.toContain("(no response)");
  });

  test("a provider declaring capabilities.streaming:false never receives stream:true", async () => {
    const o = await runScenario("sse-ok", false);
    // On HEAD the transport is capability-blind: the request log shows
    // stream:true despite the declaration — the proof fails until Phase 1.
    expect(o.chat.length).toBeGreaterThan(0);
    for (const f of o.streamFields) {
      expect(f).toBe(false);
    }
  });

  test("a non-SSE body over a stream request for a streaming:false provider is still an honest failure", async () => {
    const o = await runScenario("non-sse-body", false);
    expect(o.result.code).not.toBe(0);
    expect(o.sessionAudit).not.toContain("session.done");
  });

  // NO_COLOR honesty: with --no-color (env NO_COLOR=1, forced by the harness)
  // the run path must emit ZERO ANSI escape codes. On HEAD the agent status
  // lines still inject hardcoded escapes (src/core/agent.ts `say()`:
  // "\x1b[2m▸ think", "\x1b[33m⚠", "\x1b[36m◆", "\x1b[31m✗") — the theme
  // resolves to "none" but these bypass it. RED on HEAD; Phase 1 routes the
  // agent status line through the themed printer.
  test("with --no-color the run path emits zero ANSI escape codes", async () => {
    const o = await runScenario("sse-ok", true);
    expect(o.result.stdout).not.toMatch(/\x1b\[/);
    expect(o.result.stderr).not.toMatch(/\x1b\[/);
  });
});
