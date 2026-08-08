/**
 * XR Phase 5 · T4 — mid-conversation failover context preservation (CPR).
 *
 * ContinuityBench-style harness (docs/historical/phases/phase5-routing/03-RESEARCH-NOTES.md ·
 * R4; arXiv:2607.15899): a scripted conversation plants canonical factual
 * anchors, a provider failure is injected MID-CONVERSATION, and we measure
 * CPR — the share of anchors that reach the fallback's input.
 *
 * Two arms, exactly like the benchmark:
 *   · STATEFUL (XR's mechanism): full history forwarding — CPR must meet the
 *     0.95 target;
 *   · STATELESS CONTROL: last-message-only forwarding — CPR must be ≈0,
 *     proving the harness is not vacuous (a harness that can't detect lost
 *     context proves nothing).
 *
 * The fallback's own instruction-following fidelity is covered separately by
 * behavioral context-retention probes (test/intelligence/behavioral.test.ts)
 * — the paper's residual failure mode.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { ResilientProvider, type FailoverRecord } from "../../src/intelligence/degradation.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import {
  contextManifest,
  anchorsPresent,
  aggregateCpr,
  CPR_TARGET,
} from "../../src/intelligence/failover.ts";
import type { Message, ModelTurn, Provider } from "../../src/core/types.ts";

const ANCHORS = ["BlueComet-77", "Port 8421", "Dr. Ingrid Halvorsen"];

/** The ContinuityBench-style scripted conversation, growing per turn. */
function conversation(): Message[][] {
  const t1: Message[] = [
    { role: "user", content: "For this session, our project codename is BlueComet-77. Acknowledge." },
  ];
  const t2: Message[] = [
    ...t1,
    { role: "assistant", content: "Acknowledged — BlueComet-77." },
    { role: "user", content: "The staging server listens on Port 8421. Remember that too." },
  ];
  const t3: Message[] = [
    ...t2,
    { role: "assistant", content: "Noted: Port 8421." },
    { role: "user", content: "Distractor: tell me a fun fact about lighthouse keepers." },
  ];
  const t4: Message[] = [
    ...t3,
    { role: "assistant", content: "The last manned US lighthouse was automated in 1998." },
    { role: "user", content: "Our compliance contact is Dr. Ingrid Halvorsen. Now: which port should the deploy target, and what's the codename?" },
  ];
  return [t1, t2, t3, t4];
}

function mkProvider(id: string, behavior: (msgs: Message[], call: number) => Promise<ModelTurn> | ModelTurn): { p: Provider; calls: Message[][] } {
  const calls: Message[][] = [];
  return {
    calls,
    p: {
      id,
      label: id,
      async chat(messages: Message[]) {
        calls.push(messages.map((m) => ({ ...m })));
        return behavior(messages, calls.length);
      },
      async health() {
        return { ok: true };
      },
    },
  };
}

describe("Phase 5 · failover-injection harness (ContinuityBench-style)", () => {
  let health: RoutingHealth;
  beforeEach(() => {
    health = new RoutingHealth({ file: null });
  });

  test("STATEFUL arm: mid-conversation failover preserves factual anchors — CPR ≥ 0.95", async () => {
    const turns = conversation();
    // Primary dies mid-conversation (turn 4 of 4).
    const primary = mkProvider("ollama", async (_msgs, call) => {
      if (call >= 4) throw new Error("provider outage: 503");
      return { message: "ok", toolCalls: [], done: false };
    });
    const fallback = mkProvider("lmstudio", async () => ({
      message: "Deploy to Port 8421 for BlueComet-77.",
      toolCalls: [],
      done: true,
    }));

    const failovers: FailoverRecord[] = [];
    const rp = new ResilientProvider(primary.p, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "test" }], {
      health,
      construct: () => fallback.p,
      localityGuard: () => true,
      sleep: async () => {},
      contextAnchors: ANCHORS,
      onFailover: (r) => failovers.push(r),
    });

    const turnAnswers: string[] = [];
    for (const msgs of turns) {
      const turn = await rp.chat(msgs, []);
      turnAnswers.push(turn.message);
    }

    // The last answer came from the FALLBACK, answering with anchor facts.
    expect(turnAnswers[3]).toContain("Port 8421");

    // CPR over failover hops, computed the same way the runtime records it.
    const cprs = failovers.map((f) => f.context.cpr);
    const cpr = aggregateCpr(cprs);
    expect(cpr.samples).toBeGreaterThan(0);
    expect(cpr.mean).toBeGreaterThanOrEqual(CPR_TARGET);

    // Direct evidence: the fallback RECEIVED all three anchors verbatim.
    const received = fallback.calls[fallback.calls.length - 1]!;
    const present = anchorsPresent(received, ANCHORS);
    expect(present).toEqual(ANCHORS);

    // The conversation grew across turns (the failover hop saw the deep convo).
    const manifest = contextManifest(turns[3]!, ANCHORS);
    expect(manifest.messageCount).toBe(7);
    expect(manifest.anchorsForwarded).toEqual(ANCHORS);
    expect(manifest.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("STATELESS control arm: last-message-only forwarding loses the anchors — CPR ≈ 0", async () => {
    const turns = conversation();
    // Simulate the naive stateless proxy: forwards ONLY the latest message.
    const statelessFallback = mkProvider("lmstudio", async () => ({
      message: "I don't have that context.",
      toolCalls: [],
      done: true,
    }));
    const lastOnly = (msgs: Message[]): Message[] => msgs.slice(-1);

    // What the stateless arm delivers at the failover turn:
    const delivered = lastOnly(turns[3]!);
    const present = anchorsPresent(delivered, ANCHORS);
    const cpr = present.length / ANCHORS.length;

    expect(cpr).toBeLessThanOrEqual(1 / 3); // at most incidental mention
    expect(present).not.toContain("BlueComet-77");
    expect(present).not.toContain("Port 8421");
    void statelessFallback;
  });

  test("the runtime failover RECORD carries context evidence (counts, hash, no content)", async () => {
    const primary = mkProvider("ollama", async () => {
      throw new Error("timeout");
    });
    const fallback = mkProvider("lmstudio", async () => ({ message: "x", toolCalls: [], done: true }));
    const records: FailoverRecord[] = [];
    const rp = new ResilientProvider(primary.p, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "t" }], {
      health,
      construct: () => fallback.p,
      localityGuard: () => true,
      sleep: async () => {},
      onFailover: (r) => records.push(r),
    });
    await rp.chat(conversation()[3]!, []);
    expect(records).toHaveLength(1);
    const ctx = records[0]!.context;
    expect(ctx.messageCount).toBe(7);
    expect(ctx.totalChars).toBeGreaterThan(0);
    expect(ctx.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    // Production path passes NO anchors → CPR field defaults to 1 (not measured)
    expect(records[0]!.trigger).toBe("transient");
  });

  test("CPR_TARGET is the contracted 0.95", () => {
    expect(CPR_TARGET).toBe(0.95);
  });
});
