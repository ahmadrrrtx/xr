/**
 * XR Phase 5 · T3 — rolling health + circuit breaker.
 *
 * Asserts EFFECTS (docs/phase5-routing/04-ARCHITECTURE-VALIDATION.md):
 *   · an injected OUTAGE trips the breaker open;
 *   · an injected QUALITY-DEGRADATION (semantic) streak trips it too —
 *     uptime checks cannot see this class, the breaker must;
 *   · cooldown → half-open single probe → success closes, failure re-opens
 *     with capped backoff;
 *   · while open, the ROUTER excludes the provider with a visible reason
 *     (never silently routed to, never silently ignored).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  RoutingHealth,
  healthView,
  DEFAULT_BREAKER_CONFIG,
} from "../../src/intelligence/health.ts";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import { scoreCandidate } from "../../src/intelligence/scorer.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import type { IntelligenceCatalog } from "../../src/intelligence/catalog.ts";
import type { ModelDescriptor, ProviderDescriptor } from "../../src/intelligence/types.ts";
import { modelsFromPreset } from "../../src/intelligence/capability.ts";
import { PRESETS } from "../../src/providers/presets.ts";

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function model(providerId: string, modelId: string): ModelDescriptor {
  const preset = PRESETS[providerId]!;
  return modelsFromPreset(preset, true).find((m) => m.modelId === modelId)!;
}

describe("Phase 5 · rolling health + circuit breaker", () => {
  let c: ReturnType<typeof clock>;
  let health: RoutingHealth;

  beforeEach(() => {
    c = clock();
    health = new RoutingHealth({
      file: null,
      now: c.now,
      random: () => 0.5, // no jitter — deterministic cooldowns
      config: { minSamples: 4, errorRateThreshold: 0.5, qualityRateThreshold: 0.6, cooldownMs: 1_000 },
    });
  });

  test("injected outage trips the breaker open after minSamples errors", () => {
    let trip = null;
    for (let i = 0; i < 4; i++) {
      trip = health.record("ollama", "qwen2.5:7b", { ok: false, latencyMs: 50 }) ?? trip;
    }
    expect(trip).not.toBeNull();
    expect(trip!.reason).toMatch(/error rate/);
    const gate = health.gate("ollama", "qwen2.5:7b");
    expect(gate.state).toBe("open");
    expect(gate.reason).toMatch(/error rate/);
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("deny_open");
  });

  test("mixed outcomes below threshold keep the breaker closed", () => {
    for (let i = 0; i < 8; i++) {
      health.record("ollama", "qwen2.5:7b", { ok: i % 4 !== 0, latencyMs: 50 });
    }
    expect(health.gate("ollama", "qwen2.5:7b").state).toBe("closed");
  });

  test("QUALITY degradation (semantic failures) trips the breaker — not just errors", () => {
    let trip = null;
    for (let i = 0; i < 4; i++) {
      // Transport fine (ok:true) but the answer violated the model contract.
      trip = health.record("ollama", "qwen2.5:7b", { ok: true, qualityOk: false, latencyMs: 30 }) ?? trip;
    }
    expect(trip).not.toBeNull();
    expect(trip!.reason).toMatch(/quality degradation/);
    expect(health.gate("ollama", "qwen2.5:7b").state).toBe("open");
  });

  test("cooldown → half-open probe → success CLOSES the breaker", () => {
    for (let i = 0; i < 4; i++) health.record("ollama", "qwen2.5:7b", { ok: false });
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("deny_open");
    c.advance(1_100); // past cooldown
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("probe");
    // single probe only — a second caller is denied while it flies
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("deny_open");
    health.resolveProbe("ollama", "qwen2.5:7b", true);
    expect(health.gate("ollama", "qwen2.5:7b").state).toBe("closed");
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("allow");
  });

  test("failed probe re-opens with capped exponential backoff", () => {
    for (let i = 0; i < 4; i++) health.record("ollama", "qwen2.5:7b", { ok: false });
    c.advance(1_100);
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("probe");
    health.resolveProbe("ollama", "qwen2.5:7b", false);
    expect(health.gate("ollama", "qwen2.5:7b").state).toBe("open");
    // streak=1 → 2× base cooldown: 1000ms no longer sufficient
    c.advance(1_100);
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("deny_open");
    c.advance(1_200); // now past 2× cooldown
    expect(health.permit("ollama", "qwen2.5:7b")).toBe("probe");
  });

  test("rolling score reflects measured outcomes (not binary, hysteresis via windows)", () => {
    for (let i = 0; i < 10; i++) health.record("groq", "llama-3.3-70b-versatile", { ok: true, latencyMs: 120 });
    const good = health.gate("groq", "llama-3.3-70b-versatile");
    expect(good.score).toBeGreaterThan(0.95);
    for (let i = 0; i < 4; i++) health.record("groq", "llama-3.3-70b-versatile", { ok: false, latencyMs: 8_000 });
    const degraded = health.gate("groq", "llama-3.3-70b-versatile");
    expect(degraded.score).toBeLessThan(good.score);
    expect(degraded.errorRate).toBeGreaterThan(0);
  });

  test("breaker with zero data reports a fresh closed gate (no phantom trips)", () => {
    const gate = health.gate("never-seen", "model");
    expect(gate.state).toBe("closed");
    expect(gate.samples).toBe(0);
    expect(gate.score).toBe(1);
  });

  test("ROUTER integration: an open breaker removes the provider from selection with a reason", () => {
    // Trip ollama's breaker hard.
    for (let i = 0; i < 6; i++) health.record("ollama", "qwen2.5:7b", { ok: false });
    expect(health.gate("ollama", "qwen2.5:7b").state).toBe("open");

    const config = ConfigSchema.parse({
      defaults: { provider: "ollama", model: "qwen2.5:7b" },
    }) as XRConfig;
    // Catalog with ONLY ollama models → router must report unavailability,
    // not select the tripped provider.
    const ollamaDesc: ProviderDescriptor = {
      providerId: "ollama",
      label: "Ollama (Local)",
      kind: "local",
      tier: "free",
      locality: { locality: "local", leavesMachine: false, requiresCredential: false },
      defaultModelId: "qwen2.5:7b",
      auth: { type: "none", credentialAvailable: true },
      capabilities: model("ollama", "qwen2.5:7b").capabilities,
    };
    const catalog: IntelligenceCatalog = {
      providers: [ollamaDesc],
      models: [model("ollama", "qwen2.5:7b")],
      builtAt: Date.now(),
    };
    const router = new IntelligenceRouter({ catalog, health: healthView(health) });
    const { decision } = router.route(config, { requirements: { modelClass: "chat" } });
    expect(decision.unavailable).toBe(true);
    expect(decision.selected).toBeUndefined();
    // The rejection names the circuit — the outage is explainable, not silent.
    const flat = JSON.stringify(decision.rejected);
    expect(flat).toMatch(/circuit open/);
  });

  test("ROUTER integration: half-open target stays eligible but down-scored", () => {
    // Trip, advance past cooldown → gate reports half_open
    for (let i = 0; i < 4; i++) health.record("ollama", "qwen2.5:7b", { ok: false });
    c.advance(1_100);
    const gate = health.gate("ollama", "qwen2.5:7b"); // eligible → half_open view
    expect(gate.state).toBe("half_open");
    const m = model("ollama", "qwen2.5:7b");
    const s = scoreCandidate(m, {
      requirements: { modelClass: "chat" } as never,
      policy: {
        routingMode: "automatic", localityPolicy: "any", allowFallback: true, allowCloudFallback: false,
        preferFree: true, disableHistorical: false,
      },
      routingHealth: healthView(health),
    });
    expect(s.notes.join(" ")).toMatch(/half-open probe pending/);
  });

  test("breaker persistence: a tripped breaker survives process restart (same XR_HOME file)", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "xr-health-"));
    const file = join(dir, "health.json");
    const h1 = new RoutingHealth({ file, now: c.now, random: () => 0.5, config: { minSamples: 3 } });
    for (let i = 0; i < 3; i++) h1.record("ollama", "qwen2.5:7b", { ok: false });
    expect(h1.gate("ollama", "qwen2.5:7b").state).toBe("open");
    // New instance over the same file — the outage is remembered.
    const h2 = new RoutingHealth({ file, now: c.now, random: () => 0.5, config: { minSamples: 3 } });
    const gate = h2.gate("ollama", "qwen2.5:7b");
    expect(gate.state).toBe("open");
    expect(gate.reason).toMatch(/error rate/);
  });

  test("default config constants are sane and bounded", () => {
    expect(DEFAULT_BREAKER_CONFIG.windowSize).toBeGreaterThan(0);
    expect(DEFAULT_BREAKER_CONFIG.minSamples).toBeGreaterThan(0);
    expect(DEFAULT_BREAKER_CONFIG.errorRateThreshold).toBeLessThanOrEqual(1);
    expect(DEFAULT_BREAKER_CONFIG.cooldownMaxMs).toBeGreaterThanOrEqual(DEFAULT_BREAKER_CONFIG.cooldownMs);
  });
});
