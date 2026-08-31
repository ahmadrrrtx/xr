/**
 * XR — Phase 1 · config migration integrity (M-04).
 *
 * The migration-8→9 "Universal Provider Engine" step used to REPLACE the whole
 * `providerEngine` with `customProviders: []`, wiping any pre-existing custom
 * providers on first load. Phase 1 spreads the existing providerEngine first.
 * This fixture proves a config that carries customProviders survives to v20.
 */

import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, migrateRawConfig } from "../../src/config/config.ts";

const custom = {
  id: "my-endpoint",
  label: "My Endpoint",
  baseUrl: "https://my-endpoint.example/v1",
  apiKeyEnv: "MY_ENDPOINT_KEY",
  defaultModel: "my-model",
  capabilities: { chat: true, streaming: false, toolUse: true, functionCalling: true },
};

function rawWithProviderEngine(version: number) {
  return {
    version,
    providerEngine: {
      routingStrategy: "hybrid",
      customProviders: [custom],
      providerCapabilities: { "my-endpoint": { streaming: false } },
    },
  };
}

describe("Phase 1 · migration 8→9 preserves providerEngine (M-04)", () => {
  test("a v8 config with customProviders survives the full ladder to v20 intact", () => {
    const out = migrateRawConfig(rawWithProviderEngine(8)) as any;
    expect(out.version).toBe(CONFIG_VERSION);
    expect(out.providerEngine.customProviders).toEqual([custom]);
    expect(out.providerEngine.providerCapabilities["my-endpoint"]).toEqual({ streaming: false });
    // The default injection must not have emptied the array.
    expect(out.providerEngine.customProviders.length).toBe(1);
  });

  test("the ladder is idempotent and always lands on CONFIG_VERSION", () => {
    for (const v of [0, 1, 6, 7, 8, 9, 10, 14, 18, 19]) {
      const out = migrateRawConfig(rawWithProviderEngine(v)) as any;
      expect(out.version).toBe(CONFIG_VERSION);
    }
  });

  test("a version-9 config also keeps its custom providers (no double-wipe)", () => {
    const out = migrateRawConfig(rawWithProviderEngine(9)) as any;
    expect(out.providerEngine.customProviders).toEqual([custom]);
  });
});
