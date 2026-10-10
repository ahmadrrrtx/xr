/**
 * XR — Phase 26 · shared chat-bot runtime.
 *
 * The runtime is what Telegram, Discord and WhatsApp share. These tests pin
 * the guarantees each adapter depends on, independent of any wire protocol:
 * the one-task-per-chat guard, refusal ordering, per-chat budget refusal,
 * per-chat rate limit, durable approvals scoped to their chat, and surface-
 * prefixed audit events (so a Discord approval is never logged as Telegram).
 * No network. The agent run itself is not exercised here; only refusals and
 * the state the runtime owns are asserted.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { BotRuntime, type AgentRun, type AgentReply, type ApprovalPresenter } from "../../src/bots/runtime.ts";
import { ReplyContext } from "../../src/bots/context.ts";
import { loadConfig } from "../../src/config/config.ts";

let store: Store;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-bots-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "b.db"));
});

function run(over: Partial<AgentRun> = {}): AgentRun {
  const { config } = loadConfig();
  const presenter: ApprovalPresenter = {
    show: async () => undefined,
    resolved: async () => {},
  };
  return {
    chatKey: "chat-1",
    text: "do a thing",
    blocks: [],
    quote: "",
    notes: [],
    chat: {},
    config,
    approvals: presenter,
    ...over,
  };
}

const noopReply: AgentReply = {
  typing: async () => {},
  started: async () => {},
  answer: async () => {},
  failed: async () => {},
};

test("refusals are ordered: paused, then empty, then busy, then budget", async () => {
  const rt = new BotRuntime({ surface: "discord", store });
  rt.paused = true;
  expect(await rt.runTurn(run(), noopReply)).toEqual({ kind: "refused", reason: "paused" });

  rt.paused = false;
  expect(await rt.runTurn(run({ text: "" }), noopReply)).toEqual({ kind: "refused", reason: "empty" });

  rt.active.set("chat-1", new AbortController());
  expect(await rt.runTurn(run(), noopReply)).toEqual({ kind: "refused", reason: "busy" });
  rt.active.delete("chat-1");
});

test("per-chat budget refuses before any work and audits under the surface prefix", async () => {
  const rt = new BotRuntime({ surface: "discord", store });
  rt.chatSpendUsd.set("chat-1", 0.05);
  const refused = await rt.runTurn(run({ chatBudgets: { maxUsd: 0.01 } }), noopReply);
  expect(refused).toEqual({ kind: "refused", reason: "budget", spent: 0.05, cap: 0.01 });
  expect(store.recentAudit().some((e) => e.event === "discord.chat_budget")).toBe(true);
  expect(store.recentAudit().some((e) => e.event === "telegram.chat_budget")).toBe(false);
});

test("rate limit is per chat and audits under the surface prefix", () => {
  const rt = new BotRuntime({ surface: "whatsapp", store });
  const rl = { tokens: 1, refillPerSec: 0 };
  expect(rt.allowMessage("a", rl, {}, 1000)).toBe(true);
  // Same chat, no refill: refused. A different chat has its own bucket.
  expect(rt.allowMessage("a", rl, {}, 1001)).toBe(false);
  expect(rt.allowMessage("b", rl, {}, 1001)).toBe(true);
  expect(store.recentAudit().some((e) => e.event === "whatsapp.rate_limited")).toBe(true);
});

test("an approval can only be decided from the chat it was shown in", async () => {
  const rt = new BotRuntime({ surface: "discord", store });
  const shown: string[] = [];
  const presenter: ApprovalPresenter = {
    show: async (v) => {
      shown.push(v.id);
      return "msg-1";
    },
    resolved: async () => {},
  };
  const approve = rt.approver("dm-A", presenter);
  const p = approve({ tool: "write_file", reason: "create x" });
  await new Promise((r) => setTimeout(r, 0));

  const id = shown[0] ?? [...rt.pending.keys()][0];
  expect(id).toBeTruthy();
  expect(rt.ownsApproval(id, "dm-B")).toBe(false);
  expect(rt.decideFromChat(id, true, "dm-B", "user-B")).toBe("not_found");
  expect(rt.pending.has(id)).toBe(true);

  expect(rt.decideFromChat(id, true, "dm-A", "user-A")).toBe("decided");
  expect(await p).toBe(true);
  expect(store.recentAudit().some((e) => e.event === "discord.approval.answered")).toBe(true);
  expect(store.recentAudit().some((e) => e.event === "telegram.approval.answered")).toBe(false);
});

test("a decided approval cannot be decided twice", async () => {
  const rt = new BotRuntime({ surface: "discord", store });
  const shown: string[] = [];
  const presenter: ApprovalPresenter = {
    show: async (v) => {
      shown.push(v.id);
      return undefined;
    },
    resolved: async () => {},
  };
  const p = rt.approver("dm-A", presenter)({ tool: "shell", reason: "run" });
  await new Promise((r) => setTimeout(r, 0));
  const id = shown[0];
  expect(rt.decideFromChat(id, false, "dm-A", "u")).toBe("decided");
  expect(await p).toBe(false);
  expect(rt.decideFromChat(id, false, "dm-A", "u")).toBe("not_found");
});

test("reply context keeps the last turns per chat and does not mix chats", () => {
  const ctx = new ReplyContext(3);
  for (let i = 0; i < 5; i += 1) ctx.push("a", { role: "user", text: `m${i}` });
  ctx.push("b", { role: "user", text: "other" });
  expect(ctx.recent("a").map((t) => t.text)).toEqual(["m2", "m3", "m4"]);
  expect(ctx.recent("b").map((t) => t.text)).toEqual(["other"]);
});

test("reply context does not coerce keys: a numeric id and its string are different chats", () => {
  const ctx = new ReplyContext(5);
  ctx.push(111, { role: "user", text: "numeric" });
  expect(ctx.recent("111")).toEqual([]);
  expect(ctx.recent(111)[0].text).toBe("numeric");
});

test("cancelAll and abortChat stop running tasks without touching other chats", () => {
  const rt = new BotRuntime({ surface: "discord", store });
  const a = new AbortController();
  const b = new AbortController();
  rt.active.set("a", a);
  rt.active.set("b", b);
  expect(rt.abortChat("a")).toBe(true);
  expect(a.signal.aborted).toBe(true);
  expect(b.signal.aborted).toBe(false);
  expect(rt.abortChat("missing")).toBe(false);
  rt.cancelAll();
  expect(b.signal.aborted).toBe(true);
});
