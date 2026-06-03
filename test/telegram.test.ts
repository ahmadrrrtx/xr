/**
 * XR — Block 6 tests: Telegram auth, parsing, rendering, and the secure
 * handleUpdate flow (no live network — mock fetch).
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import { parseAllowedIds, isAllowed } from "../src/telegram/auth.ts";
import { parseCommand, extractBudget } from "../src/telegram/commands.ts";
import { approvalMessage, parseCallback, statusMessage } from "../src/telegram/render.ts";
import { TelegramBot } from "../src/telegram/bot.ts";

let tmp: string;
let store: Store;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-tg-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "t.db"));
});

// ---- auth ----
test("parseAllowedIds parses csv of numeric ids", () => {
  expect(parseAllowedIds("123, 456 ,789")).toEqual([123, 456, 789]);
  expect(parseAllowedIds("")).toEqual([]);
  expect(parseAllowedIds(undefined)).toEqual([]);
  expect(parseAllowedIds("abc,12")).toEqual([12]);
});

test("isAllowed fails closed (empty list = nobody)", () => {
  expect(isAllowed(123, [])).toBe(false);
  expect(isAllowed(undefined, [123])).toBe(false);
  expect(isAllowed(123, [123, 456])).toBe(true);
  expect(isAllowed(999, [123])).toBe(false);
});

// ---- commands ----
test("extractBudget pulls dollar amount", () => {
  expect(extractBudget("keep it under $0.50")).toBe(0.5);
  expect(extractBudget("max $2 please")).toBe(2);
  expect(extractBudget("no budget here")).toBeUndefined();
});

test("parseCommand handles slash commands and free text", () => {
  expect(parseCommand("/status").type).toBe("status");
  expect(parseCommand("/pause").type).toBe("pause");
  expect(parseCommand("/budget $1.50")).toEqual({ type: "budget", usd: 1.5 });
  const t = parseCommand("refactor auth under $0.25");
  expect(t.type).toBe("task");
  if (t.type === "task") {
    expect(t.budgetUsd).toBe(0.25);
    expect(t.text).toContain("refactor");
  }
  expect(parseCommand("").type).toBe("empty");
});

// ---- render ----
test("approvalMessage has ✅/❌ inline buttons with correct callback data", () => {
  const m = approvalMessage({ id: "abc12", tool: "write_file", reason: "create x" });
  const kb = m.reply_markup!.inline_keyboard;
  expect(kb[0][0].callback_data).toBe("ok:abc12");
  expect(kb[0][1].callback_data).toBe("no:abc12");
});

test("parseCallback decodes decisions", () => {
  expect(parseCallback("ok:abc12")).toEqual({ decision: "approve", id: "abc12" });
  expect(parseCallback("no:xyz")).toEqual({ decision: "reject", id: "xyz" });
  expect(parseCallback("garbage")).toBeNull();
});

test("statusMessage renders key fields", () => {
  const m = statusMessage({ project: "p", costUsd: 0.01, tokens: 1500, blockRate: 0.9, auditOk: true, paused: false });
  expect(m.text).toContain("90% block-rate");
  expect(m.text).toContain("intact");
});

// ---- handleUpdate flow (mock fetch) ----
function mockFetch() {
  const calls: Array<{ method: string; body: any }> = [];
  const fn = (async (url: string, init?: any) => {
    const method = String(url).split("/").pop() ?? "";
    calls.push({ method, body: init ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true, result: [] }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("unauthorized user is ignored and logged", async () => {
  const { fn, calls } = mockFetch();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  await bot.handleUpdate({ message: { from: { id: 999 }, chat: { id: 999 }, text: "/status" } });
  // No reply sent to an unauthorized user.
  expect(calls.filter((c) => c.method === "sendMessage").length).toBe(0);
});

test("authorized /help replies", async () => {
  const { fn, calls } = mockFetch();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  await bot.handleUpdate({ message: { from: { id: 111 }, chat: { id: 111 }, text: "/help" } });
  const sends = calls.filter((c) => c.method === "sendMessage");
  expect(sends.length).toBe(1);
  expect(sends[0].body.text).toContain("remote control");
});

test("approval button resolves a pending action", async () => {
  const { fn } = mockFetch();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  const approve = bot.approver(111);
  // Kick off an approval (sends buttons, returns a promise).
  const p = approve({ tool: "write_file", reason: "create x" });
  // We can't read the random id, so simulate a tap by grabbing the pending one.
  // Find the pending id via a callback for each candidate is impractical; instead
  // we approve by replaying the exact callback the bot would receive. The bot
  // stores id internally; we expose behavior by sending a matching callback.
  // Pull the id from the audit/send: simplest is to monkey-check via reflection.
  const anyBot = bot as any;
  const id = [...anyBot.pending.keys()][0];
  await bot.handleUpdate({ callback_query: { id: "cq1", from: { id: 111 }, data: `ok:${id}` } });
  expect(await p).toBe(true);
});

test("rejection button denies a pending action", async () => {
  const { fn } = mockFetch();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  const p = bot.approver(111)({ tool: "shell", reason: "run x" });
  const id = [...(bot as any).pending.keys()][0];
  await bot.handleUpdate({ callback_query: { id: "cq2", from: { id: 111 }, data: `no:${id}` } });
  expect(await p).toBe(false);
});

test("unauthorized callback cannot resolve an approval", async () => {
  const { fn } = mockFetch();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  const p = bot.approver(111)({ tool: "shell", reason: "run x" });
  const id = [...(bot as any).pending.keys()][0];
  // attacker (id 999) taps the button → must be ignored
  await bot.handleUpdate({ callback_query: { id: "cq3", from: { id: 999 }, data: `ok:${id}` } });
  // pending still there (not resolved)
  expect((bot as any).pending.has(id)).toBe(true);
  // clean up so the test doesn't hang the promise
  (bot as any).pending.get(id)(false);
  expect(await p).toBe(false);
});
