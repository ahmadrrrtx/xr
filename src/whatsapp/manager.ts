/**
 * XR — WhatsApp lifecycle owner (Phase 26).
 *
 * Everything that is *state* rather than protocol lives here: when the linked
 * device connects, the QR pairing window, the allow-list, per-chat settings,
 * the outbox, the 100-line log ring, and the status view the desktop reads.
 *
 * The rules it enforces on behalf of the user:
 *   · credentials never leave `~/.xr/whatsapp/` except as an encrypted blob
 *   · `loggedOut` from WhatsApp wipes them; a reconnect never asks for a QR again
 *   · the QR window closes on its own; pairing is never left open in the dark
 *   · phone numbers appear as last-four in every log line and audit row
 *   · the risk disclosure travels with the link, not just the README
 */
import type { Store } from "../state/workspace-store.ts";
import { loadConfig, saveConfig, type XRConfig } from "../config/config.ts";
import { WhatsAppBot, type WhatsAppTransport } from "./bot.ts";
import { RUNTIME_MISSING_MESSAGE, isRuntimeInstalled } from "./baileys.ts";
import { WhatsAppClient } from "./client.ts";
import { WhatsAppCredsStore, whatsappDir } from "./creds.ts";
import { WhatsAppGate, jidForPhone, maskPhone, maskPhonesInText, normalizePhone, phoneFromJid } from "./auth.ts";
import { loadWhatsAppState, saveWhatsAppState, type WhatsAppRuntimeState } from "./state.ts";
import { linkedText, riskLine, UNOFFICIAL_CLIENT_NOTICE } from "./render.ts";
import type { MediaDownloader, WhatsAppConnectionState, WhatsAppQrFrame, WhatsAppSocket } from "./types.ts";
import type { ChatSettings } from "../bots/types.ts";
import { sttFromSettings } from "../voice/stt.ts";
import { getVoiceSettings } from "../voice/settings.ts";

/** How long a pairing window stays open before the QR stops being offered. */
export const QR_WINDOW_MS = 3 * 60_000;
const LOG_RING = 100;

export interface WhatsAppManagerOptions {
  store: Store;
  dashboardBaseUrl?: string;
  now?: () => number;
  /** Test seams: a fake socket, a fake media downloader, a fixed state path. */
  socketFactory?: () => Promise<WhatsAppSocket>;
  /**
   * Whether the optional Baileys runtime can be imported. Injectable so the
   * status view can be tested without the package installed (which is the
   * normal case: it is not a dependency of this repo).
   */
  runtimeProbe?: () => Promise<boolean>;
  mediaDownloader?: MediaDownloader | null;
  statePath?: string;
  credsDir?: string;
}

export interface WhatsAppStatusView {
  enabled: boolean;
  autoStart: boolean;
  /** True when a linked-device credential blob exists on disk. */
  linked: boolean;
  linkedAs: string | null;
  linkedAt: number | null;
  connection: WhatsAppConnectionState;
  qr: { active: boolean; expiresAt: number | null; frames: number };
  /** Full numbers: this is the management list, behind the daemon bearer token. */
  contacts: Array<{ phone: string; masked: string; label: string | null }>;
  outbox: Array<{ phone: string; masked: string }>;
  respondToOutbox: boolean;
  settings: { rateLimitPerMin: number; maxAttachmentBytes: number; selfJid: string | null };
  chats: Record<string, ChatSettings>;
  creds: { linked: boolean; updatedAt: number | null; keyCount: number; bytes: number };
  /**
   * Whether the opt-in Baileys runtime is importable. It is deliberately not a
   * dependency of this repo (its GPL-3.0 libsignal would fail the license gate),
   * so the dialog has to be able to say "install this first" before a QR is
   * minted rather than fail at link time.
   */
  runtime: { installed: boolean; hint: string };
  /** Proof that XR did not ingest the phone's history. */
  historyDropped: number;
  /** The disclosure the dialog must show before linking. */
  notice: string;
}

/** QR frames, fanned out to whoever is watching the dialog. */
export class QrStream {
  private readonly listeners = new Set<(frame: WhatsAppQrFrame) => void>();
  private lastFrame: WhatsAppQrFrame | null = null;
  private frames = 0;

  publish(frame: WhatsAppQrFrame): void {
    this.lastFrame = frame;
    if (frame.state === "qr") this.frames += 1;
    for (const listener of this.listeners) {
      try {
        listener(frame);
      } catch {
        /* a broken listener must not break the stream */
      }
    }
  }

  subscribe(listener: (frame: WhatsAppQrFrame) => void, opts: { replay?: boolean } = {}): () => void {
    this.listeners.add(listener);
    if (opts.replay !== false && this.lastFrame) listener(this.lastFrame);
    return () => {
      this.listeners.delete(listener);
    };
  }

  last(): WhatsAppQrFrame | null {
    return this.lastFrame;
  }

  get frameCount(): number {
    return this.frames;
  }

  get subscribers(): number {
    return this.listeners.size;
  }
}

export class WhatsAppManager {
  readonly qr = new QrStream();
  private readonly creds: WhatsAppCredsStore;
  private readonly state: WhatsAppRuntimeState;
  private clientRef: WhatsAppClient | null = null;
  private botRef: WhatsAppBot | null = null;
  private pairingUntil = 0;
  private pairingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logs: Array<{ at: number; level: string; line: string }> = [];
  private readonly now: () => number;
  private lastConnection: WhatsAppConnectionState = { status: "idle", lastCloseCode: null, reason: null, linkedAs: null };

  constructor(private readonly opts: WhatsAppManagerOptions) {
    this.now = opts.now ?? Date.now;
    this.creds = new WhatsAppCredsStore({ dir: opts.credsDir });
    this.state = loadWhatsAppState(opts.statePath);
    this.lastConnection = { ...this.lastConnection, linkedAs: this.state.selfLabel };
  }

  // ── observability ────────────────────────────────────────────────────────

  private log(level: "info" | "warn" | "error", line: string): void {
    // Numbers are last-four-only in every line, including ones that reached us
    // from Baileys with a jid in them.
    const clean = maskPhonesInText(line);
    this.logs.push({ at: this.now(), level, line: clean });
    if (this.logs.length > LOG_RING) this.logs.shift();
  }

  tail(n = 50): Array<{ at: number; level: string; line: string }> {
    return this.logs.slice(-Math.max(1, Math.min(200, n)));
  }

  // ── state ────────────────────────────────────────────────────────────────

  private persistState(): void {
    saveWhatsAppState(this.state, this.opts.statePath);
  }

  private config(): XRConfig {
    return loadConfig().config;
  }

  private writeWhatsAppConfig(patch: Partial<XRConfig["whatsapp"]>): void {
    const { config } = loadConfig();
    saveConfig({ ...config, whatsapp: { ...config.whatsapp, ...patch } });
  }

  private ensureBot(): WhatsAppBot {
    if (this.botRef) return this.botRef;
    const gate = new WhatsAppGate({
      allowed: () => this.config().whatsapp?.allowedContacts ?? [],
      respondToOutbox: () => this.config().whatsapp?.respondToOutbox ?? false,
      outbox: this.state.outbox,
      onOutboxChange: (list) => {
        this.state.outbox = list;
        this.persistState();
      },
    });
    this.botRef = new WhatsAppBot({
      store: this.opts.store,
      transport: this.transport(),
      gate,
      chats: this.state.chats,
      labels: this.state.labels,
      persist: () => this.persistState(),
      onRevoke: (phone) => this.removeContact(phone),
      stt: this.speech(),
      onLog: (line) => this.log("info", line),
      maxAttachmentBytes: () => this.config().whatsapp?.maxAttachmentBytes ?? 5 * 1024 * 1024,
      connection: () => this.lastConnection,
      linkedAs: () => this.state.selfLabel,
      now: this.now,
    });
    return this.botRef;
  }

  private speech(): ReturnType<typeof sttFromSettings> | undefined {
    try {
      return sttFromSettings(getVoiceSettings());
    } catch {
      return undefined;
    }
  }

  private transport(): WhatsAppTransport {
    const client = (): WhatsAppClient => {
      if (!this.clientRef) throw new Error("WhatsApp is not connected");
      return this.clientRef;
    };
    return {
      sendText: async (chatId, text, opts) => (await client().sendText(chatId, text, opts ?? {})),
      setTyping: async (chatId) => {
        await client().setTyping(chatId);
      },
      markRead: async (raw) => {
        await client().markRead(raw);
      },
    };
  }

  /** The bot, for the daemon and tests that need to inject a message. */
  get bot(): WhatsAppBot {
    return this.ensureBot();
  }

  // ── client lifecycle ─────────────────────────────────────────────────────

  private ensureClient(): WhatsAppClient {
    if (this.clientRef) return this.clientRef;
    this.clientRef = new WhatsAppClient({
      credsStore: this.creds,
      socketFactory: this.opts.socketFactory,
      mediaDownloader: this.opts.mediaDownloader ?? null,
      onMessage: (msg) => this.ensureBot().handleMessage(msg),
      onQr: (frame) => this.qr.publish(frame),
      onConnection: (state) => {
        this.lastConnection = state;
        if (state.status === "open") {
          const jid = this.clientRef?.selfJid ?? null;
          if (jid && jid !== this.state.selfJid) this.state.selfJid = jid;
          if (state.linkedAs && state.linkedAs !== this.state.selfLabel) {
            this.state.selfLabel = state.linkedAs;
            this.state.linkedAt = this.now();
            void this.announceLink();
          }
          this.persistState();
        }
      },
      onLoggedOut: () => {
        // WhatsApp unlinked the device: the credentials are worthless now.
        this.creds.wipe();
        this.state.selfJid = null;
        this.state.selfLabel = null;
        this.state.linkedAt = null;
        this.persistState();
        this.log("warn", "the phone unlinked this device; credentials wiped");
        this.opts.store.audit("whatsapp.unlinked", { reason: "logged_out" });
      },
      onLog: (line) => this.log("info", line),
      now: this.now,
    });
    return this.clientRef;
  }

  /** Set the media downloader that the client uses for injected test sockets. */
  setMediaLoader(loader: MediaDownloader | null): void {
    if (this.clientRef) this.clientRef.setMediaLoader(loader);
  }

  /** Send the "linked" confirmation to the user's own chat (best-effort). */
  private async announceLink(): Promise<void> {
    this.log("info", `linked as ${this.state.selfLabel ?? "unknown"}`);
    this.opts.store.audit("whatsapp.linked", { linkedAs: this.state.selfLabel });
    const client = this.clientRef;
    const jid = this.selfJid();
    if (!client || !jid || !this.config().whatsapp?.enabled) return;
    await client.sendText(jid, `${linkedText(this.state.selfLabel)}\n\n${riskLine()}`).catch(() => {});
  }

  private selfJid(): string | null {
    return this.clientRef?.selfJid ?? this.state.selfJid;
  }

  /** Open the socket with stored credentials. Reconnects without a QR. */
  async start(): Promise<{ ok: boolean; reason?: string }> {
    if (this.clientRef?.connected) return { ok: true };
    this.writeWhatsAppConfig({ enabled: true });
    try {
      const client = this.ensureClient();
      await client.connect();
      this.opts.store.audit("whatsapp.start", { linked: this.creds.exists() });
      return { ok: true };
    } catch (err) {
      const reason = (err as Error).message;
      this.log("error", `start failed: ${reason}`);
      return { ok: false, reason };
    }
  }

  /** Close the socket. Credentials stay, so a later start resumes silently. */
  async stop(): Promise<void> {
    this.closePairing();
    await this.clientRef?.stop();
    this.writeWhatsAppConfig({ enabled: false });
    this.opts.store.audit("whatsapp.stop", {});
  }

  /** Daemon shutdown: close the socket and cancel running tasks. */
  async shutdown(): Promise<void> {
    this.closePairing();
    this.botRef?.cancelAll();
    await this.clientRef?.stop();
  }

  /** Boot behavior: connect only when the user asked for it AND a link exists. */
  async autoStartOnBoot(): Promise<void> {
    const cfg = this.config().whatsapp;
    if (!cfg?.enabled || !cfg.autoStart) return;
    if (!this.creds.exists()) {
      this.log("info", "auto-start skipped: no linked device yet");
      return;
    }
    const res = await this.start();
    if (!res.ok) this.log("warn", `auto-start failed: ${res.reason ?? "unknown"}`);
  }

  // ── pairing ──────────────────────────────────────────────────────────────

  /**
   * Open the QR window. This is pairing for WhatsApp: the code in the phone app
   * is scanned, not typed. Refused when a device is already linked — unlinking
   * first is a deliberate, separate action.
   */
  async pair(): Promise<{ ok: true; expiresAt: number } | { ok: false; reason: string }> {
    if (this.creds.exists()) {
      return { ok: false, reason: "This daemon already has a linked device. Unpair first to link a different phone." };
    }
    const cfg = this.config().whatsapp;
    if (cfg?.respondToOutbox) {
      // Not a blocker — just worth saying out loud in the log.
      this.log("info", "pairing with respondToOutbox enabled: contacts you write to first will be answered");
    }
    this.pairingUntil = this.now() + QR_WINDOW_MS;
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = setTimeout(() => this.closePairing("timeout"), QR_WINDOW_MS);
    const res = await this.start();
    if (!res.ok) {
      this.closePairing("error");
      return { ok: false, reason: res.reason ?? "could not open the WhatsApp connection" };
    }
    this.opts.store.audit("whatsapp.pair.open", { windowMs: QR_WINDOW_MS });
    return { ok: true, expiresAt: this.pairingUntil };
  }

  /** Close the pairing window (or let it lapse). No QR frames are offered after. */
  closePairing(reason: "closed" | "timeout" | "error" = "closed"): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    this.pairingTimer = null;
    const wasOpen = this.pairingUntil > 0;
    this.pairingUntil = 0;
    if (wasOpen) this.qr.publish({ state: reason === "timeout" ? "timeout" : reason === "error" ? "error" : "closed" });
  }

  /** True while the QR window is open and frames are being offered. */
  get pairingOpen(): boolean {
    return this.pairingUntil > this.now();
  }

  get pairingExpiresAt(): number | null {
    return this.pairingUntil > 0 ? this.pairingUntil : null;
  }

  // ── access ───────────────────────────────────────────────────────────────

  addContact(raw: string): { ok: true; phone: string } | { ok: false; reason: string } {
    const phone = normalizePhone(raw);
    if (!phone) return { ok: false, reason: "Use digits with the country code, e.g. 923001234567." };
    const cfg = this.config();
    const list = cfg.whatsapp?.allowedContacts ?? [];
    if (list.includes(phone)) return { ok: true, phone };
    if (list.length >= 200) return { ok: false, reason: "That is the maximum of 200 contacts." };
    this.writeWhatsAppConfig({ allowedContacts: [...list, phone] });
    this.opts.store.audit("whatsapp.contact.added", { phone: maskPhone(phone) });
    return { ok: true, phone };
  }

  removeContact(raw: string): { ok: boolean; phone: string | null } {
    const phone = normalizePhone(raw);
    if (!phone) return { ok: false, phone: null };
    const cfg = this.config();
    const list = cfg.whatsapp?.allowedContacts ?? [];
    if (!list.includes(phone)) return { ok: false, phone };
    this.writeWhatsAppConfig({ allowedContacts: list.filter((p) => p !== phone) });
    this.state.outbox = this.state.outbox.filter((p) => p !== phone);
    this.persistState();
    this.opts.store.audit("whatsapp.contact.removed", { phone: maskPhone(phone) });
    return { ok: true, phone };
  }

  // ── settings ─────────────────────────────────────────────────────────────

  async updateSettings(patch: {
    rateLimitPerMin?: number;
    maxAttachmentBytes?: number;
    autoStart?: boolean;
    respondToOutbox?: boolean;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const next: Partial<XRConfig["whatsapp"]> = {};
    if (patch.rateLimitPerMin !== undefined) {
      if (!(patch.rateLimitPerMin > 0 && patch.rateLimitPerMin <= 60)) {
        return { ok: false, reason: "Messages per minute must be between 1 and 60 (WhatsApp's ceiling is 60)." };
      }
      next.rateLimit = { tokens: Math.min(20, patch.rateLimitPerMin), refillPerSec: patch.rateLimitPerMin / 60 };
    }
    if (patch.maxAttachmentBytes !== undefined) {
      if (!(patch.maxAttachmentBytes >= 64 * 1024 && patch.maxAttachmentBytes <= 20 * 1024 * 1024)) {
        return { ok: false, reason: "Attachment cap must be between 64 KB and 20 MB." };
      }
      next.maxAttachmentBytes = patch.maxAttachmentBytes;
    }
    if (patch.autoStart !== undefined) next.autoStart = patch.autoStart;
    if (patch.respondToOutbox !== undefined) next.respondToOutbox = patch.respondToOutbox;
    this.writeWhatsAppConfig(next);
    this.opts.store.audit("whatsapp.settings", { ...next, rateLimit: next.rateLimit ? true : undefined });
    return { ok: true };
  }

  // ── unpair ───────────────────────────────────────────────────────────────

  /**
   * Unlink the device. Asks WhatsApp to unlink (best effort), wipes the sealed
   * credentials, forgets the outbox and stops. The allow-list is kept: it is the
   * user's own list, and it is meaningless until a device is linked again.
   */
  async unpair(): Promise<{ ok: boolean; reason?: string }> {
    let reason: string | undefined;
    try {
      if (this.clientRef?.connected) await this.clientRef.logout();
    } catch (err) {
      reason = (err as Error).message;
    }
    await this.clientRef?.stop();
    this.creds.wipe();
    this.clientRef = null;
    this.botRef = null;
    this.state.selfJid = null;
    this.state.selfLabel = null;
    this.state.linkedAt = null;
    this.state.outbox = [];
    this.persistState();
    this.writeWhatsAppConfig({ enabled: false, selfJid: undefined });
    this.closePairing();
    this.opts.store.audit("whatsapp.unpair", { wiped: true });
    this.log("warn", "device unlinked; credentials wiped");
    return { ok: true, reason };
  }

  // ── status ───────────────────────────────────────────────────────────────

  async status(): Promise<WhatsAppStatusView> {
    const cfg = this.config().whatsapp;
    const contacts = cfg?.allowedContacts ?? [];
    const summary = this.creds.summary();
    return {
      enabled: cfg?.enabled ?? false,
      autoStart: cfg?.autoStart ?? true,
      linked: this.creds.exists(),
      linkedAs: this.state.selfLabel,
      linkedAt: this.state.linkedAt,
      connection: this.lastConnection,
      qr: { active: this.pairingOpen, expiresAt: this.pairingExpiresAt, frames: this.qr.frameCount },
      contacts: contacts.map((phone) => ({ phone, masked: maskPhone(phone), label: this.state.labels[phone] ?? null })),
      outbox: this.state.outbox.map((phone) => ({ phone, masked: maskPhone(phone) })),
      respondToOutbox: cfg?.respondToOutbox ?? false,
      settings: {
        rateLimitPerMin: Math.round((cfg?.rateLimit?.refillPerSec ?? 20 / 60) * 60),
        maxAttachmentBytes: cfg?.maxAttachmentBytes ?? 5 * 1024 * 1024,
        selfJid: this.state.selfJid,
      },
      chats: this.state.chats,
      creds: summary,
      runtime: { installed: await this.runtimeInstalled(), hint: RUNTIME_MISSING_MESSAGE },
      historyDropped: this.clientRef?.historyDropped ?? 0,
      notice: UNOFFICIAL_CLIENT_NOTICE,
    };
  }

  /**
   * Cached runtime probe: the answer only changes when someone installs or
   * removes the package, and a dynamic import per status poll would be wasteful.
   */
  private runtimeCache: boolean | null = null;
  private async runtimeInstalled(): Promise<boolean> {
    if (this.runtimeCache === null) {
      this.runtimeCache = await (this.opts.runtimeProbe ?? isRuntimeInstalled)();
    }
    return this.runtimeCache;
  }

  /** Filesystem facts for the dialog ("stored at ~/.xr/whatsapp"). */
  get storageDir(): string {
    return this.creds.dir ?? whatsappDir();
  }
}

/** Re-exported so route code can build a jid without importing auth.ts. */
export { jidForPhone, phoneFromJid };
