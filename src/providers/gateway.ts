/**
 * XR Phase 04 — Provider Gateway / Universal Provider Engine
 *
 * The canonical XR Provider Gateway.
 *
 * Architecture:
 *                         USER
 *                           |
 *                 CLI / TUI / DASHBOARD
 *                           |
 *                      AgentService
 *                           |
 *                    Execution Fabric
 *                           |
 *                         Runner
 *                           |
 *                    Provider Gateway  ← THIS FILE
 *                           |
 *          +----------------+----------------+
 *          |                |                |
 *       Provider A       Provider B       Provider C
 *          |                |                |
 *       OpenAI/etc      Anthropic/etc     Local/etc
 *
 * Goals:
 * - ONE provider abstraction that unified AgentService/execution can use
 * - Provider selection belongs to Gateway
 * - Provider health belongs to shared health system
 * - Credentials belong to existing secret/config system
 * - Request/response translation inside adapter
 * - AgentService operates against stable provider interface
 *
 * Feature flag: XR_PROVIDER_GATEWAY=0 disables gateway fallback to direct registry.createProvider
 */

import type { XRConfig } from "../config/config.ts";
import type { Provider, Message, Tool, ChatOptions, ModelTurn } from "../core/types.ts";
import { registry } from "./registry.ts";
import type { ProviderPreset } from "./presets.ts";
import { PRESETS } from "./presets.ts";
import { checkProviderHealthCached, type CachedProviderHealth, HEALTH_BOUND_MS, type ProviderHealthReport } from "./health.ts";
import { buildCatalog, type IntelligenceCatalog, catalogFingerprint, catalogCacheStats } from "../intelligence/catalog.ts";
import { RoutingService, FallbackProvider } from "../intelligence/routing-service.ts";
import { buildProvider as legacyBuildProvider, buildProviderWithDecision } from "./factory.ts";
import { capabilityResolver, type ProviderCapability, type NormalizedCapabilities } from "./capability-resolver.ts";
import { resolveFallbackChain, type FallbackChain } from "./fallback-chain.ts";
import { normalizeProviderError, ProviderError, isRetryableProviderError } from "./errors.ts";
import { isCancellation } from "./request-guard.ts";
import { secretBrokerSync } from "../security/secret-broker.ts";
import { TtlCache } from "../util/ttl-cache.ts";
import { bounded } from "../util/concurrency.ts";
import { xrMetrics } from "../observability/metrics.ts";
import { setConfiguredRequestTimeout } from "./request-guard.ts";

export const GATEWAY_VERSION = 1;

export function gatewayEnabled(): boolean {
  const raw = process.env.XR_PROVIDER_GATEWAY;
  return raw === undefined || raw === "" || !/^(0|false|off|no)$/i.test(raw);
}

// ── Provider Streaming types ────────────────────────────────────────────────

export interface ProviderStreamChunk {
  text?: string;
  toolCall?: { tool: string; args: Record<string, unknown> };
  usage?: { inTokens: number; outTokens: number };
  finish?: boolean;
  reasoning?: string;
  model?: string;
  providerId?: string;
}

export type ProviderStream = AsyncGenerator<ProviderStreamChunk>;

// ── Provider Resolution ─────────────────────────────────────────────────────

export interface ProviderResolutionInput {
  provider?: string;
  model?: string;
  strategy?: import("../intelligence/routing-service.ts").RoutingStrategy;
  requirements?: Partial<import("../intelligence/types.ts").TaskRequirements>;
  mode?: import("../intelligence/types.ts").RoutingMode;
}

export interface ProviderResolution {
  provider: Provider;
  preset: ProviderPreset;
  decision?: import("../intelligence/types.ts").RoutingDecision;
  resolved: {
    providerId: string;
    modelId: string;
    displayName: string;
  };
  capabilities: NormalizedCapabilities;
  fallbackChain: FallbackChain;
}

// ── Gateway Cache ───────────────────────────────────────────────────────────

const GATEWAY_CATALOG_TTL_MS = Number(process.env.XR_PROVIDER_GATEWAY_CATALOG_TTL_MS ?? 60_000) > 0
  ? Number(process.env.XR_PROVIDER_GATEWAY_CATALOG_TTL_MS ?? 60_000)
  : 60_000;

// ── Provider Gateway ────────────────────────────────────────────────────────

export class ProviderGateway {
  // Catalog cache is already handled by buildCatalog's TtlCache, but we keep a short additional
  // fingerprint cache for gateway-level metrics
  private readonly catalogCacheStats = catalogCacheStats;

  constructor() {}

  // ── Registry ──────────────────────────────────────────────────────────────

  list(config: XRConfig): ProviderPreset[] {
    if (!gatewayEnabled()) {
      return Object.values(PRESETS);
    }
    try {
      registry.syncCustom(config);
    } catch {
      // Best effort
    }
    return registry.list();
  }

  listByKind(config: XRConfig, kind: ProviderPreset["kind"]): ProviderPreset[] {
    return this.list(config).filter((p) => p.kind === kind);
  }

  listByTier(config: XRConfig, tier: ProviderPreset["tier"]): ProviderPreset[] {
    return this.list(config).filter((p) => p.tier === tier);
  }

  getPreset(id: string): ProviderPreset | undefined {
    return registry.getPreset(id) ?? PRESETS[id];
  }

  getFactory(id: string) {
    return registry.getFactory(id);
  }

  has(id: string): boolean {
    return registry.has(id) || Boolean(PRESETS[id]);
  }

  get(id: string): ProviderPreset | undefined {
    return this.getPreset(id);
  }

  /**
   * Create a provider instance for a given id/model.
   * Uses the canonical registry factory, with config overrides.
   */
  createProvider(id: string, config: XRConfig, model?: string): Provider {
    if (!gatewayEnabled()) {
      // Rollback path: direct registry
      setConfiguredRequestTimeout(config.providerEngine?.requestTimeoutMs);
      return registry.createProvider(id, config, model ?? this.getPreset(id)?.defaultModel ?? config.defaults.model);
    }
    const preset = this.getPreset(id);
    const modelId = model ?? preset?.defaultModel ?? config.defaults.model;
    // Publish configured timeout (GAP-001)
    setConfiguredRequestTimeout(config.providerEngine?.requestTimeoutMs);
    try {
      registry.syncCustom(config);
    } catch {}
    return registry.createProvider(id, config, modelId);
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  /**
   * Deterministic provider resolution.
   * Precedence: explicit task provider → workspace/provider preference → configured default → safe fallback.
   * This is delegated to RoutingService/IntelligenceRouter which already implements that logic.
   */
  async resolve(
    config: XRConfig,
    input: ProviderResolutionInput = {},
  ): Promise<ProviderResolution> {
    const started = Date.now();
    const router = new RoutingService(config);

    // Resolve provider + decision (also handles fallback wrapping)
    const { provider, decision } = router.resolveWithDecision(input as any);

    const selectedProviderId = decision?.selected?.providerId ?? input.provider ?? config.defaults.provider;
    const selectedModelId = decision?.selected?.modelId ?? input.model ?? config.defaults.model;

    const preset = this.getPreset(selectedProviderId);
    if (!preset) {
      throw new ProviderError(
        "unknown_provider_failure",
        selectedProviderId,
        `Unknown provider "${selectedProviderId}"`,
        { modelId: selectedModelId, details: { providerCode: "unknown_provider" } },
      );
    }

    const capabilities = capabilityResolver.getCapabilities(preset);

    const fallbackChain = await resolveFallbackChain(config, {
      primaryProviderId: selectedProviderId,
      primaryModelId: selectedModelId,
      allowFallback: decision?.constraints?.allowFallback ?? config.intelligencePlane?.allowFallback,
      localityPolicy: decision?.constraints?.localityPolicy,
    });

    xrMetrics.providerHealthDuration.observe({ provider: selectedProviderId }, Date.now() - started);

    return {
      provider,
      preset,
      decision,
      resolved: {
        providerId: selectedProviderId,
        modelId: selectedModelId,
        displayName: preset.label,
      },
      capabilities,
      fallbackChain,
    };
  }

  /**
   * Backward-compatible wrapper: buildProvider equivalent but through gateway.
   */
  buildProvider(config: XRConfig, override?: ProviderResolutionInput): Provider {
    if (!gatewayEnabled()) {
      return legacyBuildProvider(config, override);
    }
    // For sync compatibility, we use the legacy path but via gateway registry
    // The async resolve() is preferred for gateway-aware code.
    const router = new RoutingService(config);
    return router.resolve(override as any);
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async health(config: XRConfig, id: string, model?: string): Promise<CachedProviderHealth> {
    if (!gatewayEnabled()) {
      const checker = new (await import("./health.ts")).ProviderHealthChecker(config);
      const report = await checker.check(id, model);
      return {
        ...report,
        cached: false,
        stale: false,
        deduped: false,
        probeMs: report.latencyMs ?? 0,
      };
    }
    return checkProviderHealthCached(config, id, model);
  }

  async healthAll(config: XRConfig): Promise<CachedProviderHealth[]> {
    const presets = this.list(config);
    // Parallel bounded health — preserve Phase01 caching/performance
    const results = await Promise.all(
      presets.map(async (p) => {
        try {
          return await this.health(config, p.id);
        } catch {
          return {
            id: p.id,
            ok: false,
            detail: "health check failed",
            authOk: false,
            timestamp: new Date().toISOString(),
            cached: false,
            stale: false,
            deduped: false,
            probeMs: 0,
          } as CachedProviderHealth;
        }
      }),
    );
    return results;
  }

  // ── Catalog / Model discovery ─────────────────────────────────────────────

  catalog(config: XRConfig): IntelligenceCatalog {
    return buildCatalog(config);
  }

  catalogFingerprint(config?: XRConfig): string {
    return catalogFingerprint(config);
  }

  // ── Capabilities ──────────────────────────────────────────────────────────

  capabilities(presetId: string): NormalizedCapabilities | undefined {
    const preset = this.getPreset(presetId);
    if (!preset) return undefined;
    return capabilityResolver.getCapabilities(preset);
  }

  supports(presetId: string, capability: ProviderCapability): boolean {
    const preset = this.getPreset(presetId);
    if (!preset) return false;
    return capabilityResolver.supports(preset, capability);
  }

  // ── Fallback Chain ────────────────────────────────────────────────────────

  async fallbackChain(config: XRConfig, opts?: { primaryProviderId?: string; primaryModelId?: string }): Promise<FallbackChain> {
    return resolveFallbackChain(config, opts);
  }

  /**
   * Execute with fallback chain: try primary, then fallbackProvider, then local healthy.
   * Returns the first successful provider turn or throws.
   * Explicit, bounded, auditable.
   */
  async executeWithFallback(
    config: XRConfig,
    messages: Message[],
    tools: Tool[],
    input: ProviderResolutionInput,
    options?: ChatOptions,
  ): Promise<{ turn: ModelTurn; providerId: string; modelId: string; attempted: string[] }> {
    const chain = await this.fallbackChain(config, {
      primaryProviderId: input.provider,
      primaryModelId: input.model,
    });

    const attempted: string[] = [];
    let lastError: unknown;

    for (const step of chain.steps) {
      attempted.push(`${step.providerId}/${step.modelId}`);
      try {
        const prov = this.createProvider(step.providerId, config, step.modelId);
        const turn = await prov.chat(messages, tools, options);
        return { turn, providerId: step.providerId, modelId: step.modelId, attempted };
      } catch (e) {
        lastError = e;
        // Cancellation must never trigger fallback — user explicitly stopped
        if (isCancellation(e)) throw e;
        const normalized = normalizeProviderError(e, step.providerId, step.modelId);
        // Do NOT retry non-retryable errors
        if (!isRetryableProviderError(normalized)) {
          throw normalized;
        }
        // Retryable → try next fallback
        continue;
      }
    }

    throw normalizeProviderError(lastError, chain.steps[0]?.providerId ?? "unknown", chain.steps[0]?.modelId);
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async execute(
    config: XRConfig,
    messages: Message[],
    tools: Tool[],
    input: ProviderResolutionInput,
    options?: ChatOptions,
  ): Promise<ModelTurn> {
    const resolution = await this.resolve(config, input);
    try {
      return await resolution.provider.chat(messages, tools, options);
    } catch (e) {
      throw normalizeProviderError(e, resolution.resolved.providerId, resolution.resolved.modelId);
    }
  }

  /**
   * Streaming execution through canonical path.
   * If provider has native chatStream, uses it; otherwise falls back to chat() and yields as single chunk.
   */
  async *stream(
    config: XRConfig,
    messages: Message[],
    tools: Tool[],
    input: ProviderResolutionInput,
    options?: ChatOptions,
  ): ProviderStream {
    const resolution = await this.resolve(config, input);
    const provider: any = resolution.provider;

    // If provider implements chatStream, use it
    if (typeof provider.chatStream === "function") {
      try {
        const stream: ProviderStream = provider.chatStream(messages, tools, options);
        for await (const chunk of stream) {
          yield chunk;
        }
        return;
      } catch (e) {
        throw normalizeProviderError(e, resolution.resolved.providerId, resolution.resolved.modelId);
      }
    }

    // Fallback: single chat() call yielded as stream
    try {
      const turn = await resolution.provider.chat(messages, tools, options);
      if (turn.message) {
        yield { text: turn.message, finish: false, providerId: resolution.resolved.providerId, model: resolution.resolved.modelId };
      }
      for (const tc of turn.toolCalls ?? []) {
        yield { toolCall: { tool: tc.tool, args: tc.args }, providerId: resolution.resolved.providerId };
      }
      yield { usage: turn.usage, finish: true, providerId: resolution.resolved.providerId, model: resolution.resolved.modelId };
    } catch (e) {
      throw normalizeProviderError(e, resolution.resolved.providerId, resolution.resolved.modelId);
    }
  }

  // ── Credential resolution ─────────────────────────────────────────────────

  /**
   * Centralized credential resolution through existing secure mechanism.
   * Returns presence boolean, never the secret itself.
   */
  credentialStatus(providerId: string): { required: boolean; available: boolean; envName?: string } {
    const preset = this.getPreset(providerId);
    if (!preset) return { required: false, available: false };
    if (!preset.apiKeyEnv) return { required: false, available: true };
    // Phase 2 · F-24 — key presence through the broker seam (env hydration
    // compat-gated; durable backend always consulted).
    const available = Boolean(secretBrokerSync(preset.apiKeyEnv));
    return { required: true, available, envName: preset.apiKeyEnv };
  }

  /**
   * Resolve credential for adapter — returns key if available, via existing secure path.
   * Adapter receives resolved credential, not raw env.
   */
  resolveCredential(providerId: string): string | undefined {
    const preset = this.getPreset(providerId);
    if (!preset?.apiKeyEnv) return undefined;
    // Phase 2 · F-24 — credential resolution through the broker seam.
    return secretBrokerSync(preset.apiKeyEnv);
  }

  // ── Model Resolution ──────────────────────────────────────────────────────

  /**
   * Provider and model are related but NOT identical.
   * A model should resolve through provider abstraction.
   */
  resolveModel(config: XRConfig, providerId: string, modelId?: string): { providerId: string; modelId: string; preset: ProviderPreset } {
    const preset = this.getPreset(providerId);
    if (!preset) {
      throw new ProviderError("unknown_provider_failure", providerId, `Unknown provider "${providerId}"`, { modelId });
    }
    const catalog = this.catalog(config);
    const model = catalog.models.find((m) => m.providerId === providerId && m.modelId === (modelId ?? preset.defaultModel))
      ?? catalog.models.find((m) => m.providerId === providerId && m.isDefault)
      ?? catalog.models.find((m) => m.providerId === providerId);

    const resolvedModelId = model?.modelId ?? modelId ?? preset.defaultModel;
    return { providerId, modelId: resolvedModelId, preset };
  }

  // ── Usage normalization ──────────────────────────────────────────────────

  /**
   * Provider-specific usage data normalized into XR's existing budget/cost architecture.
   * Adapters already return {inTokens, outTokens}; gateway normalizes + adds latency/provider/model.
   */
  normalizeUsage(
    usage: { inTokens?: number; outTokens?: number; totalTokens?: number } | undefined,
    meta: { providerId: string; modelId: string; latencyMs?: number },
  ): { inTokens: number; outTokens: number; totalTokens: number; providerId: string; modelId: string; latencyMs?: number } {
    const inTokens = usage?.inTokens ?? 0;
    const outTokens = usage?.outTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? inTokens + outTokens;
    return {
      inTokens,
      outTokens,
      totalTokens,
      providerId: meta.providerId,
      modelId: meta.modelId,
      latencyMs: meta.latencyMs,
    };
  }

  // ── Error normalization public ────────────────────────────────────────────

  normalizeError(err: unknown, providerId: string, modelId?: string): ProviderError | any {
    return normalizeProviderError(err, providerId, modelId) as any;
  }
}

// Singleton — THE canonical provider gateway
export const providerGateway = new ProviderGateway();

// Backward compat: keep registry singleton accessible via gateway
export { registry as providerRegistry } from "./registry.ts";
export { PRESETS } from "./presets.ts";
