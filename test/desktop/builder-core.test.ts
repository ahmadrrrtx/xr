/**
 * Phase 17 · Builder core (desktop/src/lib/builderCore.ts) — pure helpers,
 * tested from the repo root with relative imports only.
 */

import { describe, expect, test } from "bun:test";
import {
  ancestorsOf,
  buildTree,
  builderContextText,
  classifyConsoleLine,
  clampPane,
  defaultPaneWidth,
  detectIndent,
  excerptAround,
  fileIconFor,
  findFileLinks,
  flattenTree,
  formatReady,
  fuzzyMatch,
  languageFor,
  nextMru,
  parseDiffHunks,
  rankFiles,
  segmentAssistantMarkdown,
  selectedPatch,
  splitDiffFiles,
  tabTitles,
  touchMru,
} from "../../desktop/src/lib/builderCore";

describe("languages + icons", () => {
  test("extension and well-known names", () => {
    expect(languageFor("src/App.tsx").id).toBe("tsx");
    expect(languageFor("a/b/main.py").indent).toBe(4);
    expect(languageFor("Dockerfile").label).toBe("Dockerfile");
    expect(languageFor("README").id).toBe("plain");
    expect(fileIconFor("package.json").glyph).toBe("{}");
    expect(fileIconFor("src", true).glyph).toBe("▸");
    expect(fileIconFor("x.rs").color).toBe("#DEA584");
  });
  test("indent detection", () => {
    expect(detectIndent("a\n    b\n    c\n        d\n")).toEqual({ unit: "spaces", width: 4 });
    expect(detectIndent("a\n\tb\n\tc\n")).toEqual({ unit: "tabs", width: 4 });
    expect(detectIndent("no indent\n", 2)).toEqual({ unit: "spaces", width: 2 });
  });
});

describe("tree", () => {
  const entries = [
    { rel: "src", name: "src", type: "dir" as const, size: 0, mtimeMs: 0 },
    { rel: "src/b.ts", name: "b.ts", type: "file" as const, size: 1, mtimeMs: 0 },
    { rel: "src/a.ts", name: "a.ts", type: "file" as const, size: 1, mtimeMs: 0 },
    { rel: "zeta.md", name: "zeta.md", type: "file" as const, size: 1, mtimeMs: 0 },
    { rel: "node_modules", name: "node_modules", type: "dir" as const, size: 0, mtimeMs: 0, heavy: true as const },
  ];
  test("nests, folders first, sorted; flatten follows expansion", () => {
    const tree = buildTree(entries);
    expect(tree.map((n) => n.rel)).toEqual(["node_modules", "src", "zeta.md"]);
    expect(tree[1]?.children.map((n) => n.name)).toEqual(["a.ts", "b.ts"]);
    expect(flattenTree(tree, new Set()).map((n) => n.rel)).toEqual(["node_modules", "src", "zeta.md"]);
    expect(flattenTree(tree, new Set(["src"])).map((n) => n.rel)).toEqual(["node_modules", "src", "src/a.ts", "src/b.ts", "zeta.md"]);
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
  });
});

describe("fuzzy + tabs + panes", () => {
  test("ranks basename and boundary hits above scattered ones", () => {
    const ranked = rankFiles("app", ["src/components/Apple.tsx", "src/App.tsx", "docs/approach.md"]);
    expect(ranked[0]?.path).toBe("src/App.tsx");
    expect(fuzzyMatch("zzz", "src/App.tsx")).toBeNull();
    expect(fuzzyMatch("", "x")?.positions).toEqual([]);
    expect(fuzzyMatch("at", "src/App.tsx")?.positions).toEqual([4, 8]);
  });
  test("MRU order and Ctrl+Tab wrap", () => {
    const mru = touchMru(touchMru(["a", "b"], "c"), "a");
    expect(mru).toEqual(["a", "c", "b"]);
    expect(nextMru(mru, ["a", "b", "c"], "a")).toBe("c");
    expect(nextMru(mru, ["a", "b", "c"], "b")).toBe("a");
    expect(nextMru(mru, ["a", "b", "c"], "a", -1)).toBe("b");
    expect(nextMru([], [], null)).toBeNull();
  });
  test("duplicate tab names get a folder hint", () => {
    const t = tabTitles(["src/index.ts", "lib/index.ts", "README.md"]);
    expect(t.get("src/index.ts")).toEqual({ title: "index.ts", hint: "src" });
    expect(t.get("README.md")).toEqual({ title: "README.md", hint: null });
  });
  test("pane geometry", () => {
    expect(clampPane(10, 280, 480)).toBe(280);
    expect(clampPane(Number.NaN, 280, 480)).toBe(280);
    expect(defaultPaneWidth(1280, "chat")).toBe(358);
    expect(defaultPaneWidth(900, "preview")).toBe(320);
  });
});

describe("diffs in chat", () => {
  const md = [
    "Here is the change.",
    "",
    "**src/app.ts**",
    "```diff",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,3 +1,3 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " export {};",
    "@@ -10,2 +10,3 @@",
    " x",
    "+y",
    " z",
    "```",
    "",
    "And a new file:",
    "```diff",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1,2 @@",
    "+export const n = 1;",
    "+export const m = 2;",
    "```",
    "Done.",
  ].join("\n");

  test("segments text and per-file diff blocks with paths and hunks", () => {
    const segs = segmentAssistantMarkdown(md);
    expect(segs.map((s) => s.kind)).toEqual(["text", "diff", "text", "diff", "text"]);
    const first = segs[1];
    if (first?.kind !== "diff") throw new Error("expected diff");
    expect(first.block.path).toBe("src/app.ts");
    expect(first.block.hunks).toHaveLength(2);
    expect(first.block.hunks[0]?.removed).toBe(1);
    expect(first.block.hunks[1]?.added).toBe(1);
    const second = segs[3];
    if (second?.kind !== "diff") throw new Error("expected diff");
    expect(second.block.isNewFile).toBe(true);
    expect(second.block.path).toBe("src/new.ts");
  });

  test("path falls back to the line above the fence; untagged fences that look like diffs count", () => {
    const segs = segmentAssistantMarkdown("Edit `src/x.ts`:\n```\n@@ -1 +1 @@\n-a\n+b\n```");
    expect(segs[0]?.kind).toBe("text");
    const d = segs.find((s) => s.kind === "diff");
    if (d?.kind !== "diff") throw new Error("expected diff");
    expect(d.block.path).toBe("src/x.ts");
    expect(parseDiffHunks("@@ ... @@\n-a\n+b\n")[0]?.header).toBe("@@ -1,0 +1,0 @@");
  });

  test("multi-file git diffs split per file; selectedPatch keeps only chosen hunks", () => {
    const blocks = splitDiffFiles("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-1\n+2\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-3\n+4\n", null);
    expect(blocks.map((b) => b.path)).toEqual(["a.ts", "b.ts"]);
    const segs = segmentAssistantMarkdown(md);
    const first = segs[1];
    if (first?.kind !== "diff") throw new Error("expected diff");
    const patch = selectedPatch(first.block, new Set([1]));
    expect(patch).toContain("+++ b/src/app.ts");
    expect(patch).toContain("@@ -10,2 +10,3 @@");
    expect(patch).not.toContain("const b = 3;");
  });

  test("no diff → one text segment; plain code fences stay text", () => {
    const segs = segmentAssistantMarkdown("```ts\nconst a = 1;\n```");
    expect(segs).toEqual([{ kind: "text", text: "```ts\nconst a = 1;\n```" }]);
  });
});

describe("links, console, context", () => {
  test("file:line links only for known paths", () => {
    const known = new Set(["src/App.tsx", "src/main.ts"]);
    const links = findFileLinks("See src/App.tsx:24:7 and src/main.ts and src/nope.ts:3.", known);
    expect(links.map((l) => [l.path, l.line, l.col])).toEqual([
      ["src/App.tsx", 24, 7],
      ["src/main.ts", null, null],
    ]);
  });
  test("console classification + ready formatting", () => {
    expect(classifyConsoleLine("  ➜  Local:   http://localhost:5173/", "stdout")).toBe("info");
    expect(classifyConsoleLine("Error: Cannot find module 'x'", "stdout")).toBe("error");
    expect(classifyConsoleLine("(node) DeprecationWarning: punycode", "stderr")).toBe("warn");
    expect(classifyConsoleLine("hmm", "stderr")).toBe("warn");
    expect(classifyConsoleLine("plain", "stdout")).toBe("log");
    expect(formatReady(2300)).toBe("Ready in 2.3s");
    expect(formatReady(820)).toBe("Ready in 820ms");
  });
  test("context is bounded and excerpts around the cursor", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i + 1} ${"x".repeat(40)}`).join("\n");
    const text = builderContextText({
      projectName: "demo",
      root: "/tmp/demo",
      activePath: "src/big.ts",
      activeContent: big,
      cursorLine: 1000,
      selection: null,
      openFiles: ["src/big.ts", "README.md"],
      terminalTail: ["$ bun run dev", "ready"],
      git: { branch: "main", dirty: true, changed: ["src/big.ts"] },
      devServer: { state: "running", url: "http://localhost:5173/" },
    });
    expect(text.length).toBeLessThan(14_500);
    expect(text).toContain("UNIFIED DIFF");
    expect(text).toContain("1000  line 1000");
    expect(text).toContain("branch main");
    expect(text).toContain("Open files: src/big.ts (TypeScript), README.md (Markdown)");
    const ex = excerptAround("a\nb\nc", null, 1000);
    expect(ex.partial).toBe(false);
    expect(ex.text).toBe("   1  a\n   2  b\n   3  c");
  });
});
