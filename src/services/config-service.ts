/**
 * XR — Config Service
 * Manages the application configuration with schema validation and persistence.
 */

import { loadConfig, saveConfig, configPath, type XRConfig, isMemoryEnabled } from "../config/config.ts";
import { LifecycleHook } from "../core/lifecycle.ts";

/** Recursive deep merge (Phase 1 · M-03). Plain objects merge key-by-key;
 * arrays and non-plain values are replaced wholesale when the patch carries the
 * key (a present key is explicit intent). A partial `providerEngine` patch
 * therefore PRESERVES `customProviders` / `providerCapabilities` instead of
 * wiping them with the shallow `{...base, ...patch}` that dropped them. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = (base as Record<string, unknown>)[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v);
    } else {
      // Arrays (and other non-plain values) REPLACED — present key = explicit intent.
      out[k] = v;
    }
  }
  return out as T;
}

export class ConfigService implements LifecycleHook {
  private config: XRConfig;
  private warnings: string[] = [];

  constructor() {
    const { config, warnings } = loadConfig();
    this.config = config;
    this.warnings = warnings;
  }

  /**
   * Get the current configuration.
   */
  get(): XRConfig {
    return this.config;
  }

  /**
   * Get configuration warnings.
   */
  getWarnings(): string[] {
    return this.warnings;
  }

  /**
   * Update the configuration and persist it to disk.
   *
   * Phase 1 · M-03 — deep-merges per-section, so a partial top-level section
   * patch (e.g. only `providerEngine.requestTimeoutMs`) preserves the sibling
   * keys (`customProviders`, `providerCapabilities`, …) instead of dropping
   * them. Arrays are replaced only when the patch key is present (explicit).
   */
  async update(patch: Partial<XRConfig>): Promise<void> {
    this.config = deepMerge(this.config, patch);
    saveConfig(this.config);
  }

  /**
   * Check if durable memory is enabled.
   */
  isMemoryEnabled(): boolean {
    return isMemoryEnabled();
  }

  /**
   * Returns the path to the config file.
   */
  getPath(): string {
    return configPath();
  }

  async onInit(): Promise<void> {
    // Validation already done in constructor via loadConfig()
  }

  async onStart(): Promise<void> {}
  async onStop(): Promise<void> {}
}
