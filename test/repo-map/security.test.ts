import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, indexTree, tempDir, writeTree, openStore } from "./helpers.ts";
import { createRepoIntelligence } from "../../src/repo/index.ts";
import { loadIgnore } from "../../src/repo/ignore.ts";
import { scopedStat } from "../../src/repo/scope.ts";

describe("Phase 11 — security", () => {
  test("secret files are not indexed", async () => {
    const { intel, store, home } = await indexTree("ws-sec", {
      "src/app.ts": `export function boot(): void {}\n`,
      ".env": `OPENAI_API_KEY=sk-secret\n`,
      ".env.local": `TOKEN=abc\n`,
      "id_rsa": `-----BEGIN PRIVATE KEY-----\nxxx\n`,
      "credentials.json": `{"password":"x"}\n`,
    });
    try {
      const files = intel.rank("").map((f) => f.relativePath);
      expect(files).not.toContain(".env");
      expect(files).not.toContain(".env.local");
      expect(files).not.toContain("id_rsa");
      expect(files).not.toContain("credentials.json");
      const map = await intel.map("secret token key");
      expect(map.text).not.toContain("sk-secret");
      expect(map.text).not.toContain("OPENAI_API_KEY");
    } finally {
      cleanup(home, store);
    }
  });

  test("symlinks that escape the workspace are not followed", () => {
    const root = tempDir("xr-link");
    const outside = tempDir("xr-outside");
    writeFileSync(join(outside, "secret.ts"), `export const LEAK = 1;\n`);
    mkdirSync(join(root, "src"), { recursive: true });
    try {
      symlinkSync(outside, join(root, "src", "escape"));
    } catch {
      // some FS may refuse; still assert scopedStat
    }
    const st = scopedStat(root, join(root, "src", "escape"));
    if (st) {
      expect(st.relativePath.startsWith("..")).toBe(false);
    }
    // A direct path outside must be rejected.
    expect(scopedStat(root, join(outside, "secret.ts"))).toBeNull();
    cleanup(root);
    cleanup(outside);
  });

  test("default ignore skips node_modules and .git", () => {
    const root = tempDir("xr-ign");
    writeTree(root, {
      ".gitignore": "tmp/\n",
      "src/a.ts": "export const a = 1;\n",
    });
    const ign = loadIgnore(root);
    expect(ign.skipDir("node_modules", "node_modules")).toBe(true);
    expect(ign.skipDir(".git", ".git")).toBe(true);
    expect(ign.skipDir("dist", "dist")).toBe(true);
    cleanup(root);
  });
});
