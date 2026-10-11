/**
 * XR — Phase 26 · Discord (PR 2): the bot against a local mock Discord server.
 *
 * Runs the real REST client and the real gateway client over loopback. The
 * agent is injected, so no model is called. Every assertion is about what XR
 * sends to Discord and what it refuses to do.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { DiscordBot, BUSY_REPLY, NOT_HERE_REPLY, type AgentRunArgs } from "../../src/discord/bot.ts";
import { DiscordAccess, DiscordCodes, blankDiscordState, saveDiscordState } from "../../src/discord/auth.ts";
import { DiscordGateway } from "../../src/discord/gateway.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";
import { startMockDiscord, dmMessage, guildMessage, MOCK_APP_ID, MOCK_BOT_ID, type MockDiscord } from "./mock-discord.ts";

const TOKEN = "MTAwMDAwMDAwMDAwMDAwMDAwMA.FAKETK.abcdefghijklmnopqrstuvwxyz0123456789";
const OWNER = "3000000000000000001";
const STRANGER = "3000000000000000009";
const DM = "4000000000000000001";
const GUILD_CHANNEL = "5000000000000000001";
const OTHER_CHANNEL = "5000000000000000002";

let dir: string;
let store: Store;
let mock: MockDiscord;
let bot: DiscordBot;
let access: DiscordAccess;
let codes: DiscordCodes;
let statuses: string[];
let runs: AgentRunArgs[];
let gate: { resolve: (() => void) | null };

function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 15);
    };
    tick();
  });
}

const posts = (channelId: string) => mock.calls.filter((c) => c.method === "POST" && c.path === `/channels/${channelId}/messages`);
const contents = (channelId: string) => posts(channelId).map((c) => String(c.body?.content ?? ""));

async function startBot(): Promise<void> {
  bot = new DiscordBot({
    token: TOKEN,
    store,
    access,
    codes,
    apiBase: `${mock.url}/api/v10`,
    log: () => {},
    onStatus: (s) => statuses.push(s),
    runAgent: async (args) => {
      runs.push(args);
      if (args.task.includes("ask for approval")) {
        const ok = await args.approve({ tool: "write_file", reason: "Write the notes file", preview: "notes.txt", riskTier: "medium" });
        return { finalMessage: ok ? "Saved." : "Skipped.", stopped: "completed" };
      }
      if (args.task.includes("hold")) {
        await new Promise<void>((resolve) => {
          gate.resolve = resolve;
        });
        return { finalMessage: "held", stopped: "completed" };
      }
      if (args.task.includes("long answer")) {
        return { finalMessage: "Paragraph of text. ".repeat(180), stopped: "completed", meter: "1k tokens" };
      }
      return { finalMessage: `Answer to: ${args.task}`, stopped: "completed", meter: "120 tokens" };
    },
  });
  await bot.start();
  await waitFor(() => bot.info.running && mock.calls.some((c) => c.method === "PUT"));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "xr-discord-bot-"));
  process.env.XR_HOME = join(dir, "home");
  store = new Store(join(dir, "t.db"));
  mock = startMockDiscord();
  access = new DiscordAccess(blankDiscordState(), (s) => saveDiscordState(s, join(dir, "discord", "state.json")));
  codes = new DiscordCodes();
  statuses = [];
  runs = [];
  gate = { resolve: null };
});

afterEach(() => {
  bot?.stop();
  mock.stop();
  store.close();
});

/** Pair the owner directly (the code flow is tested separately). */
function pairOwner(): void {
  access.pairUser(OWNER);
}

// ── connection and registration ──────────────────────────────────────────────

test("connects with the bot token, identifies, and registers /xr", async () => {
  await startBot();
  const auth = mock.calls.find((c) => c.path === "/users/@me");
  expect(auth?.auth).toBe(`Bot ${TOKEN}`);
  expect(mock.identifies).toBe(1);
  const put = mock.calls.find((c) => c.method === "PUT");
  expect(put?.path).toBe(`/applications/${MOCK_APP_ID}/commands`);
  expect(put?.body?.[0]?.name).toBe("xr");
  expect(bot.info.identity?.botId).toBe(MOCK_BOT_ID);
});

test("the token is sent only in the Authorization header, never in a body", async () => {
  await startBot();
  for (const c of mock.calls) expect(JSON.stringify(c.body ?? {})).not.toContain(TOKEN);
});

test("an invalid token fails start() with auth_failed and no gateway is opened", async () => {
  bot = new DiscordBot({ token: "invalid", store, access, codes, apiBase: `${mock.url}/api/v10`, log: () => {} });
  await expect(bot.start()).rejects.toMatchObject({ code: "auth_failed" });
  expect(mock.connections).toBe(0);
});

test("every REST write sets allowed_mentions to parse nothing, so model output cannot ping @everyone", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "hello" }));
  await waitFor(() => contents(DM).length >= 2);
  const writes = mock.calls.filter((c) => c.method === "POST" && c.path.includes("/messages"));
  expect(writes.length).toBeGreaterThan(0);
  for (const w of writes) expect(w.body?.allowed_mentions).toEqual({ parse: [] });
});

// ── DM pairing and fail-closed behaviour ─────────────────────────────────────

test("an unpaired DM gets no reply at all", async () => {
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: STRANGER, content: "hello?" }));
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m2", channelId: DM, userId: STRANGER, content: "/xr budget" }));
  await new Promise((r) => setTimeout(r, 150));
  expect(posts(DM)).toHaveLength(0);
  expect(runs).toHaveLength(0);
});

test("a wrong pairing code gets a generic reply and does not pair", async () => {
  await startBot();
  codes.issue("dm");
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: STRANGER, content: "/xr pair 000000" }));
  await waitFor(() => contents(DM).length === 1);
  expect(contents(DM)[0]).toMatch(/not valid or has expired/);
  expect(access.isPaired(STRANGER)).toBe(false);
});

test("a correct /xr pair in a DM pairs the user and the code cannot be reused", async () => {
  await startBot();
  const { code } = codes.issue("dm");
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: `/xr pair ${code}` }));
  await waitFor(() => contents(DM).some((c) => c.startsWith("Paired.")));
  expect(access.isPaired(OWNER)).toBe(true);
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m2", channelId: DM, userId: STRANGER, content: `/xr pair ${code}` }));
  await waitFor(() => contents(DM).length === 2);
  expect(access.isPaired(STRANGER)).toBe(false);
});

test("paired DM text runs a task, shows Working on it, and posts the answer with a footer", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "what is 2+2" }));
  await waitFor(() => contents(DM).some((c) => c.includes("Answer to")));
  expect(contents(DM)).toContain("Working on it.");
  const answer = contents(DM).find((c) => c.includes("Answer to"))!;
  expect(answer).toContain("what is 2+2");
  expect(answer).toContain("-# completed · 120 tokens");
  expect(mock.calls.some((c) => c.path === `/channels/${DM}/typing`)).toBe(true);
  expect(runs[0]?.task).toContain("what is 2+2");
});

test("a long answer is split into messages of at most 2000 characters", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "long answer please" }));
  await waitFor(() => contents(DM).some((c) => c.includes("continued")) || contents(DM).length >= 3, 6000);
  const parts = contents(DM).filter((c) => c !== "Working on it.");
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
});

test("a second task in the same chat while one runs gets the busy reply", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "hold this" }));
  await waitFor(() => runs.length === 1);
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m2", channelId: DM, userId: OWNER, content: "another" }));
  await waitFor(() => contents(DM).includes(BUSY_REPLY));
  gate.resolve?.();
  await waitFor(() => contents(DM).some((c) => c.includes("held")));
});

test("/xr stop cancels the running task", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "hold it" }));
  await waitFor(() => runs.length === 1);
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m2", channelId: DM, userId: OWNER, content: "/xr stop" }));
  await waitFor(() => contents(DM).includes("Stopping."));
  expect(runs[0]!.signal.aborted).toBe(true);
  gate.resolve?.();
});

// ── guild channels ───────────────────────────────────────────────────────────

test("a guild message in a non-whitelisted channel is ignored, even from a paired user", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", guildMessage({ id: "g1", channelId: OTHER_CHANNEL, userId: OWNER, content: "xr hello" }));
  await new Promise((r) => setTimeout(r, 150));
  expect(posts(OTHER_CHANNEL)).toHaveLength(0);
  expect(runs).toHaveLength(0);
});

test("/xr pairchannel with a valid code whitelists the channel, then prefixed messages are answered", async () => {
  pairOwner();
  await startBot();
  const { code } = codes.issue("channel");
  mock.dispatch("MESSAGE_CREATE", guildMessage({ id: "g1", channelId: GUILD_CHANNEL, userId: OWNER, content: `/xr pairchannel ${code}` }));
  await waitFor(() => contents(GUILD_CHANNEL).some((c) => c.includes("This channel is allowed")));
  expect(access.isAllowedChannel("2000000000000000001", GUILD_CHANNEL)).toBe(true);

  mock.dispatch("MESSAGE_CREATE", guildMessage({ id: "g2", channelId: GUILD_CHANNEL, userId: OWNER, content: "xr summarise the build" }));
  await waitFor(() => contents(GUILD_CHANNEL).some((c) => c.includes("Answer to")));
  expect(runs.at(-1)?.task).toContain("summarise the build");
});

test("an unpaired user cannot whitelist a channel", async () => {
  await startBot();
  const { code } = codes.issue("channel");
  mock.dispatch("MESSAGE_CREATE", guildMessage({ id: "g1", channelId: GUILD_CHANNEL, userId: STRANGER, content: `/xr pairchannel ${code}` }));
  await new Promise((r) => setTimeout(r, 150));
  expect(posts(GUILD_CHANNEL)).toHaveLength(0);
  expect(access.isAllowedChannel("2000000000000000001", GUILD_CHANNEL)).toBe(false);
});

test("in an allowed channel, plain chat is ignored; a mention addresses XR", async () => {
  pairOwner();
  access.allowChannel("2000000000000000001", GUILD_CHANNEL, OWNER);
  await startBot();
  mock.dispatch("MESSAGE_CREATE", guildMessage({ id: "g1", channelId: GUILD_CHANNEL, userId: OWNER, content: "just chatting with friends" }));
  await new Promise((r) => setTimeout(r, 120));
  expect(runs).toHaveLength(0);
  mock.dispatch("MESSAGE_CREATE", guildMessage({ id: "g2", channelId: GUILD_CHANNEL, userId: OWNER, content: `<@${MOCK_BOT_ID}> what time is it`, mentions: [MOCK_BOT_ID] }));
  await waitFor(() => runs.length === 1);
  expect(runs[0]!.task).toContain("what time is it");
});

test("the bot ignores messages from bots, including itself", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", { ...dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "hi" }), author: { id: MOCK_BOT_ID, username: "XR", bot: true } });
  await new Promise((r) => setTimeout(r, 120));
  expect(runs).toHaveLength(0);
});

// ── slash commands and interactions ──────────────────────────────────────────

function slash(opts: { userId: string; channelId: string; guildId?: string; sub: string; options?: Array<{ name: string; type: number; value: string }> }) {
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    type: 2,
    token: "itok",
    application_id: MOCK_APP_ID,
    channel_id: opts.channelId,
    ...(opts.guildId ? { guild_id: opts.guildId } : {}),
    user: { id: opts.userId, username: "owner" },
    data: { name: "xr", options: [{ name: opts.sub, type: 1, options: opts.options ?? [] }] },
  };
}

test("/xr budget from a paired DM is acknowledged ephemerally and answered on the original", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("INTERACTION_CREATE", slash({ userId: OWNER, channelId: DM, sub: "budget" }));
  await waitFor(() => mock.calls.some((c) => c.method === "PATCH" && c.path.endsWith("/@original")));
  const defer = mock.calls.find((c) => c.path.includes("/callback"));
  expect(defer?.body?.type).toBe(5);
  expect(defer?.body?.data?.flags).toBe(64);
  const orig = mock.calls.find((c) => c.path.endsWith("/@original"));
  expect(String(orig?.body?.content)).toContain("Spend today");
});

test("a slash command from an unpaired user gets one ephemeral generic reply and nothing else", async () => {
  await startBot();
  mock.dispatch("INTERACTION_CREATE", slash({ userId: STRANGER, channelId: DM, sub: "ask", options: [{ name: "message", type: 3, value: "hi" }] }));
  await waitFor(() => mock.calls.some((c) => c.path.includes("/callback")));
  const cb = mock.calls.find((c) => c.path.includes("/callback"));
  expect(cb?.body?.type).toBe(4);
  expect(cb?.body?.data?.flags).toBe(64);
  expect(cb?.body?.data?.content).toBe(NOT_HERE_REPLY);
  expect(mock.calls.some((c) => c.path.endsWith("/@original"))).toBe(false);
  expect(runs).toHaveLength(0);
});

test("/xr ask from a whitelisted channel runs publicly (defer with no ephemeral flag)", async () => {
  pairOwner();
  access.allowChannel("2000000000000000001", GUILD_CHANNEL, OWNER);
  await startBot();
  mock.dispatch(
    "INTERACTION_CREATE",
    slash({ userId: OWNER, channelId: GUILD_CHANNEL, guildId: "2000000000000000001", sub: "ask", options: [{ name: "message", type: 3, value: "status?" }] }),
  );
  await waitFor(() => mock.calls.some((c) => c.path.endsWith("/@original") && String(c.body?.content).includes("Answer to")));
  const defer = mock.calls.find((c) => c.path.includes("/callback"));
  expect(defer?.body?.type).toBe(5);
  expect(defer?.body?.data?.flags).toBe(0);
});

// ── approvals ────────────────────────────────────────────────────────────────

function approvalIdFromCard(): string {
  const card = posts(DM).find((c) => Array.isArray(c.body?.components));
  const btn = card?.body.components[0].components[0];
  return String(btn.custom_id).split(":")[2]!;
}

test("an approval shows buttons; a button press from the chat decides it and the agent continues", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "please ask for approval" }));
  await waitFor(() => posts(DM).some((c) => Array.isArray(c.body?.components)));
  const id = approvalIdFromCard();
  expect(posts(DM).find((c) => Array.isArray(c.body?.components))?.body.embeds[0].title).toContain("Approval needed");

  mock.dispatch("INTERACTION_CREATE", {
    id: "btn1",
    type: 3,
    token: "btok",
    application_id: MOCK_APP_ID,
    channel_id: DM,
    user: { id: OWNER, username: "owner" },
    data: { custom_id: `xr:approve:${id}`, component_type: 2 },
  });
  await waitFor(() => contents(DM).some((c) => c.startsWith("Saved.")));
  const update = mock.calls.find((c) => c.path === "/interactions/btn1/btok/callback");
  expect(update?.body?.type).toBe(7);
  expect(update?.body?.data?.content).toContain("Approved from discord");
});

test("a button press from an unpaired user is refused and decides nothing", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "please ask for approval" }));
  await waitFor(() => posts(DM).some((c) => Array.isArray(c.body?.components)));
  const id = approvalIdFromCard();
  mock.dispatch("INTERACTION_CREATE", {
    id: "btn2",
    type: 3,
    token: "btok2",
    application_id: MOCK_APP_ID,
    channel_id: DM,
    user: { id: STRANGER, username: "stranger" },
    data: { custom_id: `xr:approve:${id}`, component_type: 2 },
  });
  await waitFor(() => mock.calls.some((c) => c.path === "/interactions/btn2/btok2/callback"));
  expect(mock.calls.find((c) => c.path === "/interactions/btn2/btok2/callback")?.body?.data?.content).toBe(NOT_HERE_REPLY);
  expect(getApprovalStore(store).get(id)?.decision ?? null).toBeNull();
});

test("a decision from another surface edits the Discord card so no stale buttons remain", async () => {
  pairOwner();
  await startBot();
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "please ask for approval" }));
  await waitFor(() => posts(DM).some((c) => Array.isArray(c.body?.components)));
  const id = approvalIdFromCard();
  getApprovalStore(store).decide(id, true, { channel: "desktop", userId: "local" });
  await waitFor(() => mock.calls.some((c) => c.method === "PATCH" && c.path.startsWith(`/channels/${DM}/messages/`)));
  const edit = mock.calls.find((c) => c.method === "PATCH" && c.path.startsWith(`/channels/${DM}/messages/`));
  expect(edit?.body?.content).toBe("✅ Approved from desktop · write_file");
  expect(edit?.body?.components).toEqual([]);
});

// ── transport resilience ─────────────────────────────────────────────────────

test("a 429 on a message write waits and retries, then the answer still lands", async () => {
  pairOwner();
  await startBot();
  mock.rateLimitOnce(/\/channels\/\d+\/messages$/, 0.05);
  mock.dispatch("MESSAGE_CREATE", dmMessage({ id: "m1", channelId: DM, userId: OWNER, content: "what is up" }));
  await waitFor(() => contents(DM).some((c) => c.includes("Answer to")), 6000);
  // The first Working-on-it write was rate limited, so there are at least two attempts for it.
  expect(posts(DM).filter((c) => c.body?.content === "Working on it.").length).toBeGreaterThanOrEqual(2);
});

test("a fatal gateway close (disallowed intent) stops the bot and does not retry", async () => {
  await startBot();
  mock.closeGateway(4014);
  await waitFor(() => statuses.includes("fatal"));
  await new Promise((r) => setTimeout(r, 1300));
  expect(mock.connections).toBe(1);
  expect(bot.info.running).toBe(false);
});

test("a transient gateway close reconnects", async () => {
  await startBot();
  expect(mock.connections).toBe(1);
  mock.closeGateway(1006);
  await waitFor(() => mock.connections >= 2, 4000);
  expect(statuses).toContain("reconnecting");
});

test("gateway client: heartbeat acks reset the zombie check (no reconnect while acked)", async () => {
  let beats = 0;
  const frames: string[] = [];
  class FakeWs {
    private listeners: Record<string, Array<(ev: any) => void>> = {};
    constructor(_url: string) {
      queueMicrotask(() => this.emit("message", { data: JSON.stringify({ op: 10, d: { heartbeat_interval: 20 } }) }));
    }
    addEventListener(t: string, fn: (ev: any) => void) {
      (this.listeners[t] ??= []).push(fn);
    }
    send(data: string) {
      frames.push(data);
      const f = JSON.parse(data);
      if (f.op === 1) {
        beats += 1;
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({ op: 11 }) }));
      }
    }
    close() {
      this.emit("close", { code: 1000 });
    }
    emit(t: string, ev: any) {
      for (const fn of this.listeners[t] ?? []) fn(ev);
    }
  }
  const gw = new DiscordGateway({
    token: TOKEN,
    intents: 1,
    url: "ws://fake/gateway",
    WebSocketCtor: FakeWs as never,
    onReady: () => {},
    onDispatch: () => {},
    onStatus: () => {},
    random: () => 0.5,
  });
  gw.start();
  await new Promise((r) => setTimeout(r, 150));
  gw.stop();
  expect(beats).toBeGreaterThanOrEqual(3);
  expect(frames.some((f) => JSON.parse(f).op === 2)).toBe(true);
});
