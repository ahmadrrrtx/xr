/**
 * 3.x-era config fixtures must migrate in-memory (no disk) to CONFIG_VERSION
 * and pass ConfigSchema. The 1.0 rebaseline kept the same migration ladder.
 */
import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, ConfigSchema, migrateRawConfig } from "../../src/config/config.ts";

describe("3.x-era config migrates without touching disk", () => {
  test("version:3 fixture advances to CONFIG_VERSION and schema-parses", () => {
    const fixture = {
      version: 3,
      defaults: { provider: "ollama", model: "qwen2.5:7b", mode: "agent" },
      preferFreeProviders: true,
    };
    const migrated = migrateRawConfig(fixture) as { version: number };
    expect(migrated.version).toBe(CONFIG_VERSION);
    const parsed = ConfigSchema.safeParse(migrated);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(CONFIG_VERSION);
      expect(parsed.data.defaults.provider).toBe("ollama");
      expect(parsed.data.research.firecrawl.enabled).toBe(false);
    }
  });

  test("version:0 empty object also migrates and schema-parses", () => {
    const migrated = migrateRawConfig({ version: 0 });
    const parsed = ConfigSchema.safeParse(migrated);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.version).toBe(CONFIG_VERSION);
  });
});
