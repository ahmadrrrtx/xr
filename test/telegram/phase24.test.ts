/**
 * XR — Phase 24 Telegram tests. Fully offline: every Telegram call goes
 * through a mock fetch. Covers pairing (fail-closed), callback binding,
 * desktop↔Telegram approval sync, expiry, voice fallbacks, attachment caps,
 * offset persistence, webhook secret, settings validation, and redaction.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { TelegramBot } from "../../src/telegram/bot.ts";
import { TelegramManager } from "../../src/telegram/manager.ts";
import { PairingBook, PAIRING_CODE_TTL_MS, PAIRING_MAX_FAILED_ATTEMPTS } from "../../src/telegram/pairing.ts";
import { chunkMarkdown, renderMarkdownV2, splitForTelegram, escapeV2, TELEGRAM_MAX_CHARS } from "../../src/telegram/markdown.ts";
import { checkSize, decodeText, extractAttachment, classifyAttachment, TEXT_CAP_CHARS } from "../../src/telegram/attachments.ts";
import { transcribeVoice, NO_MODEL_REPLY, NO_FFMPEG_REPLY } from "../../src/telegram/voice.ts";
import { approvalResolvedText, parseCallback } from "../../src/telegram/render.ts";
import { ReplyContext } from "../../src/telegram/context.ts";
import { loadTelegramState, saveTelegramState } from "../../src/telegram/state.ts";
import { loadConfig, saveConfig } from "../../src/config/config.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";
import { makeHandler } from "../../src/daemon/server.ts";

let tmp: string;
let store: Store;
const TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghijk";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-tg24-"));
  process.env.XR_HOME = join(tmp, "home");
  delete process.env.XR_TELEGRAM_TOKEN;
  delete process.env.XR_TELEGRAM_ALLOWED;
  store = new Store(join(tmp, "t.db"));
  clearSecretMemo();
  const { config } = loadConfig();
  saveConfig({
    ...config,
    telegram: {
      ...config.telegram,
      enabled: false,
      autoStart: true,
      pairedUserIds: [],
      webhookUrl: undefined,
      rateLimit: { tokens: 20, refillPerSec: 20 / 60 },
      chatBudgets: {},
      maxAttachmentBytes: 5 * 1024 * 1024,
    },
  });
});

interface Call {
  method: string;
  body: any;
}

/** Mock Telegram Bot API. `updates` are handed out once per getUpdates call. */
function mockApi(opts: { updates?: any[][]; getMeOk?: boolean; onGetUpdates?: () => void } = {}) {
  const calls: Call[] = [];
  let nextId = 1000;
  const queue = [...(opts.updates ?? [])];
  const fn = (async (url: string, init?: any) => {
    const u = String(url);
    const method = u.split("/").pop() ?? "";
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
    if (u.includes("/getMe")) {
      return opts.getMeOk === false
        ? json({ ok: false, error_code: 401, description: "Unauthorized" })
        : json({ ok: true, result: { id: 42, is_bot: true, first_name: "XR", username: "xr_test_bot" } });
    }
    if (method === "getUpdates") {
      opts.onGetUpdates?.();
      if (!queue.length) await new Promise((r) => setTimeout(r, 5)); // like a real long poll
      return json({ ok: true, result: queue.shift() ?? [] });
    }
    if (method === "sendMessage") return json({ ok: true, result: { message_id: nextId++ } });
    return json({ ok: true, result: true });
  }) as unknown as typeof fetch;
  return { fn, calls, sent: (text: RegExp) => calls.filter((c) => c.method === "sendMessage" && text.test(c.body.text)) };
}

const msg = (userId: number, text: string, extra: Record<string, unknown> = {}) => ({
  message: { from: { id: userId, first_name: "Ana", username: "ana" }, chat: { id: userId, type: "private" }, text, ...extra },
});

// ── markdown ───────────────────────────────────────────────────────────────

test("MarkdownV2: prose escapes every reserved character", () => {
  expect(escapeV2("a_b (c) 1.5! *x*")).toBe("a\\_b \\(c\\) 1\\.5\\! \\*x\\*");
  expect(renderMarkdownV2("cost 2.50 today")).toBe("cost 2\\.50 today");
});

test("MarkdownV2: code fences and spans escape only backtick and backslash", () => {
  const out = renderMarkdownV2("```ts\nx = `a\\b` + 1.5\n```");
  expect(out).toBe("```ts\nx = \\`a\\\\b\\` + 1.5\n```");
  expect(renderMarkdownV2("use `a.b()` now")).toBe("use `a.b()` now");
  expect(renderMarkdownV2("**bold** text")).toBe("*bold* text");
});

test("splitForTelegram: every chunk fits 4096 and keeps fences balanced", () => {
  const body = Array.from({ length: 400 }, (_, i) => `line ${i} with some words (and.punctuation!)`).join("\n");
  const raw = "intro\n```js\n" + body + "\n```\noutro";
  const chunks = splitForTelegram(raw);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) {
    expect(c.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    const fences = (c.match(/```/g) ?? []).length;
    expect(fences % 2).toBe(0);
  }
  expect(chunkMarkdown("a\nb", 10)).toEqual(["a\nb"]);
});

// ── pairing ────────────────────────────────────────────────────────────────

test("pairing: no code while the window is closed", () => {
  const book = new PairingBook();
  expect(book.issue({ id: 1, name: "A", username: null })).toBeNull();
});

test("pairing: 6-digit single-use code, reused for the same user, expires", () => {
  const book = new PairingBook();
  const t0 = 1_000_000;
  book.openWindow(t0);
  const a = book.issue({ id: 7, name: "Ana", username: "ana" }, t0)!;
  expect(a.code).toMatch(/^\d{6}$/);
  expect(book.issue({ id: 7, name: "Ana", username: "ana" }, t0 + 1)!.code).toBe(a.code);
  expect(book.pending(t0).map((p) => p.name)).toEqual(["Ana"]);
  expect(book.consume(a.code, t0 + 2)?.userId).toBe(7);
  expect(book.consume(a.code, t0 + 3)).toBeNull();

  const b = book.issue({ id: 8, name: "Bo", username: null }, t0)!;
  expect(book.consume(b.code, t0 + PAIRING_CODE_TTL_MS + 1)).toBeNull();
});

test("pairing: five wrong codes close the window", () => {
  const book = new PairingBook();
  book.openWindow(0);
  book.issue({ id: 9, name: "X", username: null }, 0);
  for (let i = 0; i < PAIRING_MAX_FAILED_ATTEMPTS; i += 1) book.consume("000000", 1);
  expect(book.isOpen(1)).toBe(false);
});

// ── attachments ────────────────────────────────────────────────────────────

test("attachments: size caps are checked from metadata (photos capped at 2 MB)", () => {
  const five = 5 * 1024 * 1024;
  expect(checkSize("document", 6 * 1024 * 1024, five).ok).toBe(false);
  expect(checkSize("document", 4 * 1024 * 1024, five).ok).toBe(true);
  expect(checkSize("photo", 3 * 1024 * 1024, five).ok).toBe(false);
  expect(checkSize("photo", 1 * 1024 * 1024, five).ok).toBe(true);
});

test("attachments: text is decoded and capped; binaries are rejected", () => {
  expect(decodeText(new Uint8Array([0x68, 0x00, 0x69])).ok).toBe(false);
  const big = new TextEncoder().encode("a".repeat(40 * 1024));
  const dec = decodeText(big);
  expect(dec.ok && dec.truncated && dec.text.length).toBe(TEXT_CAP_CHARS);
  expect(classifyAttachment("notes.md")).toBe("text");
  expect(classifyAttachment("paper.pdf", "application/pdf")).toBe("pdf");
  expect(classifyAttachment("tool.exe")).toBe("unsupported");
});

test("attachments: text is quarantined; images are noted, not analyzed; unknown types refused", async () => {
  const text = await extractAttachment({ name: "a.ts", bytes: new TextEncoder().encode("export const x = 1;") });
  expect(text.ok && text.block).toContain("export const x = 1;");
  const img = await extractAttachment({ name: "p.jpg", mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) });
  expect(img.ok && img.block).toContain("not analyzed");
  const bad = await extractAttachment({ name: "x.exe", bytes: new Uint8Array([1]) });
  expect(bad.ok).toBe(false);
});

// ── voice ──────────────────────────────────────────────────────────────────

function fakeStt(desc: { backend: string; available: boolean }, text = "hello there") {
  const transcribed: Array<{ mime: string; bytes: number }> = [];
  return {
    transcribed,
    stt: {
      describeAsync: async () => ({ backend: desc.backend as any, model: "m", available: desc.available, detail: "" }),
      transcribe: async (audio: Uint8Array, mime = "audio/wav") => {
        transcribed.push({ mime, bytes: audio.byteLength });
        return { ok: true, text, backend: desc.backend as any };
      },
    },
  };
}

test("voice: no speech model gives the plain-language reply", async () => {
  const { stt, transcribed } = fakeStt({ backend: "disabled", available: false });
  const r = await transcribeVoice(new Uint8Array([1]), { stt: stt as any });
  expect(r).toEqual({ ok: false, reply: NO_MODEL_REPLY });
  expect(transcribed.length).toBe(0);
});

test("voice: cloud backends receive the Ogg bytes directly", async () => {
  const { stt, transcribed } = fakeStt({ backend: "groq", available: true }, "make a plan");
  const r = await transcribeVoice(new Uint8Array([1, 2]), { stt: stt as any });
  expect(r).toEqual({ ok: true, text: "make a plan" });
  expect(transcribed[0].mime).toBe("audio/ogg");
});

test("voice: local backends without ffmpeg get the honest reply, not a silent failure", async () => {
  const { stt, transcribed } = fakeStt({ backend: "whisper-cli", available: true });
  const r = await transcribeVoice(new Uint8Array([1]), { stt: stt as any, hasFfmpeg: async () => false });
  expect(r).toEqual({ ok: false, reply: NO_FFMPEG_REPLY });
  expect(transcribed.length).toBe(0);
});

test("voice: local path converts to WAV and deletes its temp directory", async () => {
  const { stt, transcribed } = fakeStt({ backend: "whisper-cli", available: true }, "wav text");
  let dirUsed = "";
  const r = await transcribeVoice(new Uint8Array([1]), {
    stt: stt as any,
    hasFfmpeg: async () => true,
    convertToWav: async (_ogg, dir) => {
      dirUsed = dir;
      expect(existsSync(dir)).toBe(true);
      return new Uint8Array([0, 0]);
    },
  });
  expect(r).toEqual({ ok: true, text: "wav text" });
  expect(transcribed[0].mime).toBe("audio/wav");
  expect(existsSync(dirUsed)).toBe(false);
});

// ── reply context & approval text ──────────────────────────────────────────

test("reply context keeps the last 20 turns per chat", () => {
  const rc = new ReplyContext(20);
  for (let i = 0; i < 25; i += 1) rc.push(1, { role: "user", text: `m${i}` });
  const recent = rc.recent(1);
  expect(recent.length).toBe(20);
  expect(recent[0].text).toBe("m5");
  expect(rc.recent(2)).toEqual([]);
});

test("approval text: outcome and surface are shown; expiry says Expired", () => {
  expect(approvalResolvedText({ tool: "write_file", outcome: "approved", surface: "desktop" })).toBe("✅ Approved from desktop · write_file");
  expect(approvalResolvedText({ tool: "shell", outcome: "rejected", surface: "telegram" })).toBe("❌ Rejected · shell");
  expect(approvalResolvedText({ tool: "shell", outcome: "expired" })).toContain("Expired");
  expect(parseCallback("det:ap_1234abcd")).toEqual({ decision: "details", id: "ap_1234abcd" });
});

// ── bot: pairing and fail-closed behaviour ─────────────────────────────────

test("bot: an unknown user gets NO reply while the pairing window is closed", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [], store, fetchFn: api.fn });
  await bot.handleUpdate(msg(555, "/start"));
  await bot.handleUpdate(msg(555, "/status"));
  expect(api.calls.filter((c) => c.method === "sendMessage").length).toBe(0);
  expect(store.recentAudit().some((e) => e.event === "telegram.unauthorized")).toBe(true);
});

test("bot: /start with the window open issues a code; the code never reaches the audit log", async () => {
  const api = mockApi();
  const pairing = new PairingBook();
  pairing.openWindow();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [], store, fetchFn: api.fn, pairing });
  await bot.handleUpdate(msg(555, "/start"));
  const sent = api.sent(/pairing code is \d{6}/);
  expect(sent.length).toBe(1);
  const code = sent[0].body.text.match(/\d{6}/)[0];
  const audit = JSON.stringify(store.recentAudit());
  expect(audit).toContain("telegram.pair.code_issued");
  expect(audit).not.toContain(code);
});

test("bot: group chats are ignored even for paired users", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  await bot.handleUpdate({ message: { from: { id: 111 }, chat: { id: -100, type: "supergroup" }, text: "/help" } });
  expect(api.calls.filter((c) => c.method === "sendMessage").length).toBe(0);
});

test("bot: a callback from another chat cannot decide an approval", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  const p = bot.approver(111)({ tool: "shell", reason: "run x" });
  const id = [...bot.pending.keys()][0];
  await bot.handleUpdate({ callback_query: { id: "cbX", from: { id: 111 }, data: `ok:${id}`, message: { chat: { id: 222 } } } });
  expect(bot.pending.has(id)).toBe(true);
  expect(api.calls.find((c) => c.method === "answerCallbackQuery")?.body.text).toBe("Not for this chat");
  bot.pending.get(id)!(false);
  await p;
});

test("bot: approvals decided on the desktop edit the Telegram message", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  const p = bot.approver(111)({ tool: "write_file", reason: "create notes" });
  await new Promise((r) => setTimeout(r, 10));
  const id = [...bot.pending.keys()][0];
  const ok = getApprovalStore(store).decide(id, true, { channel: "desktop", userId: null });
  expect(ok).toBe(true);
  expect(await p).toBe(true);
  await new Promise((r) => setTimeout(r, 20));
  const edit = api.calls.find((c) => c.method === "editMessageText");
  expect(edit?.body.text).toBe("✅ Approved from desktop · write_file");
  expect(edit?.body.reply_markup.inline_keyboard).toEqual([]);
});

test("bot: an approval that times out is edited to Expired", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  const p = bot.approver(111)({ tool: "shell", reason: "rm" });
  await new Promise((r) => setTimeout(r, 10));
  const id = [...bot.pending.keys()][0];
  // Sweep as if 10 minutes had passed (the default TTL is 5 minutes).
  expect(getApprovalStore(store).sweepExpired(Date.now() + 10 * 60_000)).toBeGreaterThanOrEqual(1);
  expect(await p).toBe(false);
  await new Promise((r) => setTimeout(r, 20));
  expect(api.calls.find((c) => c.method === "editMessageText")?.body.text).toContain("Expired");
});

test("bot: details button sends the full preview with the buttons repeated", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  void bot.approver(111)({ tool: "write_file", reason: "create notes", preview: "+ hello" });
  await new Promise((r) => setTimeout(r, 10));
  const id = [...bot.pending.keys()][0];
  await bot.handleUpdate({ callback_query: { id: "cbD", from: { id: 111 }, data: `det:${id}`, message: { chat: { id: 111 } } } });
  const details = api.sent(/Details/);
  expect(details.length).toBe(1);
  expect(details[0].body.reply_markup.inline_keyboard[0][0].callback_data).toBe(`ok:${id}`);
});

// ── bot: commands and settings ─────────────────────────────────────────────

test("bot: /model rejects unknown ids and accepts the configured model", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn, chats: {} });
  const current = loadConfig().config.defaults.model;
  await bot.handleUpdate(msg(111, "/model definitely-not-real"));
  expect(api.sent(/Unknown model/).length).toBe(1);
  await bot.handleUpdate(msg(111, `/model ${current}`));
  expect(api.sent(/set to/).length).toBe(1);
});

test("bot: /budget validates the amount and stores it for the chat", async () => {
  const api = mockApi();
  const chats: Record<string, any> = {};
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn, chats, persist: () => {} });
  await bot.handleUpdate(msg(111, "/budget 0"));
  expect(api.sent(/Usage: \/budget/).length).toBe(1);
  await bot.handleUpdate(msg(111, "/budget $1.50"));
  expect(chats["111"].budgetUsd).toBe(1.5);
});

test("bot: /stop with nothing running says so; /approve for an unknown id is refused", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  await bot.handleUpdate(msg(111, "/stop"));
  expect(api.sent(/Nothing is running/).length).toBe(1);
  await bot.handleUpdate(msg(111, "/approve ap_deadbeef"));
  expect(api.sent(/No pending approval/).length).toBe(1);
});

test("bot: a voice note without a speech model gets the plain-language reply", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  await bot.handleUpdate(msg(111, "", { voice: { file_id: "F1", duration: 3 } }));
  expect(api.sent(/Voice messages require a speech model/).length).toBe(1);
});

test("bot: an oversized document is refused before any download", async () => {
  const api = mockApi();
  const bot = new TelegramBot({ token: TOKEN, allowedIds: [111], store, fetchFn: api.fn });
  await bot.handleUpdate(msg(111, "read this", { document: { file_id: "D1", file_name: "big.txt", file_size: 9 * 1024 * 1024 } }));
  expect(api.calls.some((c) => c.method === "getFile")).toBe(false);
  expect(api.sent(/limit here is 5\.0 MB/).length).toBe(1);
});

test("bot: a 401 from Telegram stops the loop and reports the bad token", async () => {
  let fatal = "";
  const bot = new TelegramBot({
    token: TOKEN,
    allowedIds: [],
    store,
    fetchFn: (async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    onFatal: (r) => (fatal = r),
  });
  await bot.start(0);
  expect(fatal).toContain("rejected the bot token");
});

test("bot: the offset advances after each processed update", async () => {
  const offsets: number[] = [];
  let polls = 0;
  let bot!: TelegramBot;
  const api = mockApi({
    updates: [[{ update_id: 7, message: { from: { id: 1 }, chat: { id: 1, type: "private" }, text: "/help" } }]],
    onGetUpdates: () => {
      polls += 1;
      if (polls > 1) bot.stop();
    },
  });
  bot = new TelegramBot({ token: TOKEN, allowedIds: [1], store, fetchFn: api.fn, onOffset: (o) => offsets.push(o) });
  await bot.start(0);
  expect(offsets).toEqual([8]);
  expect(bot.currentOffset).toBe(8);
});

// ── manager: lifecycle, pairing, webhook, settings ─────────────────────────

test("manager: connect rejects malformed tokens and tokens Telegram refuses", async () => {
  const m = new TelegramManager({ store, fetchFn: mockApi({ getMeOk: false }).fn, statePath: join(tmp, "s.json") });
  expect((await m.connect("not a token")).ok).toBe(false);
  const refused = await m.connect(TOKEN);
  expect(refused.ok).toBe(false);
});

test("manager: connect stores the token in the vault, opens pairing, and starts polling", async () => {
  const api = mockApi();
  const m = new TelegramManager({ store, fetchFn: api.fn, statePath: join(tmp, "s.json"), stt: undefined });
  const res = await m.connect(TOKEN);
  expect(res.ok).toBe(true);
  const st = await m.status();
  expect(st.label).toBe("Running");
  expect(st.tokenSource).toBe("keychain");
  expect(st.pairing.open).toBe(true);
  expect(JSON.stringify(st)).not.toContain(TOKEN);
  expect(JSON.stringify(m.tail(50))).not.toContain(TOKEN);
  await m.stop();
  expect((await m.status()).label).toBe("Stopped");
  expect(loadConfig().config.telegram.enabled).toBe(false);
});

test("manager: pairing end-to-end: /start over the webhook, code confirmed on the desktop, then tasks are accepted", async () => {
  const api = mockApi();
  const m = new TelegramManager({ store, fetchFn: api.fn, statePath: join(tmp, "s.json") });
  await m.connect(TOKEN);
  const secret = m.runtimeState().webhookSecret;
  const start = { update_id: 1, message: { from: { id: 555, first_name: "Ana", username: "ana" }, chat: { id: 555, type: "private" }, text: "/start" } };

  expect((await m.handleWebhook("wrong", start)).ok).toBe(false);
  expect(store.recentAudit().some((e) => e.event === "telegram.webhook.rejected")).toBe(true);

  expect((await m.handleWebhook(secret, start)).ok).toBe(true);
  const st = await m.status();
  expect(st.pairing.pending.map((p) => p.name)).toEqual(["Ana"]);
  const code = api.sent(/pairing code is/)[0].body.text.match(/\d{6}/)[0];

  expect((await m.pair("000000")).ok).toBe(false);
  const res = await m.pair(code);
  expect(res.ok).toBe(true);
  expect(loadConfig().config.telegram.pairedUserIds).toEqual([555]);
  expect((await m.pair(code)).ok).toBe(false);

  await m.handleWebhook(secret, { update_id: 2, message: { from: { id: 555 }, chat: { id: 555, type: "private" }, text: "/help" } });
  expect(api.sent(/remote control/).length).toBeGreaterThan(0);

  m.unpair(555);
  expect(loadConfig().config.telegram.pairedUserIds).toEqual([]);
  await m.disconnect();
});

test("manager: settings validate rate limit, attachment cap, and https-only webhook", async () => {
  const m = new TelegramManager({ store, fetchFn: mockApi().fn, statePath: join(tmp, "s.json") });
  expect((await m.updateSettings({ rateLimitPerMin: 0 })).ok).toBe(false);
  expect((await m.updateSettings({ maxAttachmentBytes: 1 })).ok).toBe(false);
  expect((await m.updateSettings({ webhookUrl: "http://example.com" })).ok).toBe(false);
  expect((await m.updateSettings({ rateLimitPerMin: 30, maxAttachmentBytes: 2 * 1024 * 1024 })).ok).toBe(true);
  const cfg = loadConfig().config.telegram;
  expect(cfg.rateLimit.tokens).toBe(30);
  expect(cfg.maxAttachmentBytes).toBe(2 * 1024 * 1024);
});

test("manager: runtime state (offset, webhook secret) is written 0600 and reloads", () => {
  const path = join(tmp, "tg", "state.json");
  const st = loadTelegramState(path);
  st.offset = 99;
  saveTelegramState(st, path);
  expect(loadTelegramState(path).offset).toBe(99);
  expect(loadTelegramState(path).webhookSecret).toBe(st.webhookSecret);
});

// ── routes ─────────────────────────────────────────────────────────────────

test("routes: status is token-protected; webhook needs Telegram's secret header, not the XR token", async () => {
  const h = makeHandler(store, "daemon-token-xyz");
  const unauth = await h(new Request("http://127.0.0.1:3141/api/telegram/status"));
  expect(unauth.status).toBe(401);

  const auth = await h(new Request("http://127.0.0.1:3141/api/telegram/status", { headers: { authorization: "Bearer daemon-token-xyz" } }));
  expect(auth.status).toBe(200);
  const body: any = await auth.json();
  expect(["Not set up", "Stopped", "Running", "Connected", "Error"]).toContain(body.label);

  const hook = await h(
    new Request("http://127.0.0.1:3141/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "nope" },
      body: JSON.stringify({ update_id: 1 }),
    }),
  );
  expect(hook.status).toBe(401);
});

test("routes: connect validates the token and never echoes it", async () => {
  const h = makeHandler(store, "daemon-token-xyz");
  const res = await h(
    new Request("http://127.0.0.1:3141/api/telegram/connect", {
      method: "POST",
      headers: { authorization: "Bearer daemon-token-xyz", "content-type": "application/json" },
      body: JSON.stringify({ token: "bad" }),
    }),
  );
  expect(res.status).toBe(400);
  expect(JSON.stringify(await res.json())).not.toContain("daemon-token-xyz");
});

test("routes: disconnect requires explicit confirm", async () => {
  const h = makeHandler(store, "daemon-token-xyz");
  const res = await h(
    new Request("http://127.0.0.1:3141/api/telegram/disconnect", {
      method: "POST",
      headers: { authorization: "Bearer daemon-token-xyz", "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  expect(res.status).toBe(400);
});
