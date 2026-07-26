/**
 * XR 4.4 — Routing overhead benchmarks (bounded, no network).
 */
import { describe, test, expect } from "bun:test";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import { ConfigSchema } from "../../src/config/config.ts";

describe("XR 4.4 intelligence performance", () => {
  test("catalog build is under 50ms cold", () => {
    const config = ConfigSchema.parse({});
    const t0 = performance.now();
    const cat = buildCatalog(config);
    const ms = performance.now() - t0;
    expect(cat.models.length).toBeGreaterThan(10);
    expect(ms).toBeLessThan(50);
  });

  test("100 routing decisions average under 5ms each", () => {
    const config = ConfigSchema.parse({
      defaults: { provider: "ollama", model: "qwen2.5:7b" },
    });
    const catalog = buildCatalog(config);
    const router = new IntelligenceRouter({ catalog });
    const t0 = performance.now();
    const n = 100;
    for (let i = 0; i < n; i++) {
      router.route(config, {
        requirements: { modelClass: "chat", require: { toolUse: true } },
      });
    }
    const avg = (performance.now() - t0) / n;
    expect(avg).toBeLessThan(5);
  });

  test("manual pin path is faster than full automatic (or comparable)", () => {
    const config = ConfigSchema.parse({});
    const catalog = buildCatalog(config);
    const router = new IntelligenceRouter({ catalog });
    const tAuto0 = performance.now();
    for (let i = 0; i < 50; i++) router.route(config, {});
    const auto = (performance.now() - tAuto0) / 50;
    const tMan0 = performance.now();
    for (let i = 0; i < 50; i++) {
      router.route(config, { provider: "ollama", model: "qwen2.5:7b" });
    }
    const man = (performance.now() - tMan0) / 50;
    // Manual should not be dramatically slower than automatic
    expect(man).toBeLessThan(auto * 5 + 2);
  });
});
