import { describe, expect, test } from "bun:test";
import { cleanup, indexTree } from "./helpers.ts";
import { REPO_TOOLS } from "../../src/repo/tools.ts";
import type { ToolContext } from "../../src/core/types.ts";

describe("Phase 11 — repo tools", () => {
  test("core repo tools are named and read-only", () => {
    const names = REPO_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "repo_context",
      "repo_dependencies",
      "repo_diff",
      "repo_map",
      "repo_search",
      "repo_symbols",
    ]);
    expect(REPO_TOOLS.every((t) => t.requiresApproval === false)).toBe(true);
  });

  test("repo_map / repo_search run against the last-opened store", async () => {
    const { intel, store, home, root } = await indexTree("ws-tools", {
      "src/auth.ts": `export function authenticate(): void {}\n`,
    });
    try {
      await intel.ensureIndexed();
      const ctx = {
        cwd: root,
        approve: async () => true,
        audit: () => {},
      } as unknown as ToolContext;
      const mapTool = REPO_TOOLS.find((t) => t.name === "repo_map")!;
      const res = await mapTool.run({ query: "authenticate" }, ctx);
      expect(res.ok).toBe(true);
      expect(res.output).toContain("auth");

      const search = REPO_TOOLS.find((t) => t.name === "repo_search")!;
      const found = await search.run({ query: "authenticate" }, ctx);
      expect(found.ok).toBe(true);
      expect(found.output).toContain("authenticate");
    } finally {
      cleanup(home, store);
    }
  });
});
