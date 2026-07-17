/**
 * XR Phase 0 tests — full loop with a mock provider + audit-chain tamper test.
 * Run: bun test
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Store } from "../src/state/workspace-store.ts";
import { runAgent } from "../src/core/agent.ts";
import { parseTurn } from "../src/providers/openai-compat.ts";
import type { Provider, Message, Tool, ModelTurn } from "../src/core/types.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-"));
  process.env.XR_HOME = join(tmp, "home");
});

/** A scripted provider: returns a fixed sequence of turns. */
function mockProvider(turns: ModelTurn[]): Provider {
  let i = 0;
  return {
    id: "mock",
    label: "Mock",
    async chat(_m: Message[], _t: Tool[]) {
      return turns[Math.min(i++, turns.length - 1)];
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  };
}

test("agent loop: writes a file via approval and finishes", async () => {
  const store = new Store(join(tmp, "a.db"));
  const cwd = tmp;
  const lines: string[] = [];

  const result = await runAgent("create hello.txt", "agent", {
    provider: mockProvider([
      {
        message: "I'll create the file.",
        toolCalls: [{ tool: "write_file", args: { path: "hello.txt", content: "hi from xr" } }],
        done: false,
      },
      { message: "Done!", toolCalls: [], done: true },
    ]),
    store,
    cwd,
    say: (l) => lines.push(l),
    approve: async () => true, // auto-approve in test
    maxSteps: 5,
  });

  expect(result.stopped).toBe("done");
  expect(existsSync(join(cwd, "hello.txt"))).toBe(true);
  expect(readFileSync(join(cwd, "hello.txt"), "utf8")).toBe("hi from xr");
  store.close();
});

test("approval gate: denied write does NOT touch disk", async () => {
  const store = new Store(join(tmp, "b.db"));
  await runAgent("create secret.txt", "agent", {
    provider: mockProvider([
      {
        message: "writing",
        toolCalls: [{ tool: "write_file", args: { path: "secret.txt", content: "nope" } }],
        done: false,
      },
      { message: "ok", toolCalls: [], done: true },
    ]),
    store,
    cwd: tmp,
    say: () => {},
    approve: async () => false, // DENY
    maxSteps: 5,
  });
  expect(existsSync(join(tmp, "secret.txt"))).toBe(false);
  store.close();
});

test("least privilege: ask mode cannot use write_file", async () => {
  const store = new Store(join(tmp, "c.db"));
  await runAgent("try to write", "ask", {
    provider: mockProvider([
      {
        message: "writing",
        toolCalls: [{ tool: "write_file", args: { path: "x.txt", content: "x" } }],
        done: false,
      },
      { message: "done", toolCalls: [], done: true },
    ]),
    store,
    cwd: tmp,
    say: () => {},
    approve: async () => true,
    maxSteps: 5,
  });
  // write_file is blocked in ask mode → file must not exist
  expect(existsSync(join(tmp, "x.txt"))).toBe(false);
  store.close();
});

test("path escape is blocked", async () => {
  const store = new Store(join(tmp, "d.db"));
  await runAgent("escape", "agent", {
    provider: mockProvider([
      {
        message: "escaping",
        toolCalls: [{ tool: "write_file", args: { path: "../evil.txt", content: "x" } }],
        done: false,
      },
      { message: "done", toolCalls: [], done: true },
    ]),
    store,
    cwd: tmp,
    say: () => {},
    approve: async () => true,
    maxSteps: 5,
  });
  expect(existsSync(join(tmp, "..", "evil.txt"))).toBe(false);
  store.close();
});

test("audit chain: intact after activity, detects tampering", async () => {
  const dbPath = join(tmp, "e.db");
  const store = new Store(dbPath);
  store.audit("test.one", { a: 1 });
  store.audit("test.two", { b: 2 });
  store.audit("test.three", { c: 3 });
  expect(store.verifyChain().valid).toBe(true);
  expect(store.auditCount()).toBe(3);
  store.close();

  // Tamper directly in the DB, bypassing the hash logic.
  const raw = new Database(dbPath);
  raw.query(`UPDATE audit_log SET detail = ? WHERE id = 2`).run(JSON.stringify({ b: 999 }));
  raw.close();

  const store2 = new Store(dbPath);
  const res = store2.verifyChain();
  expect(res.valid).toBe(false);
  expect(res.brokenAt).toBe(2);
  store2.close();
});

test("secret redaction in audit log", () => {
  const store = new Store(join(tmp, "f.db"));
  store.audit("call", { authorization: "Bearer sk-abcdef123456789" });
  // verify the stored detail does not contain the raw key
  const db = new Database(join(tmp, "f.db"));
  const row = db.query<{ detail: string }, []>(`SELECT detail FROM audit_log LIMIT 1`).get();
  expect(row!.detail).not.toContain("sk-abcdef123456789");
  expect(row!.detail).toContain("redacted");
  db.close();
  store.close();
});

test("parseTurn repairs fenced / messy JSON", () => {
  const t = parseTurn('```json\n{"message":"hi","tool_calls":[],"done":true}\n```');
  expect(t.message).toBe("hi");
  expect(t.done).toBe(true);

  const t2 = parseTurn('garbage before {"message":"x","tool_calls":[{"tool":"read_file","args":{"path":"a"}}],"done":false} trailing');
  expect(t2.toolCalls.length).toBe(1);
  expect(t2.toolCalls[0].tool).toBe("read_file");
});
