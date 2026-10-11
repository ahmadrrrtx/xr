/**
 * XR — Phase 26 · shared chat runtime (src/bots/).
 *
 * Unit tests for the pieces every chat surface reuses. The approval bridge is
 * exercised with a fake "discord" surface: proof that it is surface-neutral
 * and that only the injected rendering and the audit prefix differ per platform.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { TaskGuard } from "../../src/bots/tasks.ts";
import { ChatRateLimiter } from "../../src/bots/rate.ts";
import { startTypingPulse } from "../../src/bots/typing.ts";
import { ReplyContext } from "../../src/bots/context.ts";
import { BotRuntime } from "../../src/bots/runtime.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";
import type { BotSurface } from "../../src/bots/types.ts";

let store: Store;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-bots-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "t.db"));
});

// ── TaskGuard ────────────────────────────────────────────────────────────────

test("TaskGuard: one running task per key; begin refuses while busy", () => {
  const g = new TaskGuard<string>();
  const first = g.begin("chat-a");
  expect(first).not.toBeNull();
  expect(g.isBusy("chat-a")).toBe(true);
  expect(g.begin("chat-a")).toBeNull();
  g.finish("chat-a");
  expect(g.isBusy("chat-a")).toBe(false);
  expect(g.begin("chat-a")).not.toBeNull();
});

test("TaskGuard: keys are independent", () => {
  const g = new TaskGuard<string>();
  expect(g.begin("a")).not.toBeNull();
  expect(g.begin("b")).not.toBeNull();
});

test("TaskGuard: abort signals the running task and reports whether one existed", () => {
  const g = new TaskGuard<string>();
  const ac = g.begin("a")!;
  expect(g.abort("a")).toBe(true);
  expect(ac.signal.aborted).toBe(true);
  expect(g.abort("nobody")).toBe(false);
});

test("TaskGuard: abortAll signals every running task", () => {
  const g = new TaskGuard<string>();
  const a = g.begin("a")!;
  const b = g.begin("b")!;
  g.abortAll();
  expect(a.signal.aborted && b.signal.aborted).toBe(true);
});

// ── ChatRateLimiter ──────────────────────────────────────────────────────────

test("ChatRateLimiter: burst is enforced per key", () => {
  const rl = new ChatRateLimiter();
  const cfg = { tokens: 2, refillPerSec: 0 };
  expect(rl.allow("k", cfg, 0)).toBe(true);
  expect(rl.allow("k", cfg, 0)).toBe(true);
  expect(rl.allow("k", cfg, 0)).toBe(false);
  expect(rl.allow("other", cfg, 0)).toBe(true);
});

test("ChatRateLimiter: a changed limit takes effect without a restart", () => {
  const rl = new ChatRateLimiter();
  expect(rl.allow("k", { tokens: 1, refillPerSec: 0 }, 0)).toBe(true);
  expect(rl.allow("k", { tokens: 1, refillPerSec: 0 }, 0)).toBe(false);
  // A new config rebuilds the buckets, so the key starts with a full burst again.
  expect(rl.allow("k", { tokens: 3, refillPerSec: 0 }, 0)).toBe(true);
});

// ── startTypingPulse ─────────────────────────────────────────────────────────

test("typing pulse fires on its interval and stops when told", async () => {
  let n = 0;
  const stop = startTypingPulse(() => {
    n += 1;
  }, 5);
  await new Promise((r) => setTimeout(r, 40));
  stop();
  const atStop = n;
  expect(atStop).toBeGreaterThan(1);
  await new Promise((r) => setTimeout(r, 30));
  expect(n).toBe(atStop);
});

// ── ReplyContext ─────────────────────────────────────────────────────────────

test("ReplyContext: generic over chat keys and capped", () => {
  const ctx = new ReplyContext<string>(2);
  ctx.push("c", { role: "user", text: "1" });
  ctx.push("c", { role: "assistant", text: "2" });
  ctx.push("c", { role: "user", text: "3" });
  expect(ctx.recent("c").map((t) => t.text)).toEqual(["2", "3"]);
  expect(ctx.recent("other")).toEqual([]);
});

// ── Approval bridge with a fake surface ──────────────────────────────────────

interface Sent {
  chatId: unknown;
  msg: string;
}

function fakeSurface(id: "discord" | "telegram") {
  const sent: Sent[] = [];
  const edits: Array<{ chatId: unknown; messageId: unknown; text: string }> = [];
  let nextId = 1;
  const surface: BotSurface<string> = {
    id,
    async send(chatId, msg) {
      sent.push({ chatId, msg });
      return nextId++;
    },
    async edit(chatId, messageId, text) {
      edits.push({ chatId, messageId, text });
    },
    async setTyping() {},
  };
  return { surface, sent, edits };
}

function makeRuntime(surface: BotSurface<string>) {
  return new BotRuntime<string>({
    surface,
    store,
    storeConfig: () => ({}),
    renderRequest: (p) => `REQ ${p.tool} ${p.id}`,
    renderResolved: (p) => `RES ${p.outcome} via ${p.surface ?? "?"}`,
  });
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("approval bridge: a fake discord surface gets the request, and the decision edits it", async () => {
  const { surface, sent, edits } = fakeSurface("discord");
  const rt = makeRuntime(surface);
  const p = rt.approvals.request("dm-1", { tool: "write_file", reason: "create notes" });
  await settle();
  expect(sent.length).toBe(1);
  expect(sent[0].chatId).toBe("dm-1");
  expect(sent[0].msg.startsWith("REQ write_file ")).toBe(true);
  const id = [...rt.approvals.pending.keys()][0];
  expect(rt.approvals.decideFromChat(id, true, "dm-1", "user-9")).toBe("decided");
  expect(await p).toBe(true);
  await settle();
  expect(edits.length).toBe(1);
  expect(edits[0].text).toBe("RES approved via discord");
  // The audit prefix follows the surface, so Discord events are not tagged telegram.
  const events = store.recentAudit().map((e) => e.event);
  expect(events).toContain("discord.approval.request");
  expect(events).toContain("discord.approval.answered");
  expect(events.some((e) => e.startsWith("telegram.approval"))).toBe(false);
});

test("approval bridge: a decision from another chat is refused and does not resolve", async () => {
  const { surface } = fakeSurface("discord");
  const rt = makeRuntime(surface);
  const p = rt.approvals.request("dm-1", { tool: "shell", reason: "run" });
  await settle();
  const id = [...rt.approvals.pending.keys()][0];
  expect(rt.approvals.ownsIn(id, "dm-2")).toBe(false);
  expect(rt.approvals.decideFromChat(id, true, "dm-2", "mallory")).toBe("not_found");
  expect(rt.approvals.pending.has(id)).toBe(true);
  // Clean up: deny from the owning chat so the promise settles.
  expect(rt.approvals.decideFromChat(id, false, "dm-1", "user-9")).toBe("decided");
  expect(await p).toBe(false);
});

test("approval bridge: the same approval cannot be decided twice", async () => {
  const { surface } = fakeSurface("telegram");
  const rt = makeRuntime(surface);
  const p = rt.approvals.request(1, { tool: "shell", reason: "run" });
  await settle();
  const id = [...rt.approvals.pending.keys()][0];
  expect(rt.approvals.decideFromChat(id, true, 1, 7)).toBe("decided");
  // Depending on whether the outcome handler has run, the slot is already gone
  // (not_found) or still present (already). Either way it is not a second decision.
  expect(rt.approvals.decideFromChat(id, false, 1, 7)).not.toBe("decided");
  expect(await p).toBe(true);
});
