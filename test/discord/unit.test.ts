/**
 * XR — Phase 26 · Discord (PR 2): pure units.
 * Splitting, command grammar, pairing codes, persisted access, REST 429 handling,
 * invite URL and the intent and permission bitmasks from the brief.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitForDiscord, approvalCard, approvalDetails } from "../../src/discord/render.ts";
import { parseTextCommand, parseSlashCommand, stripBotMention, XR_COMMAND_DEFINITION } from "../../src/discord/commands.ts";
import { DiscordCodes, DiscordAccess, blankDiscordState, loadDiscordState, saveDiscordState, DISCORD_CODE_TTL_MS, DISCORD_MAX_FAILED_ATTEMPTS } from "../../src/discord/auth.ts";
import { DiscordRest } from "../../src/discord/rest.ts";
import { discordInviteUrl, DiscordManager } from "../../src/discord/manager.ts";
import { XR_INTENTS, XR_INVITE_PERMISSIONS, GatewayIntent, DISCORD_MAX_CHARS } from "../../src/discord/types.ts";
import { Store } from "../../src/state/workspace-store.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-discord-unit-"));
  process.env.XR_HOME = join(dir, "home");
});

// ── constants from the brief ─────────────────────────────────────────────────

test("gateway intents are 37377 (GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT)", () => {
  expect(XR_INTENTS).toBe(37377);
  expect(XR_INTENTS).toBe(GatewayIntent.GUILDS | GatewayIntent.GUILD_MESSAGES | GatewayIntent.DIRECT_MESSAGES | GatewayIntent.MESSAGE_CONTENT);
});

test("invite permissions are 51200 (send, embed, attach) and carry no history or admin bits", () => {
  expect(XR_INVITE_PERMISSIONS).toBe(51200);
  const readHistory = 1 << 16;
  const administrator = 1 << 3;
  expect(XR_INVITE_PERMISSIONS & readHistory).toBe(0);
  expect(XR_INVITE_PERMISSIONS & administrator).toBe(0);
});

test("invite URL carries the application id, bot and applications.commands scopes, and 51200", () => {
  const url = new URL(discordInviteUrl("1558728414045929595"));
  expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
  expect(url.searchParams.get("client_id")).toBe("1558728414045929595");
  expect(url.searchParams.get("permissions")).toBe("51200");
  expect(url.searchParams.get("scope")).toBe("bot applications.commands");
});

// ── splitting ────────────────────────────────────────────────────────────────

test("splitForDiscord leaves short text alone", () => {
  expect(splitForDiscord("hello")).toEqual(["hello"]);
});

test("splitForDiscord keeps every chunk within 2000 characters and marks continuation", () => {
  const para = "Lorem ipsum dolor sit amet. ".repeat(20) + "\n\n";
  const text = para.repeat(12);
  const chunks = splitForDiscord(text);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DISCORD_MAX_CHARS);
  for (const c of chunks.slice(0, -1)) expect(c.endsWith("(continued)")).toBe(true);
  expect(chunks[chunks.length - 1]!.endsWith("(continued)")).toBe(false);
});

test("splitForDiscord closes and reopens a code fence that spans a split", () => {
  const code = "const x = 1;\n".repeat(200);
  const text = `intro\n\`\`\`ts\n${code}\`\`\`\nafter`;
  const chunks = splitForDiscord(text);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) {
    expect(c.length).toBeLessThanOrEqual(DISCORD_MAX_CHARS);
    const fences = (c.match(/```/g) ?? []).length;
    expect(fences % 2).toBe(0);
  }
});

test("splitForDiscord never drops characters that are not whitespace", () => {
  const words = Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ");
  const chunks = splitForDiscord(words);
  const rejoined = chunks.map((c) => c.replace(/\n…\(continued\)$/, "")).join(" ");
  for (let i = 0; i < 600; i += 1) expect(rejoined).toContain(`w${i}`);
});

// ── commands ─────────────────────────────────────────────────────────────────

test("text: /xr prefix is always a command; /xr alone is help", () => {
  expect(parseTextCommand("/xr", { dm: true })).toEqual({ kind: "help" });
  expect(parseTextCommand("/xr stop", { dm: false })).toEqual({ kind: "stop" });
  expect(parseTextCommand("/xr ask what time is it", { dm: false })).toEqual({ kind: "ask", text: "what time is it" });
  expect(parseTextCommand("/xr what time is it", { dm: false })).toEqual({ kind: "ask", text: "what time is it" });
});

test("text: 'xr <subcommand>' is a command; 'xr <anything>' addresses XR as chat", () => {
  expect(parseTextCommand("xr budget", { dm: false })).toEqual({ kind: "budget" });
  expect(parseTextCommand("xr summarise the build", { dm: false })).toEqual({ kind: "chat", text: "summarise the build" });
  expect(parseTextCommand("xrays are cool", { dm: false })).toEqual({ kind: "none" });
});

test("text: plain DM text is chat; plain server text is ignored unless the bot was mentioned", () => {
  expect(parseTextCommand("hi there", { dm: true })).toEqual({ kind: "chat", text: "hi there" });
  expect(parseTextCommand("hi there", { dm: false })).toEqual({ kind: "none" });
  expect(parseTextCommand("hi there", { dm: false, mentioned: true })).toEqual({ kind: "chat", text: "hi there" });
});

test("text: pair and pairchannel need a code; missing code shows usage", () => {
  expect(parseTextCommand("/xr pair 123456", { dm: true })).toEqual({ kind: "pair", code: "123456" });
  expect(parseTextCommand("/xr pairchannel 654321", { dm: false })).toEqual({ kind: "pairchannel", code: "654321" });
  expect(parseTextCommand("/xr pair", { dm: true })).toMatchObject({ kind: "invalid" });
});

test("text: /xr ask with no message is a usage error, not a blank task", () => {
  expect(parseTextCommand("/xr ask", { dm: true })).toMatchObject({ kind: "invalid" });
});

test("slash: maps subcommands and options", () => {
  expect(parseSlashCommand([{ name: "ask", type: 1, options: [{ name: "message", type: 3, value: "hi" }] }])).toEqual({ kind: "ask", text: "hi" });
  expect(parseSlashCommand([{ name: "pair", type: 1, options: [{ name: "code", type: 3, value: "123456" }] }])).toEqual({ kind: "pair", code: "123456" });
  expect(parseSlashCommand([{ name: "approve", type: 1 }])).toEqual({ kind: "approve", id: undefined });
  expect(parseSlashCommand(undefined)).toEqual({ kind: "help" });
});

test("command registration defines one global /xr with the brief's subcommands", () => {
  const names = XR_COMMAND_DEFINITION.options.map((o) => o.name).sort();
  expect(XR_COMMAND_DEFINITION.name).toBe("xr");
  expect(names).toEqual(["approve", "ask", "budget", "deny", "help", "model", "pair", "pairchannel", "stop"]);
});

test("stripBotMention removes <@id> and <@!id> and reports the mention", () => {
  expect(stripBotMention("<@123> hello", "123")).toEqual({ text: "hello", mentioned: true });
  expect(stripBotMention("<@!123> hello", "123")).toEqual({ text: "hello", mentioned: true });
  expect(stripBotMention("<@999> hello", "123")).toEqual({ text: "<@999> hello", mentioned: false });
});

// ── pairing codes ────────────────────────────────────────────────────────────

test("pairing code is 6 digits, single-use, and expires after 10 minutes", () => {
  const codes = new DiscordCodes();
  const t0 = 1_000_000;
  const { code, expiresAt } = codes.issue("dm", t0);
  expect(code).toMatch(/^\d{6}$/);
  expect(expiresAt).toBe(t0 + DISCORD_CODE_TTL_MS);
  expect(codes.redeem("dm", code, t0 + 1)).toBe("ok");
  expect(codes.redeem("dm", code, t0 + 2)).toBe("invalid");
});

test("pairing code expires", () => {
  const codes = new DiscordCodes();
  const { code, expiresAt } = codes.issue("dm", 0);
  expect(codes.redeem("dm", code, expiresAt)).toBe("invalid");
});

test("five wrong guesses lock the code", () => {
  const codes = new DiscordCodes();
  const { code } = codes.issue("channel", 0);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 1; i < DISCORD_MAX_FAILED_ATTEMPTS; i += 1) expect(codes.redeem("channel", wrong, 0)).toBe("invalid");
  expect(codes.redeem("channel", wrong, 0)).toBe("locked");
  expect(codes.redeem("channel", code, 0)).toBe("locked");
});

test("dm and channel codes are independent", () => {
  const codes = new DiscordCodes();
  const dm = codes.issue("dm").code;
  codes.issue("channel");
  expect(codes.redeem("channel", dm)).not.toBe("ok");
});

// ── persisted access ─────────────────────────────────────────────────────────

test("access: pairing and allowed channels persist, and the state file is mode 0600", () => {
  const path = join(dir, "discord", "state.json");
  const state = blankDiscordState();
  const access = new DiscordAccess(state, (s) => saveDiscordState(s, path));
  access.pairUser("42");
  access.allowChannel("G1", "C1", "42");
  access.setChat("C1", { model: "m1" });

  const again = new DiscordAccess(loadDiscordState(path), (s) => saveDiscordState(s, path));
  expect(again.isPaired("42")).toBe(true);
  expect(again.isAllowedChannel("G1", "C1")).toBe(true);
  expect(again.isAllowedChannel("G2", "C1")).toBe(false);
  expect(again.chat("C1").model).toBe("m1");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readFileSync(path, "utf8")).not.toMatch(/Bot |token/i);
});

test("access: unpair and clearAccess remove who may talk to XR", () => {
  const path = join(dir, "discord", "state.json");
  const access = new DiscordAccess(blankDiscordState(), (s) => saveDiscordState(s, path));
  access.pairUser("42");
  access.unpair("42");
  expect(access.isPaired("42")).toBe(false);
  access.pairUser("43");
  access.allowChannel("G1", "C1", "43");
  access.clearAccess();
  expect(access.state.paired).toEqual([]);
  expect(access.state.channels).toEqual([]);
});

// ── approval card ────────────────────────────────────────────────────────────

test("approval card: three buttons carry the approval id; preview fences are neutralised", () => {
  const card = approvalCard({ id: "appr-1", tool: "shell", reason: "Run it", preview: "rm -rf ```x```", riskTier: "high" });
  const row = (card.components as Array<{ components: Array<{ custom_id: string; label: string }> }>)[0]!;
  expect(row.components.map((b) => b.custom_id)).toEqual(["xr:approve:appr-1", "xr:deny:appr-1", "xr:view:appr-1"]);
  const desc = (card.embeds as Array<{ description: string }>)[0]!.description;
  expect(desc).not.toContain("```x```");
  expect(approvalDetails({ id: "appr-1", tool: "shell", reason: "Run it" })).toContain("/xr approve appr-1");
});

// ── REST rate limiting ───────────────────────────────────────────────────────

test("REST: a 429 waits retry_after, then retries and succeeds", async () => {
  const waits: number[] = [];
  let calls = 0;
  const fetchFn = (async () => {
    calls += 1;
    if (calls === 1) return Response.json({ retry_after: 1.5 }, { status: 429 });
    return Response.json({ id: "ok" }, { status: 200 });
  }) as unknown as typeof fetch;
  const rest = new DiscordRest({ token: "x.y.z", fetchFn, sleep: async (ms) => void waits.push(ms) });
  const res = await rest.request<{ id: string }>("POST", "/channels/1/messages", { content: "hi" });
  expect(res.ok).toBe(true);
  expect(res.data?.id).toBe("ok");
  expect(calls).toBe(2);
  expect(waits[0]).toBe(1500);
});

test("REST: a 429 longer than maxWaitMs fails instead of stalling", async () => {
  const fetchFn = (async () => Response.json({ retry_after: 600 }, { status: 429 })) as unknown as typeof fetch;
  const rest = new DiscordRest({ token: "x.y.z", fetchFn, sleep: async () => {}, maxWaitMs: 1000 });
  const res = await rest.request("GET", "/users/@me");
  expect(res.status).toBe(429);
  expect(res.ok).toBe(false);
});

test("REST: sends the bot authorization header unless auth is disabled", async () => {
  const seen: Array<string | null> = [];
  const fetchFn = (async (_u: string, init: RequestInit) => {
    seen.push(new Headers(init.headers).get("authorization"));
    return Response.json({}, { status: 200 });
  }) as unknown as typeof fetch;
  const rest = new DiscordRest({ token: "tok", fetchFn });
  await rest.request("GET", "/users/@me");
  await rest.request("POST", "/interactions/1/abc/callback", {}, { auth: false });
  expect(seen).toEqual(["Bot tok", null]);
});

// ── manager boundaries ───────────────────────────────────────────────────────

function managerWith(fetchFn: typeof fetch, store: Store, secrets: Map<string, string>) {
  return new DiscordManager({
    store,
    statePath: join(dir, "discord", "state.json"),
    fetchFn,
    secrets: {
      get: async (n) => secrets.get(n),
      set: async (n, v) => void secrets.set(n, v),
      remove: async (n) => void secrets.delete(n),
    },
  });
}

test("manager: a malformed token is rejected before any network call", async () => {
  const store = new Store(join(dir, "t.db"));
  let networked = false;
  const fetchFn = (async () => {
    networked = true;
    return new Response("", { status: 500 });
  }) as unknown as typeof fetch;
  const mgr = managerWith(fetchFn, store, new Map());
  const res = await mgr.connect("not a token");
  expect(res.ok).toBe(false);
  expect(networked).toBe(false);
});

test("manager: a token Discord rejects is never stored", async () => {
  const store = new Store(join(dir, "t.db"));
  const secrets = new Map<string, string>();
  const fetchFn = (async () => Response.json({ message: "401" }, { status: 401 })) as unknown as typeof fetch;
  const mgr = managerWith(fetchFn, store, secrets);
  const res = await mgr.connect("MTAwMDAwMDAwMDAwMDAwMDAwMA.FAKETK.abcdefghijklmnopqrstuvwxyz0123456789");
  expect(res.ok).toBe(false);
  expect(secrets.size).toBe(0);
});

test("manager: status never includes the token and reports no pairings before any", async () => {
  const store = new Store(join(dir, "t.db"));
  const mgr = managerWith((async () => new Response("", { status: 500 })) as unknown as typeof fetch, store, new Map());
  const status = await mgr.status();
  expect(status.connected).toBe(false);
  expect(status.pairedUsers).toBe(0);
  expect(JSON.stringify(status)).not.toMatch(/Bot |MTAw/);
});
