import { describe, expect, test } from "bun:test";
import { cleanup, indexTree } from "./helpers.ts";

describe("Phase 11 — ranking", () => {
  test("exact symbol match ranks above a generic high-degree file", async () => {
    const files: Record<string, string> = {
      "src/core/types.ts": `
export type Id = string;
export interface Node { id: Id }
`,
      "src/auth/middleware.ts": `
export function authenticate(token: string): boolean { return token.length > 0; }
export function bearer(header: string): string { return header; }
`,
      "src/auth/routes.ts": `
import { authenticate } from "./middleware.ts";
export function authRoutes(): void { authenticate("x"); }
`,
    };
    // Many files import types.ts so it is high-degree.
    for (let i = 0; i < 8; i++) {
      files[`src/mod${i}.ts`] = `import type { Id } from "./core/types.ts";\nexport const n${i}: Id = "${i}";\n`;
    }
    const { intel, store, home } = await indexTree("ws-rank", files);
    try {
      const ranked = intel.rank("Fix authentication in the daemon API authenticate bearer");
      const top = ranked.slice(0, 4).map((r) => r.relativePath);
      expect(top.some((p) => p.includes("auth/"))).toBe(true);
      const auth = ranked.find((r) => r.relativePath === "src/auth/middleware.ts")!;
      const types = ranked.find((r) => r.relativePath === "src/core/types.ts")!;
      expect(auth.score).toBeGreaterThan(types.score);
      expect(auth.signals.symbol).toBeGreaterThan(0);
    } finally {
      cleanup(home, store);
    }
  });

  test("task keyword relevance and dependency expansion", async () => {
    const { intel, store, home } = await indexTree("ws-rank2", {
      "src/providers/gateway.ts": `export function selectProvider(): string { return "x"; }\n`,
      "src/providers/openai-compat.ts": `import { selectProvider } from "./gateway.ts";\nexport function chat(): string { return selectProvider(); }\n`,
      "src/unrelated/ui.ts": `export function renderButton(): void {}\n`,
    });
    try {
      const ranked = intel.rank("Fix the provider fallback logic");
      expect(ranked[0]!.relativePath.startsWith("src/providers/")).toBe(true);
      expect(ranked.find((r) => r.relativePath === "src/unrelated/ui.ts")!.score)
        .toBeLessThan(ranked.find((r) => r.relativePath === "src/providers/gateway.ts")!.score);
    } finally {
      cleanup(home, store);
    }
  });
});
