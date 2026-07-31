/**
 * XR Phase 2 · T3 — LOCALITY INVARIANT: the single routing authority never
 * lets data leave the machine against the workspace's policy.
 *
 * ── The defect this test locks shut ─────────────────────────────────────────
 *
 * The retired `src/providers/routing.ts` had two independent behaviours that
 * could contradict `IntelligenceRouter`:
 *
 *   1. Its own locality derivation recognised only `local_only` and IGNORED
 *      `private_only` and `no_cloud`.
 *   2. On `decision.unavailable` it constructed `config.defaults.provider`
 *      directly, with NO locality check at all:
 *
 *          const primaryId = overrides?.provider ?? this.config.defaults.provider;
 *          const primary = registry.createProvider(primaryId, …);
 *
 *      So a `no_cloud` workspace whose local runtime was momentarily
 *      unavailable was handed the configured default — commonly a cloud
 *      provider — silently. That is a data-egress policy bypass.
 *
 * These tests assert EFFECTS (which provider object is produced, or that the
 * call throws), not that a flag was read.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  LocalityPolicyViolation,
  RoutingService,
  localityAllowed,
} from "../../src/intelligence/routing-service.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";

// Registering the built-in provider presets is a side effect of importing the
// factory; without it the registry is empty and every resolve fails for the
// wrong reason. Same bootstrap the existing integration test uses.
import "../../src/providers/factory.ts";
import { registry } from "../../src/providers/registry.ts";
import { PRESETS } from "../../src/providers/presets.ts";

function config(over: Record<string, unknown> = {}): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: { routingStrategy: "hybrid" },
    intelligencePlane: {},
    ...over,
  });
}

/** Locality of a provider id, read from the same preset catalogue routing uses. */
function localityOfProvider(id: string): "local" | "private" | "cloud" | "unknown" {
  const preset = registry.getPreset(id) ?? PRESETS[id];
  if (!preset) return "unknown";
  if (preset.kind === "local") return "local";
  if (preset.kind === "hosted") return "cloud";
  return "private";
}

const CLOUD_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of CLOUD_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of CLOUD_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("T3 — one routing authority", () => {
  test("the legacy router module no longer exists", async () => {
    // Retirement must reach removal, not stop at the facade (Part 13.5).
    const legacy = Bun.file(`${import.meta.dir}/../../src/providers/routing.ts`);
    expect(await legacy.exists()).toBe(false);
  });

  test("RoutingService produces a decision with an explicit locality policy", () => {
    const svc = new RoutingService(config());
    const decision = svc.decide({});
    expect(decision.constraints.localityPolicy).toBeTruthy();
    expect(decision.explanation.length).toBeGreaterThan(0);
  });
});

describe("T3 — localityAllowed: the one policy predicate", () => {
  test("any permits everything", () => {
    for (const loc of ["local", "private", "cloud", "hybrid", "unknown"] as const) {
      expect(localityAllowed("any", loc)).toBe(true);
    }
  });

  test("local_only permits ONLY local", () => {
    expect(localityAllowed("local_only", "local")).toBe(true);
    expect(localityAllowed("local_only", "private")).toBe(false);
    expect(localityAllowed("local_only", "cloud")).toBe(false);
    expect(localityAllowed("local_only", "hybrid")).toBe(false);
    expect(localityAllowed("local_only", "unknown")).toBe(false);
  });

  test("private_only permits local and private, refuses cloud", () => {
    expect(localityAllowed("private_only", "local")).toBe(true);
    expect(localityAllowed("private_only", "private")).toBe(true);
    expect(localityAllowed("private_only", "cloud")).toBe(false);
    expect(localityAllowed("private_only", "unknown")).toBe(false);
  });

  test("no_cloud refuses cloud AND hybrid AND unknown (ambiguity denies)", () => {
    expect(localityAllowed("no_cloud", "local")).toBe(true);
    expect(localityAllowed("no_cloud", "private")).toBe(true);
    expect(localityAllowed("no_cloud", "cloud")).toBe(false);
    expect(localityAllowed("no_cloud", "hybrid")).toBe(false);
    // The pre-Phase-2 gap: an unrecognised provider must not be assumed safe.
    expect(localityAllowed("no_cloud", "unknown")).toBe(false);
  });
});

describe("T3 — REGRESSION: a cloud default is never silently used under a restrictive policy", () => {
  /**
   * The pre-Phase-2 defect: with `defaults.provider = "openai"` and a
   * restrictive policy, `ProviderRouter` skipped straight to
   * `registry.createProvider(config.defaults.provider, …)` whenever the
   * decision came back `unavailable`, producing an OpenAI provider with no
   * policy check.
   *
   * The single authority must never yield a cloud provider here. Two outcomes
   * are acceptable and BOTH are secure:
   *   · a compliant (local/private) provider is selected instead, or
   *   · the call fails closed with LocalityPolicyViolation.
   * What is NOT acceptable is silently returning the cloud default.
   */
  for (const policy of ["no_cloud", "private_only", "local_only"] as const) {
    test(`${policy}: a cloud default never yields a cloud provider`, () => {
      const cfg = config({
        defaults: { provider: "openai", model: "gpt-4o-mini" },
        intelligencePlane: { localityPolicy: policy },
      });
      const svc = new RoutingService(cfg);

      let resolvedId: string | null = null;
      try {
        resolvedId = svc.resolveWithDecision({}).provider.id;
      } catch (e) {
        // Failing closed is the other acceptable outcome.
        expect(e).toBeInstanceOf(LocalityPolicyViolation);
        expect((e as LocalityPolicyViolation).policy).toBe(policy);
        return;
      }

      // If it resolved, the target MUST satisfy the policy — and must not be
      // the cloud default the old code would have handed back.
      expect(resolvedId).not.toBe("openai");
      expect(localityAllowed(policy, localityOfProvider(resolvedId!))).toBe(true);
    });

    test(`${policy}: an EXPLICIT cloud pin is refused (fail closed)`, () => {
      // Manual pins win over routing preference, but never over a data-egress
      // policy: intelligence proposes, policy grants (Inviolable P5).
      const cfg = config({ intelligencePlane: { localityPolicy: policy } });
      const svc = new RoutingService(cfg);
      expect(() => svc.resolveWithDecision({ provider: "openai", model: "gpt-4o-mini" })).toThrow(
        LocalityPolicyViolation,
      );
    });

    test(`${policy}: the violation is explainable (names policy + target)`, () => {
      const cfg = config({ intelligencePlane: { localityPolicy: policy } });
      const svc = new RoutingService(cfg);
      try {
        svc.resolveWithDecision({ provider: "openai", model: "gpt-4o-mini" });
        throw new Error("expected a LocalityPolicyViolation");
      } catch (e) {
        expect(e).toBeInstanceOf(LocalityPolicyViolation);
        const err = e as LocalityPolicyViolation;
        expect(err.policy).toBe(policy);
        expect(err.attemptedProviderId).toBe("openai");
        expect(err.attemptedLocality).toBe("cloud");
        expect(err.message).toContain(policy);
      }
    });
  }

  test("no_cloud + local default still resolves normally (no false positive)", () => {
    const cfg = config({ intelligencePlane: { localityPolicy: "no_cloud" } });
    const svc = new RoutingService(cfg);
    const { provider, decision } = svc.resolveWithDecision({});
    expect(provider).toBeDefined();
    expect(decision.constraints.localityPolicy).toBe("no_cloud");
    expect(localityAllowed("no_cloud", localityOfProvider(provider.id))).toBe(true);
  });

  test("local_only resolves to a genuinely local provider", () => {
    const cfg = config({ intelligencePlane: { localityPolicy: "local_only" } });
    const svc = new RoutingService(cfg);
    const { provider } = svc.resolveWithDecision({});
    expect(localityOfProvider(provider.id)).toBe("local");
  });

  test("policy `any` still permits an explicit cloud pin (no over-blocking)", () => {
    // The fix must not turn into a blanket cloud ban: `any` behaves exactly as
    // it did before Phase 2.
    const cfg = config({ intelligencePlane: { localityPolicy: "any" } });
    const svc = new RoutingService(cfg);
    const { provider } = svc.resolveWithDecision({ provider: "openai", model: "gpt-4o-mini" });
    expect(provider.id).toBe("openai");
  });
});

describe("T3 — legacy strategy compatibility is preserved", () => {
  for (const strategy of [
    "primary",
    "localFirst",
    "cloudFirst",
    "hybrid",
    "cheapest",
    "fastest",
  ] as const) {
    test(`strategy "${strategy}" still resolves a provider`, () => {
      const svc = new RoutingService(config());
      const { provider, decision } = svc.resolveWithDecision({ strategy });
      expect(provider).toBeDefined();
      expect(decision).toBeDefined();
    });
  }

  test("localModels.routing = 'local-only' is still honoured", () => {
    const cfg = config({
      defaults: { provider: "openai", model: "gpt-4o-mini" },
      localModels: { enabled: true, routing: "local-only" },
    });
    const svc = new RoutingService(cfg);
    // The legacy `localModels.routing` switch must map onto the same policy the
    // single authority enforces — a cloud default must never satisfy it.
    const decision = svc.decide({});
    expect(decision.constraints.localityPolicy).toBe("local_only");
    const { provider } = svc.resolveWithDecision({});
    expect(localityOfProvider(provider.id)).toBe("local");
  });
});

describe("T3 — Phase 0 · T11 fallback diversity survives the merge", () => {
  test("a same-provider/same-model fallback is never wired", () => {
    // The shipped defaults made provider==fallbackProvider the common case.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "ollama",
        fallbackModel: "qwen2.5:7b",
      },
    });
    const svc = new RoutingService(cfg);
    const { provider } = svc.resolveWithDecision({});
    // A FallbackProvider would expose `fallbackId`; a bare provider does not.
    const wrapped = provider as { fallbackId?: string };
    if (wrapped.fallbackId !== undefined) {
      const model = (provider as { model?: string }).model;
      const fbModel = (provider as unknown as { fallback: { model?: string } }).fallback.model;
      expect(wrapped.fallbackId !== "ollama" || model !== fbModel).toBe(true);
    }
  });
});
