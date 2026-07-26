/**
 * XR 4.4 — Routing, filtering, scoring, privacy, fallback tests.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { IntelligenceRouter, policyFromConfig } from "../../src/intelligence/router.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import {
  IntelligenceMetrics,
  resetDefaultMetrics,
  setDefaultMetrics,
} from "../../src/intelligence/metrics.ts";
import { evaluateCandidate } from "../../src/intelligence/evaluator.ts";
import { scoreCandidate } from "../../src/intelligence/scorer.ts";
import { mayFallbackOnTrigger, buildFallbackChain } from "../../src/intelligence/fallback.ts";
import { modelsFromPreset } from "../../src/intelligence/capability.ts";
import { PRESETS } from "../../src/providers/presets.ts";
import type { XRConfig } from "../../src/config/config.ts";
import { ConfigSchema } from "../../src/config/config.ts";

function baseConfig(over: Record<string, unknown> = {}): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: { routingStrategy: "hybrid" },
    intelligencePlane: {},
    ...over,
  });
}

describe("XR 4.4 intelligence router", () => {
  beforeEach(() => {
    resetDefaultMetrics();
    // Ensure no cloud keys leak into tests
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  test("automatic routing selects a local model when only local is credential-free", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: { modelClass: "chat", require: { toolUse: true } },
    });
    expect(decision.unavailable).toBe(false);
    expect(decision.selected?.providerId).toBeTruthy();
    // Without cloud keys, selection should be local
    const catalog = buildCatalog(config);
    const m = catalog.models.find(
      (x) =>
        x.providerId === decision.selected!.providerId &&
        x.modelId === decision.selected!.modelId,
    );
    expect(m?.locality.locality).toBe("local");
    expect(decision.explanation.length).toBeGreaterThan(0);
    expect(decision.manual).toBe(false);
  });

  test("explicit provider/model pin is never silently overridden", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      provider: "ollama",
      model: "qwen2.5:7b",
    });
    expect(decision.manual).toBe(true);
    expect(decision.selected?.providerId).toBe("ollama");
    expect(decision.selected?.modelId).toBe("qwen2.5:7b");
  });

  test("local-only policy rejects cloud even if preferred", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    const config = baseConfig({
      intelligencePlane: { localityPolicy: "local_only", mode: "local_only" },
      defaults: { provider: "openai", model: "gpt-4o-mini" },
    });
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "chat",
        localityPolicy: "local_only",
        preferred: { providerId: "openai", modelId: "gpt-4o-mini" },
      },
    });
    if (decision.selected) {
      const cat = buildCatalog(config);
      const m = cat.models.find(
        (x) =>
          x.providerId === decision.selected!.providerId &&
          x.modelId === decision.selected!.modelId,
      );
      expect(m?.locality.locality).toBe("local");
      expect(m?.locality.locality).not.toBe("cloud");
    }
    // Ensure no selected cloud
    expect(decision.selected?.providerId).not.toBe("openai");
    delete process.env.OPENAI_API_KEY;
  });

  test("manual pin to cloud under local-only is rejected (security)", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    const config = baseConfig({
      intelligencePlane: { localityPolicy: "local_only", mode: "local_only", allowFallback: false },
    });
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      provider: "openai",
      model: "gpt-4o-mini",
      requirements: { localityPolicy: "local_only", allowFallback: false },
    });
    // Pin cannot bypass locality — unavailable or fell back to local
    if (decision.selected) {
      expect(decision.selected.providerId).not.toBe("openai");
    } else {
      expect(decision.unavailable).toBe(true);
    }
    delete process.env.OPENAI_API_KEY;
  });

  test("tool-use requirement filters incompatible models", () => {
    const ollama = modelsFromPreset(PRESETS.ollama, true)[0]!;
    const gpt4all = modelsFromPreset(PRESETS.gpt4all, true)[0]!;
    const policy = policyFromConfig(baseConfig());
    const req = {
      modelClass: "tool_use" as const,
      require: { toolUse: true },
    };
    const ok = evaluateCandidate(ollama, req, policy);
    const bad = evaluateCandidate(gpt4all, req, policy);
    // gpt4all has unknown toolUse → fail closed
    expect(ok.compatible || ollama.capabilities.toolUse === "supported").toBe(true);
    expect(bad.compatible).toBe(false);
    expect(bad.rejections.some((r) => r.code.startsWith("capability_"))).toBe(true);
  });

  test("vision requirement rejects non-vision models", () => {
    const ollama = modelsFromPreset(PRESETS.ollama, true)[0]!;
    const policy = policyFromConfig(baseConfig());
    const ev = evaluateCandidate(
      ollama,
      { modelClass: "vision", require: { vision: true } },
      policy,
    );
    // ollama vision is unknown → fail closed
    expect(ev.compatible).toBe(false);
  });

  test("context-limit filtering rejects small windows", () => {
    const model = modelsFromPreset(PRESETS.ollama, true)[0]!;
    model.context = { contextWindow: 4096 };
    const policy = policyFromConfig(baseConfig());
    const ev = evaluateCandidate(
      model,
      { modelClass: "chat", minContextTokens: 100_000 },
      policy,
    );
    expect(ev.compatible).toBe(false);
    expect(ev.rejections.some((r) => r.code === "context_too_small")).toBe(true);
  });

  test("scoring is deterministic for same inputs", () => {
    const model = modelsFromPreset(PRESETS.ollama, true)[0]!;
    const ctx = {
      requirements: { modelClass: "chat" as const },
      policy: policyFromConfig(baseConfig()),
    };
    const a = scoreCandidate(model, ctx);
    const b = scoreCandidate(model, ctx);
    expect(a.total).toBe(b.total);
    expect(a.taskFit).toBe(b.taskFit);
  });

  test("cost_constrained prefers free/local", () => {
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    const config = baseConfig({
      intelligencePlane: { mode: "cost_constrained", preferFree: true },
      providerEngine: { routingStrategy: "cheapest" },
    });
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, { mode: "cost_constrained" });
    expect(decision.selected).toBeTruthy();
    const cat = buildCatalog(config);
    const m = cat.models.find(
      (x) =>
        x.providerId === decision.selected!.providerId &&
        x.modelId === decision.selected!.modelId,
    );
    expect(m?.cost.free || m?.cost.tier === "free").toBe(true);
    delete process.env.OPENAI_API_KEY;
  });

  test("unknown completion must not auto-fallback", () => {
    const gate = mayFallbackOnTrigger("unknown_completion");
    expect(gate.allow).toBe(false);
  });

  test("provider_outage may fallback", () => {
    expect(mayFallbackOnTrigger("provider_outage").allow).toBe(true);
  });

  test("fallback chain does not escalate local→cloud without allowCloudFallback", () => {
    const local = modelsFromPreset(PRESETS.ollama, true)[0]!;
    const cloud = modelsFromPreset(PRESETS.openai, true)[0]!;
    const policy = {
      ...policyFromConfig(baseConfig()),
      allowFallback: true,
      allowCloudFallback: false,
      localityPolicy: "any" as const,
    };
    const ranked = [
      { model: local, compatible: true, rejections: [], score: { total: 0.9 } as any },
      { model: cloud, compatible: true, rejections: [], score: { total: 0.8 } as any },
    ];
    const plan = buildFallbackChain(
      ranked as any,
      local,
      { modelClass: "chat", allowFallback: true, allowCloudFallback: false },
      policy,
    );
    expect(plan.steps.every((s) => s.providerId !== "openai")).toBe(true);
    expect(plan.blockedCloudEscalation).toBe(true);
  });

  test("historical metrics ignored when sparse", () => {
    const metrics = new IntelligenceMetrics();
    setDefaultMetrics(metrics);
    metrics.record({
      providerId: "ollama",
      modelId: "qwen2.5:7b",
      modelClass: "chat",
      success: false,
      at: Date.now(),
    });
    const stats = metrics.statsFor("ollama", "qwen2.5:7b", "chat");
    expect(stats).toBeTruthy();
    expect(stats!.confidence).toBeLessThan(0.3);
    // Router should still work
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config), metrics });
    const { decision } = router.route(config, {});
    expect(decision.unavailable).toBe(false);
  });

  test("historical metrics influence only with sufficient confidence", () => {
    const metrics = new IntelligenceMetrics();
    for (let i = 0; i < 10; i++) {
      metrics.record({
        providerId: "ollama",
        modelId: "qwen2.5:7b",
        modelClass: "chat",
        success: true,
        latencyMs: 200,
        at: Date.now() - i * 1000,
      });
    }
    const stats = metrics.statsFor("ollama", "qwen2.5:7b", "chat")!;
    expect(stats.confidence).toBeGreaterThanOrEqual(0.3);
    expect(stats.successRate).toBe(1);
  });

  test("decision record is secret-free and durable-shaped", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { record } = router.route(config, { provider: "ollama" });
    expect(record.version).toBe(1);
    expect(record.decisionId.startsWith("rd_")).toBe(true);
    expect(record.explanation).toBeTruthy();
    expect(JSON.stringify(record)).not.toMatch(/sk-|api[_-]?key|password|secret/i);
  });

  test("no compatible candidate yields human handoff", () => {
    const config = baseConfig({
      intelligencePlane: {
        mode: "local_only",
        localityPolicy: "local_only",
        allowFallback: false,
      },
    });
    // Force impossible requirement
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const { decision } = router.route(config, {
      requirements: {
        modelClass: "image_generation",
        require: { vision: true },
        localityPolicy: "local_only",
        allowFallback: false,
      },
      mode: "local_only",
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.humanHandoff?.required).toBe(true);
  });

  test("policyFromConfig maps localModels.routing local-only", () => {
    const config = baseConfig({
      localModels: { routing: "local-only", enabled: true },
    });
    const policy = policyFromConfig(config);
    expect(policy.localityPolicy).toBe("local_only");
    expect(policy.allowCloudFallback).toBe(false);
  });

  test("tie-breaking is stable (lexical provider/model)", () => {
    const config = baseConfig();
    const router = new IntelligenceRouter({ catalog: buildCatalog(config) });
    const a = router.route(config, { requirements: { modelClass: "chat" } });
    const b = router.route(config, { requirements: { modelClass: "chat" } });
    expect(a.decision.selected?.providerId).toBe(b.decision.selected?.providerId);
    expect(a.decision.selected?.modelId).toBe(b.decision.selected?.modelId);
  });
});
