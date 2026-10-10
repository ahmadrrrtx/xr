/**
 * Phase 23 — the `xr` coding agent, end to end: the real entry point (src/index.ts)
 * in a child process, a scripted OpenAI-compatible provider (test/cli/support), a
 * temporary XR home and a temporary project. No real model, no network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startMockOpenAI, type MockServer } from "../support/mock-openai.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const ENTRY = join(ROOT, "src/index.ts");
const BUN = process.execPath;

let mock: MockServer;
let home: string;
let proj: string;

beforeAll(() => {
  mock = startMockOpenAI();
  home = mkdtempSync(join(tmpdir(), "xr-e2e-home-"));
  proj = mkdtempSync(join(tmpdir(), "xr-e2e-proj-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify(
      {
        defaults: { provider: "mock", model: "mock-1" },
        providerEngine: {
          customProviders: [
            {
              id: "mock",
              label: "Mock",
              baseUrl: mock.url,
              defaultModel: "mock-1",
              capabilities: { chat: true, streaming: true, toolUse: true, functionCalling: true },
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  // The wizard has run before (tests are never interactive).
  writeFileSync(join(home, "coder-setup.json"), JSON.stringify({ onboardedAt: "test" }));
  writeFileSync(join(proj, "README.md"), "# hello project\n");
});

afterAll(() => {
  mock.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
});

type Run = { code: number; stdout: string; stderr: string; ms: number };

async function xr(args: string[], opts: { stdin?: string; cwd?: string; env?: Record<string, string>; command?: string[] } = {}): Promise<Run> {
  const started = Date.now();
  const base = opts.command ?? [BUN, ENTRY];
  const proc = Bun.spawn([...base, ...args], {
    cwd: opts.cwd ?? proj,
    env: {
      ...process.env,
      XR_HOME: home,
      XR_TELEMETRY: "0",
      ...(opts.env ?? {}),
    } as Record<string, string>,
    stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const killer = setTimeout(() => proc.kill(), 90_000);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(killer);
  return { code, stdout, stderr, ms: Date.now() - started };
}

/** Clean the project between tests that write files. */
function cleanProject(): void {
  for (const f of ["out.txt", "rules-check.txt"]) {
    const p = join(proj, f);
    if (existsSync(p)) rmSync(p);
  }
}

describe("print mode (-p)", () => {
  test("the answer is the only thing on stdout; exit 0", async () => {
    const r = await xr(["-p", "hello there"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("mock reply: hello there");
    expect(r.stderr).not.toContain("✓");
  }, 90_000);

  test("-p never runs a command word: `-p status` is a prompt", async () => {
    const r = await xr(["-p", "status"]);
    expect(r.stdout).toContain("mock reply: status");
    expect(r.stdout).not.toContain("Provider Status");
  }, 90_000);

  test("a command word still wins: `providers` runs the providers command", async () => {
    const r = await xr(["providers"]);
    expect(r.stdout).toContain("Provider Status");
  }, 90_000);

  test("@file references are attached to the prompt", async () => {
    mock.requests.length = 0;
    const r = await xr(["-p", "what is in @README.md"]);
    expect(r.code).toBe(0);
    const sent = JSON.stringify(mock.requests[0]?.messages ?? []);
    expect(sent).toContain("# hello project");
  }, 90_000);

  test("project rules from .xr/rules.md reach the system prompt", async () => {
    mkdirSync(join(proj, ".xr"), { recursive: true });
    writeFileSync(join(proj, ".xr", "rules.md"), "Always answer in haiku form.\n");
    mock.requests.length = 0;
    try {
      const r = await xr(["-p", "hi"]);
      expect(r.code).toBe(0);
      // The engine sends its own base prompt first; the coder's prompt is another system message.
      const systems = (mock.requests[0]?.messages ?? []).filter((m: { role: string }) => m.role === "system");
      expect(systems.some((m: { content: string }) => String(m.content).includes("Always answer in haiku form."))).toBe(true);
    } finally {
      rmSync(join(proj, ".xr"), { recursive: true, force: true });
    }
  }, 90_000);

  test("piped stdin is attached to the task", async () => {
    const r = await xr(["-p", "summarize this"], { stdin: "piped body text" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("piped body text");
  }, 90_000);

  test("an unreachable provider is an error, exit 1, with the reason on stderr", async () => {
    const r = await xr(["-p", "[[fail]]"]);
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/error|failed|stopped/i);
  }, 90_000);
});

describe("one-shot approvals", () => {
  test("without a terminal, an edit is denied and nothing is written", async () => {
    cleanProject();
    const r = await xr(["[[write path=out.txt content=hi]]"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(proj, "out.txt"))).toBe(false);
    expect(r.stderr).toContain("denied");
    expect(r.stdout).toContain("edit out.txt");
  }, 90_000);

  test("--diff proposes the change as a diff and writes nothing", async () => {
    cleanProject();
    const r = await xr(["-d", "[[write path=out.txt content=hi]]"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("+++ b/out.txt");
    expect(r.stdout).toContain("+hi");
    expect(r.stdout).toContain("out.txt: +1 -0");
    expect(existsSync(join(proj, "out.txt"))).toBe(false);
  }, 90_000);

  test("the json done event carries the refused edit as a denial record", async () => {
    cleanProject();
    const r = await xr(["--json", "[[write path=out.txt content=hi]]"]);
    expect(r.code).toBe(0);
    const done = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)).at(-1);
    expect(done.type).toBe("done");
    expect(done.denials).toEqual([
      expect.objectContaining({ tool: "write_file", kind: "edit", target: "out.txt", reason: "non-interactive" }),
    ]);
  }, 90_000);

  test("--approve-all without a typed yes refuses and runs nothing", async () => {
    cleanProject();
    // setsid removes the controlling terminal, so /dev/tty cannot be opened and the
    // typed-yes check cannot wait on a human. Without setsid the test is skipped.
    const setsid = Bun.which("setsid");
    if (!setsid) return;
    mock.requests.length = 0;
    const r = await xr(["--approve-all", "[[write path=out.txt content=hi]]"], { command: [setsid, BUN, ENTRY] });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--approve-all was not confirmed");
    expect(mock.requests.length).toBe(0);
    expect(existsSync(join(proj, "out.txt"))).toBe(false);
  }, 90_000);
});

describe("json mode", () => {
  test("tool output travels in tool events; token events carry only model text", async () => {
    writeFileSync(join(proj, "leak-check.txt"), "TOOL-OUTPUT-SENTINEL-7319\n");
    try {
      const r = await xr(["--json", "[[read path=leak-check.txt]]"]);
      expect(r.code).toBe(0);
      const events = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; content?: string; output?: string });
      // The tool's output is in its tool event...
      const toolOut = events.filter((e) => e.type === "tool").map((e) => e.output ?? "").join("");
      expect(toolOut).toContain("TOOL-OUTPUT-SENTINEL-7319");
      // ...and the token stream holds only the model's text. The mock's final reply echoes the
      // tool result once ("Done. Tool said: …"), so the sentinel appears in tokens exactly once.
      const tokens = events.filter((e) => e.type === "token").map((e) => e.content ?? "").join("");
      expect(tokens.split("TOOL-OUTPUT-SENTINEL-7319").length - 1).toBe(1);
    } finally {
      rmSync(join(proj, "leak-check.txt"), { force: true });
    }
  }, 90_000);

  test("every stdout line is a JSON event, and the turn ends with done", async () => {
    const r = await xr(["--json", "hello json"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(2);
    const events = lines.map((l) => JSON.parse(l) as { type: string });
    expect(events[0]?.type).toBe("prompt");
    expect(events.some((e) => e.type === "token")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: "done", stopped: "done" });
  }, 90_000);
});

describe("entry points", () => {
  test("ask is the one-shot coding turn", async () => {
    const r = await xr(["ask", "hello"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("mock reply: hello");
  }, 90_000);

  test("--version does not boot the engine (fast path)", async () => {
    const r = await xr(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^v\d/);
    expect(r.ms).toBeLessThan(3000);
  }, 90_000);

  test("--help lists the coding agent and does not boot the engine", async () => {
    const r = await xr(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("coding agent");
    expect(r.ms).toBeLessThan(3000);
  }, 90_000);

  test("a near-miss word runs as a task with a hint", async () => {
    const r = await xr(["statsu"]);
    expect(r.stdout).toContain("Did you mean the command `xr status`");
    expect(r.stdout).toContain("mock reply: statsu");
  }, 90_000);

  test("no task and no terminal is a usage error (exit 1)", async () => {
    const r = await xr([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no task given");
  }, 90_000);

  test("an unknown --tools name is refused before anything runs", async () => {
    mock.requests.length = 0;
    const r = await xr(["--tools", "teleport", "-p", "hi"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown tool");
    expect(mock.requests.length).toBe(0);
  }, 90_000);

  test("bad spend and step caps are refused before anything runs", async () => {
    mock.requests.length = 0;
    const steps = await xr(["--max-steps", "0", "-p", "hi"]);
    expect(steps.code).toBe(1);
    expect(steps.stderr).toContain("--max-steps must be a whole number");
    const budget = await xr(["--budget", "0", "-p", "hi"]);
    expect(budget.code).toBe(1);
    expect(budget.stderr).toContain("--budget must be a positive USD amount");
    // A negative value parses as a flag, so the usage parser refuses it first (non-zero).
    const negative = await xr(["--budget", "-2", "-p", "hi"]);
    expect(negative.code).not.toBe(0);
    expect(mock.requests.length).toBe(0);
  }, 90_000);

  test("--max-steps is accepted and the run still completes", async () => {
    const r = await xr(["--max-steps", "3", "-p", "hello steps"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("mock reply: hello steps");
  }, 90_000);

  test("--cwd must be a real directory", async () => {
    const r = await xr(["--cwd", "/definitely/not/here", "-p", "hi"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--cwd");
  }, 90_000);
});
