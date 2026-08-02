/**
 * XR Phase 5 · T2/T8 — measured provider behavioral contracts.
 *
 * Charter §9.8: behavior is MEASURED and recorded, never vendor-claimed.
 * Asserts EFFECTS:
 *   · the offline evaluator measures real probe outcomes from a provider
 *     (scripted here — the same code path a live `xr providers measure` runs);
 *   · contracts persist and are re-read (no reparsing vendor presets);
 *   · capability-gated selection chooses the CHEAPEST model meeting the
 *     fidelity floor — and rejects a measured-below-floor model even when
 *     static presets declare it capable;
 *   · measured fidelity overrides the static price-tier prior in scoring
 *     (no vendor-claim assumptions left in the decision path).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BehavioralEvaluator,
  BehavioralStore,
  behavioralView,
  type BehavioralContract,
} from "../../src/intelligence/behavioral.ts";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import { scoreCandidate } from "../../src/intelligence/scorer.ts";
import { modelsFromPreset } from "../../src/intelligence/capability.ts";
import { PRESETS } from "../../src/providers/presets.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import type { IntelligenceCatalog } from "../../src/intelligence/catalog.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";
import type { ProviderDescriptor } from "../../src/intelligence/types.ts";

// ── Scripted providers (the observed outcomes come from actual chat() calls) ─

/** A provider that answers every probe CORRECTLY. */
function goodProvider(id = "probe-good"): Provider {
  return {
    id,
    label: "Good probe provider",
    async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
      const last = messages[messages.length - 1]!.content;
      if (tools.length && /xr_probe\.echo/.test(last)) {
        return { message: "", toolCalls: [{ tool: "xr_probe.echo", args: { text: "ping-0" } }], done: false };
      }
      if (/ONLY a JSON object/.test(last)) {
        return { message: `{"name":"probe0","count":1}`, toolCalls: [], done: true };
      }
      if (/anchor token/.test(last)) {
        return { message: "XR-ANCHOR-7741", toolCalls: [], done: true };
      }
      return { message: "Paris", toolCalls: [], done: true };
    },
    async health() {
      return { ok: true, latencyMs: 10 };
    },
  };
}

/** A provider that FAILS structured output, tool use, retention; fine on benign chat. */
function badProvider(id = "probe-bad"): Provider {
  return {
    id,
    label: "Bad probe provider",
    async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
      const last = messages[messages.length - 1]!.content;
      if (tools.length && /xr_probe\.echo/.test(last)) {
        return { message: "I cannot call tools right now, sorry!", toolCalls: [], done: true };
      }
      if (/ONLY a JSON object/.test(last)) {
        return { message: "Sure! Here is your data: {name: probe0, count: one}", toolCalls: [], done: true };
      }
      if (/anchor token/.test(last)) {
        return { message: "I don't recall any token.", toolCalls: [], done: true };
      }
      return { message: "Paris", toolCalls: [], done: true };
    },
    async health() {
      return { ok: true, latencyMs: 10 };
    },
  };
}

let xrHome: string;

beforeEach(() => {
  xrHome = mkdtempSync(join(tmpdir(), "xr-behavioral-"));
  process.env.XR_HOME = xrHome;
});

afterEach(() => {
  rmSync(xrHome, { recursive: true, force: true });
  delete process.env.XR_HOME;
});

describe("Phase 5 · behavioral contract evaluator (offline measurement)", () => {
  test("a high-fidelity provider measures ≈1.0 across all four dimensions", async () => {
    const evaluator = new BehavioralEvaluator({ timeoutMs: 5_000 });
    const contract = await evaluator.evaluate(goodProvider(), "good-model");
    expect(contract.source).toBe("measured");
    expect(contract.structuredOutputFidelity).toBe(1);
    expect(contract.toolUseFidelity).toBe(1);
    expect(contract.contextRetention).toBe(1);
    expect(contract.refusalRate).toBe(0);
    expect(contract.overallFidelity).toBeGreaterThanOrEqual(0.99);
    expect(contract.samples).toBeGreaterThanOrEqual(7);
    expect(contract.confidence).toBeGreaterThan(0);
  });

  test("a low-fidelity provider measures LOW on the exact dimensions it fails", async () => {
    const evaluator = new BehavioralEvaluator({ timeoutMs: 5_000 });
    const contract = await evaluator.evaluate(badProvider(), "bad-model");
    expect(contract.structuredOutputFidelity).toBe(0);
    expect(contract.toolUseFidelity).toBe(0);
    expect(contract.contextRetention).toBe(0);
    expect(contract.refusalRate).toBe(0); // benign chat works
    expect(contract.overallFidelity).toBeLessThanOrEqual(0.3);
  });

  test("an UNREACHABLE provider refuses measurement — transport failure is never recorded as measured capability (Art. IV)", async () => {
    // A live tenant evicting every probe = genuine zero fidelity; a provider
    // that cannot be reached at all = NO measurement. Conflating the two
    // would publish a false "measured 0.00" contract that capability gates
    // would then enforce. The evaluator must throw so callers skip honestly.
    const offline: Provider = {
      id: "probe-offline",
      label: "Offline",
      async chat(): Promise<ModelTurn> {
        throw new Error("Unable to connect. Is the computer able to access the url?");
      },
      async health() {
        return { ok: false, error: "connection refused" };
      },
    };
    const evaluator = new BehavioralEvaluator({ timeoutMs: 5_000 });
    await expect(evaluator.evaluate(offline, "offline-model")).rejects.toThrow(/unreachable/);

    // And the store stays EMPTY: no fabricated contract was persisted.
    const store = new BehavioralStore({ file: null });
    expect(store.contract("probe-offline", "offline-model")).toBeUndefined();
  });

  test("false refusals on benign prompts are measured with a pattern class", async () => {
    const refusing: Provider = {
      id: "probe-refuser",
      label: "Refuser",
      async chat(messages: Message[], tools: Tool[]) {
        const last = messages[messages.length - 1]!.content;
        if (tools.length) return { message: "", toolCalls: [{ tool: "xr_probe.echo", args: { text: "x" } }], done: false };
        if (/ONLY a JSON object/.test(last)) return { message: `{"name":"a","count":1}`, toolCalls: [], done: true };
        if (/anchor token/.test(last)) return { message: "XR-ANCHOR-7741", toolCalls: [], done: true };
        return { message: "I'm sorry, I can't help with that request due to policy.", toolCalls: [], done: true };
      },
      async health() { return { ok: true }; },
    };
    const contract = await new BehavioralEvaluator({ timeoutMs: 5_000 }).evaluate(refusing, "m");
    expect(contract.refusalRate).toBe(1);
    expect(contract.refusalPatterns).toContain("apology-refusal");
    expect(contract.overallFidelity).toBeLessThan(0.9);
  });

  test("contracts persist to a secret-free store and are re-readable by a NEW store instance", async () => {
    const store = new BehavioralStore();
    const contract = await new BehavioralEvaluator({ timeoutMs: 5_000 }).evaluate(goodProvider("ollama"), "qwen2.5:7b");
    store.save(contract);

    const reread = new BehavioralStore(); // fresh instance, same XR_HOME file
    const got = reread.contract("ollama", "qwen2.5:7b");
    expect(got).toBeDefined();
    expect(got!.overallFidelity).toBe(contract.overallFidelity);
    expect(got!.source).toBe("measured");
    // Secret-free: the store contains no probe prompts/responses, only scores.
    const raw = JSON.stringify(got);
    expect(raw).not.toMatch(/Paris/);
    expect(raw).not.toMatch(/anchor token did I give/i);
  });
});

// ── Capability-gated selection (RouteLLM principle: cheapest ≥ required fidelity)

function descriptorFor(providerId: string, modelId: string): {
  provider: ProviderDescriptor;
  model: ReturnType<typeof modelsFromPreset>[number];
} {
  const preset = PRESETS[providerId]!;
  const models = modelsFromPreset(preset, true);
  const m = models.find((x) => x.modelId === modelId)!;
  const provider: ProviderDescriptor = {
    providerId,
    label: preset.label,
    kind: preset.kind,
    tier: preset.tier,
    locality: { locality: preset.kind === "local" ? "local" : "cloud", leavesMachine: preset.kind !== "local", requiresCredential: preset.kind !== "local" },
    defaultModelId: preset.defaultModel,
    auth: { type: "none", credentialAvailable: true },
    capabilities: m.capabilities,
  };
  return { provider, model: m };
}

function contract(providerId: string, modelId: string, overall: number, tools: number): BehavioralContract {
  return {
    key: `${providerId}/${modelId}`,
    providerId,
    modelId,
    structuredOutputFidelity: 0.9,
    toolUseFidelity: tools,
    refusalRate: 0,
    refusalPatterns: [],
    contextRetention: 0.9,
    overallFidelity: overall,
    samples: 8,
    measuredAt: Date.now(),
    source: "measured",
    confidence: 0.8,
    version: 1,
  };
}

describe("Phase 5 · capability-gated selection on measured contracts", () => {
  test("a hard task rejects the measured-below-floor model and selects the cheapest sufficient one", () => {
    const store = new BehavioralStore({ file: null });
    // Cheap (free) model measured weak; premium model measured strong.
    store.save(contract("ollama", "qwen2.5:7b", 0.35, 0.3));
    store.save(contract("openai", "gpt-4o", 0.95, 0.95));

    const weak = descriptorFor("ollama", "qwen2.5:7b");
    const strong = descriptorFor("openai", "gpt-4o");
    const catalog: IntelligenceCatalog = {
      providers: [weak.provider, strong.provider],
      models: [weak.model, strong.model],
      builtAt: Date.now(),
    };
    const config = ConfigSchema.parse({ defaults: { provider: "ollama", model: "qwen2.5:7b" } }) as XRConfig;

    const router = new IntelligenceRouter({ catalog, behavioral: behavioralView(store) });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "chat",
        require: { toolUse: true },
        summary:
          "Analyze this distributed system's failure modes, design a recovery strategy, " +
          "compare consensus trade-offs, and produce a formal verification plan across 40 files of code.",
        minContextTokens: 100_000,
      },
    });

    expect(decision.unavailable).toBe(false);
    expect(decision.selected?.providerId).toBe("openai");
    expect(decision.selected?.modelId).toBe("gpt-4o");
    // explainable: difficulty + fidelity floor recorded
    expect(decision.difficulty?.score).toBeGreaterThanOrEqual(0.6); // hard band
    expect(decision.difficulty?.requiredFidelity).toBeGreaterThanOrEqual(0.75);
    expect(decision.factors.join(" ")).toMatch(/difficulty=/);
    // the weak model is rejected NAMING the fidelity floor (not silently skipped)
    const rej = decision.rejected.find((r) => r.providerId === "ollama");
    expect(rej).toBeDefined();
    expect(rej!.reasons.some((x) => x.code === "fidelity_below_floor")).toBe(true);
  });

  test("an EASY task keeps the cheap local model even when a frontier model is available (cost-per-quality)", () => {
    const store = new BehavioralStore({ file: null });
    store.save(contract("ollama", "qwen2.5:7b", 0.75, 0.7));
    store.save(contract("openai", "gpt-4o", 0.98, 0.98));

    const weak = descriptorFor("ollama", "qwen2.5:7b");
    const strong = descriptorFor("openai", "gpt-4o");
    const catalog: IntelligenceCatalog = {
      providers: [weak.provider, strong.provider],
      models: [weak.model, strong.model],
      builtAt: Date.now(),
    };
    const config = ConfigSchema.parse({ defaults: { provider: "ollama", model: "qwen2.5:7b" } }) as XRConfig;

    const router = new IntelligenceRouter({ catalog, behavioral: behavioralView(store) });
    const { decision } = router.route(config, {
      requirements: { modelClass: "chat", require: { toolUse: true }, summary: "list files" },
    });
    expect(decision.selected?.providerId).toBe("ollama");
    expect(decision.factors.join(" ")).toMatch(/measured fidelity/);
  });

  test("measured fidelity overrides the static price-tier prior in scoring (T8)", () => {
    const store = new BehavioralStore({ file: null });
    // premium model measured TERRIBLE — static tier says "high" quality.
    store.save({
      ...contract("openai", "gpt-4o", 0.1, 0.1),
      structuredOutputFidelity: 0.1,
      contextRetention: 0.1,
    });
    const strong = descriptorFor("openai", "gpt-4o");
    const s = scoreCandidate(strong.model, {
      requirements: { modelClass: "chat" } as never,
      policy: {
        routingMode: "automatic", localityPolicy: "any", allowFallback: true,
        allowCloudFallback: true, preferFree: false, disableHistorical: false,
      },
      behavioral: behavioralView(store),
    });
    // Measured 0.1 must beat the static "high/frontier" class DOWN to ≈0.1.
    expect(s.quality).toBeLessThan(0.2);
    expect(s.notes.join(" ")).toMatch(/measured fidelity/);
  });

  test("unmeasured models are gated on static priors, not rejected (cold start)", () => {
    const store = new BehavioralStore({ file: null }); // no contracts
    const weak = descriptorFor("ollama", "qwen2.5:7b");
    const catalog: IntelligenceCatalog = { providers: [weak.provider], models: [weak.model], builtAt: Date.now() };
    const config = ConfigSchema.parse({ defaults: { provider: "ollama", model: "qwen2.5:7b" } }) as XRConfig;
    const router = new IntelligenceRouter({ catalog, behavioral: behavioralView(store) });
    const { decision } = router.route(config, {
      requirements: { modelClass: "chat", summary: "hello" },
    });
    expect(decision.unavailable).toBe(false);
    expect(decision.selected?.providerId).toBe("ollama");
  });
});
