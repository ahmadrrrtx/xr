/**
 * XR Phase 5 · service-level integration — IntelligenceService is the glue
 * between the single routing authority and the resilience plane.
 *
 * Asserts EFFECTS through the DI surface actually used at runtime:
 *   · resolveProvider() returns a ResilientProvider that EXECUTES the
 *     decision's fallback chain (real failover, not a mock of it);
 *   · runtime outcomes flow back into IntelligenceMetrics — G2 closure (the
 *     audit found `recordOutcome` was never called in production);
 *   · SLO events (selection / fallback / cost-per-quality / breaker trips)
 *     are recorded at the single choke point every decision passes through;
 *   · workspace breaker/retry config (intelligencePlane.breaker/.retry) is
 *     honored, and a sustained outage trips breakers that the authority then
 *     reports HONESTLY (unavailable + circuit-open reasons), never silently.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { Tokens } from "../../src/core/tokens.ts";
import type { ConfigService } from "../../src/services/config-service.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import { IntelligenceService } from "../../src/intelligence/service.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import { BehavioralStore } from "../../src/intelligence/behavioral.ts";
import { RoutingSlo } from "../../src/intelligence/slo.ts";
import { RoutingEscalationError } from "../../src/intelligence/degradation.ts";
import { registry as providerRegistry } from "../../src/providers/registry.ts";
import "../../src/providers/factory.ts"; // preset bootstrap (same as runtime)
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";

const PRIMARY = "v5primary";
const FALLBACK = "v5fallback";

const CLOUD_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
const calls: string[] = [];

/** Per-test scripted behavior; swapped by each test. */
let primaryBehavior: (messages: Message[], tools: Tool[]) => Promise<ModelTurn>;
let fallbackBehavior: (messages: Message[], tools: Tool[]) => Promise<ModelTurn>;

function scripted(id: string, behavior: typeof primaryBehavior): Provider {
  return {
    id,
    label: id,
    chat: (m, t) => {
      calls.push(id);
      return behavior(m, t);
    },
    async health() {
      return { ok: true };
    },
  };
}

function preset(id: string, model: string) {
  return {
    id,
    label: `V5 scripted (${id})`,
    kind: "local" as const,
    tier: "free" as const,
    baseUrl: "http://localhost:9/v1",
    apiKeyEnv: undefined,
    authType: "none" as const,
    defaultModel: model,
    knownModels: [model],
    capabilities: { chat: true, toolUse: true, streaming: true },
    description: "Phase 5 service-integration scripted provider",
  };
}

function baseConfig(over: Record<string, unknown> = {}): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: PRIMARY, model: "v5-a" },
    providerEngine: { routingStrategy: "hybrid" },
    intelligencePlane: {
      // Tiny, deterministic retry budget — tests must stay fast.
      retry: { maxInPlaceRetries: 1, baseDelayMs: 0, maxDelayMs: 1, totalBudgetMs: 200, jitterRatio: 0 },
    },
    ...over,
  });
}

function wiredService(config: XRConfig): IntelligenceService {
  const registry = new ServiceRegistry();
  registry.registerValue(Tokens.Config, { get: () => config } as unknown as ConfigService);
  return new IntelligenceService(
    registry,
    {}, // fresh in-memory metrics (not the process-wide default)
    {
      health: new RoutingHealth({ file: null }),
      behavioral: new BehavioralStore({ file: null }),
      slo: new RoutingSlo({ file: null }),
    },
  );
}

/** Pin the primary, allow fallback, restrict eligibility to the two fakes. */
function pinRequest() {
  return {
    requirements: {
      modelClass: "chat" as const,
      summary: "service integration: pin primary with diverse fallback",
      pin: { providerId: PRIMARY, modelId: "v5-a" },
      allowFallback: true,
      restrictProviders: [PRIMARY, FALLBACK],
    },
  };
}

beforeEach(() => {
  calls.length = 0;
  for (const k of CLOUD_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  providerRegistry.register(preset(PRIMARY, "v5-a"), () => scripted(PRIMARY, primaryBehavior));
  providerRegistry.register(preset(FALLBACK, "v5-b"), () => scripted(FALLBACK, fallbackBehavior));
});

afterEach(() => {
  providerRegistry.unregister(PRIMARY);
  providerRegistry.unregister(FALLBACK);
  for (const k of CLOUD_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Phase 5 · IntelligenceService resilience wiring", () => {
  test("resolveProvider executes the chain: transient primary → real failover → metrics + SLO effects", async () => {
    primaryBehavior = async () => {
      throw new Error("fetch failed: ECONNRESET"); // transient class
    };
    fallbackBehavior = async () => ({
      message: "fallback answer",
      toolCalls: [],
      done: true,
      usage: { inTokens: 11, outTokens: 7 },
    });

    const service = wiredService(baseConfig());
    const { provider, decision, record } = service.resolveProvider(pinRequest());

    // The authority's decision drives execution.
    expect(decision.selected?.providerId).toBe(PRIMARY);
    expect(decision.fallbackChain).toHaveLength(1);
    expect(decision.fallbackChain[0]!.providerId).toBe(FALLBACK);
    expect(record.decisionId).toBe(decision.decisionId);

    // EFFECT: the wrapped provider actually fails over and answers.
    const turn = await provider.chat([{ role: "user", content: "hi" }], []);
    expect(turn.message).toBe("fallback answer");
    // 1 primary attempt + 1 in-place transient retry, then 1 fallback call.
    expect(calls).toEqual([PRIMARY, PRIMARY, FALLBACK]);

    // G2 closure: measured runtime outcomes feed the historical scorer input.
    const primaryStats = service.getMetrics().statsFor(PRIMARY, "v5-a", "chat");
    expect(primaryStats).not.toBeNull();
    expect(primaryStats!.samples).toBe(2);
    expect(primaryStats!.successRate).toBe(0);
    const fallbackStats = service.getMetrics().statsFor(FALLBACK, "v5-b", "chat");
    expect(fallbackStats!.samples).toBe(1);
    expect(fallbackStats!.successRate).toBe(1);

    // SLO evidence at the choke point: one selection, one fallback, one cpq.
    const report = service.slo.report();
    expect(report.selection.count).toBe(1);
    expect(report.selection.manualRate).toBe(1); // pinned decision is manual
    expect(report.selection.withinBudget).toBe(true); // p95 < 20ms preserved
    expect(report.fallback.total).toBe(1);
    expect(report.fallback.byTrigger["transient"]).toBe(1);
    expect(Object.keys(report.fallback.byLevel)).toHaveLength(1);
    expect(report.costPerQuality.samples).toBe(1); // usage present → cpq event
  });

  test("workspace breaker config applies: sustained outage trips breakers → authority reports HONEST unavailability", async () => {
    const permanent = async (): Promise<ModelTurn> => {
      throw new Error("401 unauthorized: invalid api key"); // permanent class
    };
    primaryBehavior = permanent;
    fallbackBehavior = permanent;

    const service = wiredService(
      baseConfig({
        intelligencePlane: {
          retry: { maxInPlaceRetries: 0, baseDelayMs: 0, maxDelayMs: 0, totalBudgetMs: 0, jitterRatio: 0 },
          breaker: {
            windowSize: 8,
            minSamples: 2,
            errorRateThreshold: 0.5,
            qualityRateThreshold: 1, // only the error path can trip here
            cooldownMs: 60_000,
            cooldownMaxMs: 60_000,
            jitterRatio: 0,
          },
        },
      }),
    );

    // Two full chain exhaustions — each fails closed with an honest
    // escalation, never a fake success.
    for (let run = 0; run < 2; run++) {
      const { provider } = service.resolveProvider(pinRequest());
      await expect(provider.chat([{ role: "user", content: "hi" }], [])).rejects.toThrow(
        RoutingEscalationError,
      );
    }

    // EFFECT: rolling health flipped both breakers open (2/2 errors each).
    const gates = service.health.report();
    for (const id of [PRIMARY, FALLBACK]) {
      const gate = gates.find((g) => g.key.startsWith(`${id}/`));
      expect(gate).toBeDefined();
      expect(gate!.state).toBe("open");
      expect(gate!.errorRate).toBe(1);
    }

    // EFFECT: the same two models that were selectable in test 3 (healthy,
    // same restrict set) are no longer selectable — the authority's view of
    // rolling health gates them. The decision is an HONEST unavailability
    // with human handoff (never a silent fallback, never a fake pick).
    // (The "circuit open" rejection NAMING is asserted deterministically at
    // the router level in breaker.test.ts; decision.rejected is capped by
    // maxRejected, so the v5 entries' position in it is not stable here.)
    const { decision } = service.route({
      requirements: {
        modelClass: "chat",
        summary: "outage: all restricted candidates circuit-open",
        restrictProviders: [PRIMARY, FALLBACK],
      },
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.selected).toBeUndefined();
    expect(decision.explanation).toMatch(/No compatible model/);
    expect(decision.humanHandoff?.required).toBe(true);

    // SLO: breaker trips recorded; unavailable selection counted honestly.
    const report = service.slo.report();
    expect(report.breaker.trips).toBeGreaterThanOrEqual(2);
    expect(report.selection.unavailableRate).toBeGreaterThan(0);
  });

  test("route() records the selection SLO on the automatic path too (single choke point)", () => {
    fallbackBehavior = async () => ({ message: "ok", toolCalls: [], done: true });
    primaryBehavior = fallbackBehavior;
    const service = wiredService(baseConfig());

    const { decision } = service.route({
      requirements: {
        modelClass: "chat",
        summary: "quick automatic route",
        restrictProviders: [PRIMARY, FALLBACK],
      },
    });
    expect(decision.unavailable).toBe(false);
    expect(decision.manual).toBe(false);

    const report = service.slo.report();
    expect(report.selection.count).toBe(1);
    expect(report.selection.manualRate).toBe(0);
    expect(report.selection.p95Ms).toBeLessThan(report.selection.budgetMs);
  });
});
