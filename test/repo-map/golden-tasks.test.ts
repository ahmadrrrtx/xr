import { describe, expect, test } from "bun:test";
import { cleanup, GOLDEN_TREE, indexTree } from "./helpers.ts";

describe("Phase 11 — golden coding tasks", () => {
  test("Fix the provider fallback logic → gateway + provider files", async () => {
    const { intel, store, home } = await indexTree("ws-g1", GOLDEN_TREE);
    try {
      const ranked = intel.rank("Fix the provider fallback logic");
      const paths = ranked.slice(0, 6).map((r) => r.relativePath);
      expect(paths.some((p) => p.includes("providers/gateway"))).toBe(true);
      expect(paths.some((p) => p.includes("providers/") || p.includes("chat.routes"))).toBe(true);
    } finally {
      cleanup(home, store);
    }
  });

  test("Fix skills marketplace API routing → skills-api / extensions / contract", async () => {
    const { intel, store, home } = await indexTree("ws-g2", GOLDEN_TREE);
    try {
      const ranked = intel.rank("Fix skills marketplace API routing");
      const paths = ranked.slice(0, 8).map((r) => r.relativePath).join("\n");
      expect(paths).toMatch(/marketplace-backend|extensions\.routes|contract/);
    } finally {
      cleanup(home, store);
    }
  });

  test("Improve checkpoint recovery → checkpoint / recovery / execution", async () => {
    const { intel, store, home } = await indexTree("ws-g3", GOLDEN_TREE);
    try {
      const ranked = intel.rank("Improve checkpoint recovery");
      const paths = ranked.slice(0, 8).map((r) => r.relativePath).join("\n");
      expect(paths).toMatch(/checkpoint|recovery/);
    } finally {
      cleanup(home, store);
    }
  });

  test("Fix MCP security → manager / allowlist / tool-output", async () => {
    const { intel, store, home } = await indexTree("ws-g4", GOLDEN_TREE);
    try {
      const ranked = intel.rank("Fix MCP security allowlist tool description scanner");
      const paths = ranked.slice(0, 8).map((r) => r.relativePath).join("\n");
      expect(paths).toMatch(/mcp\/|allowlist|tool-output/);
    } finally {
      cleanup(home, store);
    }
  });

  test("Improve memory retrieval → memory / rag / retrieval / store", async () => {
    const { intel, store, home } = await indexTree("ws-g5", GOLDEN_TREE);
    try {
      const ranked = intel.rank("Improve memory retrieval rag context workspace store");
      const paths = ranked.slice(0, 8).map((r) => r.relativePath).join("\n");
      expect(paths).toMatch(/rag|retrieval|workspace-store/);
    } finally {
      cleanup(home, store);
    }
  });
});
