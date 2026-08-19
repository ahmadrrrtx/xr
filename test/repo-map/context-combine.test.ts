import { describe, expect, test } from "bun:test";
import { isRepositoryFact, isResearchFact } from "../../src/repo/context.ts";
import { cleanup, indexTree } from "./helpers.ts";
import { buildRepoCandidates } from "../../src/repo/context.ts";

describe("Phase 11 — repo + research context stay distinct", () => {
  test("classifier does not confuse research provenance with repo facts", () => {
    expect(isRepositoryFact(["repo", "repo-map"], "file")).toBe(true);
    expect(isRepositoryFact(["memory"], "file")).toBe(false);
    expect(isResearchFact("research")).toBe(true);
    expect(isResearchFact("web")).toBe(true);
    expect(isResearchFact("file")).toBe(false);
  });

  test("repo extras are knowledge / file / source_evidence", async () => {
    const { intel, store, home } = await indexTree("ws-ctx", {
      "src/a.ts": `export function alpha(): void {}\n`,
    });
    try {
      const extras = await buildRepoCandidates(intel, {
        workspaceId: "ws-ctx",
        projectScope: "proj",
        task: "alpha",
      });
      expect(extras.length).toBe(1);
      const item = extras[0]!.item;
      expect(item.type).toBe("knowledge");
      expect(item.provenanceKind).toBe("file");
      expect(item.trustStatus).toBe("source_evidence");
      expect(item.tags).toContain("repo");
      expect(extras[0]!.tier).toBe("project_knowledge");
    } finally {
      cleanup(home, store);
    }
  });
});
