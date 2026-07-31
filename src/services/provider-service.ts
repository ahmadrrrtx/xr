/**
 * XR — Provider Service
 * Manages LLM providers, handles routing, fallback, health checks,
 * custom provider registration, and secure key storage.
 *
 * XR 4.4: routing goes through the Universal Intelligence Plane when available,
 * while preserving getProvider({ provider, model, strategy }) compatibility.
 */

import { registry } from "../providers/registry.ts";
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
  buildProvider,
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

  /** Last routing decision from getProvider / route. */
  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  /**
   * Resolve the active provider based on current config and optional overrides.
   * XR 4.4: accepts requirements/mode for capability-aware automatic routing.
   */
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

    // Prefer IntelligenceService when registered
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
        return result.provider;
      } catch {
        // Fall through to classic router
      }
    }

    const router = new RoutingService(config);
    const { provider, decision } = router.resolveWithDecision(overrides as ResolveOptions);
    this.lastDecision = decision;
    return provider;
  }

  private tryIntel(): import("../intelligence/service.ts").IntelligenceService | null {
    try {
      return this.registry.resolve(Tokens.Intelligence);
    } catch {
      return null;
    }
  }

  /**
   * XR 4.4 — compute routing decision (no provider construction required).
   */
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

  /**
   * Get a list of all supported provider IDs (built-in + custom).
   */
  getKnownProviders(): string[] {
    this.sync();
    return knownProviders();
  }

  /**
   * Get metadata for a specific provider (built-in or custom).
   */
  getPreset(id: string): typeof PRESETS[string] | undefined {
    this.sync();
    return registry.getPreset(id) ?? PRESETS[id];
  }

  /**
   * Check health of a specific provider.
   */
  async checkHealth(
    id?: string,
    model?: string,
  ): Promise<ProviderHealthReport> {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();
    const checker = new ProviderHealthChecker(config);
    return await checker.check(
      id ?? config.defaults.provider,
      model ?? config.defaults.model,
    );
  }

  /**
   * Check health of ALL registered providers.
   */
  async checkAllProviders(): Promise<ProviderHealthReport[]> {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();
    const checker = new ProviderHealthChecker(config);
    return await checker.checkAll();
  }

  /**
   * Get active provider ID from config.
   */
  getActiveProviderId(): string {
    const configService = this.registry.resolve(Tokens.Config);
    return configService.get().defaults.provider;
  }

  /**
   * Set the active provider and optionally model. Persists to config.
   */
  async setActiveProvider(id: string, model?: string): Promise<void> {
    this.sync();
    const configService = this.registry.resolve(Tokens.Config);
    const config = configService.get();

    if (!registry.has(id) && !PRESETS[id]) {
      throw new Error(`Unknown provider: ${id}`);
    }

    config.defaults.provider = id;
    if (model) {
      config.defaults.model = model;
    } else if (PRESETS[id]) {
      config.defaults.model = PRESETS[id].defaultModel;
    }

    await configService.update(config);
    this.tryIntel()?.invalidateCatalog();
  }

  /**
   * Add a custom provider. Persists to config.
   */
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

  /**
   * Remove a custom provider. Persists to config.
   */
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

  /**
   * Store a provider API key securely using the best available backend.
   */
  async storeKey(envName: string, value: string): Promise<string> {
    const backend = setSecret(envName, value);
    process.env[envName] = value;
    this.tryIntel()?.invalidateCatalog();
    return backend;
  }

  /**
   * Get key status for a provider (required / set / env name).
   * Never returns the actual key value.
   */
  getKeyStatus(id: string): {
    required: boolean;
    set: boolean;
    envName?: string;
  } {
    const preset = registry.getPreset(id) ?? PRESETS[id];
    if (!preset) return { required: false, set: false };
    if (!preset.apiKeyEnv) return { required: false, set: true };
    const set = !!(
      process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv)
    );
    return { required: true, set, envName: preset.apiKeyEnv };
  }

  /**
   * Get a formatted provider list for display.
   */
  getProviderList(): string {
    this.sync();
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
