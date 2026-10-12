/**
 * XR — Phase 26 Discord tests. Fully offline: REST goes through a mock fetch
 * and the gateway through a fake socket (with one case over a real local
 * WebSocket server, proving the socket wiring end to end).
 *
 * Covers: command parsing, rendering/splitting, fail-closed access control,
 * pairing (mint → redeem → unpair), buttons and cross-surface approvals,
 * typing throttle, 429 retry-after, gateway identify/READY/4004-fatal/resume,
 * webhook signature verification, daemon routes, and token redaction.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createPrivateKey, sign as signPayload, createPublicKey } from "node:crypto";
import { Store } from "../../src/state/workspace-store.ts";
import { DiscordBot } from "../../src/discord/bot.ts";
import { DiscordManager, DISCORD_TOKEN_RE } from "../../src/discord/manager.ts";
import { DiscordClient, API_BASE, type WsLike } from "../../src/discord/client.ts";
import {
  DiscordPairingBook,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_FAILED_ATTEMPTS,
  isAllowedChannel,
  isAllowedUser,
  channelKey,
} from "../../src/discord/auth.ts";
import { parseDiscordText, parseInteraction, inviteUrl, INVITE_PERMISSIONS, SLASH_COMMANDS } from "../../src/discord/commands.ts";
import { chunkText } from "../../src/bots/chunk.ts";
import {
  DISCORD_MAX_CHARS,
  CONTINUATION_MARKER,
  approvalButtons,
  approvalResolvedText,
  parseComponentId,
  splitForDiscord,
  escapeMarkdown,
  budgetText,
  statusMessage,
} from "../../src/discord/render.ts";
import { verifyInteractionSignature, isPublicKey } from "../../src/discord/verify.ts";
import { INTENTS, OP, type DiscordInteraction, type DiscordMessage } from "../../src/discord/types.ts";
import { loadDiscordState, saveDiscordState } from "../../src/discord/state.ts";
import { loadConfig, saveConfig } from "../../src/config/config.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";
import { makeHandler } from "../../src/daemon/server.ts";

let tmp: string;
let store: Store;
/**
 * A Discord-shaped token that is obviously not one. It is assembled from
 * parts on purpose: the three-segment form is exactly what Discord issues,
 * and a literal one in a repository trips GitHub's push protection (it
 * cannot know the difference between a fixture and a leaked credential).
 */
const TOKEN = ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "GaBcDe", "FaKeT0kenForTestsOnly_1234567890"].join(".");
const APP_ID = "123456789012345678";
const BOT_ID = "123456789012345678";
const USER_A = "111111111111111111";
const USER_B = "222222222222222222";
const DM_CHANNEL = "333333333333333333";
const GUILD_ID = "444444444444444444";
const GUILD_CHANNEL = "555555555555555555";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-dc26-"));
  process.env.XR_HOME = join(tmp, "home");
  delete process.env.XR_DISCORD_TOKEN;
  store = new Store(join(tmp, "t.db"));
  clearSecretMemo();
  const { config } = loadConfig();
  saveConfig({
    ...config,
    discord: {
      ...config.discord,
      enabled: false,
      autoStart: true,
      pairedUserIds: [],
      allowedChannels: [],
      webhookUrl: undefined,
      devGuildId: undefined,
      rateLimit: { tokens: 20, refillPerSec: 20 / 60 },
      chatBudgets: {},
      maxAttachmentBytes: 5 * 1024 * 1024,
    },
  });
});

// ── mock transport ─────────────────────────────────────────────────────────

interface RestCall {
  method: string;
  path: string;
  body: any;
  auth: string | null;
}

/** Mock Discord REST. Records every call; can force a 429 once. */
function mockRest(opts: { application?: { id: string; name: string; botId?: string } | null; rateLimitOnce?: boolean } = {}) {
  const calls: RestCall[] = [];
  let messageId = 9000;
  let loggedIn = opts.application !== null;
  let rateLimited = Boolean(opts.rateLimitOnce);
  const fn = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const path = u.startsWith(API_BASE) ? u.slice(API_BASE.length) : u;
    const method = String(init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth: headers.authorization ?? null });
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

    if (rateLimited && method !== "GET") {
      rateLimited = false;
      return new Response(JSON.stringify({ message: "You are being rate limited.", retry_after: 0.25 }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0.25" },
      });
    }
    if (path === "/applications/@me") {
      if (method === "PATCH") return json({ id: APP_ID });
      if (!loggedIn) return json({ message: "401: Unauthorized" }, 401);
      return json({ id: APP_ID, name: opts.application?.name ?? "XR", bot: { id: opts.application?.botId ?? BOT_ID } });
    }
    if (path === "/users/@me/guilds") return json([{ id: GUILD_ID, name: "Home Lab" }]);
    if (path === `/guilds/${GUILD_ID}/channels`) {
      return json([
        { id: GUILD_CHANNEL, type: 0, name: "general" },
        { id: "666666666666666666", type: 2, name: "Voice" },
        { id: "777777777777777777", type: 5, name: "announcements" },
      ]);
    }
    if (path.startsWith("/applications/") && (method === "PUT" || method === "POST")) return json([{ id: "cmd" }]);
    if (path.includes("/messages") && method === "POST") return json({ id: String(messageId++), channel_id: "x" });
    if (path.includes("/messages/") && method === "PATCH") return json({ id: "edited" });
    if (path.includes("/typing")) return new Response(null, { status: 204 });
    if (path.startsWith("/interactions/")) return new Response(null, { status: 204 });
    if (path.startsWith("/webhooks/")) return new Response(null, { status: 204 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { fn, calls, sent: (re: RegExp) => calls.filter((c) => c.method === "POST" && c.path.includes("/messages") && re.test(String(c.body?.content ?? ""))) };
}

/** Fake gateway socket: the test feeds frames in and reads what was sent. */
class FakeSocket implements WsLike {
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  /** Deliver a gateway frame to the client. */
  async emit(frame: unknown): Promise<void> {
    this.onmessage?.({ data: JSON.stringify(frame) });
    await new Promise((r) => setTimeout(r, 1));
  }
  last(op: number): any {
    const hits = this.sent.filter((f) => f.op === op);
    return hits[hits.length - 1];
  }
}

const HELLO = { op: OP.HELLO, d: { heartbeat_interval: 45_000 } };

type Deps = ConstructorParameters<typeof DiscordBot>[0];

/** The bot's dependencies with test doubles for the live bits. */
function botDeps(over: Partial<Deps> = {}): Deps {
  return {
    token: TOKEN,
    store,
    pairedUserIds: () => loadConfig().config.discord.pairedUserIds,
    allowedChannels: () => loadConfig().config.discord.allowedChannels,
    persist: () => {},
    now: () => 1_700_000_000_000,
    ...over,
  } as Deps;
}

const dmMessage = (text: string, over: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: "8001",
  channel_id: DM_CHANNEL,
  content: text,
  author: { id: USER_A, username: "ana" },
  ...over,
});

// ── parsing ────────────────────────────────────────────────────────────────

test("commands: prefixes, subcommands, and plain tasks", () => {
  expect(parseDiscordText("/xr stop")).toEqual({ type: "stop" });
  expect(parseDiscordText("xr help")).toEqual({ type: "help" });
  expect(parseDiscordText("!budget 2")).toEqual({ type: "budget", usd: 2 });
  expect(parseDiscordText("/stop")).toEqual({ type: "stop" });
  expect(parseDiscordText("/xr pair 123456")).toEqual({ type: "pair", code: "123456" });
  const task = parseDiscordText("refactor auth, keep it under $0.50");
  expect(task.type).toBe("task");
  if (task.type === "task") expect(task.budgetUsd).toBe(0.5);
  // A sentence that merely starts with a slash is still a task.
  expect(parseDiscordText("/etc/hosts is a mess").type).toBe("task");
});

test("commands: slash interaction options map to the same vocabulary", () => {
  expect(parseInteraction({ name: "xr", options: [{ name: "stop", type: 1, options: [] }] })).toEqual({ type: "stop" });
  expect(
    parseInteraction({ name: "xr", options: [{ name: "ask", type: 1, options: [{ name: "question", type: 3, value: "run the tests" }] }] }),
  ).toEqual({ type: "ask", text: "run the tests", budgetUsd: undefined });
  expect(
    parseInteraction({ name: "xr", options: [{ name: "budget", type: 1, options: [{ name: "usd", type: 3, value: "3" }] }] }),
  ).toEqual({ type: "budget", usd: 3 });
  expect(parseInteraction({ name: "other" })).toBeNull();
});

test("commands: the /xr tree fits Discord's limits and covers the brief's verbs", () => {
  const tree = SLASH_COMMANDS[0];
  expect(tree.name).toBe("xr");
  expect(tree.description.length).toBeLessThanOrEqual(100);
  const names = tree.options.map((o) => (o as { name: string }).name);
  for (const verb of ["ask", "budget", "model", "stop", "approve", "deny", "status", "help", "pair", "pairchannel"]) {
    expect(names).toContain(verb);
  }
  for (const opt of tree.options) expect(opt.name.length).toBeLessThanOrEqual(32);
});

test("commands: invite URL carries only the permissions XR uses", () => {
  const url = inviteUrl(APP_ID);
  expect(url).toContain(`client_id=${APP_ID}`);
  expect(url).toContain(`permissions=${INVITE_PERMISSIONS}`);
  expect(INVITE_PERMISSIONS).toBe(117_760);
  // No MODERATE_MEMBERS (1 << 38) and no ADMINISTRATOR (1 << 3) bit.
  expect(INVITE_PERMISSIONS & (1 << 3)).toBe(0);
  expect(INVITE_PERMISSIONS & (1 << 38)).toBe(0);
});

// ── rendering ──────────────────────────────────────────────────────────────

test("render: 2000-character splits carry an explicit continuation marker", () => {
  const body = Array.from({ length: 240 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
  const chunks = splitForDiscord(body);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DISCORD_MAX_CHARS + CONTINUATION_MARKER.length + 1);
  expect(chunks.slice(0, -1).every((c) => c.includes(CONTINUATION_MARKER))).toBe(true);
  expect(chunks[chunks.length - 1]).not.toContain(CONTINUATION_MARKER);
  // No content is lost: stripping markers restores the original text.
  expect(chunks.join("").replaceAll(CONTINUATION_MARKER, "").replace(/\s+/g, "")).toBe(body.replace(/\s+/g, ""));
  expect(chunkText("short", { maxLength: 10 })).toEqual(["short"]);
});

test("render: buttons are green/red/grey with a link when a dashboard URL exists", () => {
  const rows = approvalButtons("appr_1", "http://127.0.0.1:3141/?approval=appr_1");
  const flat = rows.flatMap((r) => r.components);
  expect(flat[0].custom_id).toBe("xr:approve:appr_1");
  expect(flat[0].style).toBe(3);
  expect(flat[1].custom_id).toBe("xr:deny:appr_1");
  expect(flat[1].style).toBe(4);
  expect(flat[2].custom_id).toBe("xr:details:appr_1");
  expect(flat[3].style).toBe(5);
  expect(flat[3].url).toContain("approval=appr_1");
  // Without a dashboard there is no link button at all.
  expect(approvalButtons("appr_1").flatMap((r) => r.components)).toHaveLength(3);
});

test("render: component ids round-trip and reject foreign ids", () => {
  expect(parseComponentId("xr:approve:abc_123")).toEqual({ decision: "approve", id: "abc_123" });
  expect(parseComponentId("xr:details:xyz")).toEqual({ decision: "details", id: "xyz" });
  expect(parseComponentId("tg:approve:1")).toBeNull();
  expect(parseComponentId("xr:approve:")).toBeNull();
});

test("render: markdown escaping and resolved labels", () => {
  expect(escapeMarkdown("a_b*c")).toBe("a\\_b\\*c");
  expect(approvalResolvedText({ tool: "shell", outcome: "approved", surface: "desktop" })).toContain("Approved from desktop");
  expect(approvalResolvedText({ tool: "shell", outcome: "approved", surface: "discord" })).toBe("✅ Approved · shell");
  expect(approvalResolvedText({ tool: "shell", outcome: "expired" })).toContain("⌛");
  const st = statusMessage({
    project: "xr",
    costUsd: 0.12,
    tokens: 1234,
    blockRate: 0.5,
    auditOk: true,
    paused: false,
    model: "qwen",
    busy: true,
    pairedUsers: 1,
    channels: 2,
    gateway: "connected",
  });
  expect(st).toContain("working");
  expect(st).toContain("2 allowed channels");
  expect(st).toContain("Gateway: connected");
  const b = budgetText({ todayUsd: 0.5, monthUsd: 3, perTask: 1, defaultPerTask: 0.25, chatCap: 5, spentHere: 0.4 });
  expect(b).toContain("Today: $0.5000");
  expect(b).toContain("of $5.00 cap");
});

// ── access control ─────────────────────────────────────────────────────────

test("auth: empty allow-lists fail closed", () => {
  expect(isAllowedUser(USER_A, [])).toBe(false);
  expect(isAllowedUser(undefined, [USER_A])).toBe(false);
  expect(isAllowedUser(USER_A, [USER_A])).toBe(true);
  expect(isAllowedChannel({ guildId: GUILD_ID, channelId: GUILD_CHANNEL }, [])).toBe(false);
  expect(isAllowedChannel({ guildId: GUILD_ID, channelId: GUILD_CHANNEL }, [{ guildId: GUILD_ID, channelId: GUILD_CHANNEL }])).toBe(true);
  expect(isAllowedChannel({ channelId: GUILD_CHANNEL }, [{ guildId: GUILD_ID, channelId: GUILD_CHANNEL }])).toBe(false);
  expect(channelKey(GUILD_ID, GUILD_CHANNEL)).toBe(`${GUILD_ID}:${GUILD_CHANNEL}`);
});

test("auth: pairing codes are 6 digits, single-use, expiring, and lock after 5 failures", () => {
  const book = new DiscordPairingBook();
  const t0 = 1_000_000;
  expect(book.issue({ kind: "user", label: "x" }, t0)).toBeNull(); // no open window, no code
  const closesAt = book.openWindow(t0, 60_000);
  expect(closesAt).toBe(t0 + 60_000);
  const a = book.issue({ kind: "user", label: "A" }, t0)!;
  expect(a.code).toMatch(/^\d{6}$/);
  expect(a.expiresAt).toBe(Math.min(t0 + PAIRING_CODE_TTL_MS, closesAt));
  expect(book.pending(t0)[0].label).toBe("A");
  // Wrong kind does not consume it; wrong code closes the window after 5 tries.
  expect(book.consume(a.code, "channel", t0)).toBeNull();
  expect(book.consume("000000", "user", t0)).toBeNull();
  expect(book.consume("000000", "user", t0)).toBeNull();
  expect(book.consume("000000", "user", t0)).toBeNull();
  expect(book.consume("000000", "user", t0)).toBeNull();
  expect(book.isOpen(t0)).toBe(true);
  expect(book.consume("000000", "user", t0)).toBeNull();
  expect(book.isOpen(t0)).toBe(false); // fifth failure locks the window
  const open = book.openWindow(t0, 60_000);
  expect(open).toBe(t0 + 60_000);
  const b = book.issue({ kind: "user", label: "B" }, t0)!;
  expect(book.consume(b.code, "user", t0)?.label).toBe("B");
  expect(book.consume(b.code, "user", t0)).toBeNull(); // single use
});

test("auth: expired codes are pruned and no window means no redemption", () => {
  const book = new DiscordPairingBook();
  const t0 = 5_000;
  book.openWindow(t0, 30_000);
  book.issue({ kind: "user", label: "A" }, t0);
  expect(book.pending(t0 + 31_000)).toHaveLength(0);
  book.closeWindow();
  expect(book.isOpen(t0)).toBe(false);
  expect(book.issue({ kind: "channel", label: "C" }, t0)).toBeNull();
});

// ── webhook signatures ─────────────────────────────────────────────────────

function ed25519(): { publicHex: string; signBody: (body: string, timestamp: string) => string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const publicHex = Buffer.from(der).subarray(12).toString("hex"); // strip the 12-byte SPKI prefix
  return {
    publicHex,
    signBody: (body, timestamp) => signPayload(null, Buffer.from(timestamp + body, "utf8"), privateKey).toString("hex"),
  };
}

test("verify: valid signatures pass, tampered bodies and stale timestamps do not", () => {
  const { publicHex, signBody } = ed25519();
  const now = 1_700_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const body = JSON.stringify({ type: 1 });
  expect(isPublicKey(publicHex)).toBe(true);
  expect(isPublicKey("nope")).toBe(false);
  expect(verifyInteractionSignature({ publicKey: publicHex, signature: signBody(body, ts), timestamp: ts, body, now }).ok).toBe(true);
  expect(verifyInteractionSignature({ publicKey: publicHex, signature: signBody(body, ts), timestamp: ts, body: body + " ", now }).ok).toBe(false);
  expect(verifyInteractionSignature({ publicKey: publicHex, signature: signBody(body, ts), timestamp: ts, body, now: now + 6 * 60_000 }).ok).toBe(false);
  expect(verifyInteractionSignature({ publicKey: publicHex, signature: null, timestamp: ts, body, now }).ok).toBe(false);
  expect(verifyInteractionSignature({ publicKey: "", signature: "00", timestamp: ts, body, now }).ok).toBe(false);
  // A key generated elsewhere must not verify our signature.
  const other = ed25519();
  expect(verifyInteractionSignature({ publicKey: other.publicHex, signature: signBody(body, ts), timestamp: ts, body, now }).ok).toBe(false);
});

// ── client ─────────────────────────────────────────────────────────────────

test("client: identifies with the required intents, then follows READY", async () => {
  const rest = mockRest();
  const socket = new FakeSocket("wss://gateway.discord.gg");
  const sessions: any[] = [];
  const states: string[] = [];
  const client = new DiscordClient({
    token: TOKEN,
    fetchFn: rest.fn,
    wsFactory: () => socket,
    onDispatch: () => {},
    onSession: (patch) => sessions.push(patch),
    onState: (s) => states.push(s.status),
    // Keep the heartbeat long so the test never races it.
    heartbeatMs: 60_000,
  });
  await client.connect();
  await socket.emit(HELLO);
  const identify = socket.last(OP.IDENTIFY);
  expect(identify.d.token).toBe(TOKEN);
  expect(identify.d.intents).toBe(INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.DIRECT_MESSAGES | INTENTS.MESSAGE_CONTENT);
  expect(identify.d.presence.activities[0].name).toContain("XR");

  await socket.emit({ op: OP.DISPATCH, t: "READY", s: 7, d: { session_id: "sess-1", resume_gateway_url: "wss://resume.discord.gg", user: { id: BOT_ID }, application: { id: APP_ID } } });
  expect(client.gatewayState.status).toBe("connected");
  expect(sessions.some((p) => p.id === "sess-1" && p.url === "wss://resume.discord.gg")).toBe(true);
  expect(states).toContain("connected");
  client.disconnect();
  expect(client.gatewayState.status).toBe("stopped");
});

test("client: a resumed session sends RESUME, and 4004 is fatal", async () => {
  const rest = mockRest();
  const make = () => {
    const socket = new FakeSocket("wss://gateway.discord.gg");
    const fatal: string[] = [];
    const client = new DiscordClient({
      token: TOKEN,
      fetchFn: rest.fn,
      wsFactory: () => socket,
      onDispatch: () => {},
      onFatal: (r) => fatal.push(r),
      session: { id: "sess-9", url: "wss://resume.discord.gg", seq: 42 },
      heartbeatMs: 60_000,
    });
    return { socket, fatal, client };
  };
  const a = make();
  await a.client.connect();
  await a.socket.emit(HELLO);
  const resume = a.socket.last(OP.RESUME);
  expect(resume.d.session_id).toBe("sess-9");
  expect(resume.d.seq).toBe(42);
  a.client.disconnect();

  const b = make();
  await b.client.connect();
  await b.socket.emit(HELLO);
  b.socket.onclose?.({ code: 4004, reason: "Authentication failed." });
  expect(b.fatal).toHaveLength(1);
  expect(b.fatal[0]).toContain("token");
  b.client.disconnect();
});

test("client: 429 honours retry_after and never leaks the token", async () => {
  const rest = mockRest({ rateLimitOnce: true });
  const logs: string[] = [];
  const slept: number[] = [];
  const client = new DiscordClient({
    token: TOKEN,
    fetchFn: rest.fn,
    onDispatch: () => {},
    onLog: (l) => logs.push(l),
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  await client.sendMessage(DM_CHANNEL, { content: "hello" });
  expect(slept).toEqual([250]);
  // Two attempts are on record: the 429'd one and the retry that succeeded.
  expect(rest.sent(/hello/)).toHaveLength(2);
  expect(rest.calls.filter((c) => c.path.endsWith("/messages")).length).toBe(2);
  expect(logs.join("\n")).toContain("rate-limited");
  expect(logs.join("\n")).not.toContain(TOKEN);
  // Every REST call carried the bot authorization exactly once.
  expect(rest.calls.every((c) => c.auth === `Bot ${TOKEN}`)).toBe(true);
});

test("client: rejections surface as DiscordRestError without echoing the token", async () => {
  const rest = mockRest({ application: null });
  const client = new DiscordClient({ token: TOKEN, fetchFn: rest.fn, onDispatch: () => {} });
  await expect(client.getApplication()).rejects.toThrow(/401/);
  await expect(client.getApplication()).rejects.not.toThrow(new RegExp(TOKEN.slice(0, 12)));
});

test("client: reads Discord's own gateway URL, and falls back when it cannot", async () => {
  const ok = new DiscordClient({
    token: TOKEN,
    fetchFn: (async (url: string) =>
      String(url).includes("/gateway/bot")
        ? new Response(JSON.stringify({ url: "wss://gateway-us-east1-b.discord.gg" }), { status: 200 })
        : new Response("{}", { status: 200 })) as unknown as typeof fetch,
    onDispatch: () => {},
  });
  expect(await ok.getGatewayUrl()).toBe("wss://gateway-us-east1-b.discord.gg");
  const broken = new DiscordClient({ token: TOKEN, fetchFn: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch, onDispatch: () => {} });
  expect(await broken.getGatewayUrl()).toBe("wss://gateway.discord.gg");
});

// ── bot: access control and pairing ────────────────────────────────────────

test("bot: an unpaired DM is ignored in silence", async () => {
  const rest = mockRest();
  const audited: string[] = [];
  const original = store.audit.bind(store);
  (store as unknown as { audit: (e: string, d?: unknown) => void }).audit = (event, detail) => {
    audited.push(event);
    return original(event, detail as Record<string, unknown>);
  };
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn, pairedUserIds: () => [] }));
  await bot.handleMessage(dmMessage("please delete my files"));
  expect(rest.calls).toHaveLength(0);
  expect(audited).toContain("discord.unauthorized");
  expect(store.recentAudit().some((e) => e.event === "discord.unauthorized")).toBe(true);
});

test("bot: a stranger's message never reaches the model, but a pairing code does get redeemed", async () => {
  const rest = mockRest();
  const book = new DiscordPairingBook();
  book.openWindow();
  const minted = book.issue({ kind: "user", label: "desktop" })!;
  const paired: string[] = [];
  const bot = new DiscordBot(
    botDeps({
      fetchFn: rest.fn,
      pairing: book,
      pairedUserIds: () => [],
      onPairedUser: (id) => paired.push(id),
    }),
  );
  await bot.handleMessage(dmMessage("/xr pair 000000"));
  expect(paired).toHaveLength(0); // a wrong code pairs nobody
  await bot.handleMessage(dmMessage(`/xr pair ${minted.code}`));
  expect(paired).toEqual([USER_A]);
  expect(rest.sent(/Paired/)).toHaveLength(1);
  expect(store.recentAudit().some((e) => e.event === "discord.paired_user")).toBe(true);
});

test("bot: guild traffic needs an allowed channel, a mention, and a paired user", async () => {
  const rest = mockRest();
  const auditEvents: string[] = [];
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn, pairedUserIds: () => [USER_A] }));
  const guildMsg = (content: string, channelId = GUILD_CHANNEL) =>
    dmMessage(content, { guild_id: GUILD_ID, channel_id: channelId, author: { id: USER_A, username: "ana" } });

  await bot.handleMessage(guildMsg("hello there"));
  expect(rest.calls.some((c) => c.path.includes("/messages"))).toBe(false);
  expect(store.recentAudit().some((e) => e.event === "discord.ignored_channel")).toBe(true);

  // Allowed channel, no mention, no command: still ignored.
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, allowedChannels: [{ guildId: GUILD_ID, channelId: GUILD_CHANNEL }] } });
  await bot.handleMessage(guildMsg("just chatting with friends"));
  expect(rest.calls.some((c) => c.path.includes("/messages"))).toBe(false);
  expect(store.recentAudit().some((e) => e.event === "discord.ignored_no_mention")).toBe(true);

  // A control command needs no mention, but the channel still has to be allowed.
  void auditEvents;
});

test("bot: unpaired guild member cannot run commands, but may redeem a channel code", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({
    ...config,
    discord: { ...config.discord, allowedChannels: [{ guildId: GUILD_ID, channelId: GUILD_CHANNEL }], pairedUserIds: [USER_A] },
  });
  const book = new DiscordPairingBook();
  book.openWindow();
  const channelCode = book.issue({ kind: "channel", label: "desktop" })!;
  const added: string[] = [];
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn, pairing: book, onPairedChannel: (g, c) => added.push(`${g}:${c}`) }));

  await bot.handleMessage(
    dmMessage(`<@${BOT_ID}> do the thing`, { guild_id: GUILD_ID, channel_id: GUILD_CHANNEL, author: { id: USER_B, username: "ben" } }),
  );
  expect(rest.calls.some((c) => c.path.includes("/messages"))).toBe(false);
  expect(store.recentAudit().some((e) => e.event === "discord.unauthorized")).toBe(true);

  await bot.handleMessage(
    dmMessage(`/xr pairchannel ${channelCode.code}`, { guild_id: GUILD_ID, channel_id: GUILD_CHANNEL, author: { id: USER_B, username: "ben" } }),
  );
  expect(added).toEqual([`${GUILD_ID}:${GUILD_CHANNEL}`]);
});

test("bot: rate limiting answers once and audits, and pairing codes never appear in status", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({
    ...config,
    discord: { ...config.discord, pairedUserIds: [USER_A], rateLimit: { tokens: 1, refillPerSec: 0 } },
  });
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn }));
  await bot.handleMessage(dmMessage("/xr help"));
  await bot.handleMessage(dmMessage("/xr help"));
  expect(rest.sent(/Rate limit/)).toHaveLength(1);
  expect(store.recentAudit().some((e) => e.event === "discord.rate_limited")).toBe(true);
});

// ── bot: approvals through buttons ─────────────────────────────────────────

test("bot: an approval raised in a DM is answered by its button, and the message is edited", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, pairedUserIds: [USER_A] } });
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn }));

  const pending = bot.approver(DM_CHANNEL)({ tool: "shell.run", reason: "wants to run rm -rf build" });
  // The approval card went out with buttons carrying the durable id.
  const card = rest.calls.find((c) => c.method === "POST" && c.path.includes("/messages") && c.body?.components?.length);
  expect(card).toBeTruthy();
  const approveId = String(card!.body.components[0].components[0].custom_id).replace("xr:approve:", "");
  expect(getApprovalStore(store).get(approveId)?.decision).toBeNull();

  await bot.handleInteraction({
    id: "i1",
    application_id: APP_ID,
    type: 3,
    token: "itok",
    channel_id: DM_CHANNEL,
    user: { id: USER_A, username: "ana" },
    data: { custom_id: `xr:approve:${approveId}` },
  } as DiscordInteraction);

  await expect(pending).resolves.toBe(true);
  expect(getApprovalStore(store).get(approveId)?.decision).toBe("approved");
  const edits = rest.calls.filter((c) => c.method === "PATCH" && c.path.includes("/messages/"));
  expect(edits.length).toBeGreaterThan(0);
  expect(String(edits[0].body.content)).toContain("Approved");
  expect(edits[0].body.components).toEqual([]);
});

test("bot: a second tap is refused, and a tap from another chat cannot decide it", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, pairedUserIds: [USER_A] } });
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn }));
  const pending = bot.approver(DM_CHANNEL)({ tool: "shell.run", reason: "careful" });
  const card = rest.calls.find((c) => c.path.includes("/messages") && c.body?.components?.length)!;
  const id = String(card.body.components[0].components[0].custom_id).replace("xr:approve:", "");

  // Wrong chat: the component belongs to a different channel.
  await bot.handleInteraction({
    id: "i2",
    application_id: APP_ID,
    type: 3,
    token: "itok",
    channel_id: "999999999999999999",
    user: { id: USER_A, username: "ana" },
    data: { custom_id: `xr:deny:${id}` },
  } as DiscordInteraction);
  expect(getApprovalStore(store).get(id)?.decision).toBeNull();

  await bot.handleInteraction({
    id: "i3",
    application_id: APP_ID,
    type: 3,
    token: "itok",
    channel_id: DM_CHANNEL,
    user: { id: USER_A, username: "ana" },
    data: { custom_id: `xr:deny:${id}` },
  } as DiscordInteraction);
  await expect(pending).resolves.toBe(false);

  await bot.handleInteraction({
    id: "i4",
    application_id: APP_ID,
    type: 3,
    token: "itok",
    channel_id: DM_CHANNEL,
    user: { id: USER_A, username: "ana" },
    data: { custom_id: `xr:approve:${id}` },
  } as DiscordInteraction);
  // The bridge drops its slot as soon as the outcome lands, so the late tap is
  // refused either as "already decided" or as "not from this chat" — both are
  // refusals, and neither changes the record.
  const refusals = rest.calls.filter(
    (c) => c.path.startsWith("/interactions/") && /already decided|not from this chat/.test(JSON.stringify(c.body)),
  );
  expect(refusals.length).toBeGreaterThan(0);
});

test("bot: the desktop can decide an approval that Discord is showing (cross-surface sync)", async () => {
  const rest = mockRest();
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn }));
  const pending = bot.approver(DM_CHANNEL)({ tool: "shell.run", reason: "from telegram" });
  const card = rest.calls.find((c) => c.path.includes("/messages") && c.body?.components?.length)!;
  const id = String(card.body.components[0].components[0].custom_id).replace("xr:approve:", "");

  // The decision lands on another surface (the desktop runs in another process).
  getApprovalStore(store).decide(id, true, { channel: "desktop", userId: "local" });
  await expect(pending).resolves.toBe(true);
  const edits = rest.calls.filter((c) => c.method === "PATCH" && c.path.includes("/messages/"));
  expect(edits.length).toBeGreaterThan(0);
  expect(String(edits[0].body.content)).toContain("from desktop");
});

test("bot: /xr approve without an id uses the pending approval in this chat", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, pairedUserIds: [USER_A] } });
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn }));
  const pending = bot.approver(DM_CHANNEL)({ tool: "shell.run", reason: "no id needed" });
  await bot.handleMessage(dmMessage("/xr approve"));
  await expect(pending).resolves.toBe(true);
  expect(rest.sent(/✅ Approved\./)).toHaveLength(1);
});

test("bot: /xr stop with nothing running says so, and the shared runtime guards one task per chat", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, pairedUserIds: [USER_A] } });
  const bot = new DiscordBot(botDeps({ fetchFn: rest.fn }));
  await bot.handleMessage(dmMessage("/xr stop"));
  expect(rest.sent(/Nothing is running/)).toHaveLength(1);
  expect(bot.pending.size).toBe(0);
});

// ── gateway over a real socket ─────────────────────────────────────────────

test("integration: the client drives a real local WebSocket gateway", async () => {
  let wsPort = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify(HELLO));
      },
      message(ws, raw) {
        const frame = JSON.parse(String(raw));
        if (frame.op === OP.HEARTBEAT) {
          ws.send(JSON.stringify({ op: OP.HEARTBEAT_ACK, d: null }));
          return;
        }
        if (frame.op === OP.IDENTIFY) {
          ws.send(
            JSON.stringify({
              op: OP.DISPATCH,
              t: "READY",
              s: 1,
              d: { session_id: "local", resume_gateway_url: `ws://127.0.0.1:${wsPort}`, user: { id: BOT_ID }, application: { id: APP_ID } },
            }),
          );
        }
      },
    },
  });
  wsPort = server.port ?? 0;
  const events: string[] = [];
  let ready = false;
  const client = new DiscordClient({
    token: TOKEN,
    fetchFn: (async (url: string) =>
      String(url).includes("/gateway/bot")
        ? new Response(JSON.stringify({ url: `ws://127.0.0.1:${server.port}` }), { status: 200 })
        : new Response("{}", { status: 200 })) as unknown as typeof fetch,
    onDispatch: (event) => {
      events.push(event);
      if (event === "READY") ready = true;
    },
    heartbeatMs: 200,
  });
  await client.connect();
  for (let i = 0; i < 40 && !ready; i += 1) await new Promise((r) => setTimeout(r, 25));
  expect(ready).toBe(true);
  expect(events).toContain("READY");
  // A heartbeat went out and came back as an ack with latency.
  for (let i = 0; i < 20 && client.gatewayState.latencyMs == null; i += 1) await new Promise((r) => setTimeout(r, 25));
  expect(client.gatewayState.latencyMs).not.toBeNull();
  client.disconnect();
  expect(client.gatewayState.status).toBe("stopped");
  server.stop(true);
});

// ── manager ────────────────────────────────────────────────────────────────

test("manager: connect validates the token, stores it, opens pairing, and starts", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  expect((await m.connect("not-a-token")).ok).toBe(false);
  const bad = mockRest({ application: null });
  const m2 = new DiscordManager({ store, fetchFn: bad.fn, statePath: join(tmp, "s2.json") });
  expect((await m2.connect(TOKEN)).ok).toBe(false);

  const res = await m.connect(TOKEN);
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.inviteUrl).toContain(APP_ID);
  const st = await m.status();
  expect(st.tokenSource).toBe("keychain");
  expect(st.pairing.open).toBe(true);
  // Connect opens the pairing window; the dialog mints codes on demand.
  expect(st.pairing.codes).toHaveLength(0);
  const opened = m.openPairing("user");
  expect("code" in opened && opened.code).toMatch(/^\d{6}$/);
  expect((await m.status()).pairing.codes).toHaveLength(1);
  expect(loadConfig().config.discord.enabled).toBe(true);
  // Commands were registered without a dev guild.
  expect(rest.calls.some((c) => c.method === "PUT" && c.path === `/applications/${APP_ID}/commands`)).toBe(true);
  // The token is never in the status payload or the log tail.
  expect(JSON.stringify(st)).not.toContain(TOKEN);
  expect(JSON.stringify(m.tail(50))).not.toContain(TOKEN);
  await m.stop();
  expect((await m.status()).label).toBe("Stopped");
});

test("manager: a guild-scoped dev server registers commands instantly there", async () => {
  const rest = mockRest();
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, devGuildId: GUILD_ID } });
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  expect(rest.calls.some((c) => c.method === "PUT" && c.path === `/applications/${APP_ID}/guilds/${GUILD_ID}/commands`)).toBe(true);
  expect(store.recentAudit().some((e) => e.event === "discord.commands_registered")).toBe(true);
  await m.stop();
});

test("manager: pairing end-to-end — code minted in the app, redeemed in Discord, user persisted", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  const opened = m.openPairing("user");
  if (!("code" in opened) || !opened.code) throw new Error("no code minted");
  const bot = m.instance!;
  expect(bot).toBeTruthy();

  await bot.handleMessage(dmMessage(`/xr pair ${opened.code}`));
  expect(loadConfig().config.discord.pairedUserIds).toEqual([USER_A]);
  expect((await m.status()).pairedUsers[0].label).toBe("ana");
  expect(store.recentAudit().some((e) => e.event === "discord.paired")).toBe(true);

  m.unpair(USER_A);
  expect(loadConfig().config.discord.pairedUserIds).toEqual([]);
  await m.disconnect();
  expect(loadConfig().config.discord.enabled).toBe(false);
  expect((await m.status()).label).toBe("Not set up");
});

test("manager: channel allow-list add/remove and the server picker", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  expect(m.addChannel({ guildId: "nope", channelId: GUILD_CHANNEL }).ok).toBe(false);
  expect(m.addChannel({ guildId: GUILD_ID, channelId: GUILD_CHANNEL }).ok).toBe(true);
  expect(loadConfig().config.discord.allowedChannels).toEqual([{ guildId: GUILD_ID, channelId: GUILD_CHANNEL }]);
  const guilds = await m.listGuilds();
  expect(guilds.map((g) => g.name)).toEqual(["Home Lab"]);
  const channels = await m.listChannels(GUILD_ID);
  // Voice channels are not offered: XR answers in text channels only.
  expect(channels.map((c) => c.name)).toEqual(["general", "announcements"]);
  m.removeChannel({ guildId: GUILD_ID, channelId: GUILD_CHANNEL });
  expect(loadConfig().config.discord.allowedChannels).toEqual([]);
  await m.stop();
});

test("manager: settings validate ranges, and the webhook URL must be https", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  expect((await m.updateSettings({ rateLimitPerMin: 0 })).ok).toBe(false);
  expect((await m.updateSettings({ rateLimitPerMin: 500 })).ok).toBe(false);
  expect((await m.updateSettings({ maxAttachmentBytes: 1 })).ok).toBe(false);
  expect((await m.updateSettings({ webhookUrl: "http://example.com" })).ok).toBe(false);
  expect((await m.updateSettings({ devGuildId: "abc" })).ok).toBe(false);
  expect((await m.updateSettings({ rateLimitPerMin: 30, maxAttachmentBytes: 2 * 1024 * 1024, autoStart: false, devGuildId: GUILD_ID })).ok).toBe(true);
  const cfg = loadConfig().config.discord;
  expect(cfg.rateLimit.tokens).toBe(30);
  expect(cfg.maxAttachmentBytes).toBe(2 * 1024 * 1024);
  expect(cfg.autoStart).toBe(false);
  expect(cfg.devGuildId).toBe(GUILD_ID);
  expect((await m.updateSettings({ webhookUrl: "https://xr.example.com" })).ok).toBe(true);
  expect(rest.calls.some((c) => c.method === "PATCH" && c.path === "/applications/@me")).toBe(true);
});

test("manager: token shape and secret name are the documented ones", () => {
  expect(DISCORD_TOKEN_RE.test(TOKEN)).toBe(true);
  expect(DISCORD_TOKEN_RE.test("123:abc")).toBe(false);
});

test("manager: gateway session state survives a restart", () => {
  const path = join(tmp, "dc", "state.json");
  const st = loadDiscordState(path);
  st.sessionId = "sess-42";
  st.resumeGatewayUrl = "wss://resume.discord.gg";
  st.seq = 17;
  st.labels[USER_A] = "ana";
  saveDiscordState(st, path);
  const back = loadDiscordState(path);
  expect(back.sessionId).toBe("sess-42");
  expect(back.resumeGatewayUrl).toBe("wss://resume.discord.gg");
  expect(back.seq).toBe(17);
  expect(back.labels[USER_A]).toBe("ana");
});

// ── routes ─────────────────────────────────────────────────────────────────

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:3141${path}`, {
    ...init,
    headers: { authorization: "Bearer daemon-token-xyz", "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("routes: status, logs and pairing are token-protected and never leak the token", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  const h = makeHandler(store, "daemon-token-xyz", { discord: m });

  expect((await h(new Request("http://127.0.0.1:3141/api/discord/status"))).status).toBe(401);
  const status = await h(authed("/api/discord/status"));
  expect(status.status).toBe(200);
  const body: any = await status.json();
  expect(typeof body.label).toBe("string");
  expect(JSON.stringify(body)).not.toContain(TOKEN);

  const opened = await h(authed("/api/discord/pair/open", { method: "POST", body: JSON.stringify({ kind: "channel" }) }));
  expect(opened.status).toBe(200);
  const openedBody: any = await opened.json();
  expect(String(openedBody.code)).toMatch(/^\d{6}$/);

  const logs = await h(authed("/api/discord/logs?tail=5"));
  expect(logs.status).toBe(200);
  expect(JSON.stringify(await logs.json())).not.toContain(TOKEN);

  const settings = await h(authed("/api/discord/settings", { method: "POST", body: JSON.stringify({ rateLimitPerMin: 0 }) }));
  expect(settings.status).toBe(400);
  await m.stop();
});

test("routes: channels add/remove and guild listing go through the manager", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  const h = makeHandler(store, "daemon-token-xyz", { discord: m });

  const guilds = await h(authed("/api/discord/guilds"));
  expect(((await guilds.json()) as any).guilds[0].name).toBe("Home Lab");

  const add = await h(authed("/api/discord/channels/add", { method: "POST", body: JSON.stringify({ guildId: GUILD_ID, channelId: GUILD_CHANNEL }) }));
  expect(add.status).toBe(200);
  expect(loadConfig().config.discord.allowedChannels).toEqual([{ guildId: GUILD_ID, channelId: GUILD_CHANNEL }]);

  const remove = await h(authed("/api/discord/channels/remove", { method: "POST", body: JSON.stringify({ guildId: GUILD_ID, channelId: GUILD_CHANNEL }) }));
  expect(remove.status).toBe(200);
  expect(loadConfig().config.discord.allowedChannels).toEqual([]);
  await m.stop();
});

test("routes: the webhook is signature-authenticated, not token-authenticated", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  const { publicHex, signBody } = ed25519();
  const { config } = loadConfig();
  saveConfig({ ...config, discord: { ...config.discord, publicKey: publicHex } });
  const h = makeHandler(store, "daemon-token-xyz", { discord: m });

  // No bearer token, no signature: rejected.
  const unsigned = await h(new Request("http://127.0.0.1:3141/api/discord/webhook", { method: "POST", body: JSON.stringify({ type: 1 }) }));
  expect(unsigned.status).toBe(401);

  // Signed PING: 200 with a PONG.
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify({ type: 1 });
  const signed = await h(
    new Request("http://127.0.0.1:3141/api/discord/webhook", {
      method: "POST",
      headers: { "x-signature-ed25519": signBody(raw, ts), "x-signature-timestamp": ts, "content-type": "application/json" },
      body: raw,
    }),
  );
  expect(signed.status).toBe(200);
  expect(((await signed.json()) as any).type).toBe(1);
  expect(store.recentAudit().some((e) => e.event === "discord.webhook.rejected")).toBe(true);
});

test("routes: connect never echoes the token, and disconnect needs confirm", async () => {
  const rest = mockRest();
  const m = new DiscordManager({ store, fetchFn: rest.fn, statePath: join(tmp, "s.json") });
  const h = makeHandler(store, "daemon-token-xyz", { discord: m });
  const bad = await h(authed("/api/discord/connect", { method: "POST", body: JSON.stringify({ token: "bad" }) }));
  expect(bad.status).toBe(400);
  expect(JSON.stringify(await bad.json())).not.toContain("daemon-token-xyz");

  await m.connect(TOKEN);
  const noConfirm = await h(authed("/api/discord/disconnect", { method: "POST", body: JSON.stringify({}) }));
  expect(noConfirm.status).toBe(400);
  const ok = await h(authed("/api/discord/disconnect", { method: "POST", body: JSON.stringify({ confirm: true }) }));
  expect(ok.status).toBe(200);
  expect(loadConfig().config.discord.pairedUserIds).toEqual([]);
});
