/**
 * Phase 26 · PR 1 — Telegram characterization.
 *
 * These pin the user-visible behavior of the one-task-per-chat guard, the
 * typing pulse, /stop and cancelAll BEFORE the shared src/bots/ runtime is
 * extracted. They must pass unchanged after the refactor. No live network:
 * the provider is local (ollama, unreachable), so a task fails fast and the
 * whole path (typing → "Working on it." → answer footer) runs offline.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { TelegramBot } from "../../src/telegram/bot.ts";

let tmp: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-tgchar-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "t.db"));
});

interface Call {
  method: string;
  chatId?: number;
  text?: string;
}

function recorder() {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: any) => {
    const method = String(url).split("/").pop() ?? "";
    const body = init ? JSON.parse(init.body) : {};
    calls.push({ method, chatId: body.chat_id, text: body.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const texts = (calls: Call[]) => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.text ?? ""));
const msg = (from: number, text: string) => ({ message: { from: { id: from }, chat: { id: from }, text } });

test("a task sends typing first, then 'Working on it.', then the answer with its footer", async () => {
  const { fn, calls } = recorder();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  await bot.handleUpdate(msg(111, "say hi"));
  expect(calls[0].method).toBe("sendChatAction");
  expect(calls[1].method).toBe("sendMessage");
  expect(calls[1].text).toBe("Working on it.");
  // The provider is unreachable here (the fallback chain varies by environment),
  // so assert the shape: an answer follows the acknowledgement.
  const answers = texts(calls).filter((t) => t !== "Working on it.");
  expect(answers.length).toBeGreaterThanOrEqual(1);
});

test("a second task in the same chat is refused while the first is running", async () => {
  const { fn, calls } = recorder();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  // The first task registers itself synchronously, before its first await.
  const first = bot.handleUpdate(msg(111, "first"));
  const second = bot.handleUpdate(msg(111, "second"));
  await Promise.all([first, second]);
  const sent = texts(calls);
  expect(sent.filter((t) => t === "Working on it.").length).toBe(1);
  expect(sent.some((t) => t === "A task is already running in this chat. /stop cancels it.")).toBe(true);
});

test("/stop cancels the running task in its own chat and is audited", async () => {
  const { fn, calls } = recorder();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  const running = bot.handleUpdate(msg(111, "long task"));
  await bot.handleUpdate(msg(111, "/stop"));
  await running;
  expect(texts(calls)).toContain("Stopping the running task.");
  expect(store.recentAudit().some((e) => e.event === "telegram.stop")).toBe(true);
});

test("guards are per chat: a second paired chat runs while the first is busy", async () => {
  const { fn, calls } = recorder();
  const bot = new TelegramBot({ token: "T", allowedIds: [111, 222], store, fetchFn: fn });
  const a = bot.handleUpdate(msg(111, "task a"));
  const b = bot.handleUpdate(msg(222, "task b"));
  await Promise.all([a, b]);
  const workingChats = calls.filter((c) => c.text === "Working on it.").map((c) => c.chatId);
  expect(workingChats.sort()).toEqual([111, 222]);
});

test("cancelAll aborts a running task, and the chat is free again afterwards", async () => {
  const { fn, calls } = recorder();
  const bot = new TelegramBot({ token: "T", allowedIds: [111], store, fetchFn: fn });
  const running = bot.handleUpdate(msg(111, "long task"));
  bot.cancelAll();
  await running;
  // The finally block cleared the guard: a new task starts normally.
  await bot.handleUpdate(msg(111, "next task"));
  expect(texts(calls).filter((t) => t === "Working on it.").length).toBe(2);
  expect(texts(calls).some((t) => t === "A task is already running in this chat. /stop cancels it.")).toBe(false);
});
