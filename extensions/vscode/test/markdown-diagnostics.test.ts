import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineText, parseFileRef, parseInline, parseMarkdown, splitFileRefs, type Block, type Inline } from "../src/shared/markdown";
import { parseDiagnosticBlocks, validateDiagnostic } from "../src/chat/diagnostics";

test("markdown: fenced code keeps its language and body verbatim", () => {
  const blocks = parseMarkdown("Before\n\n```ts\nconst a = '<b>x</b>';\n```\n");
  const code = blocks.find((b): b is Extract<Block, { type: "code" }> => b.type === "code");
  assert.ok(code);
  assert.equal(code.lang, "ts");
  assert.equal(code.code, "const a = '<b>x</b>';");
  assert.equal(code.open, false);
});

test("markdown: an unclosed fence is marked open, so streaming text stays readable", () => {
  const blocks = parseMarkdown("```py\nprint(1)");
  const code = blocks[0];
  assert.equal(code.type, "code");
  assert.equal(code.type === "code" && code.open, true);
});

test("markdown: headings, bullet and numbered lists", () => {
  const blocks = parseMarkdown("## Plan\n\n- one\n- two\n\n1. first\n2. second");
  assert.equal(blocks[0].type, "heading");
  const lists = blocks.filter((b) => b.type === "list");
  assert.equal(lists.length, 2);
  assert.equal(lists[0].type === "list" && lists[0].ordered, false);
  assert.equal(lists[1].type === "list" && lists[1].ordered, true);
});

test("markdown: raw HTML in prose stays text and produces no element nodes", () => {
  const nodes = parseInline('<img src=x onerror="alert(1)"> and <script>x</script>');
  assert.ok(nodes.every((n) => n.type === "text" || n.type === "code" || n.type === "strong" || n.type === "em" || n.type === "link" || n.type === "fileref"));
  assert.equal(inlineText(nodes), '<img src=x onerror="alert(1)"> and <script>x</script>');
});

test("markdown: a link keeps only http(s) targets", () => {
  const nodes = parseInline("[ok](https://example.com) and [bad](javascript:alert(1))");
  const links = nodes.filter((n) => n.type === "link");
  assert.deepEqual(
    links.map((l) => (l.type === "link" ? l.href : "")),
    ["https://example.com"],
  );
});

test("file refs: path:line is recognized, host:port is not", () => {
  assert.deepEqual(parseFileRef("src/chat/controller.ts:42"), { path: "src/chat/controller.ts", line: 42 });
  assert.equal(parseFileRef("localhost:3141"), null);
  assert.equal(parseFileRef("README.md:0"), null);
  assert.deepEqual(parseFileRef("a.ts:1:9"), { path: "a.ts", line: 1 });
});

test("file refs inside prose become openable nodes", () => {
  const nodes: Inline[] = splitFileRefs("See src/a.ts:12 for the fix.");
  assert.deepEqual(nodes, [
    { type: "text", text: "See " },
    { type: "fileref", path: "src/a.ts", line: 12 },
    { type: "text", text: " for the fix." },
  ]);
});

test("diagnostics: only the xr-diagnostics block counts, prose never does", () => {
  const text = [
    "src/a.ts:3: error: this is only prose",
    "```xr-diagnostics",
    '[{"file":"src/a.ts","line":3,"severity":"error","message":"undefined name"}]',
    "```",
  ].join("\n");
  assert.deepEqual(parseDiagnosticBlocks(text), [
    { file: "src/a.ts", line: 3, severity: "error", message: "undefined name" },
  ]);
  assert.deepEqual(parseDiagnosticBlocks("src/a.ts:3: error: prose only"), []);
});

test("diagnostics: malformed entries are dropped one by one, not the whole block", () => {
  const text = [
    "```xr-diagnostics",
    JSON.stringify([
      { file: "a.ts", line: 1, severity: "warning", message: "ok" },
      { file: "a.ts", line: 0, severity: "warning", message: "line zero" },
      { file: "a.ts", line: 2.5, severity: "warning", message: "fraction" },
      { file: "a.ts", line: 2, severity: "critical", message: "bad severity" },
      { file: "a.ts", line: 2, severity: "info", message: "" },
      { file: "/etc/passwd", line: 1, severity: "error", message: "absolute" },
      { file: "C:\\x.ts", line: 1, severity: "error", message: "drive" },
      { file: "a/../../b.ts", line: 1, severity: "error", message: "escape" },
      { file: "a.ts", line: "3", severity: "error", message: "string line" },
    ]),
    "```",
  ].join("\n");
  const out = parseDiagnosticBlocks(text);
  assert.deepEqual(
    out.map((d) => d.message),
    ["ok"],
  );
});

test("diagnostics: messages are capped at 300 characters", () => {
  const d = validateDiagnostic({ file: "a.ts", line: 1, severity: "info", message: "x".repeat(900) });
  assert.equal(d?.message.length, 300);
});

test("diagnostics: a non-array block yields nothing", () => {
  assert.deepEqual(parseDiagnosticBlocks('```xr-diagnostics\n{"file":"a.ts"}\n```'), []);
  assert.deepEqual(parseDiagnosticBlocks('```xr-diagnostics\nnot json\n```'), []);
});
