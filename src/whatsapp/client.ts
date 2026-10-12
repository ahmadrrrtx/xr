/**
 * XR — WhatsApp transport (Phase 26).
 *
 * One class wraps a linked-device socket and turns the raw protocol into the
 * three things the rest of XR needs: normalized incoming messages, a connection
 * state, and a QR frame stream for the dialog. The real socket comes from
 * Baileys, imported lazily so a user who never links WhatsApp never loads it;
 * tests inject a fake socket and never touch the package.
 *
 * Deliberate choices, mirrored from the Discord adapter:
 *   · no history sync. `syncFullHistory: false` is passed, `messaging-history`
 *     events are counted and dropped — XR answers what it is sent, it does not
 *     ingest a phone's back catalogue. (Also why the outbox is built from live
 *     traffic only.)
 *   · QR frames become PNG data URLs here, so route code never renders.
 *   · every log line goes through the phone mask before it leaves this class.
 *   · reconnect is owned here, with backoff; a `loggedOut` close is terminal
 *     and hands control back to the manager to wipe credentials.
 */
import type { MediaDownloader, WhatsAppConnectionState, WhatsAppIncoming, WhatsAppMedia, WhatsAppQrFrame, WhatsAppSocket } from "./types.ts";
import { DISCONNECT } from "./types.ts";
import type { WhatsAppAuthState, WhatsAppCredsStore } from "./creds.ts";
import { maskPhone, maskPhonesInText, phoneFromJid } from "./auth.ts";
import { loadWhatsAppAuthState } from "./creds.ts";

type BaileysModule = typeof import("@whiskeysockets/baileys");

/** Baileys is an optional dependency: fail with words, not a stack trace. */
async function loadBaileys(): Promise<BaileysModule> {
  try {
    return (await import("@whiskeysockets/baileys")) as BaileysModule;
  } catch {
    throw new Error(
      "WhatsApp support needs the optional @whiskeysockets/baileys package. Install it (bun add @whiskeysockets/baileys) and restart the daemon.",
    );
  }
}

/** Render a QR payload as a PNG data URL. Same lazy-import rule as Baileys. */
export async function qrToDataUrl(text: string): Promise<string> {
  const qrcode = (await import("qrcode")) as unknown as {
    toDataURL(value: string, opts?: Record<string, unknown>): Promise<string>;
  };
  return qrcode.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: "M" });
}

interface RawKey {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
}

interface RawMessage {
  key?: RawKey | null;
  pushName?: string | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | Long | null;
}

interface Long {
  toNumber?: () => number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const long = value as Long;
    if (typeof long.toNumber === "function") {
      const n = long.toNumber();
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

/** Text of one message body, however WhatsApp delivered it. */
function textOf(message: Record<string, unknown>): string {
  const direct = asString(message.conversation);
  if (direct) return direct;
  const extended = asRecord(message.extendedTextMessage);
  const extendedText = asString(extended?.text);
  if (extendedText) return extendedText;
  for (const kind of ["imageMessage", "videoMessage", "documentMessage"]) {
    const caption = asString(asRecord(message[kind])?.caption);
    if (caption) return caption;
  }
  return "";
}

function downloadClosure(raw: unknown, loader: MediaDownloader | null): () => Promise<Uint8Array> {
  return async () => {
    if (!loader) throw new Error("this message cannot be downloaded in this environment");
    return loader(raw, "media");
  };
}

/**
 * Turn one raw message into the normalized shape. Returns null for anything the
 * adapter should not act on at all (edits, protocol messages, reactions).
 */
export function normalizeIncoming(raw: unknown, loader: MediaDownloader | null): WhatsAppIncoming | null {
  const message = asRecord(raw) as RawMessage | undefined;
  const key = asRecord(message?.key) as RawKey | undefined;
  const chatId = String(key?.remoteJid ?? "");
  if (!chatId) return null;
  const content = asRecord(message?.message);
  if (!content) return null;

  const userPart = chatId.includes("@") ? chatId.slice(0, chatId.indexOf("@")) : chatId;
  const domain = chatId.includes("@") ? chatId.slice(chatId.indexOf("@") + 1) : "";
  const group = domain === "g.us";
  const broadcast = domain === "broadcast" || domain === "newsletter" || userPart === "status";

  const media: WhatsAppMedia[] = [];
  const unsupported: string[] = [];
  const image = asRecord(content.imageMessage);
  if (image) {
    media.push({
      kind: "image",
      sizeBytes: asNumber(image.fileLength),
      fileName: asString(image.fileName) ?? "photo.jpg",
      mime: asString(image.mimetype) ?? "image/jpeg",
      download: downloadClosure(raw, loader),
    });
  }
  const document = asRecord(content.documentMessage);
  if (document) {
    media.push({
      kind: "document",
      sizeBytes: asNumber(document.fileLength),
      fileName: asString(document.fileName) ?? "document",
      mime: asString(document.mimetype) ?? "application/octet-stream",
      download: downloadClosure(raw, loader),
    });
  }
  const audio = asRecord(content.audioMessage);
  if (audio) {
    media.push({
      kind: "audio",
      sizeBytes: asNumber(audio.fileLength),
      mime: asString(audio.mimetype) ?? "audio/ogg",
      voice: audio.ptt === true,
      seconds: asNumber(audio.seconds),
      download: downloadClosure(raw, loader),
    });
  }
  if (asRecord(content.videoMessage)) unsupported.push("video");
  if (asRecord(content.stickerMessage)) unsupported.push("sticker");

  const contextInfo = asRecord(asRecord(content.extendedTextMessage)?.contextInfo);
  const quoted = asRecord(contextInfo?.quotedMessage);
  const quotedText = quoted ? textOf(quoted) : "";

  return {
    chatId,
    senderId: String(asString(key?.participant) ?? chatId),
    phone: phoneFromJid(chatId),
    pushName: asString(message?.pushName) ?? undefined,
    messageId: String(key?.id ?? ""),
    timestampMs: (asNumber(message?.messageTimestamp) ?? Math.floor(Date.now() / 1000)) * 1000,
    fromMe: key?.fromMe === true,
    group,
    broadcast,
    text: textOf(content),
    quotedText: quotedText || undefined,
    media,
    unsupported: unsupported.length ? unsupported : undefined,
    raw,
  };
}

export interface WhatsAppClientOptions {
  /** Auth state. Built from `credsStore` when absent (real sockets). */
  auth?: WhatsAppAuthState;
  /** Sealed credential store, used to build the auth state lazily. */
  credsStore?: WhatsAppCredsStore;
  /** Real socket factory (defaults to Baileys). Tests inject a fake. */
  socketFactory?: () => Promise<WhatsAppSocket>;
  /** Media downloader for normalized messages (defaults to Baileys' downloader). */
  mediaDownloader?: MediaDownloader | null;
  onMessage: (message: WhatsAppIncoming) => void | Promise<void>;
  onQr?: (frame: WhatsAppQrFrame) => void;
  onConnection?: (state: WhatsAppConnectionState) => void;
  /** WhatsApp unlinked the device: credentials are dead and must be wiped. */
  onLoggedOut?: () => void;
  onLog?: (line: string) => void;
  now?: () => number;
}

const MAX_BACKOFF_MS = 30_000;

export class WhatsAppClient {
  private socket: WhatsAppSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: WhatsAppConnectionState = { status: "idle", lastCloseCode: null, reason: null, linkedAs: null };
  /** Recent raw messages by id, so a reply can quote the message it answers. */
  private recentRaw = new Map<string, unknown>();
  private historyIgnored = 0;
  private readonly now: () => number;

  constructor(private readonly opts: WhatsAppClientOptions) {
    this.now = opts.now ?? Date.now;
  }

  get connection(): WhatsAppConnectionState {
    return this.state;
  }

  /** How many history-sync payloads were dropped without being read. */
  get historyDropped(): number {
    return this.historyIgnored;
  }

  /** The linked account's own jid, once WhatsApp told us. */
  get selfJid(): string | null {
    return typeof this.socket?.user?.id === "string" ? this.socket.user.id : null;
  }

  /** Attach a media downloader (used with injected test sockets). */
  setMediaLoader(loader: MediaDownloader | null): void {
    this.mediaLoader = loader;
  }

  get connected(): boolean {
    if (this.socket?.ws?.isOpen) return true;
    return this.state.status === "open";
  }

  private log(line: string): void {
    this.opts.onLog?.(maskPhonesInText(line));
  }

  private setState(patch: Partial<WhatsAppConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onConnection?.(this.state);
  }

  /** Build the socket (real or fake), wire its events, and wait for open/QR. */
  async connect(): Promise<void> {
    this.stopped = false;
    // An injected auth state (tests, or a caller that built one) is used as-is.
    if (this.opts.auth) this.auth = this.opts.auth;
    this.setState({ status: "connecting", reason: null });
    const factory = this.opts.socketFactory ?? (await this.defaultFactory());
    let socket: WhatsAppSocket;
    try {
      socket = await factory();
    } catch (err) {
      this.stopped = true;
      this.setState({ status: "error", reason: (err as Error).message });
      throw err;
    }
    this.socket = socket;
    this.wire(socket);
  }

  /** The real Baileys socket. Kept in one place so the cast is explained once. */
  private async defaultFactory(): Promise<() => Promise<WhatsAppSocket>> {
    const baileys = await loadBaileys();
    const auth =
      this.opts.auth ??
      (this.opts.credsStore
        ? loadWhatsAppAuthState({
            store: this.opts.credsStore,
            seed: () => baileys.initAuthCreds() as unknown as Record<string, unknown>,
            onLog: (line) => this.log(line),
          })
        : null);
    if (!auth) throw new Error("WhatsApp needs a credential store or an injected auth state");
    this.auth = auth;
    const logger = {
      level: "silent",
      child: () => logger,
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: (data: unknown) => this.log(`baileys warn: ${typeof data === "string" ? data : ""}`.trim()),
      error: (data: unknown) => this.log(`baileys error: ${typeof data === "string" ? data : ""}`.trim()),
    };
    return async () => {
      // The socket type is structurally described in types.ts; Baileys' exact
      // generics stay behind this one cast so the rest of the adapter is free
      // of them (and so tests can supply their own socket).
      const socket = baileys.makeWASocket({
        auth: {
          creds: auth.creds,
          keys: baileys.makeCacheableSignalKeyStore(auth.keys as never, logger),
        },
        browser: baileys.Browsers.appropriate("XR"),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        printQRInTerminal: false,
        logger,
      } as never);
      this.mediaLoader = (raw) => baileys.downloadMediaMessage(raw as never, "buffer", {}, { logger, reuploadRequest: socket.updateMediaMessage });
      return socket as unknown as WhatsAppSocket;
    };
  }

  private mediaLoader: MediaDownloader | null = null;
  private auth: WhatsAppAuthState | null = null;

  private wire(socket: WhatsAppSocket): void {
    socket.ev.on("connection.update", (update: unknown) => {
      const payload = asRecord(update) ?? {};
      const status = asString(payload.connection);
      const qr = asString(payload.qr);
      if (qr) {
        void this.emitQr(qr);
        this.setState({ status: "qr", reason: null });
      }
      if (status === "open") {
        this.attempt = 0;
        const self = socket.user?.id ? phoneFromJid(socket.user.id) : null;
        this.setState({ status: "open", lastCloseCode: null, reason: null, linkedAs: self ? maskPhone(self) : this.state.linkedAs });
        this.opts.onQr?.({ state: "open" });
        this.log("connection open");
      }
      if (status === "close") {
        const code = asNumber(asRecord(asRecord(asRecord(payload.lastDisconnect)?.error)?.output)?.statusCode) ?? null;
        this.handleClose(code);
      }
    });

    socket.ev.on("creds.update", () => {
      void this.auth?.save();
    });

    socket.ev.on("messages.upsert", (payload: unknown) => {
      const record = asRecord(payload) ?? {};
      // "append" payloads are history/backfill, not live traffic.
      if (asString(record.type) === "append") return;
      const messages = Array.isArray(record.messages) ? record.messages : [];
      for (const raw of messages) void this.deliver(raw);
    });

    // Explicitly ignored: history sync. Counted so the status card can prove
    // XR did not ingest a phone's back catalogue.
    socket.ev.on("messaging-history.set", () => {
      this.historyIgnored += 1;
    });
  }

  private async emitQr(qr: string): Promise<void> {
    try {
      const png = await qrToDataUrl(qr);
      this.opts.onQr?.({ state: "qr", png, expiresAt: this.now() + 60_000 });
    } catch (err) {
      this.log(`could not render the QR frame: ${(err as Error).message}`);
      this.opts.onQr?.({ state: "error", reason: "Could not render the QR code." });
    }
  }

  private async deliver(raw: unknown): Promise<void> {
    let normalized: WhatsAppIncoming | null;
    try {
      normalized = normalizeIncoming(raw, this.mediaLoader ?? this.opts.mediaDownloader ?? null);
    } catch (err) {
      this.log(`could not read a message: ${(err as Error).message}`);
      return;
    }
    if (!normalized) return;
    if (normalized.messageId) {
      this.recentRaw.set(normalized.messageId, raw);
      if (this.recentRaw.size > 50) {
        const oldest = this.recentRaw.keys().next().value;
        if (oldest !== undefined) this.recentRaw.delete(oldest);
      }
    }
    try {
      await this.opts.onMessage(normalized);
    } catch (err) {
      this.log(`message handler failed: ${(err as Error).message}`);
    }
  }

  private handleClose(code: number | null): void {
    this.setState({ status: "reconnecting", lastCloseCode: code, reason: code !== null ? `closed (${code})` : "closed" });
    if (code === DISCONNECT.LOGGED_OUT) {
      this.stopped = true;
      this.setState({ status: "unpaired", reason: "the phone unlinked this device", linkedAs: null });
      this.opts.onQr?.({ state: "closed", reason: "unlinked" });
      this.opts.onLoggedOut?.();
      return;
    }
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.log(`reconnecting in ${Math.round(delay / 1000)}s`);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      void this.connect().catch((err) => this.log(`reconnect failed: ${(err as Error).message}`));
    }, delay);
  }

  /** Send text, optionally quoting the message being answered. */
  async sendText(chatId: string, text: string, opts: { quoteMessageId?: string | null } = {}): Promise<string | undefined> {
    if (!this.socket) throw new Error("WhatsApp is not connected");
    const quoted = opts.quoteMessageId ? this.recentRaw.get(opts.quoteMessageId) : undefined;
    const sent = await this.socket.sendMessage(chatId, { text }, quoted ? { quoted } : {});
    return sent?.key?.id ?? undefined;
  }

  async setTyping(chatId: string): Promise<void> {
    await this.socket?.sendPresenceUpdate?.("composing", chatId);
  }

  async stopTyping(chatId: string): Promise<void> {
    await this.socket?.sendPresenceUpdate?.("paused", chatId);
  }

  /** Mark a message read — only ever called for senders XR answers. */
  async markRead(raw: unknown): Promise<void> {
    const key = asRecord(asRecord(raw)?.key);
    if (!key || !this.socket?.readMessages) return;
    await this.socket.readMessages([key]).catch(() => {});
  }

  /** Close the socket and stop reconnecting. Credentials stay on disk. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.ev.removeAllListeners?.();
    try {
      socket?.end?.(undefined);
    } catch {
      /* closing a dead socket is not an error worth surfacing */
    }
    this.setState({ status: "idle", reason: null });
    this.opts.onQr?.({ state: "closed" });
  }

  /** Ask WhatsApp to unlink this device (used by Unpair, best-effort). */
  async logout(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.socket?.logout?.().catch(() => {});
    await this.stop();
  }
}
