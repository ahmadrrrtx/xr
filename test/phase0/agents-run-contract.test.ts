/**
 * XR — `xr agents run` CLI contract (audit GAP-004 · GAP-005, both P1).
 *
 * Black-box by necessity: both defects were invisible from inside the process.
 *
 *   GAP-004 — a workflow that ended `blocked` (no synthesis produced) exited
 *             0, so CI wrapping `xr agents run` was green on a workflow that
 *             had accomplished nothing. `docs/guides/cli-compat.md` promises
 *             "a failed command never exits 0 silently".
 *   GAP-005 — `--json` was accepted but ignored by the `run` subcommand: it
 *             printed the ASCII banner and progress lines, so the documented
 *             machine-readable contract was unusable.
 *
 * These tests spawn the REAL CLI against a REAL OpenAI-compatible HTTP server
 * whose reviewer output we control, so both the blocked and completed paths
 * are genuinely exercised end to end.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const ENTRY = join(REPO_ROOT, "src/index.ts");
const POSIX_ONLY = process.platform === "win32";

let home = "";
let server: ReturnType<typeof Bun.serve>;

/** What the scripted model returns as its envelope `message`. */
let reviewerMessage = "";

function envelope(message: string): string {
  return JSON.stringify({ message, tool_calls: [], done: true });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-agents-contract-"));

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 60,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) {
        return Response.json({ data: [{ id: "mock-model" }] });
      }
      return Response.json({
        id: "chatcmpl-test",
        choices: [{ message: { content: envelope(reviewerMessage) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });
    },
  });

});

afterAll(() => {
  server?.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], timeoutMs = 120_000): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      XR_HOME: join(home, ".xr"),
      NO_COLOR: "1",
      // The workflow's workers must reach the test server, not a real provider.
      OLLAMA_HOST: `http://127.0.0.1:${server.port}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}

/** Write a config that routes the `ollama` preset at the test server. */
async function seedConfig(): Promise<void> {
  const xrHome = join(home, ".xr");
  // `doctor` materialises a default config; then we retarget the provider.
  await runCli(["doctor"]);
  const cfgPath = join(xrHome, "config.json");
  const cfg = JSON.parse(await Bun.file(cfgPath).text());
  const baseUrl = `http://127.0.0.1:${server.port}/v1`;
  cfg.providers ??= {};
  cfg.providers.ollama = { baseUrl };
  cfg.localModels ??= {};
  cfg.localModels.runtimes ??= {};
  cfg.localModels.runtimes.ollama = { baseUrl };
  cfg.defaults ??= {};
  cfg.defaults.provider = "ollama";
  cfg.defaults.model = "mock-model";
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

describe.skipIf(POSIX_ONLY)("GAP-004/005 — `xr agents run` contract", () => {
  test("a BLOCKED workflow exits non-zero (was: silently 0)", async () => {
    await seedConfig();
    // Reviewer emits prose with no JSON decision → the gate fails closed →
    // the synthesizer is blocked → no final synthesis is produced.
    reviewerMessage = "prose with no decision object at all";

    const r = await runCli(["agents", "run", "review the project"]);

    expect(r.stdout).toContain("blocked");
    expect(r.code).toBe(1);
  }, 180_000);

  test("a COMPLETED workflow still exits 0", async () => {
    await seedConfig();
    reviewerMessage = 'Looks good. {"decision":"approved","reason":"no issues found"}';

    const r = await runCli(["agents", "run", "review the project"]);

    expect(r.stdout).toContain("completed");
    expect(r.code).toBe(0);
  }, 180_000);

  test("--json emits ONE parseable record and no banner", async () => {
    await seedConfig();
    reviewerMessage = 'Looks good. {"decision":"approved","reason":"no issues found"}';

    const r = await runCli(["agents", "run", "review the project", "--json"]);

    // Must parse as a whole — the defect was banner/progress text around it.
    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe("completed");
    expect(typeof parsed.workflowId).toBe("string");
    expect(typeof parsed.durationMs).toBe("number");
    expect(Array.isArray(parsed.tasks)).toBe(true);
    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.finalOutput).toBeTruthy();

    // No human decoration leaked into the machine stream.
    expect(r.stdout).not.toContain("Running Multi-Agent Workflow");
    expect(r.stdout).not.toContain("workflow ......");
  }, 180_000);

  test("--json on a blocked workflow parses AND exits non-zero", async () => {
    await seedConfig();
    reviewerMessage = "prose with no decision object at all";

    const r = await runCli(["agents", "run", "review the project", "--json"]);

    const parsed = JSON.parse(r.stdout);
    expect(parsed.status).toBe("blocked");
    expect(parsed.finalOutput).toBeNull();
    // Both halves of the contract hold at once.
    expect(r.code).toBe(1);
  }, 180_000);
});
