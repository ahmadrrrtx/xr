/**
 * XR — Provider Service
 * Manages LLM providers, handles routing, fallback, and health checks.
 */

import { Provider, ProviderPreset, buildProvider, PRESETS, knownProviders } from "../providers/factory.ts";
import { ConfigService } from "./config-service.ts";
import { Container } from "../core/container.ts";
import { LifecycleHook } from "../core/lifecycle.ts";

export class ProviderService implements LifecycleHook {
  private container: Container;

  constructor(container: Container) {
    this.container = container;
  }

  /**
   * Resolve the active provider based on current config and optional overrides.
   */
  getProvider(overrides?: { provider?: string; model?: string }): Provider {
    const configService = this.container.resolve<ConfigService>("config");
    const config = configService.get();
    return buildProvider(config, overrides);
  }

  /**
   * Get a list of all supported provider IDs.
   */
  getKnownProviders(): string[] {
    return knownProviders();
  }

  /**
   * Get metadata for a specific provider.
   */
  getPreset(id: string): ProviderPreset | undefined {
    return PRESETS[id];
  }

  /**
   * Check health of the current active provider.
   */
  async checkHealth(overrides?: { provider?: string; model?: string }): Promise<{ ok: boolean; detail?: string; latencyMs?: number }> {
    const provider = this.getProvider(overrides);
    return await provider.health();
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}
}
