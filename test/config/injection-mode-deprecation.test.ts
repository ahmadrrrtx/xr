/**
 * XR Phase 7 (F-21) · Step 6 — `knowledge.injectionMode` deprecation contract.
 *
 * The legacy modes ("legacy" / "both") inject recalled memory as an unlabelled
 * system message — the weaker channel separation Phase 7 retires. For 1.x the
 * value still WORKS (no user action required), but loading a config that uses
 * it must produce a warning that names the setting, says it is deprecated,
 * points at the 2.0 removal and at the replacement. "context" (the default)
 * must stay silent. Removal itself is a 2.0 change, not this test's business.
 *
 * Hermetic: XR_HOME is a fresh temp dir; the config on disk is written by the
 * test; the in-process config cache is invalidated before every load.
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const TEST_HOME = mkdtempSync(join(tmpdir(), "xr-injmode-test-"));
process.env.XR_HOME = TEST_HOME;

const { loadConfig, ConfigSchema, CONFIG_VERSION, configPath } = await import("../../src/config/config.ts");
const { invalidateConfigCache, stopWatcher } = await import("../../src/config/cache.ts");

// `XR_HOME` is resolved ONCE when config.ts is first evaluated. When this file
// shares a bun process with other config tests (the CI per-directory segment),
// the module may already be loaded against a different hermetic home, so the
// only honest target is the path the module itself reports. Whatever is there
// is backed up and restored so no sibling test observes our fixture.
const TARGET = configPath();
const previous: string | null = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : null;

function writeConfig(injectionMode: "legacy" | "context" | "both"): void {
  mkdirSync(dirname(TARGET), { recursive: true });
  const cfg = ConfigSchema.parse({ version: CONFIG_VERSION, knowledge: { injectionMode } });
  writeFileSync(TARGET, JSON.stringify(cfg, null, 2));
}

const DEPRECATION = /knowledge\.injectionMode "(legacy|both)" is deprecated/;

describe("Phase 7 · injectionMode legacy/both is deprecated with a working warning", () => {
  beforeEach(() => {
    stopWatcher();
    invalidateConfigCache("all");
  });
  afterAll(() => {
    stopWatcher();
    // Put the config back exactly as found (or remove ours), then drop the cache.
    try {
      if (previous === null) rmSync(TARGET, { force: true });
      else writeFileSync(TARGET, previous);
    } catch { /* best-effort */ }
    invalidateConfigCache("all");
    try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test.each(["legacy", "both"] as const)("%s → config still loads unchanged AND a deprecation warning is emitted", (mode) => {
    writeConfig(mode);
    const { config, warnings } = loadConfig();
    // Still works: the value is honoured, never silently rewritten (removal is 2.0).
    expect(config.knowledge.injectionMode).toBe(mode);
    const hit = warnings.filter((w) => DEPRECATION.test(w));
    expect(hit).toHaveLength(1);
    // The warning is actionable: names the removal release, the replacement and the doc.
    expect(hit[0]).toContain("2.0");
    expect(hit[0]).toContain('"context"');
    expect(hit[0]).toContain("docs/privacy/MEMORY.md");
  });

  test("context (the default and the only 2.0 path) loads silently", () => {
    writeConfig("context");
    const { config, warnings } = loadConfig();
    expect(config.knowledge.injectionMode).toBe("context");
    expect(warnings.some((w) => DEPRECATION.test(w))).toBe(false);
  });

  test("the warning is part of the cached load, so every later reader sees it too", () => {
    writeConfig("legacy");
    const first = loadConfig();
    const second = loadConfig(); // served from the in-process cache
    expect(second.warnings.filter((w) => DEPRECATION.test(w))).toHaveLength(1);
    expect(second.warnings).toEqual(first.warnings);
  });
});
