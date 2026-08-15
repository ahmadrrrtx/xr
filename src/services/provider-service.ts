/**
 * XR — Provider Service
 * Manages LLM providers, handles routing, fallback, health checks,
 * custom provider registration, and secure key storage.
 *
 * XR 4.4: routing goes through the Universal Intelligence Plane when available,
 * while preserving getProvider({ provider, model, strategy }) compatibility.
 *
 * Phase 04: now delegates to ProviderGateway — the single canonical provider
 * abstraction. All provider listing, health, resolution, capability queries
 * go through the gateway. Registry is still used via gateway.
 */

import { registry } from "../providers/registry.ts";
import { providerGateway, gatewayEnabled } from "../providers/gateway.ts";
import { streamingMetrics, withTurnMetrics, type StreamingMetricsCollector } from "../providers/stream-metrics.ts";
import {
  RoutingService,
  type RoutingStrategy,
  type ResolveOptions,
} from "../intelligence/routing-service.ts";
import {
  ProviderHealthChecker,
  type ProviderHealthReport,
} from "../providers/health.ts";
import {
  PRESETS,
  knownProviders,
  providerList,
} from "../providers/factory.ts";
import type { Provider } from "../core/types.ts";
import { ServiceRegistry } from "../core/service-registry.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { Tokens } from "../core/tokens.ts";
import { setSecret, getSecret } from "../security/secrets.ts";
import type {
  RouteRequest,
  RouteResult,
  RoutingDecision,
  TaskRequirements,
} from "../intelligence/types.ts";

export class ProviderService implements LifecycleHook {
  private registry: ServiceRegistry;

  getRegistry(): ServiceRegistry {
    return this.registry;
  }
  private lastDecision: RoutingDecision | null = null;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
  }

  private sync(): void {
    try {
      const configService = this.registry.resolve(Tokens.Config);
      registry.syncCustom(configService.get());
    } catch {
      // Config service may not be available during very early init
    }
  }

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  getProvider(overrides?: {
    provider?: string;
    model?: string;
    strategy?: RoutingStrategy;
    requirements?: Partial<TaskRequirements>;
    mode?: RouteRequest["mode"];
  }): Provider {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();

    // Gateway path: if enabled, use gateway.resolve for deterministic resolution
    if (gatewayEnabled()) {
      try {
        // Sync path: we need sync but gateway.resolve is async; use sync legacy router
        // for now but still via gateway's createProvider and catalog
        // For measured path, prefer IntelligenceService when registered
        const intel = this.registry.tryResolve?.(Tokens.Intelligence) ?? this.tryIntel();
        if (intel && !overrides?.strategy) {
          try {
            const result = intel.resolveProvider({
              provider: overrides?.provider,
              model: overrides?.model,
              mode: overrides?.mode,
              requirements: overrides?.requirements,
            });
            this.lastDecision = result.decision;
            return withTurnMetrics(result.provider, streamingMetrics, overrides?.model ?? config.defaults?.model);
          } catch {
            // fall through
          }
        }

        // Use RoutingService via gateway semantics (sync)
        const router = new RoutingService(config);
        const { provider, decision } = router.resolveWithDecision(overrides as ResolveOptions);
        this.lastDecision = decision;
        return withTurnMetrics(provider, streamingMetrics, overrides?.model ?? config.defaults?.model);
      } catch {
        // Fallback to legacy
      }
    }

    // Legacy path / fallback
    const intel = this.registry.tryResolve?.(Tokens.Intelligence) ?? this.tryIntel();
    if (intel && !overrides?.strategy) {
      try {
        const result = intel.resolveProvider({
          provider: overrides?.provider,
          model: overrides?.model,
          mode: overrides?.mode,
          requirements: overrides?.requirements,
        });
        this.lastDecision = result.decision;
        return withTurnMetrics(result.provider, streamingMetrics, overrides?.model ?? config.defaults?.model);
      } catch {
        // Fall through to classic router
      }
    }

    const router = new RoutingService(config);
    const { provider, decision } = router.resolveWithDecision(overrides as ResolveOptions);
    this.lastDecision = decision;
    return withTurnMetrics(provider, streamingMetrics, overrides?.model ?? config.defaults?.model);
  }

  get metrics(): StreamingMetricsCollector {
    return streamingMetrics;
  }

  private tryIntel(): import("../intelligence/service.ts").IntelligenceService | null {
    try {
      return this.registry.resolve(Tokens.Intelligence);
    } catch {
      return null;
    }
  }

  route(request: RouteRequest = {}): RouteResult {
    this.sync();
    const intel = this.tryIntel();
    if (intel) {
      const result = intel.route(request);
      this.lastDecision = result.decision;
      return result;
    }
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();
    const router = new RoutingService(config);
    const { decision } = router.resolveWithDecision({
      provider: request.provider,
      model: request.model,
      mode: request.mode,
      requirements: request.requirements,
    });
    this.lastDecision = decision;
    return {
      decision,
      record: {
        decisionId: decision.decisionId,
        version: 1,
        timestamp: decision.timestamp,
        mode: decision.mode,
        providerId: decision.selected?.providerId,
        modelId: decision.selected?.modelId,
        manual: decision.manual,
        unavailable: decision.unavailable,
        explanation: decision.explanation,
        factors: decision.factors,
        fallbackChain: decision.fallbackChain,
        localityPolicy: decision.constraints.localityPolicy,
        confidence: decision.confidence,
        rejectedCount: decision.rejected.length,
        humanHandoff: decision.humanHandoff?.required,
      },
    };
  }

  getKnownProviders(): string[] {
    this.sync();
    if (gatewayEnabled()) {
      try {
        const configService = this.registry.resolve(Tokens.Config);
        return providerGateway.list(configService.get()).map((p) => p.id);
      } catch {}
    }
    return knownProviders();
  }

  getPreset(id: string): typeof PRESETS[string] | undefined {
    this.sync();
    if (gatewayEnabled()) {
      return providerGateway.getPreset(id) ?? PRESETS[id];
    }
    return registry.getPreset(id) ?? PRESETS[id];
  }

  async checkHealth(
    id?: string,
    model?: string,
  ): Promise<ProviderHealthReport> {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();
    const targetId = id ?? config.defaults.provider;
    const targetModel = model ?? config.defaults.model;

    if (gatewayEnabled()) {
      // Use gateway health (bounded, cached, deduped)
      const cached = await providerGateway.health(config, targetId, targetModel);
      // Strip cache metadata for backward compat
      const { cached: _c, stale: _s, deduped: _d, probeMs: _p, ...report } = cached as any;
      return report;
    }

    const checker = new ProviderHealthChecker(config);
    return await checker.check(targetId, targetModel);
  }

  async checkAllProviders(): Promise<ProviderHealthReport[]> {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();

    if (gatewayEnabled()) {
      const cachedAll = await providerGateway.healthAll(config);
      return cachedAll.map((c) => {
        const { cached: _c, stale: _s, deduped: _d, probeMs: _p, ...report } = c as any;
        return report;
      });
    }

    const checker = new ProviderHealthChecker(config);
    return await checker.checkAll();
  }

  getActiveProviderId(): string {
    const configService = this.registry.resolve(Tokens.Config);
    return configService.get().defaults.provider;
  }

  async setActiveProvider(id: string, model?: string): Promise<void> {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();

    if (!registry.has(id) && !PRESETS[id] && !providerGateway.has(id)) {
      throw new Error(`Unknown provider: ${id}`);
    }

    config.defaults.provider = id;
    if (model) {
      config.defaults.model = model;
    } else if (PRESETS[id] || providerGateway.getPreset(id)) {
      const preset = PRESETS[id] ?? providerGateway.getPreset(id);
      if (preset) config.defaults.model = preset.defaultModel;
    }

    await configService.update(config);
    this.tryIntel()?.invalidateCatalog();
  }

  async addCustomProvider(def: {
    id: string;
    label: string;
    baseUrl: string;
    apiKeyEnv?: string;
    defaultModel: string;
    headers?: Record<string, string>;
    capabilities?: any;
  }): Promise<void> {
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();

    const existing = config.providerEngine?.customProviders ?? [];
    const filtered = existing.filter((c: any) => c.id !== def.id);

    filtered.push({
      id: def.id,
      label: def.label,
      baseUrl: def.baseUrl,
      apiKeyEnv: def.apiKeyEnv,
      defaultModel: def.defaultModel,
      headers: def.headers,
      capabilities: def.capabilities ?? { chat: true },
    });

    const patch: any = {
      providerEngine: {
        ...(config.providerEngine ?? {}),
        customProviders: filtered,
      },
    };

    await configService.update(patch);
    registry.syncCustom({
      ...config,
      providerEngine: patch.providerEngine,
    } as any);
    this.tryIntel()?.invalidateCatalog();
  }

  async removeCustomProvider(id: string): Promise<void> {
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();

    const existing = config.providerEngine?.customProviders ?? [];
    const filtered = existing.filter((c: any) => c.id !== id);

    if (filtered.length === existing.length) {
      throw new Error(`Custom provider "${id}" not found.`);
    }

    const patch: any = {
      providerEngine: {
        ...(config.providerEngine ?? {}),
        customProviders: filtered,
      },
    };

    await configService.update(patch);
    registry.syncCustom({
      ...config,
      providerEngine: patch.providerEngine,
    } as any);
    this.tryIntel()?.invalidateCatalog();
  }

  async storeKey(envName: string, value: string): Promise<string> {
    const backend = setSecret(envName, value);
    process.env[envName] = value;
    this.tryIntel()?.invalidateCatalog();
    return backend;
  }

  getKeyStatus(id: string): {
    required: boolean;
    set: boolean;
    envName?: string;
  } {
    if (gatewayEnabled()) {
      const status = providerGateway.credentialStatus(id);
      return {
        required: status.required,
        set: status.available,
        envName: status.envName,
      };
    }
    const preset = registry.getPreset(id) ?? PRESETS[id];
    if (!preset) return { required: false, set: false };
    if (!preset.apiKeyEnv) return { required: false, set: true };
    const set = !!(
      process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv)
    );
    return { required: true, set, envName: preset.apiKeyEnv };
  }

  getProviderList(): string {
    this.sync();
    if (gatewayEnabled()) {
      try {
        const configService = this.registry.resolve(Tokens.Config);
        const list = providerGateway.list(configService.get());
        return list
          .map((p) => {
            const tierBadge =
              p.tier === "free"
                ? "🆓"
                : p.tier === "cheap"
                  ? "💰"
                  : p.tier === "premium"
                    ? "💎"
                    : "🏢";
            const kindBadge = p.kind === "local" ? "🏠" : "☁️";
            return `  ${p.id.padEnd(12)} ${tierBadge} ${kindBadge} ${p.label.padEnd(28)} default: ${p.defaultModel}`;
          })
          .join("\n");
      } catch {}
    }
    return providerList();
  }

  async onInit(): Promise<void> {
    this.sync();
  }

  async onStart(): Promise<void> {
    this.sync();
  }

  async onStop(): Promise<void> {}
}
