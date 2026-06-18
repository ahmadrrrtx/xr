/**
 * XR — Provider Service
 * Manages LLM providers, handles routing, fallback, health checks,
 * custom provider registration, and secure key storage.
 */

import { registry } from "../providers/registry.ts";
import { ProviderRouter, type RoutingStrategy } from "../providers/routing.ts";
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
import { ConfigService } from "./config-service.ts";
import { Container } from "../core/container.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { setSecret, getSecret } from "../security/secrets.ts";

export class ProviderService implements LifecycleHook {
  private container: Container;

  constructor(container: Container) {
    this.container = container;
  }

  private sync(): void {
    try {
      const configService = this.container.resolve<ConfigService>("config");
      registry.syncCustom(configService.get());
    } catch {
      // Config service may not be available during very early init
    }
  }

  /**
   * Resolve the active provider based on current config and optional overrides.
   */
  getProvider(overrides?: {
    provider?: string;
    model?: string;
    strategy?: RoutingStrategy;
  }): Provider {
    this.sync();
    const configService = this.container.resolve<ConfigService>("config");
    const config = configService.get();
    return buildProvider(config, overrides);
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
    const configService = this.container.resolve<ConfigService>("config");
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
    const configService = this.container.resolve<ConfigService>("config");
    const config = configService.get();
    const checker = new ProviderHealthChecker(config);
    return await checker.checkAll();
  }

  /**
   * Get active provider ID from config.
   */
  getActiveProviderId(): string {
    const configService = this.container.resolve<ConfigService>("config");
    return configService.get().defaults.provider;
  }

  /**
   * Set the active provider and optionally model. Persists to config.
   */
  async setActiveProvider(id: string, model?: string): Promise<void> {
    this.sync();
    const configService = this.container.resolve<ConfigService>("config");
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
    const configService = this.container.resolve<ConfigService>("config");
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
  }

  /**
   * Remove a custom provider. Persists to config.
   */
  async removeCustomProvider(id: string): Promise<void> {
    const configService = this.container.resolve<ConfigService>("config");
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
  }

  /**
   * Store a provider API key securely using the best available backend.
   */
  async storeKey(envName: string, value: string): Promise<string> {
    const backend = setSecret(envName, value);
    process.env[envName] = value;
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
