/**
 * XR coding CLI — routing, exit codes, JSONL events, and the search tool.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideRoute } from "../../../src/cli/route-decision.ts";
import { parseGlobalFlags, EXIT } from "../../../src/cli/flags.ts";
import { exitCodeFor, describeStop } from "../../../src/cli/coder/index.ts";
import { JsonUI } from "../../../src/cli/coder/ui.ts";
import { searchCodeTool } from "../../../src/tools/search.ts";
import type { AgentResult } from "../../../src/core/agent.ts";
import type { ToolContext } from "../../../src/core/types.ts";

const result = (over: Partial<AgentResult>): AgentResult => ({
  sessionId: "s",
  finalMessage: "",
  steps: 1,
  stopped: "done",
  ...over,
});

describe("routing", () => {
  test("bare xr goes to the coding agent (not the Shell)", () => {
    expect(decideRoute({ head: undefined }).kind).toBe("coder");
  });

  test("a free-form task goes to the coding agent", () => {
    expect(decideRoute({ head: "fix" }).kind).toBe("task");
  });

  test("xr shell and --tui keep the full-screen Shell", () => {
    expect(decideRoute({ head: "shell" }).kind).toBe("shell");
    expect(decideRoute({ head: "--tui" }).kind).toBe("shell");
  });

  test("--help and --version never enter the coder", () => {
    expect(decideRoute({ head: undefined, flagsHelp: true }).kind).toBe("help");
    expect(decideRoute({ head: undefined, flagsVersion: true }).kind).toBe("version");
    expect(decideRoute({ head: "--version" }).kind).toBe("version");
  });

  test("existing commands keep their meaning", () => {
    expect(decideRoute({ head: "run" }).kind).toBe("command");
    expect(decideRoute({ head: "ask" }).kind).toBe("command");
    expect(decideRoute({ head: "serve" }).kind).toBe("serve");
  });
});

describe("flags for the coding agent", () => {
  test("-p with a value is the print prompt", () => {
    const f = parseGlobalFlags(["-p", "explain the router"]);
    expect(f.print).toBe("explain the router");
    expect(f.args).toEqual([]);
  });

  test("-p with no value means the prompt comes from stdin", () => {
    expect(parseGlobalFlags(["-p"]).print).toBe("");
    expect(parseGlobalFlags(["-p", "--json"]).print).toBe("");
  });

  test("-a, -d, --no-history, --tools, --cwd, -m, --config are parsed", () => {
    const f = parseGlobalFlags(["-a", "-d", "--no-history", "--tools", "read", "--cwd", "/tmp", "-m", "gpt", "--config", "/x.json", "task"]);
    expect(f.approveAll).toBe(true);
    expect(f.diffOnly).toBe(true);
    expect(f.noHistory).toBe(true);
    expect(f.tools).toBe("read");
    expect(f.cwd).toBe("/tmp");
    expect(f.model).toBe("gpt");
    expect(f.configPath).toBe("/x.json");
    expect(f.args).toEqual(["task"]);
  });
});

describe("exit codes", () => {
  test("done is 0", () => {
    expect(exitCodeFor(result({ stopped: "done" }), 0)).toBe(EXIT.OK);
  });

  test("a refused approval is 4 (denied)", () => {
    expect(exitCodeFor(result({ stopped: "approval" }), 0)).toBe(EXIT.DENIED);
    expect(exitCodeFor(result({ stopped: "done" }), 2)).toBe(EXIT.DENIED);
  });

  test("cancel maps to 130", () => {
    expect(exitCodeFor(result({ stopped: "cancelled" }), 0)).toBe(EXIT.INTERRUPT);
  });

  test("a provider that cannot be reached is 3 (network)", () => {
    expect(exitCodeFor(result({ stopped: "error", finalMessage: "Provider ollama error: Unable to connect" }), 0)).toBe(
      EXIT.NETWORK,
    );
  });

  test("other failures are 1", () => {
    expect(exitCodeFor(result({ stopped: "error", finalMessage: "model returned garbage" }), 0)).toBe(EXIT.ERROR);
    expect(exitCodeFor(result({ stopped: "max_steps" }), 0)).toBe(EXIT.ERROR);
  });

  test("budget and max-steps stops explain themselves", () => {
    expect(describeStop(result({ stopped: "budget" }))).toContain("budget");
    expect(describeStop(result({ stopped: "max_steps" }))).toContain("step limit");
  });
});

describe("JSONL events", () => {
  function capture(): { ui: JsonUI; lines: () => Array<Record<string, unknown>> } {
    const out: string[] = [];
    const ui = new JsonUI((l) => out.push(l));
    return { ui, lines: () => out.map((l) => JSON.parse(l) as Record<string, unknown>) };
  }

  test("every line is valid JSON with a type", () => {
    const { ui, lines } = capture();
    ui.banner(["xr test", "cwd /x"]);
    ui.token("hi");
    ui.notice("careful", "warn");
    ui.finish();
    for (const e of lines()) expect(typeof e.type).toBe("string");
  });

  test("summary is the last event, even after a notice", () => {
    const { ui, lines } = capture();
    ui.summary({ stopped: "error", steps: 0, filesChanged: [], commands: [], denied: 0, autoDenied: 0, meter: "0 tok" });
    ui.notice("Rate limited by provider groq", "error");
    ui.finish();
    const events = lines();
    expect(events.at(-1)?.type).toBe("summary");
    expect(events.at(-1)?.stopped).toBe("error");
    expect(events.at(-2)?.type).toBe("notice");
  });

  test("the summary is emitted exactly once", () => {
    const { ui, lines } = capture();
    ui.summary({ stopped: "done", steps: 1, filesChanged: ["a.ts"], commands: [], denied: 0, autoDenied: 0 });
    ui.finish();
    ui.finish();
    expect(lines().filter((e) => e.type === "summary")).toHaveLength(1);
    expect(lines()[0]?.files_changed).toEqual(["a.ts"]);
  });

  test("JSON events carry no pictographs", () => {
    const { ui, lines } = capture();
    ui.summary({ stopped: "done", steps: 1, filesChanged: [], commands: [], denied: 0, autoDenied: 0, meter: "5.1k tok" });
    ui.finish();
    expect(JSON.stringify(lines())).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("search_code tool", () => {
  const ctxFor = (cwd: string): ToolContext =>
    ({
      cwd,
      audit: () => {},
    }) as unknown as ToolContext;

  test("finds matches in the workspace and reports line numbers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-search-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "const x = 1;\nexport function findMe() {}\n");
    const r = await searchCodeTool.run({ pattern: "findMe" }, ctxFor(dir));
    expect(r.ok).toBe(true);
    expect(String(r.output)).toContain("findMe");
    expect(String(r.output)).toContain(":2:");
  });

  test("refuses to search outside the working directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-search-"));
    const r = await searchCodeTool.run({ pattern: "x", path: "../../" }, ctxFor(dir));
    expect(r.ok).toBe(false);
  });

  test("needs no approval (read-only)", () => {
    expect(searchCodeTool.requiresApproval).toBe(false);
  });
});
