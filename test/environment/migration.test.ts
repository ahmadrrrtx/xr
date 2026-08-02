/**
 * XR 5.1/5.2+ — Config migration 15 → 18 tests (additive, behavior-preserving).
 *
 * The migration chain is tested directly on raw objects (no disk, no shared
 * config-cache state), so results are identical regardless of which test files
 * run alongside. `ConfigSchema.parse` verifies the migrated shape typechecks.
 */
import { describe, test, expect } from "bun:test";
import {
  CONFIG_VERSION,
  ConfigSchema,
  migrateRawConfig,
} from "../../src/config/config.ts";

const LEGACY_V15 = {
  version: 15,
  defaults: { provider: "ollama", model: "qwen2.5:7b" },
  control: { enabled: true, defaultMode: "auto", stepDelayMs: 250, memory: { enabled: true, maxEntries: 500 } },
  voice: { enabled: true, mode: "push-to-talk", allowCloudStt: false },
  knowledge: { enabled: true, injectionMode: "context" },
  budget: { perTaskUsd: 0.25, perTaskTokens: 200000 },
};

describe("config migration 15 → 18 (raw chain)", () => {
  test("CONFIG_VERSION is 17", () => {
    expect(CONFIG_VERSION).toBe(18);
  });

  test("a v15 config gains the environment block with safe defaults", () => {
    const raw = migrateRawConfig(structuredClone(LEGACY_V15)) as Record<string, any>;
    expect(raw.version).toBe(18);
    const env = raw.environment;
    expect(env.enabled).toBe(true);
    expect(env.modalities).toEqual({
      browser: true,
      desktop: true,
      filesystem: true,
      application: true,
      voice: true,
      vision: true,
    });
    // Cloud vision defaults OFF — matching the cloud STT/TTS posture.
    expect(env.vision.allowCloud).toBe(false);
    expect(env.vision.staleObservationMs).toBe(30_000);
    // Governed browser sessions fail closed on private networks by default.
    expect(env.browser.blockPrivateNetworks).toBe(true);
    expect(env.browser.allowedDomains).toEqual([]);
    // Bounded recovery only.
    expect(env.recovery.maxReobserveRetries).toBe(1);
    expect(env.recovery.circuitFailures).toBe(3);
    expect(env.sessions.maxActive).toBe(5);
    expect(env.voice.minControlConfidence).toBe(0.6);
    expect(raw.capabilities.enabled).toBe(true);
    expect(raw.capabilities.updateRequiresReview).toBe(true);
    expect(raw.capabilities.quarantineOnVerificationFailure).toBe(true);
  });

  test("existing blocks are preserved by the migration", () => {
    const raw = migrateRawConfig(structuredClone(LEGACY_V15)) as Record<string, any>;
    expect(raw.control.enabled).toBe(true);
    expect(raw.control.stepDelayMs).toBe(250);
    expect(raw.voice.allowCloudStt).toBe(false);
    expect(raw.budget.perTaskUsd).toBe(0.25);
    expect(raw.knowledge.injectionMode).toBe("context");
  });

  test("a pre-existing environment block is respected, never overwritten", () => {
    const legacyWithEnv = {
      ...structuredClone(LEGACY_V15),
      environment: { enabled: false, modalities: { browser: false } },
    };
    const raw = migrateRawConfig(legacyWithEnv) as Record<string, any>;
    expect(raw.version).toBe(18);
    expect(raw.environment.enabled).toBe(false);
    expect(raw.environment.modalities.browser).toBe(false);
    expect(raw.capabilities.enabled).toBe(true);
  });

  test("a pre-existing capabilities block is respected, never overwritten", () => {
    const raw = migrateRawConfig({
      ...structuredClone(LEGACY_V15),
      version: 16,
      environment: { enabled: true },
      capabilities: { enabled: false, requireSignedPackages: true },
    }) as Record<string, any>;
    expect(raw.version).toBe(18);
    expect(raw.capabilities.enabled).toBe(false);
    expect(raw.capabilities.requireSignedPackages).toBe(true);
  });

  test("the migrated config typechecks against the v17 schema", () => {
    const parsed = ConfigSchema.safeParse(migrateRawConfig(structuredClone(LEGACY_V15)));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(18);
      expect(parsed.data.environment.vision.allowCloud).toBe(false);
      expect(parsed.data.capabilities.updateRequiresReview).toBe(true);
      expect(parsed.data.control.enabled).toBe(true);
    }
  });

  test("a v17 config does not re-migrate (idempotent)", () => {
    const once = migrateRawConfig(structuredClone(LEGACY_V15)) as Record<string, any>;
    const twice = migrateRawConfig(once) as Record<string, any>;
    expect(twice.version).toBe(18);
    expect(JSON.stringify(twice.environment)).toBe(JSON.stringify(once.environment));
    expect(JSON.stringify(twice.capabilities)).toBe(JSON.stringify(once.capabilities));
  });
});
