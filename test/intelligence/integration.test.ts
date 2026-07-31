/**
 * XR 4.4 — ProviderRouter + factory integration + buildProvider pin compatibility.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { RoutingService as ProviderRouter, FallbackProvider } from "../../src/intelligence/routing-service.ts";
import { buildProvider, buildProviderWithDecision } from "../../src/providers/factory.ts";
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import { registry } from "../../src/providers/registry.ts";
import { PRESETS } from "../../src/providers/presets.ts";
import { OpenAICompatProvider } from "../../src/providers/openai-compat.ts";

// Ensure builtins registered
import "../../src/providers/factory.ts";

function cfg(over: Record<string, unknown> = {}): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: { routingStrategy: "hybrid" },
    ...over,
  });
}

describe("XR 4.4 provider routing integration", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("buildProvider with explicit pin returns that provider id", () => {
    const provider = buildProvider(cfg(), { provider: "ollama", model: "qwen2.5:7b" });
    expect(provider.id).toBe("ollama");
  });

  test("buildProviderWithDecision attaches explainable decision", () => {
    const { provider, decision } = buildProviderWithDecision(cfg(), {
      provider: "ollama",
      model: "llama3.1:8b",
    });
    expect(provider.id).toBe("ollama");
    expect(decision.selected?.modelId).toBe("llama3.1:8b");
    expect(decision.manual).toBe(true);
  });

  test("localFirst strategy prefers local without keys", () => {
    const { decision } = new ProviderRouter(cfg()).resolveWithDecision({
      strategy: "localFirst",
    });
    expect(decision.selected).toBeTruthy();
    const preset = PRESETS[decision.selected!.providerId];
    expect(preset?.kind === "local" || decision.selected!.providerId === "ollama").toBe(true);
  });

  test("FallbackProvider exposes primary id and tries fallback on chat error", async () => {
    const primary = {
      id: "primary",
      label: "P",
      async chat() {
        throw new Error("boom");
      },
      async health() {
        return { ok: false };
      },
    };
    const fallback = {
      id: "fallback",
      label: "F",
      async chat() {
        return { message: "ok", toolCalls: [], done: true };
      },
      async health() {
        return { ok: true };
      },
    };
    const wrap = new FallbackProvider(primary as any, fallback as any);
    expect(wrap.id).toBe("primary");
    const turn = await wrap.chat([], []);
    expect(turn.message).toBe("ok");
  });

  test("unknown provider pin throws", () => {
    expect(() => buildProvider(cfg(), { provider: "definitely-not-a-provider" })).toThrow();
  });

  test("registry still creates openai-compat local providers", () => {
    const p = registry.createProvider("ollama", cfg(), "qwen2.5:7b");
    expect(p).toBeInstanceOf(OpenAICompatProvider);
    expect(p.id).toBe("ollama");
  });

  test("cheapest strategy selects free tier", () => {
    const { decision } = new ProviderRouter(
      cfg({ providerEngine: { routingStrategy: "cheapest" } }),
    ).resolveWithDecision({ strategy: "cheapest" });
    expect(decision.selected).toBeTruthy();
    const preset = PRESETS[decision.selected!.providerId];
    expect(preset?.tier === "free" || preset?.kind === "local").toBe(true);
  });
});
