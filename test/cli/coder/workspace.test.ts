/**
 * XR coding CLI — @mentions, project rules, ignore handling, config precedence,
 * and the diff preview. Each test works on a real temp directory.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMentions, resolveMentions, MAX_FILE_BYTES, MAX_FOLDER_FILES } from "../../../src/cli/coder/mentions.ts";
import { compileIgnore, listProjectFiles, loadProjectRules } from "../../../src/cli/coder/context.ts";
import { cliConfigPath, loadCliConfig, resolveSettings, saveCliConfig, writePrivate } from "../../../src/cli/coder/config.ts";
import { diffStats, unifiedDiff } from "../../../src/cli/coder/diff.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-coder-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(rel: string, body: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

describe("@mentions parsing", () => {
  test("file, folder, and ranged references", () => {
    const m = parseMentions("explain @src/a.ts and @src/ then @src/b.ts:10-40 ok");
    expect(m.map((x) => x.kind)).toEqual(["file", "folder", "file"]);
    expect(m[2]!.range).toEqual([10, 40]);
  });

  test("a single line range", () => {
    const m = parseMentions("see @x.ts:7");
    expect(m[0]!.range).toEqual([7, 7]);
  });

  test("email addresses are not mentions", () => {
    expect(parseMentions("mail me at dev@example.com")).toEqual([]);
  });

  test("trailing sentence punctuation is not part of the path", () => {
    const m = parseMentions("read @src/a.ts.");
    expect(m[0]!.path).toBe("src/a.ts");
  });
});

describe("@mentions resolution", () => {
  test("attaches a file's contents", () => {
    put("src/a.ts", "export const a = 1;\n");
    const r = resolveMentions(dir, "look at @src/a.ts");
    expect(r.attachments.map((a) => a.label)).toEqual(["src/a.ts"]);
    expect(r.attachments[0]!.content).toContain("export const a");
  });

  test("a line range reads only that slice", () => {
    put("f.txt", ["one", "two", "three", "four"].join("\n"));
    const r = resolveMentions(dir, "@f.txt:2-3");
    expect(r.attachments[0]!.content).toBe("two\nthree");
    expect(r.attachments[0]!.label).toBe("f.txt:2-3");
  });

  test("a ranged mention is allowed past the whole-file cap", () => {
    put("big.txt", "x".repeat(MAX_FILE_BYTES + 10) + "\nlast line\n");
    const whole = resolveMentions(dir, "@big.txt");
    expect(whole.attachments).toHaveLength(0);
    expect(whole.notes.join(" ")).toContain("larger than");
    const ranged = resolveMentions(dir, "@big.txt:2-2");
    expect(ranged.attachments[0]!.content).toBe("last line");
  });

  test("paths outside the working directory are refused", () => {
    const r = resolveMentions(dir, "@../../etc/passwd");
    expect(r.attachments).toHaveLength(0);
    expect(r.notes.join(" ")).toContain("outside the working directory");
  });

  test("secret-looking files never reach the model", () => {
    put(".env", "API_KEY=sk-test-123\n");
    put("id_rsa", "PRIVATE\n");
    const r = resolveMentions(dir, "@.env and @id_rsa");
    expect(r.attachments).toHaveLength(0);
    expect(r.notes.join(" ")).toContain("secret");
  });

  test("a folder mention is capped in file count", () => {
    for (let i = 0; i < MAX_FOLDER_FILES + 5; i++) put(`many/f${String(i).padStart(3, "0")}.txt`, "x\n");
    const r = resolveMentions(dir, "@many/");
    expect(r.attachments).toHaveLength(MAX_FOLDER_FILES);
  });

  test("an unknown path becomes a note, not an error", () => {
    const r = resolveMentions(dir, "@nope.ts");
    expect(r.attachments).toHaveLength(0);
    expect(r.notes[0]).toContain("no such path");
  });
});

describe("project rules fallback order", () => {
  test(".xr/rules.md wins over AGENTS.md and CLAUDE.md", () => {
    put(".xr/rules.md", "xr rules");
    put("AGENTS.md", "agents");
    put("CLAUDE.md", "claude");
    expect(loadProjectRules(dir)?.source).toBe(".xr/rules.md");
  });

  test("AGENTS.md is the fallback when no .xr rules exist", () => {
    put("AGENTS.md", "agents");
    put("CLAUDE.md", "claude");
    expect(loadProjectRules(dir)?.source).toBe("AGENTS.md");
  });

  test("CLAUDE.md and .cursorrules are the last fallbacks", () => {
    put("CLAUDE.md", "claude");
    expect(loadProjectRules(dir)?.source).toBe("CLAUDE.md");
    put(".cursorrules", "cursor");
    expect(loadProjectRules(dir)?.source).toBe(".cursorrules");
  });

  test("no rules file returns null", () => {
    expect(loadProjectRules(dir)).toBeNull();
  });
});

describe("repo map respects ignore files", () => {
  test("compileIgnore understands directory and glob patterns", () => {
    const re = compileIgnore(["dist/", "*.log", "# comment", ""]);
    expect(re.some((r) => r.test("dist/app.js"))).toBe(true);
    expect(re.some((r) => r.test("logs/run.log"))).toBe(true);
    expect(re.some((r) => r.test("src/app.ts"))).toBe(false);
  });

  test(".gitignore and .xrignore are both honored (no git repo)", () => {
    put(".gitignore", "secret/\n");
    put(".xrignore", "*.snap\n");
    put("secret/key.txt", "k");
    put("src/app.ts", "a");
    put("src/app.snap", "s");
    const files = listProjectFiles(dir);
    expect(files).toContain("src/app.ts");
    expect(files.some((f) => f.startsWith("secret/"))).toBe(false);
    expect(files.some((f) => f.endsWith(".snap"))).toBe(false);
  });
});

describe("cli.json config and precedence", () => {
  test("flags beat env beats config", () => {
    const cfg = { provider: "groq", model: "openai/gpt-oss-20b" };
    const prev = { p: process.env.XR_PROVIDER, m: process.env.XR_MODEL };
    try {
      process.env.XR_PROVIDER = "ollama";
      process.env.XR_MODEL = "qwen2.5:7b";
      expect(resolveSettings({ provider: "anthropic", model: "x" }, cfg).provider).toBe("anthropic");
      expect(resolveSettings({}, cfg).provider).toBe("ollama");
      delete process.env.XR_PROVIDER;
      delete process.env.XR_MODEL;
      expect(resolveSettings({}, cfg)).toMatchObject({ provider: "groq", model: "openai/gpt-oss-20b" });
    } finally {
      if (prev.p === undefined) delete process.env.XR_PROVIDER;
      else process.env.XR_PROVIDER = prev.p;
      if (prev.m === undefined) delete process.env.XR_MODEL;
      else process.env.XR_MODEL = prev.m;
    }
  });

  test("the config file round-trips permissions and ignores unknown keys", () => {
    const path = join(dir, "cli.json");
    writeFileSync(
      path,
      JSON.stringify({ provider: "groq", model: "openai/gpt-oss-20b", unknownKey: 1, permissions: { allow: ["shell:npm test*"], deny: ["shell:sudo*"] } }),
    );
    const cfg = loadCliConfig(path);
    expect(cfg.provider).toBe("groq");
    expect(cfg.permissions?.allow).toEqual(["shell:npm test*"]);
    expect(cfg.permissions?.deny).toEqual(["shell:sudo*"]);
    expect(cfg.permissions?.ask).toEqual([]);
  });

  test("an unreadable config file is an error that names the file", () => {
    const path = join(dir, "cli.json");
    writeFileSync(path, "{ not json");
    expect(() => loadCliConfig(path)).toThrow(path);
  });

  // Windows does not enforce POSIX mode bits (a file is 0666 there whatever
  // mode is asked for), so the 0600 assertions run on POSIX only.
  test.skipIf(process.platform === "win32")("saving writes owner-only permissions", () => {
    const path = join(dir, "sub", "cli.json");
    saveCliConfig(path, { provider: "groq" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).provider).toBe("groq");
  });

  test.skipIf(process.platform === "win32")("writePrivate creates parent folders and sets 0600", () => {
    const path = join(dir, "a", "b", "f.json");
    writePrivate(path, "{}");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("XR_CLI_CONFIG and --config override the default location", () => {
    expect(cliConfigPath("/tmp/custom.json")).toBe("/tmp/custom.json");
    const prev = process.env.XR_CLI_CONFIG;
    try {
      process.env.XR_CLI_CONFIG = "/tmp/env.json";
      expect(cliConfigPath()).toBe("/tmp/env.json");
    } finally {
      if (prev === undefined) delete process.env.XR_CLI_CONFIG;
      else process.env.XR_CLI_CONFIG = prev;
    }
  });
});

describe("diff preview", () => {
  test("unified diff reports the real additions and removals", () => {
    const d = unifiedDiff("a\nb\nc\n", "a\nB\nc\nd\n", "f.txt");
    expect(d).toContain("--- a/f.txt");
    expect(d).toContain("+++ b/f.txt");
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
  });

  test("identical text produces no diff", () => {
    expect(unifiedDiff("same\n", "same\n", "f.txt")).toBe("");
  });

  test("a new file diffs as all additions", () => {
    expect(diffStats(unifiedDiff("", "x\ny\n", "new.txt"))).toEqual({ added: 2, removed: 0 });
  });
});
