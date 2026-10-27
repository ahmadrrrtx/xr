/**
 * XR-LAUNCH-024 — a failed tool shows its cause and a next step, never a bare "failed".
 *
 * Each denial class runs through the REAL agent loop (runAgentLoop) with the
 * real read_file / write_file / shell tools and a scripted model, and the
 * captured `tool_result` events are then rendered by the real CoderSession +
 * JsonUI (`xr --json`). Nothing here executes a shell command: the secret-path
 * guard refuses first, and with hardened mode and no isolated runner the
 * shell fails closed.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentLoop } from "../../helpers/scripted-agent.ts";
import type { ChatStreamEvent, Message, ModelTurn, Provider, Tool } from "../../../src/core/types.ts";
import { Store } from "../../../src/state/workspace-store.ts";
import { ToolRegistryService } from "../../../src/tools/registry-service.ts";
import { readFileTool, writeFileTool } from "../../../src/tools/files.ts";
import { shellTool } from "../../../src/tools/system.ts";
import { CoderSession, type AgentPort } from "../../../src/cli/coder/session.ts";
import { JsonUI, TtyUI } from "../../../src/cli/coder/ui.ts";
import { classifyToolFailure, isToolReasonCode, TOOL_REASONS, toolResultEvent } from "../../../src/core/tool-reasons.ts";

const tmp = mkdtempSync(join(tmpdir(), "xr-024-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function scripted(calls: Array<{ tool: string; args: Record<string, unknown> }>): Provider {
  let i = 0;
  const turns: ModelTurn[] = [
    { message: "trying tools", toolCalls: calls, done: false },
    { message: "done", toolCalls: [], done: true },
  ];
  return {
    id: "mock",
    label: "Mock",
    async chat(_m: Message[], _t: Tool[]) {
      return turns[Math.min(i++, turns.length - 1)]!;
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  };
}

type ToolResultEvent = Extract<ChatStreamEvent, { type: "tool_result" }>;

async function runLoop(calls: Array<{ tool: string; args: Record<string, unknown> }>, approve = true): Promise<ToolResultEvent[]> {
  const cwd = join(tmp, `ws-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, ".env"), "API_KEY=REDACTED-fixture\n");
  writeFileSync(join(cwd, "notes.txt"), "hello\n");
  const registry = new ToolRegistryService();
  registry.registerTools({ kind: "core", source: "test", tools: [readFileTool, writeFileTool, shellTool] });
  const events: ToolResultEvent[] = [];
  const store = new Store(join(cwd, "..", `${Math.random().toString(36).slice(2, 8)}.db`));
  try {
    await runAgentLoop("exercise denials", "agent", {
      provider: scripted(calls),
      store,
      cwd,
      approve: async () => approve,
      say: () => {},
      maxSteps: 3,
      egressAllowlist: [],
      hardened: true, // no isolated runner wired → shell must fail closed
      runId: `r-${Math.random().toString(36).slice(2, 8)}`,
      toolRegistry: registry,
      onStreamEvent: (e: ChatStreamEvent) => {
        if (e.type === "tool_result") events.push(e);
      },
    } as never);
  } finally {
    store.close();
  }
  return events;
}

describe("XR-LAUNCH-024 · every denial class carries a stable reason through the real agent loop", () => {
  test("escape, secret path (file + shell), missing file, isolation unavailable, unknown tool", async () => {
    const events = await runLoop([
      { tool: "read_file", args: { path: "../outside.txt" } },
      { tool: "read_file", args: { path: ".env" } },
      { tool: "read_file", args: { path: "does-not-exist.txt" } },
      { tool: "shell", args: { cmd: "cat .env" } },
      { tool: "shell", args: { cmd: "echo hi" } },
      { tool: "no_such_tool", args: {} },
    ]);
    const by = (i: number) => events[i]!;
    expect(events).toHaveLength(6);
    for (const e of events) {
      expect(e.ok).toBe(false);
      expect(isToolReasonCode(e.reason)).toBe(true);
      expect(e.next).toBe(TOOL_REASONS[e.reason as keyof typeof TOOL_REASONS]);
      expect(e.error && e.error !== "failed").toBeTruthy();
    }
    expect(by(0).reason).toBe("denied:escape");
    expect(by(0).error).toBe("path escapes the project root");
    expect(by(1).reason).toBe("denied:secret-path");
    expect(by(2).reason).toBe("missing:file");
    expect(by(3).reason).toBe("denied:secret-path");
    expect(by(4).reason).toBe("blocked:isolation-unavailable");
    expect(by(5).reason).toBe("invalid:unknown-tool");
    // Codes and next steps never echo secret material or paths from the call.
    for (const e of events) expect(`${e.reason} ${e.next}`).not.toContain("REDACTED-fixture");
  });

  test("a write the user declines is denied:user; a successful read carries no reason", async () => {
    const declined = await runLoop([{ tool: "write_file", args: { path: "new.txt", content: "x" } }], false);
    expect(declined[0]?.ok).toBe(false);
    expect(declined[0]?.reason).toBe("denied:user");
    const ok = await runLoop([{ tool: "read_file", args: { path: "notes.txt" } }]);
    expect(ok[0]?.ok).toBe(true);
    expect(ok[0]?.reason).toBeUndefined();
    expect(ok[0]?.error).toBeUndefined();
  });
});

describe("XR-LAUNCH-024 · `xr --json` shows cause + reason + next step", () => {
  test("JsonUI tool lines for failures carry output, reason and next — never a bare \"failed\"", async () => {
    const events = await runLoop([
      { tool: "read_file", args: { path: "../outside.txt" } },
      { tool: "shell", args: { cmd: "echo hi" } },
    ]);
    const lines: Record<string, unknown>[] = [];
    const ui = new JsonUI((l) => lines.push(JSON.parse(l)));
    const agent: AgentPort = {
      async runTask(_task, _mode, run) {
        for (const e of events) {
          run.onStreamEvent?.({ type: "tool_call", id: e.id, tool: e.tool, args: {} });
          run.onStreamEvent?.(e);
        }
        return { sessionId: "fixture", stopped: "done", steps: 1, finalMessage: "done" };
      },
    };
    const session = new CoderSession(agent, ui, {
      cwd: tmp, systemPrompt: "offline", tools: ["read_file", "shell"], mode: "yolo",
      rules: {}, interactive: false, diffOnly: false, maxSteps: 2,
    });
    await session.turn("replay", new AbortController().signal);
    const failures = lines.filter((l) => l.type === "tool" && l.status === "error");
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ tool: "read_file", output: "path escapes the project root", reason: "denied:escape" });
    expect(failures[1]).toMatchObject({ tool: "shell", reason: "blocked:isolation-unavailable" });
    for (const f of failures) {
      expect(f.output).not.toBe("failed");
      expect(typeof f.next).toBe("string");
      expect((f.next as string).length).toBeGreaterThan(10);
    }
  });

  test("an older emitter that only set `result` on failure still shows the real message", async () => {
    const lines: Record<string, unknown>[] = [];
    const ui = new JsonUI((l) => lines.push(JSON.parse(l)));
    const agent: AgentPort = {
      async runTask(_task, _mode, run) {
        run.onStreamEvent?.({ type: "tool_call", id: "t1", tool: "read_file", args: {} });
        run.onStreamEvent?.({ type: "tool_result", id: "t1", tool: "read_file", ok: false, result: "filesystem missing" });
        return { sessionId: "fixture", stopped: "done", steps: 1, finalMessage: "done" };
      },
    };
    const session = new CoderSession(agent, ui, {
      cwd: tmp, systemPrompt: "offline", tools: ["read_file"], mode: "yolo",
      rules: {}, interactive: false, diffOnly: false, maxSteps: 2,
    });
    await session.turn("replay", new AbortController().signal);
    expect(lines.find((l) => l.type === "tool" && l.status === "error")).toMatchObject({ output: "filesystem missing", reason: "missing:file" });
  });
});

describe("XR-LAUNCH-024 · terminal UI shows cause + next step", () => {
  test("the ✕ line keeps the tool's message and a dim line adds code + next step", () => {
    const ui = new TtyUI(null, true);
    const chunks: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (c: string | Uint8Array) => { chunks.push(String(c)); return true; };
    try {
      ui.toolResult("t1", "read_file", false, "path escapes the project root", { reason: "denied:escape", next: TOOL_REASONS["denied:escape"] });
    } finally {
      (process.stderr as { write: unknown }).write = original;
    }
    const text = chunks.join("").replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toContain("✕ read_file: path escapes the project root");
    expect(text).toContain(`denied:escape — ${TOOL_REASONS["denied:escape"]}`);
  });
});

describe("XR-LAUNCH-024 · classifier and event builder", () => {
  test("known denial texts map to their codes; unknown text is failed:tool, never a guess", () => {
    expect(classifyToolFailure("read_file", "path escapes the project root")).toBe("denied:escape");
    expect(classifyToolFailure("shell", "blocked: blocked: access to a secret/credential path (/x/.env)")).toBe("denied:secret-path");
    expect(classifyToolFailure("shell", "blocked: blocked: reference to secret material (.env)")).toBe("denied:secret-path");
    expect(classifyToolFailure("shell", "blocked: blocked: dangerous shell command (rm -rf /)")).toBe("denied:dangerous-command");
    expect(classifyToolFailure("write_file", "write denied by user")).toBe("denied:user");
    expect(classifyToolFailure("mcp__x__y", "blocked: grant expired: too old")).toBe("denied:policy");
    expect(classifyToolFailure("shell", "blocked by execution-integrity gate (mode=enforce): x")).toBe("blocked:integrity");
    expect(classifyToolFailure("shell", "make: *** [all] Error 2")).toBe("failed:command");
    expect(classifyToolFailure("web_fetch", "something odd happened")).toBe("failed:tool");
  });

  test("an explicit tool reason wins over classification; invalid explicit codes are ignored", () => {
    expect(toolResultEvent("i", "shell", { ok: false, output: "x", reason: "blocked:isolation-unavailable" }).reason).toBe("blocked:isolation-unavailable");
    expect(toolResultEvent("i", "read_file", { ok: false, output: "filesystem missing", reason: "made:up" }).reason).toBe("missing:file");
    expect(toolResultEvent("i", "read_file", { ok: true, output: "hi" })).toEqual({ type: "tool_result", id: "i", tool: "read_file", ok: true, result: "hi" });
  });

  test("every code has a next step and the codes are namespaced", () => {
    for (const [code, next] of Object.entries(TOOL_REASONS)) {
      expect(code).toMatch(/^(denied|blocked|missing|invalid|failed|error):[a-z-]+$/);
      expect(next.length).toBeGreaterThan(20);
    }
  });

  test("every code is documented in docs/cli/CODING_CONTRACTS.md (codes are a public contract)", () => {
    const doc = readFileSync(join(import.meta.dir, "../../../docs/cli/CODING_CONTRACTS.md"), "utf8");
    for (const code of Object.keys(TOOL_REASONS)) expect(doc).toContain(`- \`${code}\`:`);
  });
});
