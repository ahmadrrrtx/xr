import { describe, expect, test } from "bun:test";
import { generateRepoMap } from "../../src/repo/repo-map.ts";
import { countTokens } from "../../src/repo/tokens.ts";
import type { RankedFile } from "../../src/repo/types.ts";

function fakeRanked(n: number): RankedFile[] {
  const out: RankedFile[] = [];
  for (let i = 0; i < n; i++) {
    const path = `src/module${i}/file${i}.ts`;
    out.push({
      relativePath: path,
      language: "typescript",
      score: 100 - i,
      signals: { lexical: 1, symbol: 1, path: 1, dependency: 0, graph: 0.2, git: 0, task: 1 },
      gitStatus: "clean",
      symbols: [
        { id: `${i}a`, file: path, name: `Class${i}`, kind: "class", startLine: 1, endLine: 20, signature: `Class${i}`, exported: true },
        { id: `${i}b`, file: path, name: `fn${i}`, kind: "function", startLine: 22, endLine: 30, signature: `fn${i}()`, exported: true },
      ],
    });
  }
  return out;
}

describe("Phase 11 — token budget", () => {
  test("1024 token budget is never exceeded", () => {
    const map = generateRepoMap(fakeRanked(200), { tokenBudget: 1024, query: "fix auth" });
    expect(map.tokens).toBeLessThanOrEqual(1024);
    expect(countTokens(map.text)).toBeLessThanOrEqual(1024);
    expect(map.budget).toBe(1024);
    expect(map.tokenEstimator).toBe("xr-code-approx-v1");
    expect(map.truncated).toBe(true);
  });

  test("smaller budgets also hold", () => {
    for (const budget of [256, 512, 768]) {
      const map = generateRepoMap(fakeRanked(80), { tokenBudget: budget });
      expect(map.tokens).toBeLessThanOrEqual(budget);
    }
  });
});
