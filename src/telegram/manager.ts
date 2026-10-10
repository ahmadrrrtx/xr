/**
 * XR — Telegram lifecycle owner (one per daemon).
 *
 * Owns: token validation and storage (SecretBroker), start/stop of the poll
 * loop or webhook, the pairing book, paired users, settings, and a redacted
 * log tail. The daemon routes and the boot/shutdown hooks both go through it.
 *
 * Token: SecretBroker name XR_TELEGRAM_BOT_TOKEN. The brief's dotted name is
 * not usable because the vault only accepts UPPER_SNAKE names. The token is
 * never written to config, state, logs, or audit.
 *
 * Env vars are read-only overrides, shown as "Configured via environment":
 *   XR_TELEGRAM_TOKEN   token used instead of the vault copy
 *   XR_TELEGRAM_ALLOWED extra paired user ids
 */
import { loadConfig, saveConfig, type XRConfig } from "../config/config.ts";
import type { Store } from "../state/workspace-store.ts";
import { getSecretAsync, setSecretAsync, removeSecretAsync } from "../security/secrets.ts";
import { sttFromSettings } from "../voice/stt.ts";
import { getVoiceSettings } from "../voice/settings.ts";
import { TelegramBot, type BotDeps } from "./bot.ts";
import { PairingBook, type PendingPairing } from "./pairing.ts";
import { loadTelegramState, saveTelegramState, type TelegramRuntimeState } from "./state.ts";
import { parseAllowedIds } from "./auth.ts";
import { plain } from "./render.ts";

export const TELEGRAM_TOKEN_SECRET = "XR_TELEGRAM_BOT_TOKEN";
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const LOG_CAP = 200;

export type TelegramLabel = "Not set up" | "Connected" | "Running" | "Stopped" | "Error";

export interface TelegramStatusView {
  label: TelegramLabel;
  polling: boolean;
  mode: "polling" | "webhook";
  bot: { id: number; username: string; name: string } | null;
  tokenSource: "environment" | "keychain" | "none";
  enabled: boolean;
  autoStart: boolean;
  pairing: { open: boolean; closesAt: number | null; pending: Array<Omit<PendingPairing, "expiresAt"> & { expiresAt: number }> };
  pairedUsers: Array<{ userId: number; source: "paired" | "environment" }>;
  settings: { rateLimitPerMin: number; maxAttachmentBytes: number; webhookUrl: string | null };
  envOverrides: { token: boolean; allowed: boolean };
  lastError: string | null;
  startedAt: number | null;
}

export interface TelegramManagerOptions {
  store: Store;
  fetchFn?: typeof fetch;
  /** Test seam: where runtime state lives (defaults to XR_HOME). */
  statePath?: string;
  /** Test seam: speech-to-text for voice notes. */
  stt?: BotDeps["stt"];
}

export class TelegramManager {
  readonly pairing = new PairingBook();
  private state: TelegramRuntimeState;
  private bot: TelegramBot | null = null;
  private loop: Promise<void> | null = null;
  private polling = false;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private botInfo: TelegramStatusView["bot"] = null;
  private logs: Array<{ at: number; level: "info" | "warn" | "error"; line: string }> = [];
  private f: typeof fetch;

  constructor(private opts: TelegramManagerOptions) {
    this.f = opts.fetchFn ?? fetch;
    this.state = loadTelegramState(opts.statePath);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private log(level: "info" | "warn" | "error", line: string): void {
    const safe = line.replace(/\d{5,}:[A-Za-z0-9_-]{30,}/g, "<redacted>");
    this.logs.push({ at: Date.now(), level, line: safe });
    if (this.logs.length > LOG_CAP) this.logs.splice(0, this.logs.length - LOG_CAP);
  }

  private persistState(): void {
    saveTelegramState(this.state, this.opts.statePath);
  }

  private config(): XRConfig {
    return loadConfig().config;
  }

  private writeTelegramConfig(patch: Partial<XRConfig["telegram"]>): void {
    const { config } = loadConfig();
    saveConfig({ ...config, telegram: { ...config.telegram, ...patch } });
  }

  /** Token from the environment wins; otherwise the SecretBroker copy. */
  async resolveToken(): Promise<{ token: string; source: "environment" | "keychain" } | null> {
    const env = process.env.XR_TELEGRAM_TOKEN?.trim();
    if (env && TOKEN_RE.test(env)) return { token: env, source: "environment" };
    const stored = await getSecretAsync(TELEGRAM_TOKEN_SECRET).catch(() => undefined);
    return stored && TOKEN_RE.test(stored) ? { token: stored, source: "keychain" } : null;
  }

  /** Paired ids: persisted list plus the read-only env override. */
  pairedIds(): number[] {
    const cfg = this.config().telegram;
    const env = parseAllowedIds(process.env.XR_TELEGRAM_ALLOWED);
    return [...new Set([...(cfg.pairedUserIds ?? []), ...env])];
  }

  private ensureBot(token: string): TelegramBot {
    if (this.bot) return this.bot;
    const stt = this.opts.stt ?? sttFromSettings(getVoiceSettings(), this.f);
    this.bot = new TelegramBot({
      token,
      allowedIds: [],
      store: this.opts.store,
      fetchFn: this.f,
      pairedIds: () => this.pairedIds(),
      pairing: this.pairing,
      chats: this.state.chats,
      persist: () => this.persistState(),
      stt,
      onOffset: (offset) => {
        this.state.offset = offset;
        this.persistState();
      },
      onFatal: (reason) => {
        this.lastError = reason;
        this.polling = false;
        this.log("error", reason);
        this.opts.store.audit("telegram.error", { reason });
      },
      onLog: (line) => this.log("info", line),
      maxAttachmentBytes: () => this.config().telegram.maxAttachmentBytes,
    });
    return this.bot;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Validate a token with getMe, store it, enable the bot, open pairing, and start. */
  async connect(rawToken: string): Promise<{ ok: true; bot: NonNullable<TelegramStatusView["bot"]> } | { ok: false; reason: string }> {
    const token = String(rawToken ?? "").trim();
    if (!TOKEN_RE.test(token)) return { ok: false, reason: "That does not look like a bot token. Copy the full token from BotFather." };
    let info: TelegramStatusView["bot"];
    try {
      const res = await this.f(`https://api.telegram.org/bot${token}/getMe`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { id: number; username?: string; first_name?: string } };
      if (!body.ok || !body.result) return { ok: false, reason: "Telegram did not accept that token. Check it and try again." };
      info = { id: body.result.id, username: body.result.username ?? "", name: body.result.first_name ?? "" };
    } catch {
      return { ok: false, reason: "Could not reach Telegram. Check the network connection." };
    }
    await setSecretAsync(TELEGRAM_TOKEN_SECRET, token);
    this.botInfo = info;
    this.lastError = null;
    this.writeTelegramConfig({ enabled: true });
    this.pairing.openWindow();
    this.log("info", `connected to @${info.username}`);
    this.opts.store.audit("telegram.connect", { botId: info.id });
    await this.start();
    return { ok: true, bot: info };
  }

  /** Start polling (or webhook mode when a webhookUrl is set). */
  async start(): Promise<{ ok: boolean; reason?: string }> {
    if (this.polling) return { ok: true };
    const resolved = await this.resolveToken();
    if (!resolved) {
      this.lastError = "No bot token is set. Connect a bot first.";
      return { ok: false, reason: this.lastError };
    }
    const bot = this.ensureBot(resolved.token);
    this.writeTelegramConfig({ enabled: true });
    const cfg = this.config().telegram;
    try {
      if (cfg.webhookUrl) {
        const res = await this.f(`https://api.telegram.org/bot${resolved.token}/setWebhook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: `${cfg.webhookUrl.replace(/\/+$/, "")}/api/telegram/webhook`,
            secret_token: this.state.webhookSecret,
            allowed_updates: ["message", "callback_query"],
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!body.ok) throw new Error(body.description ?? "setWebhook failed");
        this.polling = true;
      } else {
        await this.f(`https://api.telegram.org/bot${resolved.token}/deleteWebhook`, { method: "POST" }).catch(() => {});
        this.polling = true;
        this.loop = bot.start(this.state.offset).catch((e) => {
          this.lastError = (e as Error).message;
          this.polling = false;
        });
      }
    } catch (e) {
      this.polling = false;
      this.lastError = `Could not start: ${(e as Error).message}`;
      this.log("error", this.lastError);
      return { ok: false, reason: this.lastError };
    }
    this.startedAt = Date.now();
    this.lastError = null;
    this.log("info", cfg.webhookUrl ? "webhook mode active" : "polling started");
    this.opts.store.audit("telegram.start", { mode: cfg.webhookUrl ? "webhook" : "polling" });
    return { ok: true };
  }

  /** Stop polling cleanly and cancel any running task. Keeps the token. */
  async stop(): Promise<void> {
    this.bot?.stop();
    this.bot?.cancelAll();
    if (this.loop) await Promise.race([this.loop, new Promise((r) => setTimeout(r, 5000))]);
    this.loop = null;
    this.polling = false;
    this.startedAt = null;
    this.writeTelegramConfig({ enabled: false });
    this.log("info", "stopped");
    this.opts.store.audit("telegram.stop", {});
  }

  /** Daemon shutdown: stop the loop, keep `enabled` so the next boot resumes. */
  async shutdown(): Promise<void> {
    if (!this.polling && !this.bot) return;
    this.bot?.stop();
    this.bot?.cancelAll();
    if (this.loop) await Promise.race([this.loop, new Promise((r) => setTimeout(r, 5000))]);
    this.loop = null;
    this.polling = false;
    this.startedAt = null;
    this.log("info", "daemon shutting down; bot stopped");
  }

  /** Boot hook: start if the user left it enabled, auto-start is on, and a token exists. */
  async autoStartOnBoot(): Promise<void> {
    const cfg = this.config().telegram;
    if (!cfg.enabled || !cfg.autoStart) return;
    const resolved = await this.resolveToken();
    if (!resolved) return;
    await this.start();
  }

  /** Remove the token and pairings. The user must reconnect and pair again. */
  async disconnect(): Promise<void> {
    await this.stop();
    const resolved = await this.resolveToken();
    if (resolved && this.state.webhookSecret) {
      await this.f(`https://api.telegram.org/bot${resolved.token}/deleteWebhook`, { method: "POST" }).catch(() => {});
    }
    await removeSecretAsync(TELEGRAM_TOKEN_SECRET).catch(() => {});
    this.pairing.closeWindow();
    this.botInfo = null;
    this.bot = null;
    this.writeTelegramConfig({ enabled: false, pairedUserIds: [], webhookUrl: undefined });
    this.log("info", "disconnected; token and pairings removed");
    this.opts.store.audit("telegram.disconnect", {});
  }

  // ── pairing ──────────────────────────────────────────────────────────────

  openPairing(): { closesAt: number } {
    const closesAt = this.pairing.openWindow();
    this.opts.store.audit("telegram.pair.window_opened", {});
    return { closesAt };
  }

  /** Confirm a code typed on the desktop. Adds the requesting user to the paired list. */
  async pair(code: string): Promise<{ ok: true; userId: number; name: string } | { ok: false; reason: string }> {
    const hit = this.pairing.consume(String(code ?? ""));
    if (!hit) {
      this.opts.store.audit("telegram.pair.rejected", {});
      return { ok: false, reason: "That code is wrong, expired, or already used." };
    }
    const cfg = this.config().telegram;
    const ids = [...new Set([...(cfg.pairedUserIds ?? []), hit.userId])];
    this.writeTelegramConfig({ pairedUserIds: ids });
    this.pairing.closeWindow();
    this.opts.store.audit("telegram.paired", { userId: hit.userId });
    this.log("info", `paired user ${hit.userId}`);
    const resolved = await this.resolveToken();
    if (resolved) {
      const bot = this.ensureBot(resolved.token);
      await bot.send(hit.userId, plain("Paired with XR. Send a task in plain text. XR must be running on your computer for the bot to respond.")).catch(() => {});
    }
    return { ok: true, userId: hit.userId, name: hit.name };
  }

  unpair(userId: number): { ok: boolean } {
    const cfg = this.config().telegram;
    const ids = (cfg.pairedUserIds ?? []).filter((id) => id !== userId);
    this.writeTelegramConfig({ pairedUserIds: ids });
    this.opts.store.audit("telegram.unpaired", { userId });
    this.log("info", `unpaired user ${userId}`);
    return { ok: true };
  }

  // ── settings ─────────────────────────────────────────────────────────────

  async updateSettings(patch: {
    rateLimitPerMin?: number;
    maxAttachmentBytes?: number;
    webhookUrl?: string | null;
    autoStart?: boolean;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const cfg = this.config().telegram;
    const next: Partial<XRConfig["telegram"]> = {};
    if (patch.rateLimitPerMin !== undefined) {
      const n = Math.round(Number(patch.rateLimitPerMin));
      if (!(n >= 1 && n <= 120)) return { ok: false, reason: "Rate limit must be between 1 and 120 messages a minute." };
      next.rateLimit = { tokens: n, refillPerSec: n / 60 };
    }
    if (patch.maxAttachmentBytes !== undefined) {
      const n = Math.round(Number(patch.maxAttachmentBytes));
      if (!(n >= 64 * 1024 && n <= 20 * 1024 * 1024)) return { ok: false, reason: "Attachment limit must be between 64 KB and 20 MB." };
      next.maxAttachmentBytes = n;
    }
    if (patch.autoStart !== undefined) next.autoStart = Boolean(patch.autoStart);
    let webhookChanged = false;
    if (patch.webhookUrl !== undefined) {
      const url = (patch.webhookUrl ?? "").trim();
      if (url && !/^https:\/\/[^\s]+$/.test(url)) return { ok: false, reason: "The webhook URL must start with https://." };
      next.webhookUrl = url || undefined;
      webhookChanged = true;
    }
    this.writeTelegramConfig(next);
    if (webhookChanged && this.polling) {
      await this.stop();
      await this.start();
    }
    this.opts.store.audit("telegram.settings", { keys: Object.keys(next) });
    return { ok: true };
  }

  /** Webhook entry point. Verifies Telegram's secret header before any processing. */
  async handleWebhook(secretHeader: string | null, update: unknown): Promise<{ ok: boolean }> {
    if (!secretHeader || secretHeader !== this.state.webhookSecret) {
      this.opts.store.audit("telegram.webhook.rejected", {});
      return { ok: false };
    }
    const resolved = await this.resolveToken();
    if (!resolved) return { ok: false };
    await this.ensureBot(resolved.token).handleUpdate(update);
    return { ok: true };
  }

  // ── views ────────────────────────────────────────────────────────────────

  async status(): Promise<TelegramStatusView> {
    const cfg = this.config().telegram;
    const resolved = await this.resolveToken();
    const paired = this.pairedIds();
    const configured = Boolean(resolved);
    // Connected: polling and at least one paired user. Running: polling, waiting
    // for pairing. Stopped: token present but not polling. Error: last start failed.
    let label: TelegramLabel = "Not set up";
    if (this.polling) label = paired.length > 0 ? "Connected" : "Running";
    else if (this.lastError) label = "Error";
    else if (configured) label = "Stopped";
    const envAllowed = parseAllowedIds(process.env.XR_TELEGRAM_ALLOWED);
    return {
      label,
      polling: this.polling,
      mode: cfg.webhookUrl ? "webhook" : "polling",
      bot: this.botInfo,
      tokenSource: resolved?.source ?? "none",
      enabled: cfg.enabled,
      autoStart: cfg.autoStart,
      pairing: {
        open: this.pairing.isOpen(),
        closesAt: this.pairing.windowClosesAt(),
        pending: this.pairing.pending(),
      },
      pairedUsers: paired.map((userId) => ({ userId, source: envAllowed.includes(userId) && !(cfg.pairedUserIds ?? []).includes(userId) ? "environment" : "paired" })),
      settings: {
        rateLimitPerMin: Math.round(cfg.rateLimit.refillPerSec * 60),
        maxAttachmentBytes: cfg.maxAttachmentBytes,
        webhookUrl: cfg.webhookUrl ?? null,
      },
      envOverrides: { token: Boolean(process.env.XR_TELEGRAM_TOKEN), allowed: envAllowed.length > 0 },
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  /** Last N redacted log lines (newest last). */
  tail(n = 50): Array<{ at: number; level: string; line: string }> {
    const take = Math.max(1, Math.min(LOG_CAP, Math.floor(n)));
    return this.logs.slice(-take);
  }

  /** Test seam: the current runtime state (offset, chat settings). */
  runtimeState(): Readonly<TelegramRuntimeState> {
    return this.state;
  }
}
