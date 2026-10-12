/**
 * XR — Phase 26 WhatsApp tests. Fully offline: the socket is a fake, media
 * downloaders are stubs, and no Baileys code runs at all (the real package is
 * only reachable through the lazy import inside WhatsAppClient).
 *
 * Covers: phone handling and masking, fail-closed admission (allow-list and
 * outbox), command vocabulary incl. the numbered approval menu, the WhatsApp
 * dialect renderer and 1500-char splitting, sealed credentials at rest,
 * normalization of incoming messages, no-history-scraping, reconnect and
 * logged-out behavior, the bot's task/settings/approval paths, the manager's
 * lifecycle and the daemon routes incl. the QR SSE stream.
 */
import { test, expect, beforeEach } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { loadConfig, saveConfig } from "../../src/config/config.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";
import { WhatsAppBot, type WhatsAppTransport } from "../../src/whatsapp/bot.ts";
import { WhatsAppClient } from "../../src/whatsapp/client.ts";
import {
  WhatsAppCredsStore,
  countKeys,
  decodeBuffers,
  encodeBuffers,
  loadWhatsAppAuthState,
} from "../../src/whatsapp/creds.ts";
import { WhatsAppManager } from "../../src/whatsapp/manager.ts";
import {
  WhatsAppGate,
  isAllowedContact,
  jidForPhone,
  maskPhone,
  maskPhonesInText,
  normalizePhone,
  phoneFromJid,
} from "../../src/whatsapp/auth.ts";
import { parseDecision, parseWhatsAppText } from "../../src/whatsapp/commands.ts";
import {
  UNOFFICIAL_CLIENT_NOTICE,
  approvalDetailsText,
  approvalMessage,
  approvalResolvedText,
  helpText,
  linkedText,
  splitForWhatsApp,
  voiceNoteText,
} from "../../src/whatsapp/render.ts";
import { collectMediaBlocks, handleVoiceNote } from "../../src/whatsapp/attachments.ts";
import { TYPING_PULSE_MS, WA_MAX_CHARS, type WhatsAppIncoming, type WhatsAppMedia, type WhatsAppSocket } from "../../src/whatsapp/types.ts";
import { loadWhatsAppState, saveWhatsAppState } from "../../src/whatsapp/state.ts";
import { getApprovalStore } from "../../src/control/approval-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

let tmp: string;
let store: Store;
const PHONE = "923001234567";
const FRIEND = "447700900123";
const STRANGER = "919999999999";
const SELF = "923111111111";
const JID = jidForPhone(PHONE);
const FRIEND_JID = jidForPhone(FRIEND);
const SELF_JID = jidForPhone(SELF);
/** WhatsApp writes the device as `number:device@server`, not after the domain. */
const SELF_DEVICE_JID = `${SELF}:4@s.whatsapp.net`;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-wa26-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "t.db"));
  clearSecretMemo();
  const { config } = loadConfig();
  saveConfig({
    ...config,
    whatsapp: {
      ...config.whatsapp,
      enabled: false,
      autoStart: true,
      allowedContacts: [],
      respondToOutbox: false,
      rateLimit: { tokens: 20, refillPerSec: 20 / 60 },
      chatBudgets: {},
      maxAttachmentBytes: 5 * 1024 * 1024,
      selfJid: undefined,
    },
  });
});

// ── fake socket ────────────────────────────────────────────────────────────

interface SentMessage {
  jid: string;
  content: Record<string, unknown>;
  opts?: Record<string, unknown>;
}

class FakeSocket implements WhatsAppSocket {
  sent: SentMessage[] = [];
  presence: string[] = [];
  readKeys: unknown[] = [];
  ended = false;
  loggedOut = false;
  user: { id?: string | null; name?: string | null } | null = null;
  ws = { isOpen: false, isClosed: false, isConnecting: false };
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  readonly ev = {
    on: (event: string, listener: (...args: unknown[]) => void): void => {
      const list = this.handlers.get(event) ?? [];
      list.push(listener);
      this.handlers.set(event, list);
    },
    off: (event: string, listener: (...args: unknown[]) => void): void => {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((l) => l !== listener));
    },
    removeAllListeners: (event?: string): void => {
      if (event) this.handlers.delete(event);
      else this.handlers.clear();
    },
  };

  async sendMessage(jid: string, content: Record<string, unknown>, opts?: Record<string, unknown>): Promise<{ key?: { id?: string | null } }> {
    this.sent.push({ jid, content, opts });
    return { key: { id: `wamid-${this.sent.length}` } };
  }

  async sendPresenceUpdate(type: string): Promise<void> {
    this.presence.push(type);
  }

  async readMessages(keys: unknown[]): Promise<void> {
    this.readKeys.push(...keys);
  }

  async logout(): Promise<void> {
    this.loggedOut = true;
  }

  end(): void {
    this.ended = true;
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.handlers.get(event) ?? []) listener(payload);
  }
}

/** A Baileys-shaped incoming text message. */
function rawText(text: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: { remoteJid: JID, id: "MSG1", fromMe: false, ...(over.key as Record<string, unknown> | undefined) },
    pushName: "Ana",
    messageTimestamp: 1_700_000_000,
    message: { conversation: text },
    ...over,
  };
}

const fakeAuth = () => {
  let saved = 0;
  return {
    state: {
      creds: {} as Record<string, unknown>,
      keys: { get: async () => ({}), set: async () => {} },
      save: async () => {
        saved += 1;
      },
      updatedAt: () => null,
    },
    saves: () => saved,
  };
};

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for an asynchronous effect (a QR frame is rendered through a dynamic
 * import + PNG encode, so a fixed sleep is a flake waiting to happen).
 */
async function waitFor<T>(fn: () => T | undefined | false | null, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await tick(25);
  }
}

// ── auth ───────────────────────────────────────────────────────────────────

test("auth: phone normalization accepts digits only and refuses non-user jids", () => {
  expect(normalizePhone("+92 300 123-4567")).toBe(PHONE);
  expect(normalizePhone("+44 7700 900123")).toBe(FRIEND);
  expect(normalizePhone("12")).toBeNull();
  expect(normalizePhone("not a number")).toBeNull();
  expect(normalizePhone("12345678901234567890")).toBeNull();

  expect(phoneFromJid("923001234567:12@s.whatsapp.net")).toBe(PHONE);
  expect(phoneFromJid("923001234567@s.whatsapp.net")).toBe(PHONE);
  expect(phoneFromJid("923001234567@c.us")).toBe(PHONE);
  // @lid identifiers are not phone numbers: they must never pass a list check.
  expect(phoneFromJid("123456789012345@lid")).toBeNull();
  expect(phoneFromJid("120363000000000000@g.us")).toBeNull();
  expect(phoneFromJid(undefined)).toBeNull();
  expect(jidForPhone(PHONE)).toBe(JID);
});

test("auth: masking keeps the last four digits only", () => {
  expect(maskPhone(PHONE)).toBe("…4567");
  expect(maskPhone("12")).toBe("…");
  expect(maskPhonesInText(`sent to ${PHONE} at 1700000000`)).not.toContain(PHONE);
  expect(maskPhonesInText(`sent to ${PHONE}`)).toContain("…4567");
});

test("auth: fail-closed admission — empty list admits nobody, outbox only when enabled", () => {
  expect(isAllowedContact(null, [PHONE])).toBe(false);
  expect(isAllowedContact(PHONE, [])).toBe(false);
  expect(isAllowedContact(PHONE, [PHONE])).toBe(true);

  let outboxSwitch = false;
  const gate = new WhatsAppGate({ allowed: () => [PHONE], respondToOutbox: () => outboxSwitch });
  expect(gate.admit(STRANGER)).toBe("denied");
  expect(gate.admit(PHONE)).toBe("allowed-list");
  gate.noteOutbound(FRIEND);
  expect(gate.admit(FRIEND)).toBe("denied");
  outboxSwitch = true;
  expect(gate.admit(FRIEND)).toBe("allowed-outbox");
  gate.forget(FRIEND);
  expect(gate.admit(FRIEND)).toBe("denied");
  expect(gate.outbox()).toEqual([]);
});

// ── commands ───────────────────────────────────────────────────────────────

test("commands: the shared vocabulary plus WhatsApp's own words", () => {
  expect(parseWhatsAppText("stop")).toEqual({ type: "revoke" });
  expect(parseWhatsAppText("Stop all")).toEqual({ type: "revoke" });
  expect(parseWhatsAppText("/xr stop")).toEqual({ type: "stop" });
  expect(parseWhatsAppText("/xr")).toEqual({ type: "empty" });
  expect(parseWhatsAppText("!budget 2")).toEqual({ type: "budget", usd: 2 });
  expect(parseWhatsAppText("/xr budget $0.75")).toEqual({ type: "budget", usd: 0.75 });
  expect(parseWhatsAppText("/xr model gpt-5-mini")).toEqual({ type: "model", model: "gpt-5-mini" });
  expect(parseWhatsAppText("/help")).toEqual({ type: "help" });
  expect(parseWhatsAppText("/xr approve abc123")).toEqual({ type: "approve", id: "abc123" });
  const task = parseWhatsAppText("refactor auth, keep it under $0.50");
  expect(task.type).toBe("task");
  expect(task.type === "task" ? task.budgetUsd : undefined).toBe(0.5);
  // An unknown word after the prefix is still a task, not a silent drop.
  expect(parseWhatsAppText("/xr frobnicate the build")).toMatchObject({ type: "task", text: "frobnicate the build" });
});

test("commands: the numbered approval menu", () => {
  expect(parseDecision("1")).toBe("approve");
  expect(parseDecision("approve")).toBe("approve");
  expect(parseDecision("YES")).toBe("approve");
  expect(parseDecision("2")).toBe("deny");
  expect(parseDecision("deny")).toBe("deny");
  expect(parseDecision("3")).toBe("details");
  expect(parseDecision("view details")).toBe("details");
  expect(parseDecision("do the thing")).toBeNull();
  expect(parseDecision("")).toBeNull();
});

// ── render ─────────────────────────────────────────────────────────────────

test("render: WhatsApp dialect, splitting and the numbered menu", () => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i} of a long answer`).join("\n");
  const chunks = splitForWhatsApp(long);
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeLessThanOrEqual(WA_MAX_CHARS);
  expect(chunks[0]).toContain("…(continued)");
  expect(splitForWhatsApp("short")).toEqual(["short"]);

  const card = approvalMessage({ id: "AP1", tool: "run_command", reason: "delete build output", riskTier: "medium" });
  expect(card).toContain("[1] Approve  [2] Deny  [3] View details");
  expect(card).toContain("run_command");
  // WhatsApp syntax, never Discord's or Telegram's.
  expect(card).not.toContain("**");

  expect(approvalResolvedText({ tool: "run_command", outcome: "approved", surface: "desktop" })).toBe("✅ Approved from desktop · run_command");
  expect(approvalResolvedText({ tool: "run_command", outcome: "expired" })).toBe("⌛ Expired · run_command");
  expect(approvalDetailsText({ id: "AP1", tool: "run_command", reason: "why" })).toContain("_No preview recorded._");
  expect(voiceNoteText("remind me at six")).toBe("[🎤 Voice note] remind me at six");
  expect(helpText()).toContain("/xr budget");
  expect(linkedText("…4567")).toContain("…4567");
  expect(UNOFFICIAL_CLIENT_NOTICE).toContain("banned");
});

// ── sealed credentials ─────────────────────────────────────────────────────

test("creds: the session blob is sealed, 0600, and never plaintext", () => {
  const dir = join(tmp, "wa");
  const creds = new WhatsAppCredsStore({ dir, now: () => 1_700_000_000_000 });
  expect(creds.exists()).toBe(false);
  expect(creds.read()).toBeNull();

  creds.write({
    creds: { noiseKey: { public: Buffer.from("super-secret-material") }, registered: true },
    keys: { session: { "abc:1": Buffer.from([1, 2, 3]) } },
  });

  const path = join(dir, "creds.sealed");
  expect(existsSync(path)).toBe(true);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  const sealedText = creds.peekSealed() ?? "";
  expect(sealedText.startsWith("XRG1.")).toBe(true);
  expect(sealedText).not.toContain("noiseKey");
  expect(sealedText).not.toContain("super-secret-material");
  expect(sealedText).not.toContain("s.whatsapp.net");

  const opened = creds.read();
  expect(opened?.updatedAt).toBe(1_700_000_000_000);
  expect(countKeys(opened!)).toBe(1);
  expect(Buffer.isBuffer(opened?.keys.session["abc:1"])).toBe(true);

  const summary = creds.summary();
  expect(summary.linked).toBe(true);
  expect(summary.keyCount).toBe(1);

  // Tampering is an error, not an empty session: XR must not silently re-register.
  writeFileSync(path, `${sealedText.slice(0, -6)}AAAAAA`, "utf8");
  chmodSync(path, 0o600);
  expect(() => creds.read()).toThrow();

  creds.wipe();
  expect(creds.exists()).toBe(false);
});

test("creds: buffer codec round-trips, and the write-through key store persists", async () => {
  expect(decodeBuffers(encodeBuffers(Buffer.from([7, 8, 9])))).toEqual(Buffer.from([7, 8, 9]));
  expect(encodeBuffers({ a: Buffer.from("x") })).toEqual({ a: { type: "Buffer", data: Buffer.from("x").toString("base64") } });

  const dir = join(tmp, "wa2");
  const creds = new WhatsAppCredsStore({ dir });
  const auth = loadWhatsAppAuthState({ store: creds, seed: () => ({ registered: false }) });
  expect(auth.creds).toEqual({ registered: false });
  await auth.keys.set({ session: { "peer:1": Buffer.from([1, 2, 3]), gone: null } });
  expect(Buffer.isBuffer((await auth.keys.get("session", ["peer:1"]))["peer:1"])).toBe(true);
  await auth.keys.set({ "sender-key": { s1: Buffer.from([4]) } });
  await auth.keys.set({ "sender-key": { s1: null } });
  expect(await auth.keys.get("sender-key", ["s1"])).toEqual({});

  const reopened = loadWhatsAppAuthState({ store: creds, seed: () => ({ registered: "SHOULD-NOT-BE-USED" }) });
  expect(reopened.creds).toEqual({ registered: false });
  expect(Buffer.isBuffer((await reopened.keys.get("session", ["peer:1"]))["peer:1"])).toBe(true);
});

test("state: runtime state round-trips and stays 0600", () => {
  const path = join(tmp, "state.json");
  saveWhatsAppState(
    { selfJid: SELF_JID, selfLabel: "…1111", linkedAt: 1, chats: { [PHONE]: { model: "m" } }, labels: { [PHONE]: "Ana" }, outbox: [FRIEND] },
    path,
  );
  expect(statSync(path).mode & 0o777).toBe(0o600);
  const loaded = loadWhatsAppState(path);
  expect(loaded.selfJid).toBe(SELF_JID);
  expect(loaded.chats[PHONE]).toEqual({ model: "m" });
  expect(loaded.outbox).toEqual([FRIEND]);
  expect(loadWhatsAppState(join(tmp, "missing.json")).selfJid).toBeNull();
});

// ── client ─────────────────────────────────────────────────────────────────

function makeClient(socket: FakeSocket, over: Record<string, unknown> = {}) {
  const auth = fakeAuth();
  const received: WhatsAppIncoming[] = [];
  const frames: string[] = [];
  const states: string[] = [];
  let loggedOut = 0;
  const client = new WhatsAppClient({
    auth: auth.state,
    socketFactory: async () => socket,
    mediaDownloader: async () => new Uint8Array([1, 2, 3]),
    onMessage: (m) => void received.push(m),
    onQr: (f) => void frames.push(f.state),
    onConnection: (s) => void states.push(s.status),
    onLoggedOut: () => {
      loggedOut += 1;
    },
    ...over,
  });
  return { client, received, frames, states, loggedOut: () => loggedOut, saves: auth.saves };
}

test("client: QRs render as PNG data URLs, and open reports the masked number", async () => {
  const socket = new FakeSocket();
  const { client, frames, states } = makeClient(socket);
  await client.connect();

  socket.emit("connection.update", { qr: "2@abc-def,ghi+123" });
  await waitFor(() => frames.includes("qr"));
  expect(client.connection.status).toBe("qr");

  const rendered = await (async () => {
    // The frame is published through the stream; render it the same way the dialog will.
    const { qrToDataUrl } = await import("../../src/whatsapp/client.ts");
    return qrToDataUrl("2@abc-def,ghi+123");
  })();
  expect(rendered.startsWith("data:image/png;base64,")).toBe(true);

  socket.user = { id: SELF_DEVICE_JID };
  socket.emit("connection.update", { connection: "open" });
  expect(client.connection.status).toBe("open");
  expect(client.connection.linkedAs).toBe("…1111");
  expect(client.selfJid).toBe(SELF_DEVICE_JID);
  expect(frames).toContain("open");
  expect(states).toContain("connecting");

  await client.stop();
  expect(socket.ended).toBe(true);
});

test("client: messages are normalized; history and backfill are never delivered", async () => {
  const socket = new FakeSocket();
  const { client, received } = makeClient(socket);
  await client.connect();

  socket.emit("messages.upsert", { type: "notify", messages: [rawText("hello XR")] });
  await tick();
  expect(received).toHaveLength(1);
  expect(received[0].text).toBe("hello XR");
  expect(received[0].phone).toBe(PHONE);
  expect(received[0].group).toBe(false);
  expect(received[0].fromMe).toBe(false);

  // Historical payloads ("append") are not live traffic.
  socket.emit("messages.upsert", { type: "append", messages: [rawText("old message")] });
  await tick();
  expect(received).toHaveLength(1);

  // History sync is counted and dropped — XR never ingests a phone's archive.
  socket.emit("messaging-history.set", { messages: [rawText("ancient")] });
  socket.emit("messaging-history.set", { messages: [rawText("older")] });
  await tick();
  expect(received).toHaveLength(1);
  expect(client.historyDropped).toBe(2);

  // Groups are flagged, not silently mangled.
  socket.emit("messages.upsert", { type: "notify", messages: [rawText("hi all", { key: { remoteJid: "120363000000000000@g.us", id: "G1" } })] });
  await tick();
  expect(received[1].group).toBe(true);
  expect(received[1].phone).toBeNull();

  // fromMe is preserved (the outbox whitelist needs it) and media is described.
  socket.emit("messages.upsert", {
    type: "notify",
    messages: [
      rawText("", {
        key: { remoteJid: FRIEND_JID, id: "M2", fromMe: true },
        message: { imageMessage: { mimetype: "image/png", fileLength: 1234, caption: "look" } },
      }),
    ],
  });
  await tick();
  expect(received[2].fromMe).toBe(true);
  expect(received[2].text).toBe("look");
  expect(received[2].media[0]).toMatchObject({ kind: "image", sizeBytes: 1234 });
  await client.stop();
});

test("client: sending quotes the original, typing uses presence, close is handled", async () => {
  const socket = new FakeSocket();
  const { client, saves } = makeClient(socket);
  await client.connect();
  socket.user = { id: SELF_DEVICE_JID };
  socket.ws.isOpen = true;
  socket.emit("connection.update", { connection: "open" });

  socket.emit("messages.upsert", { type: "notify", messages: [rawText("do the thing")] });
  await tick();
  const id = await client.sendText(JID, "on it", { quoteMessageId: "MSG1" });
  expect(id).toBe("wamid-1");
  expect(socket.sent[0].jid).toBe(JID);
  expect(socket.sent[0].content).toEqual({ text: "on it" });
  expect(socket.sent[0].opts?.quoted).toBeDefined();

  await client.setTyping(JID);
  expect(socket.presence).toContain("composing");

  socket.emit("creds.update", {});
  await tick();
  expect(saves()).toBeGreaterThan(0);

  // A session drop reconnects; the client does not pretend to be connected.
  socket.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 408 } } } });
  expect(client.connection.status).toBe("reconnecting");
  expect(client.connection.lastCloseCode).toBe(408);
  await client.stop();
});

test("client: loggedOut is terminal, and a dropped socket reconnects on its own", async () => {
  const socket = new FakeSocket();
  const { client, loggedOut } = makeClient(socket);
  await client.connect();
  socket.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  expect(loggedOut()).toBe(1);
  expect(client.connection.status).toBe("unpaired");
  await client.stop();

  // Reconnect: a non-fatal close brings a new socket up after the backoff.
  const second = new FakeSocket();
  let factories = 0;
  const reconnect = new WhatsAppClient({
    auth: fakeAuth().state,
    socketFactory: async () => {
      factories += 1;
      return second;
    },
    onMessage: () => {},
  });
  await reconnect.connect();
  expect(factories).toBe(1);
  second.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 408 } } } });
  await new Promise((resolve) => setTimeout(resolve, 1400));
  expect(factories).toBe(2);
  await reconnect.stop();
});

// ── attachments ────────────────────────────────────────────────────────────

test("attachments: caps are checked before download, and transcripts keep their label", async () => {
  const deps = { cap: () => 20 * 1024 * 1024, log: () => {}, audit: () => {} };
  const media = (over: Partial<WhatsAppMedia>, bytes = [1]): WhatsAppMedia => ({
    kind: "audio",
    sizeBytes: 1000,
    mime: "audio/ogg; codecs=opus",
    voice: true,
    download: async () => new Uint8Array(bytes),
    ...over,
  });
  const sent: string[] = [];

  // Over the audio ceiling: the sender is told, nothing is downloaded.
  let downloaded = false;
  const big = media({ sizeBytes: 11 * 1024 * 1024, download: async () => (downloaded = true, new Uint8Array([1])) });
  const over = await handleVoiceNote(deps, { userId: PHONE, media: big, send: async (c) => void sent.push(c), noModelReply: "no model" });
  expect(over).toBeNull();
  expect(downloaded).toBe(false);
  expect(sent[0]).toContain("limit here is 10.0 MB");

  // No speech model: a plain-language reply, not silence.
  const noModel = await handleVoiceNote(deps, { userId: PHONE, media: media({}), send: async (c) => void sent.push(c), noModelReply: "no model" });
  expect(noModel).toBeNull();
  expect(sent[1]).toBe("no model");

  const withStt = {
    ...deps,
    stt: {
      describeAsync: async () => ({ available: true, backend: "groq" as const, model: "whisper-large-v3", detail: "cloud" }),
      transcribe: async () => ({ ok: true, text: "remind me at six", backend: "groq" }),
    },
  };
  const heard = await handleVoiceNote(withStt, { userId: PHONE, media: media({}), send: async () => {}, noModelReply: "no model" });
  expect(heard).toBe("remind me at six");

  const notes: string[] = [];
  const result = await collectMediaBlocks(
    { ...deps, log: (l) => notes.push(`log:${l}`) },
    PHONE,
    [
      media({ kind: "document", fileName: "notes.txt", mime: "text/plain", sizeBytes: 12, download: async () => new TextEncoder().encode("hello from a file") }),
      media({ kind: "image", fileName: "cat.exe", mime: "application/x-msdownload", sizeBytes: 10 }),
    ],
  );
  expect(result.blocks[0]).toContain("hello from a file");
  expect(result.notes[0]).toContain("cat.exe");
});

// ── bot ────────────────────────────────────────────────────────────────────

function botHarness(over: Partial<ConstructorParameters<typeof WhatsAppBot>[0]> = {}) {
  const sent: Array<{ chatId: string; text: string; quote?: string | null }> = [];
  const transport: WhatsAppTransport = {
    sendText: async (chatId, text, opts) => {
      sent.push({ chatId, text, quote: opts?.quoteMessageId ?? null });
      return `wamid-${sent.length}`;
    },
    setTyping: async () => {},
    markRead: async () => {},
  };
  const revoked: string[] = [];
  const bot = new WhatsAppBot({
    store,
    transport,
    allowedContacts: () => loadConfig().config.whatsapp.allowedContacts,
    respondToOutbox: () => loadConfig().config.whatsapp.respondToOutbox,
    chats: {},
    labels: {},
    persist: () => {},
    onRevoke: (phone) => void revoked.push(phone),
    onLog: () => {},
    now: () => Date.now(),
    ...over,
  });
  return {
    bot,
    sent,
    revoked,
    texts: () => sent.map((s) => s.text),
    last: () => sent[sent.length - 1]?.text ?? "",
    incoming: (text: string, extra: Partial<WhatsAppIncoming> = {}): WhatsAppIncoming => ({
      chatId: JID,
      senderId: JID,
      phone: PHONE,
      messageId: "MSG1",
      timestampMs: 1_700_000_000_000,
      fromMe: false,
      group: false,
      broadcast: false,
      text,
      media: [],
      ...extra,
    }),
  };
}

function allow(...phones: string[]): void {
  const { config } = loadConfig();
  saveConfig({ ...config, whatsapp: { ...config.whatsapp, allowedContacts: phones } });
}

test("bot: a stranger is ignored in total silence", async () => {
  const h = botHarness();
  await h.bot.handleMessage(h.incoming("hello?", { phone: STRANGER }));
  expect(h.sent).toHaveLength(0);
  expect(store.recentAudit().some((e) => e.event === "whatsapp.unauthorized")).toBe(true);
});

test("bot: groups and broadcasts are dropped", async () => {
  const h = botHarness();
  allow(PHONE);
  await h.bot.handleMessage(h.incoming("hi all", { group: true, phone: null }));
  await h.bot.handleMessage(h.incoming("story", { broadcast: true, phone: null }));
  expect(h.sent).toHaveLength(0);
  expect(store.recentAudit().filter((e) => e.event === "whatsapp.ignored_group")).toHaveLength(2);
});

test("bot: an allowed contact gets help, status and per-chat settings", async () => {
  const h = botHarness();
  allow(PHONE);
  await h.bot.handleMessage(h.incoming("/xr help"));
  expect(h.last()).toContain("/xr budget");

  await h.bot.handleMessage(h.incoming("/xr status"));
  expect(h.last()).toContain("XR status");
  expect(h.last()).toContain("Linked: not linked");

  await h.bot.handleMessage(h.incoming("/xr model"));
  expect(h.last()).toContain("Usage: `/xr model <id>`");

  await h.bot.handleMessage(h.incoming("/xr budget 0.25"));
  expect(h.last()).toContain("$0.25");

  await h.bot.handleMessage(h.incoming("/xr budget"));
  expect(h.last()).toContain("Spend");
});

test("bot: /xr stop with nothing running says so instead of pretending", async () => {
  const h = botHarness();
  allow(PHONE);
  await h.bot.handleMessage(h.incoming("/xr stop"));
  expect(h.last()).toContain("Nothing is running in this chat");
});

test("bot: the numbered menu decides the approval, and only in its own chat", async () => {
  const h = botHarness();
  allow(PHONE);
  const pending = h.bot.approver(JID)({ tool: "run_command", reason: "wipe build output", riskTier: "medium" });
  await tick();
  expect(h.last()).toContain("[1] Approve  [2] Deny  [3] View details");

  // A bare "2" in a different chat must not decide it.
  await h.bot.handleMessage(h.incoming("2", { chatId: FRIEND_JID, phone: FRIEND }));
  expect(h.bot.pending.size).toBe(1);

  const id = [...h.bot.pending.keys()][0];
  await h.bot.handleMessage(h.incoming("1"));
  await expect(pending).resolves.toBe(true);
  await tick(30);
  // The menu answer is confirmed, and the bridge follows up because WhatsApp
  // cannot edit the original card.
  expect(h.texts()).toContain("✅ Approved.");
  expect(h.texts()).toContain("✅ Approved · run_command");
  expect(store.recentAudit().some((e) => e.event === "whatsapp.approval.answered")).toBe(true);
  expect(id).toBeDefined();
});

test("bot: [3] shows the full record, /xr deny rejects, double answers are honest", async () => {
  const h = botHarness();
  allow(PHONE);
  const pending = h.bot.approver(JID)({ tool: "run_command", reason: "restart the daemon", preview: "preview body" });
  await tick();
  await h.bot.handleMessage(h.incoming("3"));
  expect(h.last()).toContain("Approval details");
  expect(h.last()).toContain("restart the daemon");
  expect(h.last()).toContain("[1] Approve  [2] Deny");

  const id = [...h.bot.pending.keys()][0];
  await h.bot.handleMessage(h.incoming("2"));
  expect(await pending).toBe(false);
  await tick(30);
  expect(h.texts()).toContain("❌ Denied.");
  // A second answer in the same chat is refused in plain words.
  await h.bot.handleMessage(h.incoming(`/xr deny ${id}`));
  expect(h.last()).toBe("No pending approval in this chat.");
});

test("bot: a decision made elsewhere arrives as a follow-up, naming the surface", async () => {
  const h = botHarness();
  allow(PHONE);
  const pending = h.bot.approver(JID)({ tool: "run_command", reason: "write to /etc" });
  await tick();

  // The desktop answers first (cross-surface sync, the other direction).
  const approvals = getApprovalStore(store, { defaultTtlMs: 300_000 });
  const id = [...h.bot.pending.keys()][0];
  expect(typeof id).toBe("string");
  expect(approvals.decide(id, true, { channel: "desktop", userId: "local" })).toBe(true);
  await expect(pending).resolves.toBe(true);
  await tick(30);
  expect(h.last()).toBe("✅ Approved from desktop · run_command");

  // The chat cannot then decide it again — explicitly, or by number.
  await h.bot.handleMessage(h.incoming(`/xr approve ${id}`));
  expect(h.last()).toBe("No pending approval in this chat.");
});

test("bot: bare stop removes the sender from the allow-list", async () => {
  const h = botHarness();
  allow(PHONE, FRIEND);
  await h.bot.handleMessage(h.incoming("stop"));
  expect(h.last()).toContain("XR will not answer this number again");
  expect(h.revoked).toEqual([PHONE]);
});

test("bot: the outbox whitelist only works when switched on, from live traffic only", async () => {
  const h = botHarness();
  allow(PHONE);
  // With the switch off, a live outbound message is not noted and the friend stays shut out.
  await h.bot.handleMessage(h.incoming("hey, one sec", { chatId: FRIEND_JID, phone: FRIEND, fromMe: true }));
  await h.bot.handleMessage(h.incoming("hello XR?", { chatId: FRIEND_JID, phone: FRIEND }));
  expect(h.sent).toHaveLength(0);
  expect(h.bot.gate.outbox()).toEqual([]);

  const { config } = loadConfig();
  saveConfig({ ...config, whatsapp: { ...config.whatsapp, respondToOutbox: true } });
  // The user writes to the friend from their phone — seen live by the linked device.
  await h.bot.handleMessage(h.incoming("hey, one sec", { chatId: FRIEND_JID, phone: FRIEND, fromMe: true }));
  expect(h.bot.gate.outbox()).toEqual([FRIEND]);
  await h.bot.handleMessage(h.incoming("/xr help", { chatId: FRIEND_JID, phone: FRIEND }));
  expect(h.last()).toContain("/xr budget");
  // An allowed-list number never needs the outbox path.
  const before = store.recentAudit().filter((e) => e.event === "whatsapp.unauthorized").length;
  await h.bot.handleMessage(h.incoming("/xr help", { chatId: FRIEND_JID, phone: FRIEND }));
  expect(store.recentAudit().filter((e) => e.event === "whatsapp.unauthorized")).toHaveLength(before);
  expect(h.bot.gate.admit(PHONE)).toBe("allowed-list");
});

test("bot: replies are paced at one message a second per chat", async () => {
  const h = botHarness();
  allow(PHONE);
  const started = Date.now();
  await h.bot.sendToNumber(PHONE, "first");
  await h.bot.sendToNumber(PHONE, "second");
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect(h.sent.map((s) => s.text)).toEqual(["first", "second"]);
});

test("bot: the rate limit answers once instead of flooding", async () => {
  const { config } = loadConfig();
  saveConfig({ ...config, whatsapp: { ...config.whatsapp, allowedContacts: [PHONE], rateLimit: { tokens: 1, refillPerSec: 1 } } });
  const h = botHarness();
  await h.bot.handleMessage(h.incoming("/xr help"));
  await h.bot.handleMessage(h.incoming("/xr help"));
  expect(h.sent).toHaveLength(2);
  expect(h.last()).toContain("Too many messages");
  expect(store.recentAudit().some((e) => e.event === "whatsapp.rate_limited")).toBe(true);
});

test("bot: chat budget exhaustion stops the task before a model is called", async () => {
  const { config } = loadConfig();
  saveConfig({ ...config, whatsapp: { ...config.whatsapp, allowedContacts: [PHONE], chatBudgets: { maxUsd: 0.5 } } });
  const h = botHarness();
  // Pretend this chat already spent its cap.
  h.bot.chatSpendUsd.set(JID, 0.5);
  await h.bot.handleMessage(h.incoming("summarise the repo"));
  expect(h.last()).toContain("Chat budget exhausted");
  expect(h.last()).toContain("$0.50");
});

// ── manager ────────────────────────────────────────────────────────────────

function makeManager(over: Record<string, unknown> = {}) {
  const socket = new FakeSocket();
  const m = new WhatsAppManager({
    store,
    socketFactory: async () => socket,
    mediaDownloader: async () => new Uint8Array([1]),
    statePath: join(tmp, "wa-state.json"),
    credsDir: join(tmp, "wa-creds"),
    ...over,
  });
  return { m, socket };
}

test("manager: pairing opens a QR window and streams frames", async () => {
  const { m, socket } = makeManager();
  const frames: Array<{ state: string; png?: string }> = [];
  const unsubscribe = m.qr.subscribe((f) => frames.push({ state: f.state, png: f.png }), { replay: false });

  const res = await m.pair();
  expect(res.ok).toBe(true);
  expect(m.pairingOpen).toBe(true);

  socket.emit("connection.update", { qr: "2@pair-me" });
  const frame = await waitFor(() => frames.find((f) => f.state === "qr" && f.png));
  expect(frame.png?.startsWith("data:image/png;base64,")).toBe(true);

  socket.user = { id: `${SELF}:1@s.whatsapp.net` };
  socket.emit("connection.update", { connection: "open" });
  await tick(80);
  expect(frames.at(-1)?.state).toBe("open");
  expect(m.pairingOpen).toBe(true); // the window stays open until it lapses

  const status = await m.status();
  expect(status.linkedAs).toBe("…1111");
  expect(status.connection.status).toBe("open");
  expect(status.notice).toBe(UNOFFICIAL_CLIENT_NOTICE);
  expect(status.qr.frames).toBe(1);

  m.closePairing();
  expect(m.pairingOpen).toBe(false);
  expect(frames.at(-1)?.state).toBe("closed");
  unsubscribe();
  await m.shutdown();
});

test("manager: a linked device refuses a second pairing and reconnects without a QR", async () => {
  const creds = new WhatsAppCredsStore({ dir: join(tmp, "wa-creds") });
  creds.write({ creds: { registered: true, me: { id: SELF_JID } }, keys: {} });

  const { m, socket } = makeManager();
  const refused = await m.pair();
  expect(refused.ok).toBe(false);
  expect(refused.ok === false ? refused.reason : "").toContain("already has a linked device");

  const res = await m.start();
  expect(res.ok).toBe(true);
  socket.user = { id: SELF_JID };
  socket.emit("connection.update", { connection: "open" });
  await tick(40);
  const status = await m.status();
  expect(status.linked).toBe(true);
  expect(status.qr.active).toBe(false);
  expect(m.qr.frameCount).toBe(0);
  await m.stop();
});

test("manager: loggedOut wipes the credentials, and unpair cleans everything", async () => {
  const creds = new WhatsAppCredsStore({ dir: join(tmp, "wa-creds") });
  creds.write({ creds: { registered: true }, keys: {} });
  const { m, socket } = makeManager();
  await m.start();
  expect(creds.exists()).toBe(true);
  socket.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await tick(30);
  expect(creds.exists()).toBe(false);
  expect((await m.status()).linkedAs).toBeNull();
  expect(store.recentAudit().some((e) => e.event === "whatsapp.unlinked")).toBe(true);

  const { m: m2 } = makeManager();
  await m2.start();
  const res = await m2.unpair();
  expect(res.ok).toBe(true);
  const status = await m2.status();
  expect(status.linked).toBe(false);
  expect(status.linkedAs).toBeNull();
  expect(status.outbox).toEqual([]);
  expect(existsSync(join(tmp, "wa-creds", "creds.sealed"))).toBe(false);
});

test("manager: contacts, settings and the log ring are honest about their limits", async () => {
  const { m } = makeManager();
  expect(m.addContact("+92 (300) 123-4567")).toEqual({ ok: true, phone: PHONE });
  expect(loadConfig().config.whatsapp.allowedContacts).toEqual([PHONE]);
  expect(m.addContact("nope").ok).toBe(false);

  const contacts = (await m.status()).contacts;
  expect(contacts[0]).toMatchObject({ phone: PHONE, masked: "…4567" });
  expect(JSON.stringify(contacts)).not.toContain("creds.sealed");

  expect((await m.updateSettings({ rateLimitPerMin: 0 })).ok).toBe(false);
  expect((await m.updateSettings({ maxAttachmentBytes: 1024 })).ok).toBe(false);
  expect((await m.updateSettings({ rateLimitPerMin: 12, respondToOutbox: true, autoStart: false })).ok).toBe(true);
  const cfg = loadConfig().config.whatsapp;
  expect(cfg.respondToOutbox).toBe(true);
  expect(cfg.autoStart).toBe(false);
  expect(Math.round(cfg.rateLimit.refillPerSec * 60)).toBe(12);

  m.removeContact(PHONE);
  expect(loadConfig().config.whatsapp.allowedContacts).toEqual([]);

  // Log lines never carry a full number.
  const { m: m3 } = makeManager();
  m3.tail(1); // touch the ring
  expect(m3.tail(50).every((l) => !/\d{6,15}/.test(l.line))).toBe(true);
  expect(m3.storageDir.endsWith("wa-creds")).toBe(true);
});

test("manager: auto-start only reconnects an already linked, switched-on device", async () => {
  const { config } = loadConfig();
  saveConfig({ ...config, whatsapp: { ...config.whatsapp, enabled: true, autoStart: true } });

  // Switched on, but nothing linked: no socket, and the log says why.
  const { m } = makeManager();
  await m.autoStartOnBoot();
  expect((await m.status()).connection.status).toBe("idle");
  expect(m.tail(50).some((l) => l.line.includes("no linked device"))).toBe(true);

  // Linked: it reconnects on its own, with no QR.
  const creds = new WhatsAppCredsStore({ dir: join(tmp, "wa-creds") });
  creds.write({ creds: { registered: true }, keys: {} });
  const { m: m2 } = makeManager();
  await m2.autoStartOnBoot();
  expect((await m2.status()).connection.status).toBe("connecting");
  await m2.shutdown();
});

// ── routes ─────────────────────────────────────────────────────────────────

const DAEMON_TOKEN = "daemon-token-xyz";
const authed = (h: (r: Request) => Promise<Response>, path: string, init: RequestInit = {}) =>
  h(
    new Request(`http://127.0.0.1:3141${path}`, {
      headers: { authorization: `Bearer ${DAEMON_TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
      ...init,
    }),
  );

test("routes: everything is bearer-protected, and contacts round-trip", async () => {
  const { m } = makeManager();
  const h = makeHandler(store, DAEMON_TOKEN, { whatsapp: m });

  expect((await h(new Request("http://127.0.0.1:3141/api/whatsapp/status"))).status).toBe(401);

  const status = await authed(h, "/api/whatsapp/status");
  expect(status.status).toBe(200);
  const body = (await status.json()) as Record<string, unknown>;
  expect(body.notice).toBe(UNOFFICIAL_CLIENT_NOTICE);
  expect(JSON.stringify(body)).not.toContain("creds.sealed");

  const bad = await authed(h, "/api/whatsapp/contacts/add", { method: "POST", body: JSON.stringify({ phone: "abc" }) });
  expect(bad.status).toBe(400);
  const add = await authed(h, "/api/whatsapp/contacts/add", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
  expect(add.status).toBe(200);
  expect(loadConfig().config.whatsapp.allowedContacts).toEqual([PHONE]);

  const remove = await authed(h, "/api/whatsapp/contacts/remove", { method: "POST", body: JSON.stringify({ phone: PHONE }) });
  expect(remove.status).toBe(200);
  expect(loadConfig().config.whatsapp.allowedContacts).toEqual([]);

  const settings = await authed(h, "/api/whatsapp/settings", { method: "POST", body: JSON.stringify({ rateLimitPerMin: 120 }) });
  expect(settings.status).toBe(400);

  const logs = await authed(h, "/api/whatsapp/logs?tail=5");
  expect(logs.status).toBe(200);
  expect(JSON.stringify(await logs.json())).not.toContain(PHONE);
});

test("routes: unpair needs confirm, and pairing streams over SSE", async () => {
  const { m, socket } = makeManager();
  const h = makeHandler(store, DAEMON_TOKEN, { whatsapp: m });

  const noConfirm = await authed(h, "/api/whatsapp/unpair", { method: "POST", body: JSON.stringify({}) });
  expect(noConfirm.status).toBe(400);

  const pair = await authed(h, "/api/whatsapp/pair", { method: "POST", body: JSON.stringify({}) });
  expect(pair.status).toBe(200);

  const sse = await authed(h, "/api/whatsapp/qr");
  expect(sse.status).toBe(200);
  expect(sse.headers.get("content-type") ?? "").toContain("text/event-stream");
  const reader = sse.body!.getReader();
  socket.emit("connection.update", { qr: "2@sse" });
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  expect(text.startsWith("data: ")).toBe(true);
  expect(text).toContain("\"state\":\"qr\"");
  expect(text).toContain("data:image/png;base64,");

  m.closePairing();
  const second = await reader.read();
  expect(new TextDecoder().decode(second.value)).toContain("closed");
  await reader.cancel().catch(() => {});

  const confirmed = await authed(h, "/api/whatsapp/disconnect", { method: "POST", body: JSON.stringify({ confirm: true }) });
  expect(confirmed.status).toBe(200);
  expect((await confirmed.json()) as Record<string, unknown>).toMatchObject({ ok: true });
});

test("routes: status exposes no credential material and the QR route needs the token", async () => {
  const { m } = makeManager();
  const h = makeHandler(store, DAEMON_TOKEN, { whatsapp: m });
  expect((await h(new Request("http://127.0.0.1:3141/api/whatsapp/qr"))).status).toBe(401);
  expect((await h(new Request("http://127.0.0.1:3141/api/whatsapp/logs"))).status).toBe(401);

  const creds = new WhatsAppCredsStore({ dir: join(tmp, "wa-creds") });
  creds.write({ creds: { noiseKey: { public: Buffer.from("material") }, registered: true }, keys: {} });
  const body = JSON.stringify(await m.status());
  expect(body).not.toContain("material");
  expect(body).not.toContain("noiseKey");
  const sealed = readFileSync(join(tmp, "wa-creds", "creds.sealed"), "utf8");
  expect(sealed.startsWith("XRG1.")).toBe(true);
});

test("typing pulse constant matches the shared 5 s cadence", () => {
  expect(TYPING_PULSE_MS).toBe(5000);
});
