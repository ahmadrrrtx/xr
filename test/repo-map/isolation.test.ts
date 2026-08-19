import { describe, expect, test } from "bun:test";
import { cleanup, indexTree } from "./helpers.ts";

describe("Phase 11 — workspace isolation", () => {
  test("Workspace A secrets never appear in Workspace B queries", async () => {
    const a = await indexTree("workspace-a", {
      "secret.ts": `export const WORKSPACE_A_SECRET = "alpha-only";\nexport function internalApi(): string { return WORKSPACE_A_SECRET; }\n`,
    });
    const b = await indexTree("workspace-b", {
      "main.ts": `export function main(): string { return "ok"; }\n`,
    });
    try {
      const hits = b.intel.search("secret");
      expect(hits.every((h) => !String(h.name).includes("SECRET") && !h.relativePath.includes("secret"))).toBe(true);
      expect(b.intel.symbols("WORKSPACE_A_SECRET")).toHaveLength(0);
      expect(b.intel.symbols("internalApi")).toHaveLength(0);

      const aHits = a.intel.search("secret");
      expect(aHits.length).toBeGreaterThan(0);
      expect(a.intel.symbols("WORKSPACE_A_SECRET").length).toBeGreaterThan(0);

      // Store-level fence: B's tables only contain B's workspace_id.
      const leaked = b.store
        .prepare(`SELECT COUNT(*) c FROM repo_symbols WHERE workspace_id = ?`)
        .get("workspace-a") as { c: number };
      expect(leaked.c).toBe(0);
    } finally {
      cleanup(a.home, a.store);
      cleanup(b.home, b.store);
    }
  });
});
