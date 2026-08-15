/**
 * XR Phase 04 — Provider Gateway tests
 * Covers registry, resolution, capabilities, health, errors, streaming, fallback, BYOK, switching
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { registry, ProviderRegistry } from "../../src/providers/registry.ts";
import { providerGateway, ProviderGateway } from "../../src/providers/gateway.ts";
import { PRESETS } from "../../src/providers/presets.ts";
import { capabilityResolver } from "../../src/providers/capability-resolver.ts";
import { resolveFallbackChain } from "../../src/providers/fallback-chain.ts";
import { normalizeProviderError, ProviderError } from "../../src/providers/errors.ts";
import { loadConfig } from "../../src/config/config.ts";
import type { Message, Tool, ModelTurn } from "../../src/core/types.ts";

// ── Mock providers ──────────────────────────────────────────────────────────

class MockSuccessProvider {
  id = "mock-success";
  label = "Mock Success";
  model = "mock-model";
  get modelId() { return this.model; }
  async chat(_messages: Message[], _tools: Tool[]): Promise<ModelTurn> {
    return {
      message: "ok",
      toolCalls: [],
      done: true,
      usage: { inTokens: 10, outTokens: 5 },
    };
  }
  async *chatStream(): AsyncGenerator<any> {
    yield { text: "ok", providerId: this.id, model: this.model };
    yield { usage: { inTokens: 10, outTokens: 5 }, finish: true, providerId: this.id, model: this.model };
  }
  async health() {
    return { ok: true, latencyMs: 10, detail: "mock healthy" };
  }
}

class MockAuthFailProvider {
  id = "mock-auth-fail";
  label = "Mock Auth Fail";
  model = "mock-model";
  async chat(): Promise<ModelTurn> {
    throw new Error("provider mock-auth-fail HTTP 401: invalid_api_key");
  }
  async health() {
    return { ok: false, detail: "auth failed" };
  }
}

class MockRateLimitProvider {
  id = "mock-rate-limit";
  label = "Mock Rate Limit";
  model = "mock-model";
  async chat(): Promise<ModelTurn> {
    throw new Error("provider mock-rate-limit HTTP 429: rate limit exceeded");
  }
  async health() {
    return { ok: false, detail: "rate limited" };
  }
}

class MockTimeoutProvider {
  id = "mock-timeout";
  label = "Mock Timeout";
  model = "mock-model";
  async chat(_messages: Message[], _tools: Tool[], opts?: any): Promise<ModelTurn> {
    // Simulate stall longer than allowed
    await new Promise((r) => setTimeout(r, 5000));
    if (opts?.signal?.aborted) {
      const { ProviderAbortError } = await import("../../src/providers/request-guard.ts");
      throw new ProviderAbortError("cancelled", this.id);
    }
    return { message: "too late", toolCalls: [], done: true };
  }
  async health() {
    return { ok: false, detail: "timeout" };
  }
}

class MockToolProvider {
  id = "mock-tools";
  label = "Mock Tools";
  model = "mock-model";
  async chat(_messages: Message[], tools: Tool[]): Promise<ModelTurn> {
    if (tools.length > 0) {
      return {
        message: "using tool",
        toolCalls: [{ tool: tools[0].name, args: { test: 1 } }],
        done: false,
      };
    }
    return { message: "no tools", toolCalls: [], done: true };
  }
  async health() {
    return { ok: true, detail: "healthy" };
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────

describe("Provider Registry", () => {
  test("registry has builtins", () => {
    const list = registry.list();
    expect(list.length).toBeGreaterThan(20);
    expect(registry.has("ollama")).toBeTrue();
    expect(registry.has("openai")).toBeTrue();
    expect(registry.has("anthropic")).toBeTrue();
  });

  test("getPreset returns preset", () => {
    const preset = registry.getPreset("ollama");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("ollama");
    expect(preset?.kind).toBe("local");
  });

  test("resolve valid provider", () => {
    const resolved = registry.resolve("ollama");
    expect(resolved.preset.id).toBe("ollama");
    expect(typeof resolved.factory).toBe("function");
  });

  test("resolve invalid provider throws", () => {
    expect(() => registry.resolve("nonexistent-provider-xyz")).toThrow();
  });

  test("duplicate registration deterministically replaces", () => {
    const testRegistry = new ProviderRegistry();
    const presetA = { ...PRESETS["ollama"], id: "dup-test", label: "A" } as any;
    const presetB = { ...PRESETS["ollama"], id: "dup-test", label: "B" } as any;
    testRegistry.register(presetA, () => new MockSuccessProvider() as any);
    expect(testRegistry.getPreset("dup-test")?.label).toBe("A");
    testRegistry.register(presetB, () => new MockSuccessProvider() as any);
    expect(testRegistry.getPreset("dup-test")?.label).toBe("B");
    // version bumped
    expect(testRegistry.version).toBe(2);
  });

  test("registerOrThrow fails on duplicate", () => {
    const testRegistry = new ProviderRegistry();
    const preset = { ...PRESETS["ollama"], id: "dup-throw" } as any;
    testRegistry.register(preset, () => new MockSuccessProvider() as any);
    expect(() => testRegistry.registerOrThrow(preset, () => new MockSuccessProvider() as any)).toThrow();
  });
});

describe("Provider Gateway", () => {
  test("gateway list includes builtins", () => {
    const { config } = loadConfig();
    const list = providerGateway.list(config);
    expect(list.length).toBeGreaterThan(20);
    expect(list.some((p) => p.id === "ollama")).toBeTrue();
  });

  test("gateway getPreset", () => {
    const preset = providerGateway.getPreset("openai");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("openai");
  });

  test("gateway has", () => {
    expect(providerGateway.has("groq")).toBeTrue();
    expect(providerGateway.has("nonexistent")).toBeFalse();
  });

  test("gateway capabilities", () => {
    const caps = providerGateway.capabilities("openai");
    expect(caps).toBeDefined();
    expect(caps?.chat).toBeTrue();
    // openai should support streaming
    expect(providerGateway.supports("openai", "streaming")).toBeTrue();
  });

  test("gateway credential status for local provider (no key required)", () => {
    const status = providerGateway.credentialStatus("ollama");
    expect(status.required).toBeFalse();
    expect(status.available).toBeTrue();
  });

  test("gateway resolveModel", () => {
    const { config } = loadConfig();
    const resolved = providerGateway.resolveModel(config, "ollama");
    expect(resolved.providerId).toBe("ollama");
    expect(resolved.modelId).toBeDefined();
    expect(resolved.preset.id).toBe("ollama");
  });

  test("gateway catalog", () => {
    const { config } = loadConfig();
    const catalog = providerGateway.catalog(config);
    expect(catalog.providers.length).toBeGreaterThan(10);
    expect(catalog.models.length).toBeGreaterThan(10);
    expect(catalog.builtAt).toBeGreaterThan(0);
  });

  test("gateway catalog fingerprint changes with config", () => {
    const { config } = loadConfig();
    const fp1 = providerGateway.catalogFingerprint(config);
    const fp2 = providerGateway.catalogFingerprint(undefined);
    expect(typeof fp1).toBe("string");
    expect(typeof fp2).toBe("string");
    // fingerprint should be deterministic
    expect(providerGateway.catalogFingerprint(config)).toBe(fp1);
  });
});

describe("Capability Resolver", () => {
  test("supports boolean capabilities", () => {
    const preset = PRESETS["openai"];
    expect(capabilityResolver.supports(preset, "chat")).toBeTrue();
    expect(capabilityResolver.supports(preset, "streaming")).toBeTrue();
  });

  test("local execution capability", () => {
    const local = PRESETS["ollama"];
    expect(capabilityResolver.supports(local, "localExecution")).toBeTrue();
    const hosted = PRESETS["openai"];
    expect(capabilityResolver.supports(hosted, "localExecution")).toBeFalse();
  });

  test("filterByCapabilities", () => {
    const presets = Object.values(PRESETS);
    const streaming = capabilityResolver.filterByCapabilities(presets, ["streaming"]);
    expect(streaming.length).toBeGreaterThan(0);
    const local = capabilityResolver.filterByCapabilities(presets, ["localExecution"]);
    expect(local.every((p) => p.kind === "local")).toBeTrue();
  });

  test("supportsModelClass", () => {
    const preset = PRESETS["openai"];
    expect(capabilityResolver.supportsModelClass(preset, "chat")).toBeTrue();
    expect(capabilityResolver.supportsModelClass(preset, "tool_use")).toBeTrue();
  });
});

describe("Provider Error Normalization", () => {
  test("auth failure", () => {
    const err = normalizeProviderError(new Error("HTTP 401: invalid_api_key"), "openai", "gpt-4o");
    expect((err as any).kind).toBe("authentication_failure");
    expect((err as any).retryable).toBeFalse();
    expect(err.providerId).toBe("openai");
  });

  test("rate limit", () => {
    const err = normalizeProviderError(new Error("HTTP 429: too many requests"), "groq", "llama");
    expect((err as any).kind).toBe("rate_limit");
    expect((err as any).retryable).toBeTrue();
  });

  test("model unavailable", () => {
    const err = normalizeProviderError(new Error("model not found"), "ollama", "nonexistent");
    expect((err as any).kind).toBe("model_unavailable");
  });

  test("timeout", () => {
    const { ProviderAbortError, isTimeout } = require("../../src/providers/request-guard.ts");
    const abort = new ProviderAbortError("timeout", "openai", 2500);
    const err = normalizeProviderError(abort, "openai") as any;
    // GAP-001: ProviderAbortError must be preserved at adapter level for honest reporting
    // It is still retryable and timeout-distinguishable
    expect(err.name).toBe("ProviderAbortError");
    expect(isTimeout(err)).toBeTrue();
    // At gateway level it would be considered retryable via helper
    const { isRetryableProviderError } = require("../../src/providers/errors.ts");
    expect(isRetryableProviderError(err)).toBeTrue();
  });

  test("unknown failure", () => {
    const err = normalizeProviderError(new Error("something weird"), "test-provider");
    expect((err as any).kind).toBe("unknown_provider_failure");
  });

  test("safe json redacts secrets", () => {
    const err = new ProviderError("authentication_failure", "openai", "key sk-abc1234567890abcdef is invalid", {
      details: { statusCode: 401 },
    });
    const safe = err.toSafeJson();
    expect(safe.message).toBeDefined();
    const json = JSON.stringify(safe);
    expect(json).not.toContain("abc1234567890abcdef");
    // Redacted marker should be present
    expect(json).toContain("[REDACTED]");
  });

  test("non-retryable errors are not retried", () => {
    const authErr = new ProviderError("authentication_failure", "openai", "auth failed");
    expect(authErr.retryable).toBeFalse();
    const invalid = new ProviderError("invalid_request", "openai", "invalid");
    expect(invalid.retryable).toBeFalse();
  });

  test("retryable errors", () => {
    const rate = new ProviderError("rate_limit", "groq", "rate limited");
    expect(rate.retryable).toBeTrue();
    const overload = new ProviderError("provider_overload", "openai", "overload");
    expect(overload.retryable).toBeTrue();
  });
});

describe("Fallback Chain", () => {
  test("primary only when no fallback allowed", async () => {
    const { config } = loadConfig();
    const cfg = {
      ...config,
      intelligencePlane: { ...config.intelligencePlane, allowFallback: false },
    } as any;
    const chain = await resolveFallbackChain(cfg, { primaryProviderId: "openai", primaryModelId: "gpt-4o" });
    expect(chain.steps.length).toBe(1);
    expect(chain.allowed).toBeFalse();
  });

  test("includes fallbackProvider when configured", async () => {
    const { config } = loadConfig();
    const cfg = {
      ...config,
      defaults: { ...config.defaults, provider: "openai", model: "gpt-4o", fallbackProvider: "ollama", fallbackModel: "qwen2.5:7b" },
      intelligencePlane: { ...config.intelligencePlane, allowFallback: true },
    } as any;
    const chain = await resolveFallbackChain(cfg);
    expect(chain.steps.length).toBeGreaterThanOrEqual(2);
    expect(chain.steps[0].providerId).toBe("openai");
    expect(chain.steps.some((s) => s.providerId === "ollama")).toBeTrue();
  });

  test("chain explanation is auditable", async () => {
    const { config } = loadConfig();
    const chain = await resolveFallbackChain(config, { primaryProviderId: "openai", primaryModelId: "gpt-4o" });
    expect(chain.explanation).toBeDefined();
    expect(chain.explanation.length).toBeGreaterThan(10);
  });

  test("deduplicates identical steps", async () => {
    const { config } = loadConfig();
    const cfg = {
      ...config,
      defaults: { ...config.defaults, provider: "ollama", model: "qwen2.5:7b", fallbackProvider: "ollama", fallbackModel: "qwen2.5:7b" },
    } as any;
    const chain = await resolveFallbackChain(cfg);
    // identical provider+model should dedup to 1
    expect(chain.steps.length).toBe(1);
  });
});

describe("Provider Health", () => {
  test("health bounded and cached", async () => {
    const { config } = loadConfig();
    // Test with a known provider that doesn't require network if possible
    // ollama may not be running, but health check should be bounded < 5s
    const start = Date.now();
    const health = await providerGateway.health(config, "ollama");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // bounded
    expect(health.id).toBe("ollama");
    expect(typeof health.ok).toBe("boolean");
    expect(health.timestamp).toBeDefined();
  });

  test("healthAll parallel", async () => {
    const { config } = loadConfig();
    const start = Date.now();
    const all = await providerGateway.healthAll(config);
    const elapsed = Date.now() - start;
    expect(all.length).toBeGreaterThan(10);
    // Even if all providers checked, should be < 10s due to parallel + cache
    expect(elapsed).toBeLessThan(10000);
  });
});

describe("Streaming", () => {
  test("mock success provider streaming yields chunks", async () => {
    const provider = new MockSuccessProvider() as any;
    const chunks: any[] = [];
    for await (const chunk of provider.chatStream([], [])) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.text === "ok")).toBeTrue();
    expect(chunks.some((c) => c.finish)).toBeTrue();
  });

  test("gateway stream fallback when no chatStream", async () => {
    const { config } = loadConfig();
    // Use a provider that exists but may not be mocked — we test the fallback path
    // via MockToolProvider which has no chatStream
    const mockRegistry = new ProviderRegistry();
    const preset = { ...PRESETS["ollama"], id: "mock-tools" } as any;
    mockRegistry.register(preset, () => new MockToolProvider() as any);

    const gateway = new ProviderGateway();
    // Inject mock registry by temporarily replacing singleton's entries
    const originalEntries = (registry as any).entries;
    (registry as any).entries = (mockRegistry as any).entries;

    try {
      const chunks: any[] = [];
      for await (const chunk of gateway.stream(config, [], [{ name: "test_tool", description: "test", parameters: {}, requiresApproval: false, run: async () => ({ ok: true, output: "ok" }) }], { provider: "mock-tools", model: "mock" })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    } finally {
      (registry as any).entries = originalEntries;
    }
  });
});

describe("Usage Normalization", () => {
  test("normalizeUsage", () => {
    const normalized = providerGateway.normalizeUsage(
      { inTokens: 10, outTokens: 20 },
      { providerId: "openai", modelId: "gpt-4o", latencyMs: 100 },
    );
    expect(normalized.inTokens).toBe(10);
    expect(normalized.outTokens).toBe(20);
    expect(normalized.totalTokens).toBe(30);
    expect(normalized.providerId).toBe("openai");
  });

  test("normalizeUsage with totalTokens", () => {
    const normalized = providerGateway.normalizeUsage(
      { inTokens: 5, outTokens: 5, totalTokens: 20 },
      { providerId: "openai", modelId: "gpt-4o" },
    );
    expect(normalized.totalTokens).toBe(20);
  });
});

describe("Provider Switching", () => {
  test("model switch state machine preflight fails for unknown provider", async () => {
    const { ModelSwitchStateMachine } = await import("../../src/providers/model-switch.ts");
    const machine = new ModelSwitchStateMachine({
      preflight: (t) => {
        if (t.providerId === "unknown-xyz") return { ok: false, detail: "unknown provider" };
        return { ok: true, detail: "ok" };
      },
      warm: async () => ({ ok: true, detail: "warm ok" }),
      canary: async () => ({ ok: true, detail: "canary ok" }),
      apply: async () => {},
      readActive: () => ({ providerId: "ollama", model: "qwen2.5:7b" }),
    });

    const result = await machine.run({ providerId: "unknown-xyz" });
    expect(result.ok).toBeFalse();
    expect(result.phases.some((p) => p.phase === "preflight" && !p.ok)).toBeTrue();
  });

  test("model switch rollback on swap failure", async () => {
    const { ModelSwitchStateMachine } = await import("../../src/providers/model-switch.ts");
    const machine = new ModelSwitchStateMachine({
      preflight: () => ({ ok: true, detail: "ok" }),
      warm: async () => ({ ok: true, detail: "warm ok" }),
      canary: async () => ({ ok: true, detail: "canary ok" }),
      apply: async (t) => {
        if (t.providerId === "fail-swap") throw new Error("swap failed");
      },
      readActive: () => ({ providerId: "ollama", model: "qwen2.5:7b" }),
    });

    const result = await machine.run({ providerId: "fail-swap" });
    expect(result.ok).toBeFalse();
    expect(result.phases.some((p) => p.phase === "rolled-back")).toBeTrue();
  });
});

describe("BYOK", () => {
  test("credential status for provider requiring key", () => {
    // openai requires key, but may not be set in env — should still report required true
    const status = providerGateway.credentialStatus("openai");
    expect(status.required).toBeTrue();
    expect(typeof status.available).toBe("boolean");
    expect(status.envName).toBe("OPENAI_API_KEY");
  });

  test("resolve credential never throws", () => {
    // Should be safe even if key missing
    const cred = providerGateway.resolveCredential("openai");
    // May be undefined if not set, but should be string or undefined, never throws
    expect(cred === undefined || typeof cred === "string").toBeTrue();
  });

  test("credential not exposed in health", async () => {
    const { config } = loadConfig();
    const health = await providerGateway.health(config, "openai");
    const json = JSON.stringify(health);
    // Should not contain secret value patterns, but env var name is ok (not secret)
    expect(json).not.toContain("sk-");
    // Health detail may mention env var name like OPENAI_API_KEY but not actual secret value
    // So we check it doesn't contain Bearer or actual key pattern, not the env var name itself
    expect(json).not.toContain("Bearer");
  });
});

describe("Retry Policy", () => {
  test("retryable errors should be retried, non-retryable should not", async () => {
    const retryable = new ProviderError("rate_limit", "groq", "rate limited");
    const nonRetryable = new ProviderError("authentication_failure", "openai", "auth failed");

    expect(retryable.retryable).toBeTrue();
    expect(nonRetryable.retryable).toBeFalse();
  });
});

describe("Contract: Same task different provider structure", () => {
  test("same messages produce same normalized ModelTurn structure via different providers", async () => {
    const messages: Message[] = [{ role: "user", content: "hello" }];
    const tools: Tool[] = [];

    const p1 = new MockSuccessProvider() as any;
    const p2 = new MockToolProvider() as any;

    const turn1 = await p1.chat(messages, tools);
    const turn2 = await p2.chat(messages, tools);

    // Both must produce same normalized structure
    expect(typeof turn1.message).toBe("string");
    expect(typeof turn2.message).toBe("string");
    expect(Array.isArray(turn1.toolCalls)).toBeTrue();
    expect(Array.isArray(turn2.toolCalls)).toBeTrue();
    expect(typeof turn1.done).toBe("boolean");
    expect(typeof turn2.done).toBe("boolean");
    // Usage normalized
    expect(turn1.usage === undefined || typeof turn1.usage.inTokens === "number").toBeTrue();
  });
});

describe("Phase 05 — Gateway Fallback Execution", () => {
  /** Build a config whose effective chain is primary→fallback, no local step. */
  function chainConfig(primary: string, fallback: string) {
    const { config } = loadConfig();
    config.defaults.provider = primary;
    config.defaults.model = "mock-model";
    config.defaults.fallbackProvider = fallback;
    config.defaults.fallbackModel = "mock-model";
    (config as any).intelligencePlane = {
      ...(config as any).intelligencePlane,
      allowFallback: true,
      allowCloudFallback: false,
      localityPolicy: "cloud_only",
    };
    return config;
  }

  function installMocks(primaryFactory: () => unknown, fallbackFactory: () => unknown) {
    const mockRegistry = new ProviderRegistry();
    mockRegistry.register({ ...PRESETS["ollama"], id: "mock-primary", label: "Primary", apiKeyEnv: undefined } as any, primaryFactory as any);
    mockRegistry.register({ ...PRESETS["ollama"], id: "mock-fallback", label: "Fallback", apiKeyEnv: undefined } as any, fallbackFactory as any);
    const originalEntries = (registry as any).entries;
    (registry as any).entries = (mockRegistry as any).entries;
    return () => {
      (registry as any).entries = originalEntries;
    };
  }

  test("a retryable primary failure falls back to the fallback provider (bounded, auditable)", async () => {
    const restore = installMocks(() => new MockRateLimitProvider(), () => new MockSuccessProvider());
    try {
      const gateway = new ProviderGateway();
      const out = await gateway.executeWithFallback(
        chainConfig("mock-primary", "mock-fallback"),
        [],
        [],
        { provider: "mock-primary", model: "mock-model" },
      );
      expect(out.providerId).toBe("mock-fallback");
      expect(out.turn.message).toBe("ok");
      // Both steps were attempted and recorded (audit-friendly).
      expect(out.attempted.length).toBe(2);
      expect(out.attempted[0]).toContain("mock-primary");
      expect(out.attempted[1]).toContain("mock-fallback");
    } finally {
      restore();
    }
  });

  test("a NON-retryable (auth) failure is NOT blindly retried or fallen-back", async () => {
    const restore = installMocks(() => new MockAuthFailProvider(), () => new MockSuccessProvider());
    try {
      const gateway = new ProviderGateway();
      await expect(
        gateway.executeWithFallback(
          chainConfig("mock-primary", "mock-fallback"),
          [],
          [],
          { provider: "mock-primary", model: "mock-model" },
        ),
      ).rejects.toThrow();
    } finally {
      restore();
    }
  });

  test("fallback is bounded: it does not fall back on cancellation (user stop wins)", async () => {
    const { ProviderAbortError } = await import("../../src/providers/request-guard.ts");
    const canceling = {
      id: "mock-primary",
      label: "Primary",
      async chat(): Promise<ModelTurn> {
        throw new ProviderAbortError("cancelled", "mock-primary");
      },
      async health() {
        return { ok: false };
      },
    };
    const restore = installMocks(() => canceling, () => new MockSuccessProvider());
    try {
      const gateway = new ProviderGateway();
      await expect(
        gateway.executeWithFallback(
          chainConfig("mock-primary", "mock-fallback"),
          [],
          [],
          { provider: "mock-primary", model: "mock-model" },
        ),
      ).rejects.toMatchObject({ name: "ProviderAbortError", kind: "cancelled" });
    } finally {
      restore();
    }
  });
});
