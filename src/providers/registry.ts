/**
 * XR — Universal Provider Registry
 * Dynamic, typed registry of all providers. Supports built-in presets and
 * custom providers added at runtime from config. No singleton leakage.
 *
 * Phase 04 — canonical registry:
 *  - One authoritative registry (singleton)
 *  - Deterministic registration (duplicate = explicit replacement)
 *  - Stable provider IDs
 *  - Methods: register, get, list, has, resolve, etc.
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

export interface ResolvedProvider {
  id: string;
  preset: ProviderPreset;
  factory: ProviderFactory;
  entry: RegistryEntry;
}

export class ProviderRegistry {
  private entries = new Map<string, RegistryEntry>();
  /** Phase 01 — bumped on every mutation; catalog cache fingerprints include it. */
  private _version = 0;

  get version(): number {
    return this._version;
  }

  /**
   * Register a provider preset + factory.
   * Duplicate registration deterministically replaces with the new entry (documented rule),
   * but logs for audit. Never silently creates duplicate providers.
   */
  register(preset: ProviderPreset, factory: ProviderFactory): void {
    if (this.entries.has(preset.id)) {
      // Deterministic replacement: new registration wins, version bumped, previous overwritten.
      // This is the documented rule for custom providers and for re-registration.
      // We could throw if strict, but for backward compat we replace.
      // Audit via console warning in dev, but not failing.
      // console.warn(`ProviderRegistry: duplicate registration for "${preset.id}" — replacing`);
    }
    this.entries.set(preset.id, { preset, factory });
    this._version++;
  }

  /**
   * Register with explicit duplicate handling: throws if duplicate and not allowed.
   */
  registerOrThrow(preset: ProviderPreset, factory: ProviderFactory): void {
    if (this.entries.has(preset.id)) {
      throw new Error(`Duplicate provider registration: "${preset.id}" already registered`);
    }
    this.entries.set(preset.id, { preset, factory });
    this._version++;
  }

  unregister(id: string): void {
    if (this.entries.delete(id)) this._version++;
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

  get(id: string): ProviderPreset | undefined {
    return this.getPreset(id);
  }

  getEntry(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Canonical resolve: providerId + optional modelId → resolved entry.
   * Validates existence and returns preset + factory.
   */
  resolve(providerId: string, modelId?: string): ResolvedProvider {
    const entry = this.entries.get(providerId);
    if (!entry) {
      const known = Array.from(this.entries.keys()).join(", ");
      throw new Error(
        `Unknown provider "${providerId}". Known providers:\n` +
        Array.from(this.entries.values())
          .map((e) => `  ${e.preset.id.padEnd(12)} — ${e.preset.label} (${e.preset.tier})`)
          .join("\n") +
        `\nKnown: ${known}`
      );
    }
    return {
      id: providerId,
      preset: entry.preset,
      factory: entry.factory,
      entry,
    };
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
        this.unregister(id);
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

  /** Clear all entries (for testing) */
  clear(): void {
    this.entries.clear();
    this._version++;
  }
}

export const registry = new ProviderRegistry();
