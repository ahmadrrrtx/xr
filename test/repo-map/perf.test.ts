import { describe, expect, test } from "bun:test";
import { cleanup, indexTree } from "./helpers.ts";

describe("Phase 11 — large-repo incremental performance", () => {
  test("unchanged second index is dramatically cheaper than the first", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 80; i++) {
      files[`src/f${i}.ts`] = `import { shared } from "./shared.ts";\nexport function fn${i}(): number { return shared() + ${i}; }\n`;
    }
    files["src/shared.ts"] = `export function shared(): number { return 1; }\n`;
    const { intel, store, home } = await indexTree("ws-perf", files);
    try {
      const first = intel.status();
      expect(first.files).toBeGreaterThanOrEqual(80);
      const second = await intel.index();
      expect(second.changedFiles).toBe(0);
      expect(second.cacheHits).toBeGreaterThanOrEqual(80);
      // Incremental should be much cheaper; allow slack on a noisy host.
      expect(second.durationMs).toBeLessThan(Math.max(80, first.durationMs * 0.6));
    } finally {
      cleanup(home, store);
    }
  }, 60_000);
});
