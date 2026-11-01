/** Executable desktop/engine contracts; no real provider compatibility claim. */
import { expect, test } from "bun:test";
import vectors from "./fixtures/pricing-v1.json";
import { estimateCost, modelInfo } from "../../desktop/src/budget/models.ts";
import { checkPreCall, emptyCounters } from "../../desktop/src/budget/core.ts";
import { DEFAULT_BUDGET_SETTINGS } from "../../desktop/src/budget/types.ts";
import {
  catalogQuote,
  modelOptions,
  type EngineCatalog,
} from "../../desktop/src/engine/catalog.ts";
import { tighteningPatch } from "../../desktop/src/engine/budget-policy.ts";
import { UsageAccumulator } from "../../desktop/src/engine/usage.ts";
import { resolveEngineModel } from "../../desktop/src/engine/wire.ts";
import type {
  EngineBudget,
  EngineProvidersResponse,
} from "../../desktop/src/engine/types.ts";
import { priceFor } from "../../src/cost/pricing.ts";
import { ConfigSchema } from "../../src/config/config.ts";
import {
  buildCatalog,
  invalidateCatalogCache,
} from "../../src/intelligence/catalog.ts";
import { evaluateCandidate } from "../../src/intelligence/evaluator.ts";
import { policyFromConfig } from "../../src/intelligence/router.ts";
import "../../src/providers/factory.ts";
const NOW = Date.parse("2026-10-26T00:00:00Z");
for (const v of vectors.cases)
  test(`shared dated pricing vector: ${v.id}`, () => {
    const actual = estimateCost(v.model, v.input, v.output, Date.parse(v.now));
    if (v.usd === null) expect(Number.isNaN(actual)).toBe(true);
    else expect(actual).toBeCloseTo(v.usd, 9);
  });
test("empty fresh configuration does not fabricate installed/configured models or an Auto consent", () => {
  expect(DEFAULT_BUDGET_SETTINGS.installedLocal).toEqual([]);
  expect(DEFAULT_BUDGET_SETTINGS.configuredModels).toEqual([]);
  expect(DEFAULT_BUDGET_SETTINGS.modelDownshifting).toBe(false);
  expect(modelInfo("new-cloud-id").latency).toBe("unknown");
  expect(modelInfo("new-cloud-id").quality).toBe("unknown");
});
test("unknown money/NaN cannot fall through comparisons into admission; secondary routing cannot change a pin", () => {
  const settings = {
    ...DEFAULT_BUDGET_SETTINGS,
    modelDownshifting: true,
    configuredModels: ["openai::gpt-6-astra", "openai::gpt-6-luna"],
    installedLocal: ["qwen2.5:3b"],
  };
  const c = emptyCounters(NOW, NOW);
  for (const estimatedCost of [undefined, NaN, Infinity, -1]) {
    const r = checkPreCall(
      settings,
      c,
      {
        model: "vendor::unknown",
        estimatedTokensIn: 100,
        estimatedTokensOut: 800,
        estimatedCost,
        surface: "chat",
        allowDownshift: false,
      },
      { now: NOW },
    );
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("price-unavailable");
  }
  const pinned = checkPreCall(
    settings,
    c,
    {
      model: "openai::gpt-6-astra",
      estimatedTokensIn: 100000,
      estimatedTokensOut: 20000,
      surface: "chat",
      allowDownshift: false,
    },
    { now: NOW },
  );
  expect(pinned.allowed).toBe(false);
  expect(pinned.model).toBe("openai::gpt-6-astra");
  expect(pinned.downgradedToModel).toBeNull();
});
test("qualified target keeps custom provider and vendor/path model, never a name-based provider guess", () => {
  expect(resolveEngineModel("openrouter::anthropic/claude-sonnet-5-5")).toEqual(
    { provider: "openrouter", model: "anthropic/claude-sonnet-5-5" },
  );
  expect(resolveEngineModel("vendor::llama3.1:8b")).toEqual({
    provider: "vendor",
    model: "llama3.1:8b",
  });
  expect(modelInfo("vendor::llama3.1:8b").local).toBe(false);
  expect(resolveEngineModel("anthropic/claude-sonnet-5-5")).toEqual({
    provider: "anthropic",
    model: "claude-sonnet-5-5",
  });
});
const providers: EngineProvidersResponse = {
  primary: "vendor",
  model: "vendor/path-model",
  providers: [
    {
      id: "vendor",
      label: "Custom remote",
      kind: "custom",
      locality: "cloud",
      hasKey: true,
      healthy: false,
      healthState: "unknown",
    },
  ],
};
test("saved custom model stays inspectable but never fabricated local/installed/healthy", () => {
  const groups = modelOptions(providers, null, null);
  expect(groups.local).toEqual([]);
  expect(groups.cloud).toHaveLength(1);
  expect(groups.cloud[0].id).toBe("vendor::vendor/path-model");
  expect(groups.cloud[0].available).toBe(false);
  expect(groups.cloud[0].detail).toContain("agent not validated");
});
test("catalog quote shares long-context rates, preserves unavailable remote-local rates and explicit operator declarations", () => {
  const config = ConfigSchema.parse({
    defaults: { provider: "openai", model: "gpt-6-luna" },
  });
  const engine = buildCatalog(config);
  const catalog: EngineCatalog = {
    builtAt: NOW,
    models: engine.models.map((m) => ({
      ...m,
      locality: m.locality.locality,
      contextWindow: m.context.contextWindow,
    })),
  };
  expect(catalogQuote(catalog, "openai", "gpt-6-luna", 300000, 1000, NOW)).toBe(
    0.06075,
  );
  expect(
    Number.isNaN(
      catalogQuote(
        catalog,
        "openai",
        "gpt-6-luna",
        2000,
        800,
        Date.parse("2027-01-25"),
      ),
    ),
  ).toBe(true);
  const remote = ConfigSchema.parse({
    providers: { ollama: { baseUrl: "https://remote.invalid/v1" } },
    defaults: { provider: "ollama", model: "qwen2.5:3b" },
  });
  invalidateCatalogCache();
  const row = buildCatalog(remote).models.find(
    (m) => m.providerId === "ollama" && m.modelId === "qwen2.5:3b",
  )!;
  expect(row.cost.free).toBe(false);
  expect(row.cost.known).toBe(false);
  const declared = ConfigSchema.parse({
    ...remote,
    providerEngine: {
      ...remote.providerEngine,
      providerCapabilities: {
        ollama: {
          models: {
            "qwen2.5:3b": {
              cost: {
                source: "test-only operator document",
                inPerMTok: 1,
                outPerMTok: 2,
              },
            },
          },
        },
      },
    },
  });
  invalidateCatalogCache();
  const priced = buildCatalog(declared).models.find(
    (m) => m.providerId === "ollama" && m.modelId === "qwen2.5:3b",
  )!;
  expect(priced.cost.source).toBe(
    "operator-declared: test-only operator document",
  );
  expect(priced.cost.inPerMTok).toBe(1);
  expect(
    priceFor("ollama", "qwen2.5:3b", { override: { known: false } }).known,
  ).toBe(false);
});
test("research gate: engine-declared rates admit an otherwise unpriced model — without them it still fails closed", () => {
  // 2026 posture: the provider is Groq, the model is absent from the local
  // price table (like every gpt-oss id), and the operator declares rates in
  // the engine config. researchStore quotes the engine catalog before the
  // budget gate (mirroring engine/chat.ts) — this pins that contract.
  const config = ConfigSchema.parse({
    defaults: { provider: "groq", model: "openai/gpt-oss-120b" },
    providerEngine: {
      providerCapabilities: {
        groq: {
          models: {
            "openai/gpt-oss-120b": {
              cost: {
                source: "test-only operator document",
                inPerMTok: 0.15,
                outPerMTok: 0.6,
              },
            },
          },
        },
      },
    },
  });
  invalidateCatalogCache();
  const engine = buildCatalog(config);
  const catalog: EngineCatalog = {
    builtAt: NOW,
    models: engine.models.map((m) => ({
      ...m,
      locality: m.locality.locality,
      contextWindow: m.context.contextWindow,
    })),
  };
  // The settings.model string research hands to the gate (unqualified).
  const model = "openai/gpt-oss-120b";
  // The local table cannot price it — the exact failure the live run hit.
  expect(Number.isFinite(estimateCost(model, 36000, 6000, NOW))).toBe(false);
  // The engine catalog carries the operator declaration; the quote is finite.
  const quote = catalogQuote(catalog, "groq", model, 36000, 6000, NOW);
  expect(quote).toBe((36000 * 0.15 + 6000 * 0.6) / 1_000_000); // 0.009
  const req = {
    model,
    estimatedTokensIn: 36000,
    estimatedTokensOut: 6000,
    agent: "researcher",
    workspace: null,
    sessionId: null,
    surface: "research" as const,
  };
  const allowed = checkPreCall(DEFAULT_BUDGET_SETTINGS, emptyCounters(), {
    ...req,
    estimatedCost: quote,
  }, { now: NOW });
  expect(allowed.allowed).toBe(true);
  expect(allowed.code).toBe("ok");
  // Without the catalog quote the identical call fails closed.
  const denied = checkPreCall(
    DEFAULT_BUDGET_SETTINGS,
    emptyCounters(),
    req,
    { now: NOW },
  );
  expect(denied.allowed).toBe(false);
  expect(denied.code).toBe("price-unavailable");
});
test("credential presence is separate from authentication, but missing credentials still reject an execution candidate", () => {
  const config = ConfigSchema.parse({});
  const model = buildCatalog(config).models.find(
    (m) => m.providerId === "openai" && m.modelId === "gpt-6-luna",
  )!;
  const candidate = {
    ...model,
    credentialAvailable: false,
    health: { checkedAt: 0, stale: true },
  };
  const result = evaluateCandidate(
    candidate,
    {
      modelClass: "chat",
      pin: { providerId: "openai", modelId: "gpt-6-luna", strict: true },
    },
    policyFromConfig(config),
  );
  expect(result.compatible).toBe(false);
  expect(result.rejections.some((r) => r.code === "credential_missing")).toBe(
    true,
  );
  expect(candidate.health).not.toHaveProperty("authOk");
});
test("settlement sums actual attempts and provenance, never the final summary twice or selected-model repricing", () => {
  const a = new UsageAccumulator();
  a.add({
    provider: "openai",
    model: "gpt-6.1-sol",
    source: "estimated",
    usage: { inTokens: 100, outTokens: 200 },
    usdEstimate: 0.0022,
  });
  a.add({
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    source: "provider",
    usage: { inTokens: 300, outTokens: 400 },
    usdEstimate: 0.0046,
  });
  const sum = a.summary({ inTokens: 400, outTokens: 600 });
  expect(sum.inTokens).toBe(400);
  expect(sum.outTokens).toBe(600);
  expect(sum.usdEstimate).toBeCloseTo(0.0068, 10);
  expect(a.attempts.map((a) => a.provider)).toEqual(["openai", "anthropic"]);
  expect(a.summary({ inTokens: 401, outTokens: 600 }).usdEstimate).toBeNull();
  expect(a.summary(undefined, false).usdEstimate).toBeNull();
});
test("legacy or missing/interrupted settlement never becomes an invented zero", () => {
  const a = new UsageAccumulator();
  expect(a.summary().usdEstimate).toBeNull();
  expect(a.summary({ inTokens: 10, outTokens: 20 })).toEqual({
    inTokens: 10,
    outTokens: 20,
    usdEstimate: null,
  });
  a.add({ usage: { inTokens: 0, outTokens: 0 } });
  expect(a.summary().usdEstimate).toBeNull();
  const b = new UsageAccumulator();
  b.add({
    provider: "ollama",
    model: "qwen2.5:3b",
    source: "provider",
    usage: { inTokens: 0, outTokens: 0 },
    usdEstimate: 0,
  });
  expect(b.summary().usdEstimate).toBe(0); // explicit known zero, not absent money
});
test("implicit desktop synchronization can only tighten existing engine caps; corrupt/missing policy denies", () => {
  const budget: EngineBudget = {
    config: { perTaskUsd: 0.1 },
    persisted: { monthly_cap: 2, daily_cap: 0.2 },
    usage: { totalUsd: 1, totalTokens: 10 },
  };
  expect(
    tighteningPatch(budget, {
      ...DEFAULT_BUDGET_SETTINGS,
      monthlyLimit: 50,
      dailyLimit: 5,
      perRequestLimit: 2,
    }),
  ).toEqual({});
  expect(
    tighteningPatch(budget, {
      ...DEFAULT_BUDGET_SETTINGS,
      monthlyLimit: 1,
      dailyLimit: 0.1,
      perRequestLimit: 0.05,
    }),
  ).toEqual({ monthlyCap: 1, dailyCap: 0.1, perTaskUsd: 0.05 });
  expect(
    tighteningPatch(budget, {
      ...DEFAULT_BUDGET_SETTINGS,
      monthlyLimit: 0,
      dailyLimit: 0,
      perRequestLimit: 0,
    }),
  ).toEqual({ monthlyCap: 0 });
  expect(() =>
    tighteningPatch(
      { ...budget, persisted: { monthly_cap: NaN } },
      DEFAULT_BUDGET_SETTINGS,
    ),
  ).toThrow("unavailable/invalid");
});
