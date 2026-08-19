import { describe, expect, test } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { cleanup, indexTree, writeTree } from "./helpers.ts";

describe("Phase 11 — content-addressed parse cache", () => {
  test("unchanged file is reused; changed file is reparsed; deleted file is removed", async () => {
    const { intel, store, home, root } = await indexTree("ws-cache", {
      "src/keep.ts": `export function keep(): number { return 1; }\n`,
      "src/gone.ts": `export function gone(): number { return 2; }\n`,
    });
    try {
      const first = intel.status();
      expect(first.state).toBe("ready");
      expect(first.files).toBe(2);
      expect(intel.symbols("gone").length).toBe(1);

      const second = await intel.index();
      expect(second.cacheHits).toBeGreaterThanOrEqual(2);
      expect(second.changedFiles).toBe(0);
      expect(second.durationMs).toBeLessThan(first.durationMs + 2_000);

      writeFileSync(join(root, "src/keep.ts"), `export function keep(): number { return 99; }\nexport function extra(): void {}\n`);
      const third = await intel.index();
      expect(third.changedFiles).toBe(1);
      expect(intel.symbols("extra").length).toBe(1);

      unlinkSync(join(root, "src/gone.ts"));
      const fourth = await intel.index();
      expect(fourth.deletedFiles).toBe(1);
      expect(intel.symbols("gone").length).toBe(0);
      expect(intel.search("gone").every((h) => h.name !== "gone")).toBe(true);
      const map = await intel.map("gone");
      expect(map.text).not.toContain("gone()");
    } finally {
      cleanup(home, store);
    }
  });

  test("renamed file is treated as delete + add", async () => {
    const { intel, store, home, root } = await indexTree("ws-rename", {
      "src/old.ts": `export function renamed(): void {}\n`,
    });
    try {
      writeTree(root, { "src/new.ts": `export function renamed(): void {}\n` });
      unlinkSync(join(root, "src/old.ts"));
      await intel.index();
      expect(intel.search("old.ts").filter((h) => h.kind === "file")).toHaveLength(0);
      expect(intel.symbols("renamed")[0]!.file).toBe("src/new.ts");
    } finally {
      cleanup(home, store);
    }
  });
});
