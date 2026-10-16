/**
 * Real freeform coding CLI against a loopback-only provider and disposable files.
 * Exercises parser -> router -> coder -> AgentService -> unchanged production tools.
 * No paid traffic, destructive commands, real secrets, or weakened shell isolation.
 */
import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditEvents, freshHome, removeHome, runCli, writeConfig, type CliRunResult } from "./helpers.ts";

const T = 60_000;
const PROVIDER = "coder-contract-fixture";
const MARKER = "coder-contract-marker.txt";

async function fixture(tool = "write_file", toolArgs: Record<string, unknown> = { path: MARKER, content: "SYNTHETIC_CODER_MARKER" }) {
  const home = freshHome();
  const cwd = join(home, "workspace");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "package.json"), '{"name":"offline-coder-fixture","private":true}');
  let chatCalls = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (part) => chunks.push(Buffer.from(part)));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) { res.end(JSON.stringify({ data: [{ id: "stub-model" }] })); return; }
      if (!req.url?.endsWith("/chat/completions")) { res.statusCode = 404; res.end("{}"); return; }
      chatCalls++;
      res.end(JSON.stringify({
        choices: [{ message: chatCalls === 1
          ? { role: "assistant", content: "Synthetic tool proposal.", tool_calls: [{ id: "fixture-1", type: "function", function: { name: tool, arguments: JSON.stringify(toolArgs) } }] }
          : { role: "assistant", content: JSON.stringify({ message: "Offline fixture done.", tool_calls: [], done: true }) },
        finish_reason: chatCalls === 1 ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  server.unref();
  writeConfig(home, {
    version: 22,
    defaults: { provider: PROVIDER, model: "stub-model" },
    budget: { perTaskUsd: 0.5, perTaskTokens: 250_000 },
    providerEngine: {
      routingStrategy: "primary",
      customProviders: [{ id: PROVIDER, label: "Offline contract fixture", baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: "stub-model", capabilities: { chat: true, streaming: false, toolUse: true, functionCalling: true } }],
      providerCapabilities: {},
    },
    security: { egressAllowlist: [], hardened: true },
    memory: { enabled: false },
  });
  writeFileSync(join(home, "cli.json"), JSON.stringify({ provider: PROVIDER, model: "stub-model", permissions: { allow: ["edit:*", "shell:*"] } }));
  return {
    home, cwd, calls: () => chatCalls,
    run: (flags: string[]) => runCli(["--cwd", cwd, "--provider", PROVIDER, "--model", "stub-model", "--json", ...flags, "Synthetic offline task"], {
      home, env: { XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "1", CI: "1" }, timeoutMs: 45_000,
    }),
    async close() {
      server.closeAllConnections();
      // Bun can already close the listener in closeAllConnections; ERR_SERVER_NOT_RUNNING is not a product failure.
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(server.listening).toBe(false);
      removeHome(home);
    },
  };
}
function events(r: CliRunResult): Array<Record<string, unknown>> {
  // Startup/preflight errors use the existing global CLI JSON document;
  // an admitted coding turn uses JSONL. Both must be valid machine JSON.
  try { return [JSON.parse(r.stdout.trim()) as Record<string, unknown>]; }
  catch { return r.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
}
function summary(r: CliRunResult) { return events(r).findLast((e) => e.type === "summary"); }
function expectExit(r: CliRunResult, expected: number) {
  expect({ code: r.code, timedOut: r.timedOut, stderr: r.stderr, stdout: r.stdout }).toMatchObject({ code: expected, timedOut: false });
}

describe("coding CLI dry-run end to end", () => {
  test("ordinary approved writes still execute", async () => {
    const f = await fixture();
    try {
      const r = await f.run([]);
      expectExit(r, 0);
      expect(readFileSync(join(f.cwd, MARKER), "utf8")).toBe("SYNTHETIC_CODER_MARKER");
      expect(summary(r)?.files_changed).toEqual([MARKER]);
      expect(auditEvents(f.home)).toContain("write_file.applied");
    } finally { await f.close(); }
  }, T);

  for (const flag of ["--dry-run", "--dryRun", "--dry-run=true"]) {
    test(`${flag}: no write even when edit permission is explicitly allowed`, async () => {
      const f = await fixture();
      try {
        const r = await f.run([flag]);
        expectExit(r, 0);
        expect(events(r)[0]?.type).toBe("init");
        expect(f.calls()).toBe(2); // A real tool turn, not a no-op/model-disabled fix.
        expect(existsSync(join(f.cwd, MARKER))).toBe(false);
        expect(auditEvents(f.home)).toContain("write_file.dryrun");
        expect(auditEvents(f.home)).not.toContain("write_file.applied");
        expect(summary(r)?.files_changed).toEqual([]);
        expect(summary(r)?.dry_run).toBe(true);
      } finally { await f.close(); }
    }, T);
  }

  test("shell dry-run simulates without invoking the isolation executor", async () => {
    const f = await fixture("shell", { cmd: "printf '%s' XR_SAFE_CONTRACT > shell-marker.txt" });
    try {
      const r = await f.run(["--dry-run"]);
      expectExit(r, 0);
      expect(existsSync(join(f.cwd, "shell-marker.txt"))).toBe(false);
      const audit = auditEvents(f.home);
      expect(audit).toContain("shell.dryrun");
      expect(audit).not.toContain("shell.run");
      expect(audit).not.toContain("shell.run_isolated");
      expect(summary(r)?.commands_run).toEqual([]);
    } finally { await f.close(); }
  }, T);

  test("--dry-run=false does not disable ordinary explicit writes", async () => {
    const f = await fixture();
    try {
      const r = await f.run(["--dry-run=false"]);
      expectExit(r, 0);
      expect(existsSync(join(f.cwd, MARKER))).toBe(true);
    } finally { await f.close(); }
  }, T);
});

describe("budget routing and honest unsupported flags", () => {
  test("the exact requested USD override replaces configured per-task USD", async () => {
    const f = await fixture();
    try {
      const r = await f.run(["--dry-run", "--budget", "0.1234"]);
      expectExit(r, 0);
      expect(summary(r)?.meter).toContain("$0.1234 cap");
      expect(summary(r)?.meter).not.toContain("$0.5 cap");
    } finally { await f.close(); }
  }, T);

  test("coder resume fails clearly before boot/model activity, never starts fresh", async () => {
    const f = await fixture();
    try {
      const r = await f.run(["--resume", "nonexistent-contract-session"]);
      expectExit(r, 2);
      expect(r.stdout + r.stderr).toContain("--resume");
      expect(r.stdout + r.stderr).toContain("xr run --resume");
      expect(f.calls()).toBe(0);
      expect(existsSync(join(f.home, "xr.db"))).toBe(false);
      expect(existsSync(join(f.cwd, MARKER))).toBe(false);
    } finally { await f.close(); }
  }, T);

  const invalid: string[][] = [
    ["--budget", "NaN"], ["--budget", "Infinity"], ["--budget", "0"], ["--budget=-1"], ["--budget"],
    ["--max-tokens", "0"], ["--max-tokens", "12junk"], ["--max-tokens", "1.5"], ["--max-tokens"],
    ["--resume"], ["--resume="], ["--dry-run=invalid"], ["--mode", "plan"], ["--mode", "ask"],
    ["--mode", "typo"], ["--mode", "minimal"], ["--mode="],
  ];
  for (const flags of invalid) {
    test(`${flags.join(" ")}: usage error before boot or provider call`, async () => {
      const f = await fixture();
      try {
        const r = await f.run(flags);
        expectExit(r, 2);
        expect(f.calls()).toBe(0);
        expect(existsSync(join(f.home, "xr.db"))).toBe(false);
        expect(events(r).some((e) => e.type === "error" || e.error !== undefined)).toBe(true);
      } finally { await f.close(); }
    }, T);
  }
});


describe("command-local mode compatibility", () => {
  test("install --mode minimal still completes without a model or full install", async () => {
    const home = freshHome();
    try {
      const r = await runCli(["install", "--mode", "minimal", "--yes", "--from-bootstrap"], { home, timeoutMs: 45_000 });
      expectExit(r, 0);
      expect(existsSync(join(home, "config.json"))).toBe(true);
      expect(existsSync(join(home, "xr.db"))).toBe(true);
      expect(r.stdout + r.stderr).not.toContain("--mode requires");
    } finally { removeHome(home); }
  }, T);

  test("legacy xr run also refuses unknown execution modes before boot", async () => {
    const home = freshHome();
    try {
      const r = await runCli(["run", "--mode", "minimal", "--json", "Offline task"], { home });
      expectExit(r, 2);
      expect(r.stdout + r.stderr).toContain("--mode requires");
      expect(existsSync(join(home, "xr.db"))).toBe(false);
    } finally { removeHome(home); }
  }, T);
});
