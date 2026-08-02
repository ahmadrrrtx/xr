/**
 * XR Phase 5 · T3 — resilient chain execution: classification, retry budget,
 * target diversity, degradation levels, escalation.
 *
 * Asserts EFFECTS (never transitions alone): which provider was actually
 * called, in what order, with what error classes recorded, and that a
 * chain-exhaustion throws an HONEST escalation (never a fake success).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  ResilientProvider,
  RoutingEscalationError,
  classifyError,
  backoffDelay,
  redactSecrets,
  SemanticFailure,
  DEFAULT_RETRY_POLICY,
  type FailoverRecord,
  type DegradationLevel,
} from "../../src/intelligence/degradation.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";

const M = (text: string): Message[] => [{ role: "user", content: text }];

function okTurn(text = "done"): ModelTurn {
  return { message: text, toolCalls: [], done: true };
}

function provider(id: string, behavior: (messages: Message[], tools: Tool[]) => Promise<ModelTurn>): Provider {
  return {
    id,
    label: id,
    chat: behavior,
    async health() {
      return { ok: true };
    },
  };
}

describe("Phase 5 · three-tier error classification", () => {
  test("transient: rate limits, timeouts, connection resets, 5xx", () => {
    expect(classifyError(new Error("rate limit exceeded (429)")).cls).toBe("transient");
    expect(classifyError(new Error("request timed out after 30s")).cls).toBe("transient");
    expect(classifyError(new Error("fetch failed: ECONNRESET")).cls).toBe("transient");
    expect(classifyError(new Error("503 service unavailable")).cls).toBe("transient");
  });

  test("permanent: auth failures, missing models, 404s", () => {
    expect(classifyError(new Error("401 unauthorized: invalid api key")).cls).toBe("permanent");
    expect(classifyError(new Error("model does not exist (404)")).cls).toBe("permanent");
  });

  test("semantic: invalid responses, refusals, contract violations", () => {
    expect(classifyError(new SemanticFailure("empty turn")).cls).toBe("semantic");
    expect(classifyError(new Error("invalid json in tool arguments")).cls).toBe("semantic");
  });

  test("unknown errors classify permanent (no in-place retry — the safe side)", () => {
    expect(classifyError(new Error("zqxwv mystery")).cls).toBe("permanent");
  });

  test("retry backoff is jittered, exponentially growing, and budget-capped (pure)", () => {
    let draws = 0;
    const random = () => {
      draws++;
      return 1; // max jitter up
    };
    const d0 = backoffDelay(0, DEFAULT_RETRY_POLICY, 0, random);
    const d1 = backoffDelay(1, DEFAULT_RETRY_POLICY, 0, random);
    const d5 = backoffDelay(5, DEFAULT_RETRY_POLICY, 0, random);
    expect(d1).toBeGreaterThan(d0);
    expect(d5).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxDelayMs * (1 + DEFAULT_RETRY_POLICY.jitterRatio) + 1);
    // total budget is hard-capped
    const nearExhausted = backoffDelay(0, DEFAULT_RETRY_POLICY, DEFAULT_RETRY_POLICY.totalBudgetMs - 100, random);
    expect(nearExhausted).toBeLessThanOrEqual(100);
    expect(draws).toBeGreaterThan(0);
  });
});

describe("Phase 5 · ResilientProvider chain execution", () => {
  let health: RoutingHealth;
  beforeEach(() => {
    health = new RoutingHealth({ file: null, config: { minSamples: 3 } });
  });

  test("primary success: no failover, no degradation, outcome recorded", async () => {
    const outcomes: Array<{ providerId: string; success: boolean; qualityOk: boolean }> = [];
    const calls: string[] = [];
    const primary = provider("ollama", async () => {
      calls.push("ollama");
      return okTurn("primary answer");
    });
    const rp = new ResilientProvider(primary, "qwen2.5:7b", [{ providerId: "lmstudio", modelId: "m1", reason: "test" }], {
      health,
      construct: () => provider("lmstudio", async () => {
        calls.push("lmstudio");
        return okTurn();
      }),
      localityGuard: () => true,
      sleep: async () => {},
      onOutcome: (o) => outcomes.push(o),
    });
    const turn = await rp.chat(M("hi"), []);
    expect(turn.message).toBe("primary answer");
    expect(calls).toEqual(["ollama"]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.providerId).toBe("ollama");
    expect(outcomes[0]!.success).toBe(true);
    expect(outcomes[0]!.qualityOk).toBe(true);
  });

  test("transient failure → one in-place retry (budget), then target-diverse failover", async () => {
    const calls: string[] = [];
    const primary = provider("ollama", async () => {
      calls.push("ollama");
      throw new Error("rate limit 429");
    });
    const fb = provider("lmstudio", async () => {
      calls.push("lmstudio");
      return okTurn("rescued");
    });
    const records: FailoverRecord[] = [];
    const levels: DegradationLevel[] = [];
    const rp = new ResilientProvider(primary, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "test", level: "L1_equivalent_fallback" }], {
      health,
      construct: () => fb,
      localityGuard: () => true,
      sleep: async () => {},
      onFailover: (r) => records.push(r),
      onDegradation: (l) => levels.push(l),
      retry: { maxInPlaceRetries: 1 },
    });
    const turn = await rp.chat(M("hi"), []);
    expect(turn.message).toBe("rescued");
    // 2 primary attempts (1 retry for transient) + 1 fallback attempt
    expect(calls).toEqual(["ollama", "ollama", "lmstudio"]);
    expect(records).toHaveLength(1);
    expect(records[0]!.trigger).toBe("transient");
    expect(records[0]!.to.providerId).toBe("lmstudio");
    expect(levels).toContain("L1_equivalent_fallback");
  });

  test("permanent failure → NO in-place retry, straight to the diverse fallback", async () => {
    const calls: string[] = [];
    const primary = provider("ollama", async () => {
      calls.push("ollama");
      throw new Error("401 unauthorized");
    });
    const fb = provider("lmstudio", async () => {
      calls.push("lmstudio");
      return okTurn("ok");
    });
    const rp = new ResilientProvider(primary, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "t" }], {
      health,
      construct: () => fb,
      localityGuard: () => true,
      sleep: async () => {},
      retry: { maxInPlaceRetries: 3 }, // even with retries allowed, permanent skips them
    });
    await rp.chat(M("hi"), []);
    expect(calls).toEqual(["ollama", "lmstudio"]);
  });

  test("semantic failure (invalid turn / refusal-shaped) advances and records quality degradation for the breaker", async () => {
    const primary = provider("ollama", async () => ({ message: "", toolCalls: [], done: false }) as ModelTurn); // invalid
    const fb = provider("lmstudio", async () => okTurn("clean"));
    const rp = new ResilientProvider(primary, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "t" }], {
      health,
      construct: () => fb,
      localityGuard: () => true,
      sleep: async () => {},
    });
    await rp.chat(M("hi"), []);
    const gate = health.gate("ollama", "m1");
    expect(gate.qualityFailRate).toBeGreaterThan(0);
  });

  test("LOCALITY GUARD: a chain step violating policy is skipped — never silently routed to", async () => {
    const calls: string[] = [];
    const primary = provider("ollama", async () => {
      calls.push("ollama");
      throw new Error("503");
    });
    const cloud = provider("openai", async () => {
      calls.push("openai");
      return okTurn("cloud");
    });
    const rp = new ResilientProvider(primary, "m1", [{ providerId: "openai", modelId: "gpt-4o", reason: "t" }], {
      health,
      construct: () => cloud,
      localityGuard: (id) => id !== "openai", // simulates local_only defense-in-depth
      sleep: async () => {},
    });
    await expect(rp.chat(M("hi"), [])).rejects.toBeInstanceOf(RoutingEscalationError);
    expect(calls).not.toContain("openai"); // cloud NEVER called
    expect(calls.every((c) => c === "ollama")).toBe(true); // only the primary was attempted
  });

  test("breaker-open step is skipped without being called", async () => {
    // Trip lmstudio's breaker
    for (let i = 0; i < 3; i++) health.record("lmstudio", "m2", { ok: false });
    const calls: string[] = [];
    const primary = provider("ollama", async () => {
      calls.push("ollama");
      throw new Error("503");
    });
    const third = provider("jan", async () => {
      calls.push("jan");
      return okTurn("third");
    });
    const rp = new ResilientProvider(
      primary,
      "m1",
      [
        { providerId: "lmstudio", modelId: "m2", reason: "t" },
        { providerId: "jan", modelId: "m3", reason: "t" },
      ],
      {
        health,
        construct: (step) => (step.providerId === "jan" ? third : provider("lmstudio", async () => {
          calls.push("lmstudio");
          return okTurn();
        })),
        localityGuard: () => true,
        sleep: async () => {},
      },
    );
    const turn = await rp.chat(M("hi"), []);
    expect(turn.message).toBe("third");
    expect(calls).not.toContain("lmstudio");
    expect(calls).toContain("jan");
  });

  test("chain exhaustion throws RoutingEscalationError with a full, redacted package (no fake success)", async () => {
    const primary = provider("ollama", async () => {
      throw new Error("401 invalid api key=sk-live-FAKEKEY123456789");
    });
    const fb = provider("lmstudio", async () => {
      throw new Error("timeout");
    });
    const rp = new ResilientProvider(primary, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "t" }], {
      health,
      construct: () => fb,
      localityGuard: () => true,
      sleep: async () => {},
    });
    try {
      await rp.chat(M("hi"), []);
      expect.unreachable("must throw");
    } catch (e) {
      const err = e as RoutingEscalationError;
      expect(err).toBeInstanceOf(RoutingEscalationError);
      const pkg = err.escalation;
      expect(pkg.level).toBe("L3_escalation");
      expect(pkg.attempts.length).toBeGreaterThanOrEqual(2);
      expect(pkg.repair.length).toBeGreaterThan(0);
      // error classes are recorded per attempt
      expect(pkg.attempts[0]!.errorClass).toBe("permanent");
      // NO SECRETS in the package (Part 20)
      expect(JSON.stringify(pkg)).not.toMatch(/sk-live/);
      expect(pkg.attempts[0]!.message).toContain("[redacted]");
    }
  });

  test("redactSecrets strips common credential shapes", () => {
    const s = redactSecrets("Authorization: Bearer abcdef1234567890 sk-ant-oat01-xYz_987654 error");
    expect(s).not.toMatch(/abcdef1234567890/);
    expect(s).not.toMatch(/sk-ant/);
  });
});
