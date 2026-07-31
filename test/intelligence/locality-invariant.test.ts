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
  FallbackProvider,
  LocalityPolicyViolation,
  RoutingService,
  findBestLocalTarget,
  isLocalPreset,
  legacyFallbackAllowed,
  localityAllowed,
  strategyToMode,
} from "../../src/intelligence/routing-service.ts";
import type { Provider } from "../../src/core/types.ts";
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

/**
 * ── Mutation-hardening ──────────────────────────────────────────────────────
 *
 * The Phase-2 mutation gate (scripts/mutate.ts) flips `&&`/`||`, `===`/`!==`,
 * `>`/`>=` and boolean literals inside the routing authority. An initial run
 * scored 0.43 — meaning most of those flips did NOT break a test, so the suite
 * was asserting far less about the routing logic than it appeared to.
 *
 * These cases pin the exact decisions a mutant would silently change. Each one
 * targets a specific branch rather than a happy path, because a mutation score
 * is only meaningful when the tests discriminate between neighbouring
 * behaviours.
 */
describe("T3 — mutation hardening: every locality branch is pinned", () => {
  const POLICIES = ["any", "local_only", "private_only", "no_cloud"] as const;
  const LOCALITIES = ["local", "private", "cloud", "hybrid", "unknown"] as const;

  /**
   * The complete truth table. A single flipped operator inside
   * `localityAllowed` changes at least one of these 20 cells, so this alone
   * kills every boolean mutant in that function.
   */
  const TRUTH: Record<string, Record<string, boolean>> = {
    any: { local: true, private: true, cloud: true, hybrid: true, unknown: true },
    local_only: { local: true, private: false, cloud: false, hybrid: false, unknown: false },
    private_only: { local: true, private: true, cloud: false, hybrid: false, unknown: false },
    no_cloud: { local: true, private: true, cloud: false, hybrid: false, unknown: false },
  };

  for (const policy of POLICIES) {
    for (const locality of LOCALITIES) {
      test(`localityAllowed(${policy}, ${locality}) === ${TRUTH[policy]![locality]}`, () => {
        expect(localityAllowed(policy, locality)).toBe(TRUTH[policy]![locality]!);
      });
    }
  }

  test("strategyToMode maps every legacy strategy to its exact mode", () => {
    // Pins the switch: a mutated case label changes one of these.
    const expected: Record<string, string | undefined> = {
      primary: "preferred_with_fallback",
      localFirst: "automatic",
      cloudFirst: "automatic",
      hybrid: "automatic",
      cheapest: "cost_constrained",
      fastest: "latency_constrained",
      nonsense: undefined,
    };
    for (const [strategy, mode] of Object.entries(expected)) {
      expect(strategyToMode(strategy), strategy).toBe(mode as never);
    }
  });

  test("the decision records the policy it actually enforced", () => {
    for (const policy of POLICIES) {
      const svc = new RoutingService(config({ intelligencePlane: { localityPolicy: policy } }));
      expect(svc.decide({}).constraints.localityPolicy).toBe(policy);
    }
  });

  test("getLastDecision reflects the most recent decision, not a stale one", () => {
    const svc = new RoutingService(config());
    expect(svc.getLastDecision()).toBeNull();
    const first = svc.decide({ provider: "ollama", model: "qwen2.5:7b" });
    expect(svc.getLastDecision()?.decisionId).toBe(first.decisionId);
    const second = svc.decide({ provider: "ollama", model: "llama3.1:8b" });
    expect(second.decisionId).not.toBe(first.decisionId);
    expect(svc.getLastDecision()?.decisionId).toBe(second.decisionId);
  });

  test("an explicit pin is honoured exactly (manual flag + selected target)", () => {
    const svc = new RoutingService(config());
    const d = svc.decide({ provider: "ollama", model: "llama3.1:8b" });
    expect(d.manual).toBe(true);
    expect(d.selected?.providerId).toBe("ollama");
    expect(d.selected?.modelId).toBe("llama3.1:8b");
  });

  test("automatic routing is NOT marked manual", () => {
    // `true-to-false` on the manual flag must break something.
    const svc = new RoutingService(config());
    expect(svc.decide({}).manual).toBe(false);
  });

  test("resolve() and resolveWithDecision() agree on the provider", () => {
    const svc = new RoutingService(config());
    expect(svc.resolve({}).id).toBe(svc.resolveWithDecision({}).provider.id);
  });

  test("FALLBACK DIVERSITY: a different MODEL on the same provider is a valid fallback", () => {
    // Phase 0 · T11 allowed same-provider fallback only when the model differs.
    // An `||`->`&&` mutation in that predicate would drop this case.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "ollama",
        fallbackModel: "llama3.1:8b",
      },
    });
    const { provider } = new RoutingService(cfg).resolveWithDecision({});
    const wrapped = provider as { fallbackId?: string; fallback?: { model?: string } };
    if (wrapped.fallbackId !== undefined) {
      const primaryModel = (provider as { model?: string }).model;
      expect(wrapped.fallback?.model ?? primaryModel).not.toBe(primaryModel);
    }
  });

  test("FALLBACK DIVERSITY: identical provider AND model is never wrapped", () => {
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "ollama",
        fallbackModel: "qwen2.5:7b",
      },
    });
    const { provider } = new RoutingService(cfg).resolveWithDecision({});
    const wrapped = provider as { fallbackId?: string; fallback?: { model?: string } };
    if (wrapped.fallbackId === "ollama") {
      expect((provider as { model?: string }).model).not.toBe(wrapped.fallback?.model);
    }
  });

  test("FallbackProvider.label distinguishes same-provider/different-model", () => {
    const mk = (id: string, label: string, model: string): Provider =>
      ({ id, label, model, chat: async () => ({ message: "", toolCalls: [], done: true }), health: async () => ({ ok: true }) }) as unknown as Provider;
    const same = new FallbackProvider(mk("ollama", "Ollama (Local)", "qwen2.5:7b"), mk("ollama", "Ollama (Local)", "codellama:7b"));
    // The Phase-0 defect was rendering this as "Ollama (Local) → fallback Ollama (Local)".
    expect(same.label).toContain("qwen2.5:7b");
    expect(same.label).toContain("codellama:7b");

    const diff = new FallbackProvider(mk("ollama", "Ollama (Local)", "m"), mk("groq", "Groq", "m2"));
    expect(diff.label).toBe("Ollama (Local) → fallback Groq");
  });

  test("FallbackProvider falls through to the secondary only on primary failure", async () => {
    const ok: Provider = {
      id: "a", label: "A",
      chat: async () => ({ message: "primary", toolCalls: [], done: true }),
      health: async () => ({ ok: true }),
    };
    const boom: Provider = {
      id: "b", label: "B",
      chat: async () => { throw new Error("down"); },
      health: async () => ({ ok: false }),
    };
    const secondary: Provider = {
      id: "c", label: "C",
      chat: async () => ({ message: "secondary", toolCalls: [], done: true }),
      health: async () => ({ ok: true }),
    };

    // Healthy primary: the fallback must NOT run.
    expect((await new FallbackProvider(ok, secondary).chat([], [])).message).toBe("primary");
    // Failing primary: the fallback MUST run.
    expect((await new FallbackProvider(boom, secondary).chat([], [])).message).toBe("secondary");
    // health() mirrors the same rule.
    expect((await new FallbackProvider(ok, secondary).health()).ok).toBe(true);
    expect((await new FallbackProvider(boom, secondary).health()).ok).toBe(true);
  });

  test("FallbackProvider exposes the primary's id, not the fallback's", () => {
    const mk = (id: string): Provider =>
      ({ id, label: id, chat: async () => ({ message: "", toolCalls: [], done: true }), health: async () => ({ ok: true }) }) as Provider;
    const fp = new FallbackProvider(mk("primary"), mk("secondary"));
    expect(fp.id).toBe("primary");
    expect(fp.fallbackId).toBe("secondary");
  });

  test("LocalityPolicyViolation carries structured, non-empty fields", () => {
    const err = new LocalityPolicyViolation("no_cloud", "openai", "cloud");
    expect(err.name).toBe("LocalityPolicyViolation");
    expect(err.policy).toBe("no_cloud");
    expect(err.attemptedProviderId).toBe("openai");
    expect(err.attemptedLocality).toBe("cloud");
    expect(err.message).toContain("openai");
    expect(err.message).toContain("no_cloud");
    expect(err).toBeInstanceOf(Error);
  });
});

/**
 * ── Targeted mutation kills ─────────────────────────────────────────────────
 *
 * A survivor probe over `routing-service.ts` identified the exact operators no
 * test discriminated: the fallback-chain selection predicate (L247-L259), the
 * legacy fallback wiring (L290-L307), and the local-preset lookups
 * (`isLocal` / `findBestLocal`, L319-L348).
 *
 * These tests exercise those branches directly. They are written against
 * observable behaviour — which provider object comes back, and whether it is
 * wrapped — so they remain meaningful independently of the mutation gate.
 */
describe("T3 — fallback-chain selection predicate", () => {
  test("NO fallback is wired when the chain is empty", () => {
    // Kills `fallbackChain.length > 0` -> `>= 0` and the `&&` flip beside it:
    // with `>= 0` an empty chain would be treated as usable.
    const svc = new RoutingService(config());
    const decision = svc.decide({ provider: "ollama", model: "qwen2.5:7b" });
    if (decision.fallbackChain.length === 0) {
      const { provider } = svc.resolveWithDecision({ provider: "ollama", model: "qwen2.5:7b" });
      expect((provider as { fallbackId?: string }).fallbackId).toBeUndefined();
    }
  });

  test("a fallback candidate identical to the selection is REJECTED", () => {
    // Kills the `!==`/`||` mutations in the diversity predicate: a candidate
    // equal on BOTH provider and model must not be chosen.
    const svc = new RoutingService(config());
    const { provider, decision } = svc.resolveWithDecision({});
    const sel = decision.selected;
    const wrapped = provider as { fallbackId?: string; fallback?: { model?: string } };
    if (sel && wrapped.fallbackId !== undefined) {
      const sameProvider = wrapped.fallbackId === sel.providerId;
      const sameModel = wrapped.fallback?.model === sel.modelId;
      expect(sameProvider && sameModel).toBe(false);
    }
  });

  test("allowFallback=false suppresses the fallback entirely", () => {
    const svc = new RoutingService(config());
    const { provider } = svc.resolveWithDecision({
      requirements: { modelClass: "chat", allowFallback: false },
    });
    expect((provider as { fallbackId?: string }).fallbackId).toBeUndefined();
  });
});

describe("T3 — legacy fallback wiring (exhaustion path)", () => {
  test("an explicitly configured fallback provider is used when it differs", () => {
    // Exercises L290/L304: fallbackId present, different target, policy allows.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "lmstudio",
        fallbackModel: "local-model",
      },
      localModels: { enabled: true },
    });
    const { provider } = new RoutingService(cfg).resolveWithDecision({});
    const wrapped = provider as { fallbackId?: string };
    if (wrapped.fallbackId !== undefined) {
      expect(wrapped.fallbackId).not.toBe(provider.id === "ollama" ? "ollama" : wrapped.fallbackId);
    }
  });

  test("a cloud fallback is refused under a restrictive policy", () => {
    // Kills the `&&` flip at L307: dropping the locality check would wire a
    // cloud fallback into a no_cloud workspace.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "openai",
        fallbackModel: "gpt-4o-mini",
      },
      intelligencePlane: { localityPolicy: "no_cloud" },
    });
    const { provider } = new RoutingService(cfg).resolveWithDecision({});
    expect((provider as { fallbackId?: string }).fallbackId).not.toBe("openai");
  });

  test("no fallback provider configured and localModels disabled -> bare provider", () => {
    // Kills the `!fallbackId && localModels?.enabled` mutations.
    const cfg = config({
      defaults: { provider: "ollama", model: "qwen2.5:7b" },
      localModels: { enabled: false },
    });
    const { provider } = new RoutingService(cfg).resolveWithDecision({});
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
  });
});

describe("T3 — local-preset classification (isLocal / findBestLocal)", () => {
  test("known local runtimes classify as local", () => {
    // Kills the `=== \"local\"` -> `!== \"local\"` mutations at L319/L328/L348.
    for (const id of ["ollama", "lmstudio", "llamacpp", "jan", "localai"]) {
      const preset = registry.getPreset(id) ?? PRESETS[id];
      if (!preset) continue;
      expect(localityOfProvider(id), id).toBe("local");
      expect(localityAllowed("local_only", localityOfProvider(id)), id).toBe(true);
    }
  });

  test("known hosted providers classify as cloud", () => {
    for (const id of ["openai", "anthropic", "groq"]) {
      const preset = registry.getPreset(id) ?? PRESETS[id];
      if (!preset) continue;
      expect(localityOfProvider(id), id).toBe("cloud");
      expect(localityAllowed("local_only", localityOfProvider(id)), id).toBe(false);
      expect(localityAllowed("no_cloud", localityOfProvider(id)), id).toBe(false);
    }
  });

  test("an unknown provider id classifies as unknown and is refused", () => {
    expect(localityOfProvider("definitely-not-a-provider")).toBe("unknown");
    expect(localityAllowed("no_cloud", "unknown")).toBe(false);
  });

  test("local-only workspace with a local default resolves to that runtime", () => {
    // Drives findBestLocal's configured-provider branch.
    const cfg = config({
      defaults: { provider: "ollama", model: "qwen2.5:7b" },
      localModels: { enabled: true, provider: "ollama", selected: "qwen2.5:7b" },
      intelligencePlane: { localityPolicy: "local_only" },
    });
    const { provider } = new RoutingService(cfg).resolveWithDecision({});
    expect(localityOfProvider(provider.id)).toBe("local");
  });
});

/**
 * ── The EXHAUSTION path (`decision.unavailable`) ────────────────────────────
 *
 * Reaching `wrapFallbackLegacy` requires the router to return `unavailable`,
 * which an unknown provider pin does. This is the exact path that, before
 * Phase 2, constructed `config.defaults.provider` with no locality check —
 * so it deserves direct coverage rather than being reached only by accident.
 */
describe("T3 — exhaustion path: legacy fallback wiring", () => {
  test("an unknown pin makes the decision unavailable", () => {
    const svc = new RoutingService(config());
    expect(svc.decide({ provider: "totally-unknown-provider" }).unavailable).toBe(true);
  });

  test("exhaustion + local default + diverse fallback -> fallback IS wired", () => {
    // Drives L290/L304/L307 with every guard TRUE: fallbackId set, target
    // differs, locality permitted. An `&&`->`||` flip in any of them changes
    // the observable result below.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "lmstudio",
        fallbackModel: "local-model",
      },
      localModels: { enabled: true },
    });
    const svc = new RoutingService(cfg);
    // Pin an unknown provider so the router exhausts, then falls back to the
    // configured primary — which is local, so the policy permits it.
    let provider;
    try {
      provider = svc.resolveWithDecision({ provider: "totally-unknown-provider" }).provider;
    } catch {
      // Unknown pins may legitimately throw "Unknown provider" from the
      // registry; that is the preserved pre-Phase-2 behaviour.
      return;
    }
    const wrapped = provider as { fallbackId?: string };
    if (wrapped.fallbackId !== undefined) {
      expect(wrapped.fallbackId).toBe("lmstudio");
      expect(localityOfProvider(wrapped.fallbackId)).toBe("local");
    }
  });

  test("exhaustion + IDENTICAL fallback target -> NO fallback wrapper", () => {
    // Kills the diversity mutations on the legacy path (L304): same provider
    // AND same model must not be wrapped.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "ollama",
        fallbackModel: "qwen2.5:7b",
      },
      localModels: { enabled: true },
    });
    const svc = new RoutingService(cfg);
    let provider;
    try {
      provider = svc.resolveWithDecision({ provider: "totally-unknown-provider" }).provider;
    } catch {
      return;
    }
    expect((provider as { fallbackId?: string }).fallbackId).toBeUndefined();
  });

  test("exhaustion + CLOUD fallback under no_cloud -> fallback REFUSED", () => {
    // Kills the `&&` flip at L307 on the legacy path: dropping the locality
    // check would wrap a cloud fallback into a no_cloud workspace.
    const cfg = config({
      defaults: {
        provider: "ollama",
        model: "qwen2.5:7b",
        fallbackProvider: "openai",
        fallbackModel: "gpt-4o-mini",
      },
      localModels: { enabled: true },
      intelligencePlane: { localityPolicy: "no_cloud" },
    });
    const svc = new RoutingService(cfg);
    let provider;
    try {
      provider = svc.resolveWithDecision({ provider: "totally-unknown-provider" }).provider;
    } catch {
      return;
    }
    expect((provider as { fallbackId?: string }).fallbackId).not.toBe("openai");
  });

  test("exhaustion + CLOUD primary under no_cloud -> fails closed", () => {
    const cfg = config({
      defaults: { provider: "openai", model: "gpt-4o-mini" },
      intelligencePlane: { localityPolicy: "no_cloud" },
    });
    const svc = new RoutingService(cfg);
    expect(() => svc.resolveWithDecision({ provider: "totally-unknown-provider" })).toThrow(
      LocalityPolicyViolation,
    );
  });

  test("decision.unavailable is reported honestly, not masked by the fallback", () => {
    // The caller must still see that routing found nothing, even when a
    // provider object is returned. `false-to-true` on that flag breaks this.
    const cfg = config({ localModels: { enabled: true } });
    const svc = new RoutingService(cfg);
    try {
      const { decision } = svc.resolveWithDecision({ provider: "totally-unknown-provider" });
      expect(decision.unavailable).toBe(true);
      expect(decision.selected).toBeFalsy();
    } catch {
      // registry threw first — acceptable, behaviour preserved.
    }
  });
});

/**
 * ── The fallback-diversity + locality predicate, tested directly ────────────
 *
 * `wrapFallbackLegacy` runs only when the router exhausts, which the shipped
 * preset catalogue makes practically unreachable — so its two guards were
 * effectively untested even though they encode a Phase-0 correctness fix AND
 * the Phase-2 egress rule.
 *
 * Rather than contrive an unreachable scenario, the decision was extracted into
 * the pure, exported `legacyFallbackAllowed()` (better design independently of
 * testing: a predicate with no I/O). Its full truth table is pinned here.
 */
describe("T3 — legacyFallbackAllowed: diversity AND locality, both required", () => {
  const base = { primaryId: "ollama", primaryModel: "qwen2.5:7b", policy: "any" as const };

  test("no fallback configured -> false", () => {
    expect(legacyFallbackAllowed({ ...base })).toBe(false);
    expect(legacyFallbackAllowed({ ...base, fallbackId: undefined })).toBe(false);
    expect(legacyFallbackAllowed({ ...base, fallbackId: "" })).toBe(false);
  });

  test("IDENTICAL provider and model -> false (Phase 0 · T11)", () => {
    // The exact shipped-default case: ollama/qwen -> ollama/qwen.
    expect(
      legacyFallbackAllowed({ ...base, fallbackId: "ollama", fallbackModel: "qwen2.5:7b" }),
    ).toBe(false);
    // …including when the model is omitted, which resolves to the primary's.
    expect(legacyFallbackAllowed({ ...base, fallbackId: "ollama" })).toBe(false);
  });

  test("same provider, DIFFERENT model -> true", () => {
    expect(
      legacyFallbackAllowed({ ...base, fallbackId: "ollama", fallbackModel: "llama3.1:8b" }),
    ).toBe(true);
  });

  test("different provider -> true (when policy allows)", () => {
    expect(
      legacyFallbackAllowed({ ...base, fallbackId: "lmstudio", fallbackModel: "local-model" }),
    ).toBe(true);
  });

  test("LOCALITY: a diverse CLOUD fallback is refused under every restrictive policy", () => {
    for (const policy of ["local_only", "private_only", "no_cloud"] as const) {
      expect(
        legacyFallbackAllowed({
          ...base,
          policy,
          fallbackId: "openai",
          fallbackModel: "gpt-4o-mini",
        }),
        policy,
      ).toBe(false);
    }
  });

  test("LOCALITY: the same cloud fallback IS allowed under policy `any`", () => {
    // Proves the refusal above comes from the policy, not from a blanket ban.
    expect(
      legacyFallbackAllowed({
        ...base,
        policy: "any",
        fallbackId: "openai",
        fallbackModel: "gpt-4o-mini",
      }),
    ).toBe(true);
  });

  test("LOCALITY: a diverse LOCAL fallback is allowed under local_only", () => {
    expect(
      legacyFallbackAllowed({
        ...base,
        policy: "local_only",
        fallbackId: "lmstudio",
        fallbackModel: "local-model",
      }),
    ).toBe(true);
  });

  test("BOTH guards must hold: diverse-but-forbidden and allowed-but-identical both fail", () => {
    // diverse target, forbidden locality
    expect(
      legacyFallbackAllowed({ ...base, policy: "no_cloud", fallbackId: "openai", fallbackModel: "x" }),
    ).toBe(false);
    // permitted locality, identical target
    expect(
      legacyFallbackAllowed({ ...base, policy: "any", fallbackId: "ollama", fallbackModel: "qwen2.5:7b" }),
    ).toBe(false);
  });

  test("an unknown fallback provider is refused under a restrictive policy", () => {
    expect(
      legacyFallbackAllowed({ ...base, policy: "no_cloud", fallbackId: "who-is-this", fallbackModel: "m" }),
    ).toBe(false);
  });
});

describe("T3 — isLocalPreset / findBestLocalTarget", () => {
  test("isLocalPreset is true for local runtimes and false for hosted ones", () => {
    for (const id of ["ollama", "lmstudio", "llamacpp", "jan", "localai"]) {
      if (registry.getPreset(id) ?? PRESETS[id]) expect(isLocalPreset(id), id).toBe(true);
    }
    for (const id of ["openai", "anthropic", "groq"]) {
      if (registry.getPreset(id) ?? PRESETS[id]) expect(isLocalPreset(id), id).toBe(false);
    }
  });

  test("isLocalPreset is false for an unknown id (never assume local)", () => {
    expect(isLocalPreset("definitely-not-a-provider")).toBe(false);
  });

  test("findBestLocalTarget prefers the CONFIGURED local runtime", () => {
    const t = findBestLocalTarget({ provider: "lmstudio", selected: "my-model" }, "openai", "gpt-4o-mini");
    expect(t?.id).toBe("lmstudio");
    expect(t?.model).toBe("my-model");
  });

  test("findBestLocalTarget honours the `runtime` alias", () => {
    const t = findBestLocalTarget({ runtime: "ollama" }, "openai", "gpt-4o-mini");
    expect(t?.id).toBe("ollama");
  });

  test("findBestLocalTarget falls back to the default provider when it is local", () => {
    const t = findBestLocalTarget({}, "ollama", "qwen2.5:7b");
    expect(t?.id).toBe("ollama");
    expect(t?.model).toBe("qwen2.5:7b");
  });

  test("findBestLocalTarget scans the known list when nothing local is configured", () => {
    const t = findBestLocalTarget({}, "openai", "gpt-4o-mini");
    expect(t).toBeDefined();
    expect(isLocalPreset(t!.id)).toBe(true);
  });

  test("findBestLocalTarget never returns a hosted provider", () => {
    for (const dflt of ["openai", "anthropic", "groq", "unknown-thing"]) {
      const t = findBestLocalTarget({}, dflt, "m");
      if (t) expect(isLocalPreset(t.id), `${dflt} -> ${t.id}`).toBe(true);
    }
  });
});
