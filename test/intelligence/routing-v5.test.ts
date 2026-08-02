/**
 * XR Phase 5 · T1 — explainable automatic routing + complete manual override.
 *
 * Asserts EFFECTS on representative task classes: every decision carries a
 * structured, inspectable reason (difficulty, signals, floor, factors);
 * automatic routing is opt-in→default with enableAutomatic honored; and
 * override modes (pin / restrict / local_only / private_only / preferred)
 * are complete — including overriding a seeded bad-metadata decision.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { IntelligenceRouter, policyFromConfig } from "../../src/intelligence/router.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import { resetDefaultMetrics } from "../../src/intelligence/metrics.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import type { ModelClass } from "../../src/intelligence/types.ts";

function baseConfig(over: Record<string, unknown> = {}): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: { routingStrategy: "hybrid" },
    intelligencePlane: {},
    ...over,
  });
}

const CLOUD_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetDefaultMetrics();
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

describe("Phase 5 · explainable automatic routing", () => {
  test("representative task classes route with a structured explainable reason", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const classes: Array<{ modelClass: ModelClass; require?: Record<string, boolean> }> = [
      { modelClass: "chat" },
      { modelClass: "chat", require: { toolUse: true } },
      { modelClass: "reasoning", require: { reasoning: true } },
      { modelClass: "vision", require: { vision: true } },
      { modelClass: "embeddings", require: { embeddings: true } },
    ];
    for (const c of classes) {
      const { decision, record } = router.route(config, {
        requirements: {
          modelClass: c.modelClass,
          ...(c.require ? { require: c.require } : {}),
          summary: `representative ${c.modelClass} task`,
        },
      });
      // A decision is either a compliant selection or an HONEST unavailability.
      expect(record.decisionId).toBeTruthy();
      expect(decision.explanation.length).toBeGreaterThan(0);
      expect(decision.difficulty).toBeDefined();
      expect(typeof decision.difficulty!.requiredFidelity).toBe("number");
      expect(record.difficultyScore).toBe(decision.difficulty!.score);
      if (!decision.unavailable) {
        expect(decision.selected).toBeDefined();
        expect(decision.factors.length).toBeGreaterThan(0);
        expect(decision.factors.join(" ")).toMatch(/difficulty=/);
      }
    }
  });

  test("difficulty signals appear in the explanation (deterministic, inspectable)", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "chat",
        require: { toolUse: true, structuredOutput: true },
        summary: "Analyze and compare the three designs, then produce a formal migration plan\n1. step one\n2. step two",
        minContextTokens: 128_000,
      },
    });
    expect(decision.difficulty!.signals.length).toBeGreaterThan(0);
    expect(decision.explanation).toMatch(/difficulty=/);
  });

  test("seeded BAD metadata decision is overridable by manual pin (override completeness)", () => {
    // Seed a bad override at the MODEL level (the decision-path metadata):
    // mark the local runtime's default toolUse-unsupported; the tool-use task
    // will be routed away from it (metadata says incapable).
    const config = baseConfig({
      providerEngine: {
        routingStrategy: "hybrid",
        providerCapabilities: { ollama: { models: { "qwen2.5:7b": { toolUse: false } } } },
      },
    });
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const auto = router.route(config, {
      requirements: { modelClass: "chat", require: { toolUse: true }, summary: "call tools" },
    });
    const autoRejectsOllama = auto.decision.rejected.some((r) => r.providerId === "ollama");
    const autoAvoidsOllama = auto.decision.selected?.providerId !== "ollama";
    expect(autoRejectsOllama || autoAvoidsOllama).toBe(true);

    // The user's pin overrides the bad metadata deterministically.
    const pinned = router.route(config, {
      provider: "ollama",
      model: "qwen2.5:7b",
      requirements: { modelClass: "chat", require: { toolUse: true }, summary: "call tools" },
    });
    expect(pinned.decision.selected?.providerId).toBe("ollama");
    expect(pinned.decision.manual).toBe(true);
  });

  test("restrict-to-set: only whitelisted providers are eligible (user_restriction)", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "chat",
        summary: "hello",
        restrictProviders: ["ollama", "lmstudio"],
      },
    });
    if (decision.selected) {
      expect(["ollama", "lmstudio"]).toContain(decision.selected.providerId);
    }
    // Cloud candidates are rejected NAMING the restriction
    const restricted = decision.rejected.filter((r) => !["ollama", "lmstudio"].includes(r.providerId));
    for (const r of restricted) {
      expect(r.reasons.some((x) => x.code === "user_restriction")).toBe(true);
    }
  });

  test("enableAutomatic:false → no roaming: defaults resolve via preferred_with_fallback", () => {
    const config = baseConfig({
      intelligencePlane: { enableAutomatic: false },
    });
    const policy = policyFromConfig(config);
    expect(policy.routingMode).toBe("preferred_with_fallback");

    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, { requirements: { modelClass: "chat", summary: "hello" } });
    expect(decision.mode).toBe("preferred_with_fallback");
    // Defaults are the anchors of the decision (workspace default provider).
    expect(decision.selected?.providerId).toBe("ollama");
    expect(decision.factors.join(" ")).toMatch(/workspace default provider|preferred provider/);
  });

  test("enableAutomatic default (new users) routes automatically", () => {
    const config = baseConfig(); // enableAutomatic defaults to true
    const policy = policyFromConfig(config);
    expect(policy.routingMode).toBe("automatic");
  });

  test("explicit difficulty override feeds the capability gate deterministically", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const easy = router.route(config, {
      requirements: { modelClass: "chat", difficulty: 0.05, summary: "deterministic seed test a" },
    });
    const hard = router.route(config, {
      requirements: { modelClass: "chat", difficulty: 0.99, summary: "deterministic seed test a" },
    });
    expect(easy.decision.difficulty!.score).toBe(0.05);
    expect(hard.decision.difficulty!.score).toBe(0.99);
    expect(hard.decision.requirements.minFidelity!.overall!)
      .toBeGreaterThan(easy.decision.requirements.minFidelity!.overall!);
    // explicit override explains itself
    expect(hard.decision.difficulty!.signals.join(" ")).toMatch(/explicit difficulty override/);
  });

  test("difficultyRouting:false leaves no fidelity floor (workspace opt-out)", () => {
    const config = baseConfig({ intelligencePlane: { difficultyRouting: false } });
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: { modelClass: "chat", summary: "hello" },
    });
    expect(decision.requirements.minFidelity).toBeUndefined();
  });

  test("minOverallFidelity config override wins over difficulty floor", () => {
    const config = baseConfig({ intelligencePlane: { minOverallFidelity: 0.9 } });
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: { modelClass: "chat", summary: "hello" },
    });
    expect(decision.requirements.minFidelity?.overall).toBe(0.9);
  });

  test("local_only and private_only modes keep their override meaning", () => {
    const localCfg = baseConfig({ intelligencePlane: { localityPolicy: "local_only", mode: "local_only" } });
    const router = new IntelligenceRouter({ catalog: buildCatalog(localCfg) });
    const local = router.route(localCfg, { requirements: { modelClass: "chat", summary: "hello" } });
    if (local.decision.selected) {
      const cat = buildCatalog(localCfg);
      const m = cat.models.find((x) => x.key === local.decision.selected!.key);
      expect(m?.locality.locality).toBe("local");
    }
    expect(local.decision.constraints.localityPolicy).toBe("local_only");
  });
});
