/**
 * XR — Config Service
 * Manages the application configuration with schema validation and persistence.
 */

import { loadConfig, saveConfig, configPath, XRConfig, isMemoryEnabled } from "../config/config.ts";
import { LifecycleHook } from "../core/lifecycle.ts";

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
   */
  async update(patch: Partial<XRConfig>): Promise<void> {
    this.config = { ...this.config, ...patch };
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
