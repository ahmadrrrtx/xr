/**
 * XR Phase 10 · Step 4 — provider capability-contract fixtures (catalog truth).
 *
 * Both audits recommended per-preset VCR-style fixtures for contract tests.
 * The rule enforced here: a fixture is a projection of the provider CATALOG and
 * can never drift from it. Each fixture must (a) name a real catalog preset,
 * (b) agree with the catalog's kind/tier/capabilities, and (c) declare a usage
 * policy. A fixture that claims a capability the catalog does not declare is a
 * drift = a failing test. This is how the capability matrix (F-03/F-04/F-13)
 * stays honest without live network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PRESETS } from "../../src/providers/presets.ts";
import { computeMatrix } from "../../scripts/provider-matrix.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const manifestPath = join(FIXTURES_DIR, "manifest.json");

function loadJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("Phase 10 · provider capability-contract fixtures", () => {
  test("manifest exists and declares catalog presets only", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = loadJson(manifestPath);
    const presets = manifest.presets as Array<Record<string, unknown>>;
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) {
      expect(PRESETS[p.id as string], `manifest references unknown preset ${p.id}`).toBeDefined();
    }
  });

  test("every fixture is a real catalog preset and catalog-consistent (no drift)", () => {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const fx = loadJson(join(FIXTURES_DIR, f));
      const id = fx.id as string;
      const cat = PRESETS[id];
      expect(cat, `fixture ${f} for unknown preset ${id}`).toBeDefined();
      expect(fx.kind).toBe(cat.kind);
      expect(fx.tier).toBe(cat.tier);
      expect(fx.capabilities).toBeDefined();
    }
  });

  test("no capability drift between fixtures and the catalog (matrix gate)", () => {
    const { drift } = computeMatrix();
    expect(drift).toEqual([]);
  });

  test("each fixture declares a usage-reporting policy (F-13 honesty)", () => {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json");
    for (const f of files) {
      const fx = loadJson(join(FIXTURES_DIR, f));
      expect(typeof fx.usageReporting, `fixture ${f} must declare usageReporting`).toBe("string");
      expect(String(fx.usageReporting).length).toBeGreaterThan(0);
    }
  });
});
