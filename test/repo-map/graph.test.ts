import { describe, expect, test } from "bun:test";
import { cleanup, indexTree } from "./helpers.ts";

describe("Phase 11 — dependency / symbol graph", () => {
  test("internal import becomes an internal edge; package import is external", async () => {
    const { intel, store, home } = await indexTree("ws-graph", {
      "src/a.ts": `import { helper } from "./b.ts";\nimport { z } from "zod";\nexport function use(): void { helper(); }\n`,
      "src/b.ts": `export function helper(): number { return 1; }\n`,
    });
    try {
      const dep = intel.dependencies("src/a.ts");
      const internal = dep.outbound.filter((e) => e.kind === "internal");
      const external = dep.outbound.filter((e) => e.kind === "external");
      expect(internal.some((e) => e.toFile === "src/b.ts")).toBe(true);
      expect(external.some((e) => e.specifier === "zod")).toBe(true);
      expect(external.every((e) => e.toFile !== "src/b.ts")).toBe(true);

      const reverse = intel.dependencies("src/b.ts");
      expect(reverse.inbound.some((e) => e.fromFile === "src/a.ts")).toBe(true);

      const helper = intel.symbols("helper");
      expect(helper.length).toBeGreaterThan(0);
      expect(helper[0]!.file).toBe("src/b.ts");
    } finally {
      cleanup(home, store);
    }
  });
});
