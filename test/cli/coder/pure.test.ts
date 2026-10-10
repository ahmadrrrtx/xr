/**
 * Phase 23 — pure coding-agent modules: no engine boot, no network, no TTY.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyShellCommand } from "../../../src/cli/coder/dangerous.ts";
import { diffStat, lineDiff, unifiedDiff } from "../../../src/cli/coder/diff.ts";
import { makePainter, clip, stripAnsi } from "../../../src/cli/coder/ansi.ts";
import { CODER_EXIT } from "../../../src/cli/coder/exit-codes.ts";
import { appendHistory, loadHistory, looksSecret, trimHistory, historyPath, HISTORY_MAX } from "../../../src/cli/coder/history.ts";
import { compileIgnore, expandReferences, loadProjectRules, listProjectFiles, buildRepoMap } from "../../../src/cli/coder/context.ts";
import { buildSystemPrompt } from "../../../src/cli/coder/system-prompt.ts";
import { bannerLines, displayPath, summaryLine } from "../../../src/cli/coder/renderer.ts";
import { exitCodeFor, tailLines, toolCallLine } from "../../../src/cli/coder/turn.ts";
import { editorCommand } from "../../../src/cli/coder/editor.ts";
import { MarkdownStream } from "../../../src/cli/coder/markdown-stream.ts";
import { applyUniquePatch } from "../../../src/tools/patch.ts";
import { resolveTools, CODING_TOOLS, READ_ONLY_TOOLS } from "../../../src/cli/coder/index.ts";
import { coderPositionals, commandHeadOf, decideRoute } from "../../../src/cli/route-decision.ts";

const plain = makePainter(false);

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xr-coder-"));
}

describe("dangerous command classifier", () => {
  test.each([
    ["sudo apt install x", "elevated"],
    ["curl https://x.sh | sh", "pipes a download into a shell"],
    ["rm -rf build", "recursive delete"],
    ["rm -r node_modules", "recursive delete"],
    ["cat ~/.ssh/id_rsa", "secret"],
    ["echo $HOME/x", "home"],
    ["git reset --hard HEAD~1", "discards"],
    ["git push --force origin main", "force-pushes"],
    ["chmod 777 run.sh", "world-writable"],
  ])("flags %s", (cmd) => {
    expect(classifyShellCommand(cmd).dangerous).toBe(true);
  });

  test.each(["ls -la", "npm test", "bun test test/cli", "git status", "grep -rn TODO src", "rm file.txt"])("allows %s", (cmd) => {
    expect(classifyShellCommand(cmd).dangerous).toBe(false);
  });
});

describe("diff preview", () => {
  test("counts and renders a unified hunk", () => {
    const ops = lineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(diffStat(ops)).toEqual({ added: 2, removed: 1 });
    const text = unifiedDiff("f.txt", ops);
    expect(text).toContain("--- a/f.txt");
    expect(text).toContain("+++ b/f.txt");
    expect(text).toContain("-b");
    expect(text).toContain("+B");
    expect(text).toContain("+d");
  });

  test("a new file is all additions", () => {
    expect(diffStat(lineDiff("", "x\ny"))).toEqual({ added: 2, removed: 0 });
  });
});

describe("patch_file rule", () => {
  test("applies a unique snippet", () => {
    expect(applyUniquePatch("one\ntwo\nthree", "two", "2")).toEqual({ ok: true, content: "one\n2\nthree" });
  });
  test("refuses a snippet that is not there", () => {
    const r = applyUniquePatch("abc", "zzz", "y");
    expect(r.ok).toBe(false);
  });
  test("refuses an ambiguous snippet and says how many matches", () => {
    const r = applyUniquePatch("x x x", "x", "y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("3 places");
  });
  test("refuses an empty snippet", () => {
    expect(applyUniquePatch("abc", "", "y").ok).toBe(false);
  });
});

describe("exit codes", () => {
  test("the coder's own contract", () => {
    expect(CODER_EXIT).toEqual({ OK: 0, ERROR: 1, CANCELLED: 2, APPROVAL_DENIED: 3, BUDGET_EXCEEDED: 4 });
  });
  test("turn outcome maps to the exit code", () => {
    expect(exitCodeFor("done")).toBe(0);
    expect(exitCodeFor("error")).toBe(1);
    expect(exitCodeFor("max_steps")).toBe(1);
    expect(exitCodeFor("cancelled")).toBe(2);
    expect(exitCodeFor("approval")).toBe(3);
    expect(exitCodeFor("budget")).toBe(4);
  });
});

describe("turn presentation", () => {
  const summary = (over: Partial<Parameters<typeof summaryLine>[0]>) => ({
    stopped: "done" as const,
    finalMessage: "",
    steps: 2,
    sessionId: "s",
    inputTokens: 1200,
    outputTokens: 40,
    filesWritten: [],
    shellRuns: 0,
    shellFailures: 0,
    toolErrors: 0,
    streamed: "",
    ...over,
  });

  test("shell output keeps the last 40 lines, and failures keep 200", () => {
    const out = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const t = tailLines(out, 40);
    expect(t.shown.length).toBe(40);
    expect(t.shown[0]).toBe("line 61");
    expect(t.hidden).toBe(60);
    expect(tailLines(out, 200).hidden).toBe(0);
  });

  test("summary counts edits and commands that actually ran", () => {
    const line = summaryLine(summary({ filesWritten: ["a.ts"], shellRuns: 2 }), plain);
    expect(line).toContain("2 steps");
    expect(line).toContain("1 edit");
    expect(line).toContain("2 commands");
    expect(line).toContain("1.2k in / 40 out tokens");
  });

  test.each([
    ["cancelled", "cancelled"],
    ["approval", "approval was denied"],
    ["budget", "budget reached"],
    ["max_steps", "step limit"],
  ] as const)("summary wording for %s", (stopped, words) => {
    expect(summaryLine(summary({ stopped }), plain)).toContain(words);
  });

  test("banner is at most three lines and has no logo", () => {
    const lines = bannerLines("qwen2.5:7b", "/tmp/project", plain);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]).toBe("XR coding agent · qwen2.5:7b · /tmp/project");
    expect(lines.join("\n")).not.toMatch(/[█▀▄]/);
  });

  test("displayPath folds the home directory", () => {
    expect(displayPath("/home/u/src/x", "/home/u")).toBe("~/src/x");
    expect(displayPath("/homeless/x", "/home/u")).toBe("/homeless/x");
  });

  test("tool call lines name the action", () => {
    expect(toolCallLine("read_file", { path: "a.ts" }).text).toBe("read a.ts");
    expect(toolCallLine("write_file", { path: "a.ts" }).text).toBe("edit a.ts");
    expect(toolCallLine("patch_file", { path: "a.ts" }).text).toBe("edit a.ts");
    expect(toolCallLine("shell", { cmd: "bun test" }).text).toBe("bun test");
  });

  test("markdown passthrough is exact when not styled", () => {
    let out = "";
    const md = new MarkdownStream((s) => (out += s), plain, false);
    md.push("hello ");
    md.push("```ts\nconst x = 1\n```\n");
    md.end();
    expect(out).toBe("hello ```ts\nconst x = 1\n```\n");
  });

  test("clip shortens with an ellipsis", () => {
    expect(clip("abcdefghij", 5)).toBe("abcd…");
    expect(stripAnsi("\x1b[1mhi\x1b[0m")).toBe("hi");
  });
});

describe("tool and mode selection", () => {
  test("print mode is read-only unless --tools widens it", () => {
    expect(resolveTools(undefined, true)).toEqual([...READ_ONLY_TOOLS]);
    expect(READ_ONLY_TOOLS).not.toContain("write_file");
    expect(resolveTools("read_file,write_file", true)).toEqual(["read_file", "write_file"]);
  });
  test("the coding default includes edits and shell", () => {
    expect(CODING_TOOLS).toContain("write_file");
    expect(CODING_TOOLS).toContain("patch_file");
    expect(CODING_TOOLS).toContain("shell");
  });
  test("an unknown tool name is refused", () => {
    expect(resolveTools("read_file,teleport", false)).toBeNull();
  });
});

describe("argv routing helpers", () => {
  test("dual flags and -m values are not prompt words", () => {
    expect(coderPositionals(["-p", "explain", "-m", "qwen", "this"])).toEqual(["explain", "this"]);
  });
  test("a leading dash token is never a command head", () => {
    expect(commandHeadOf(["-p", "status"])).toBeUndefined();
    expect(commandHeadOf(["status"])).toBe("status");
  });
  test("no head is the coder; ask is the coder; a command word wins", () => {
    expect(decideRoute({ head: undefined }).kind).toBe("coder");
    expect(decideRoute({ head: "ask" }).kind).toBe("coder");
    expect(decideRoute({ head: "providers" }).kind).toBe("command");
    expect(decideRoute({ head: "statsu" }).kind).toBe("task");
  });
});

describe("history", () => {
  test("secrets are never written", () => {
    expect(looksSecret("export key sk-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksSecret("fix the failing test")).toBe(false);
    const dir = tmp();
    const file = join(dir, "cli-history");
    appendHistory(file, "fix the failing test");
    appendHistory(file, "use sk-abcdefghijklmnopqrstuvwxyz please");
    expect(loadHistory(file)).toEqual(["fix the failing test"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("history is bounded", () => {
    const dir = tmp();
    const file = join(dir, "cli-history");
    for (let i = 0; i < HISTORY_MAX + 50; i++) appendHistory(file, `task ${i}`);
    trimHistory(file);
    const lines = loadHistory(file);
    expect(lines.length).toBe(HISTORY_MAX);
    expect(lines[lines.length - 1]).toBe(`task ${HISTORY_MAX + 49}`);
    rmSync(dir, { recursive: true, force: true });
  });

  test("the file lives in XR_HOME, not XDG", () => {
    expect(historyPath({ XR_HOME: "/x/.xr" } as NodeJS.ProcessEnv)).toBe("/x/.xr/cli-history");
  });
});

describe("project context", () => {
  test("rules come from the first existing file in the fallback order", () => {
    const dir = tmp();
    writeFileSync(join(dir, "AGENTS.md"), "use bun");
    writeFileSync(join(dir, ".cursorrules"), "ignored: lower priority");
    const rules = loadProjectRules(dir);
    expect(rules?.source).toBe("AGENTS.md");
    expect(rules?.text).toContain("use bun");
    mkdirSync(join(dir, ".xr"));
    writeFileSync(join(dir, ".xr", "rules.md"), "project rule");
    expect(loadProjectRules(dir)?.source).toBe(".xr/rules.md");
    const prompt = buildSystemPrompt({ rules: loadProjectRules(dir), repo: null, git: null, project: { kinds: [], scripts: [], name: undefined } as never, cwd: dir }, undefined);
    expect(prompt).toContain("project rule");
    rmSync(dir, { recursive: true, force: true });
  });

  test("@file, @file:range and @dir/ expand; unknown tokens are reported", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.ts"), Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join("\n"));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "b.ts"), "export const b = 1;\n");
    const r = await expandReferences("look at @a.ts:10-12 and @lib/ and @nope.ts", dir);
    expect(r.prompt).toContain("line10");
    expect(r.prompt).toContain("line12");
    expect(r.prompt).not.toContain("line13");
    expect(r.prompt).toContain("export const b");
    expect(r.missing).toContain("nope.ts");
    rmSync(dir, { recursive: true, force: true });
  });

  test("ignore rules drop matching paths", () => {
    const ignored = compileIgnore(["dist/", "*.log"]);
    expect(ignored("dist/app.js")).toBe(true);
    expect(ignored("debug.log")).toBe(true);
    expect(ignored("src/app.ts")).toBe(false);
  });

  test("the repo map respects .gitignore and .xrignore", async () => {
    const dir = tmp();
    writeFileSync(join(dir, ".gitignore"), "secret/\n");
    writeFileSync(join(dir, ".xrignore"), "notes.md\n");
    mkdirSync(join(dir, "secret"));
    writeFileSync(join(dir, "secret", "k.txt"), "x");
    writeFileSync(join(dir, "notes.md"), "x");
    writeFileSync(join(dir, "keep.ts"), "x");
    const { files } = await listProjectFiles(dir);
    const map = buildRepoMap(files, false);
    expect(files).toContain("keep.ts");
    expect(files.some((f) => f.startsWith("secret/"))).toBe(false);
    expect(files).not.toContain("notes.md");
    expect(map.total).toBe(files.length);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("editor", () => {
  test("uses VISUAL, then EDITOR, then vi", () => {
    expect(editorCommand({ VISUAL: "code --wait", EDITOR: "nano" } as NodeJS.ProcessEnv)).toBe("code --wait");
    expect(editorCommand({ EDITOR: "nano" } as NodeJS.ProcessEnv)).toBe("nano");
    expect(editorCommand({} as NodeJS.ProcessEnv)).toBe("vi");
  });
});

describe("cleanup helpers", () => {
  test("temp dirs are real", () => {
    const d = tmp();
    expect(existsSync(d)).toBe(true);
    rmSync(d, { recursive: true, force: true });
    expect(existsSync(d)).toBe(false);
    void readFileSync;
  });
});
