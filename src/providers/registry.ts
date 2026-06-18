/**
 * XR — Universal Provider Registry
 * Dynamic, typed registry of all providers. Supports built-in presets and
 * custom providers added at runtime from config. No singleton leakage.
 */

import type { Provider } from "../core/types.ts";
import type { XRConfig } from "../config/config.ts";
import type { ProviderPreset } from "./presets.ts";
import { CustomProvider } from "./custom.ts";

export type ProviderFactory = (config: XRConfig, model: string, preset: ProviderPreset) => Provider;

export interface RegistryEntry {
  preset: ProviderPreset;
  factory: ProviderFactory;
}

export class ProviderRegistry {
  private entries = new Map<string, RegistryEntry>();

  register(preset: ProviderPreset, factory: ProviderFactory): void {
    this.entries.set(preset.id, { preset, factory });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  getPreset(id: string): ProviderPreset | undefined {
    return this.entries.get(id)?.preset;
  }

  getFactory(id: string): ProviderFactory | undefined {
    return this.entries.get(id)?.factory;
  }

  createProvider(id: string, config: XRConfig, model: string): Provider {
    const entry = this.entries.get(id);
    if (!entry) {
      const known = Array.from(this.entries.keys()).join(", ");
      throw new Error(
        `Unknown provider "${id}". Known providers:\n` +
        Array.from(this.entries.values())
          .map((e) => `  ${e.preset.id.padEnd(12)} — ${e.preset.label} (${e.preset.tier})`)
          .join("\n")
      );
    }
    return entry.factory(config, model, entry.preset);
  }

  list(): ProviderPreset[] {
    return Array.from(this.entries.values()).map((e) => e.preset);
  }

  listByKind(kind: ProviderPreset["kind"]): ProviderPreset[] {
    return this.list().filter((p) => p.kind === kind);
  }

  listByTier(tier: ProviderPreset["tier"]): ProviderPreset[] {
    return this.list().filter((p) => p.tier === tier);
  }

  /** Sync custom providers from config into the registry. */
  syncCustom(config: XRConfig): void {
    // Remove stale custom entries that are no longer in config
    for (const [id, entry] of this.entries) {
      if (entry.preset.kind === "custom" && !config.providerEngine?.customProviders?.find((c: any) => c.id === id)) {
        this.entries.delete(id);
      }
    }

    // Register current custom providers
    for (const custom of config.providerEngine?.customProviders ?? []) {
      const preset: ProviderPreset = {
        id: custom.id,
        label: custom.label,
        kind: "custom",
        tier: "custom",
        baseUrl: custom.baseUrl,
        apiKeyEnv: custom.apiKeyEnv,
        authType: custom.apiKeyEnv ? "bearer" : "none",
        defaultModel: custom.defaultModel,
        knownModels: [custom.defaultModel],
        capabilities: custom.capabilities ?? { chat: true },
      };

      this.register(preset, (_cfg, model, _pr) => {
        return new CustomProvider({
          id: custom.id,
          label: custom.label,
          baseUrl: custom.baseUrl,
          model: model || custom.defaultModel,
          apiKeyEnv: custom.apiKeyEnv,
          extraHeaders: custom.headers,
        });
      });
    }
  }
}

export const registry = new ProviderRegistry();
