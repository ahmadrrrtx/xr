/**
 * XR — Discord lifecycle owner (one per daemon).
 *
 * Owns: the bot token (SecretBroker, never in config/state/logs), start/stop of
 * the gateway, the pairing book, paired users, the channel allow-list, settings,
 * webhook registration and a redacted log tail. The daemon routes and the
 * boot/shutdown hooks both go through it.
 *
 * Token: SecretBroker name XR_DISCORD_BOT_TOKEN (the vault only accepts
 * UPPER_SNAKE names). Env override, read-only and shown as "Configured via
 * environment": XR_DISCORD_TOKEN.
 */
import { loadConfig, saveConfig, type XRConfig } from "../config/config.ts";
import type { Store } from "../state/workspace-store.ts";
import { getSecretAsync, setSecretAsync, removeSecretAsync } from "../security/secrets.ts";
import { sttFromSettings } from "../voice/stt.ts";
import { getVoiceSettings } from "../voice/settings.ts";
import { DiscordBot, gatewaySummary, type DiscordBotDeps } from "./bot.ts";
import { DiscordPairingBook, normalizeDiscordId, type PendingPairing } from "./auth.ts";
import { loadDiscordState, saveDiscordState, type DiscordRuntimeState } from "./state.ts";
import { inviteUrl } from "./commands.ts";
import { verifyInteractionSignature } from "./verify.ts";
import type { DiscordClient, GatewayState } from "./client.ts";
import type { DiscordChannel, DiscordGuildSummary, DiscordInteraction } from "./types.ts";

export const DISCORD_TOKEN_SECRET = "XR_DISCORD_BOT_TOKEN";
/** Application id . timestamp . signature — Discord's documented bot-token shape. */
export const DISCORD_TOKEN_RE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/;
const LOG_CAP = 200;

export type DiscordLabel = "Not set up" | "Connected" | "Running" | "Stopped" | "Error";

export interface DiscordStatusView {
  label: DiscordLabel;
  running: boolean;
  gateway: GatewayState;
  gatewayText: string;
  bot: { applicationId: string; name: string; botUserId: string | null } | null;
  inviteUrl: string | null;
  tokenSource: "environment" | "keychain" | "none";
  enabled: boolean;
  autoStart: boolean;
  pairing: { open: boolean; closesAt: number | null; pending: PendingPairing[]; codes: Array<{ code: string; kind: "user" | "channel"; expiresAt: number }> };
  pairedUsers: Array<{ userId: string; label: string; source: "paired" | "environment" }>;
  channels: Array<{ guildId: string; channelId: string; label: string }>;
  settings: {
    rateLimitPerMin: number;
    maxAttachmentBytes: number;
    webhookUrl: string | null;
    devGuildId: string | null;
    dashboardUrl: string;
  };
  envOverrides: { token: boolean };
  commandsRegisteredAt: number | null;
  lastError: string | null;
  startedAt: number | null;
}

export interface DiscordManagerOptions {
  store: Store;
  fetchFn?: typeof fetch;
  wsFactory?: DiscordBotDeps["wsFactory"];
  /** Test seam: where runtime state lives (defaults to XR_HOME). */
  statePath?: string;
  /** Test seam: speech-to-text for voice notes. */
  stt?: DiscordBotDeps["stt"];
  /** Local dashboard base URL used by the 🖥 Open XR button. */
  dashboardBaseUrl?: string;
}

/** Codes minted but not yet redeemed, so the dialog can keep showing them. */
interface IssuedCode {
  code: string;
  kind: "user" | "channel";
  expiresAt: number;
}

export class DiscordManager {
  readonly pairing = new DiscordPairingBook();
  private state: DiscordRuntimeState;
  private bot: DiscordBot | null = null;
  private running = false;
  private gateway: GatewayState = { status: "idle", latencyMs: null, lastCloseCode: null, sessionActive: false };
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private appInfo: DiscordStatusView["bot"] = null;
  private issued: IssuedCode[] = [];
  private logs: Array<{ at: number; level: "info" | "warn" | "error"; line: string }> = [];
  private readonly f: typeof fetch;

  constructor(private readonly opts: DiscordManagerOptions) {
    this.f = opts.fetchFn ?? fetch;
    this.state = loadDiscordState(opts.statePath);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private log(level: "info" | "warn" | "error", line: string): void {
    const safe = line.replace(DISCORD_TOKEN_RE, "<redacted>");
    this.logs.push({ at: Date.now(), level, line: safe });
    if (this.logs.length > LOG_CAP) this.logs.splice(0, this.logs.length - LOG_CAP);
  }

  private persistState(): void {
    saveDiscordState(this.state, this.opts.statePath);
  }

  private config(): XRConfig {
    return loadConfig().config;
  }

  private writeDiscordConfig(patch: Partial<XRConfig["discord"]>): void {
    const { config } = loadConfig();
    saveConfig({ ...config, discord: { ...config.discord, ...patch } });
  }

  private dashboardUrl(): string {
    return this.opts.dashboardBaseUrl ?? `http://127.0.0.1:${process.env.XR_DAEMON_PORT ?? "3141"}/`;
  }

  private openDashboardUrl(id: string): string {
    const base = this.dashboardUrl();
    return `${base}${base.includes("?") ? "&" : "?"}approval=${encodeURIComponent(id)}`;
  }

  /** Token from the environment wins; otherwise the SecretBroker copy. */
  async resolveToken(): Promise<{ token: string; source: "environment" | "keychain" } | null> {
    const env = process.env.XR_DISCORD_TOKEN?.trim();
    if (env && DISCORD_TOKEN_RE.test(env)) return { token: env, source: "environment" };
    const stored = await getSecretAsync(DISCORD_TOKEN_SECRET).catch(() => undefined);
    return stored && DISCORD_TOKEN_RE.test(stored) ? { token: stored, source: "keychain" } : null;
  }

  private ensureBot(token: string): DiscordBot {
    if (this.bot) return this.bot;
    const stt = this.opts.stt ?? sttFromSettings(getVoiceSettings(), this.f);
    this.bot = new DiscordBot({
      token,
      store: this.opts.store,
      fetchFn: this.f,
      wsFactory: this.opts.wsFactory,
      pairing: this.pairing,
      pairedUserIds: () => this.config().discord.pairedUserIds,
      allowedChannels: () => this.config().discord.allowedChannels,
      onPairedUser: (userId, label) => this.recordPairedUser(userId, label),
      onPairedChannel: (guildId, channelId, label) => this.recordPairedChannel(guildId, channelId, label),
      chats: this.state.chats,
      persist: () => this.persistState(),
      stt,
      session: { id: this.state.sessionId, url: this.state.resumeGatewayUrl, seq: this.state.seq },
      onSession: (patch) => {
        if (patch.id !== undefined) this.state.sessionId = patch.id;
        if (patch.url !== undefined) this.state.resumeGatewayUrl = patch.url;
        if (patch.seq !== undefined) this.state.seq = patch.seq;
        this.persistState();
      },
      onCommandsRegistered: (at) => {
        this.state.commandsRegisteredAt = at;
        this.persistState();
      },
      onGatewayState: (state) => {
        this.gateway = state;
      },
      onFatal: (reason) => {
        this.lastError = reason;
        this.running = false;
        this.log("error", reason);
        this.opts.store.audit("discord.error", { reason });
      },
      onLog: (line) => this.log("info", line),
      maxAttachmentBytes: () => this.config().discord.maxAttachmentBytes,
      dashboardUrl: () => this.dashboardUrl(),
      devGuildId: () => this.config().discord.devGuildId,
    });
    return this.bot;
  }

  /** Ask Discord who this token belongs to (used both to validate and to show the bot). */
  private async fetchApplication(token: string): Promise<{ ok: true; app: NonNullable<DiscordStatusView["bot"]>; invite: string } | { ok: false; reason: string }> {
    try {
      const res = await this.f("https://discord.com/api/v10/applications/@me", {
        headers: { authorization: `Bot ${token}`, "user-agent": "DiscordBot (https://github.com/ahmadrrrtx/xr, 1.0.0)" },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "Discord did not accept that token. Check it and try again." };
      if (!res.ok) return { ok: false, reason: `Discord replied ${res.status}. Try again in a moment.` };
      const body = (await res.json()) as { id?: string; name?: string; bot?: { id?: string } };
      if (!body?.id) return { ok: false, reason: "Discord did not return an application for that token." };
      const app = { applicationId: body.id, name: body.name ?? "XR", botUserId: body.bot?.id ?? null };
      return { ok: true, app, invite: inviteUrl(body.id) };
    } catch {
      return { ok: false, reason: "Could not reach Discord. Check the network connection." };
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Validate a token, store it, enable the bot, open a pairing window, and start. */
  async connect(rawToken: string): Promise<{ ok: true; bot: NonNullable<DiscordStatusView["bot"]>; inviteUrl: string } | { ok: false; reason: string }> {
    const token = String(rawToken ?? "").trim();
    if (!DISCORD_TOKEN_RE.test(token)) {
      return { ok: false, reason: "That does not look like a bot token. Copy the token from the Discord Developer Portal." };
    }
    const probed = await this.fetchApplication(token);
    if (!probed.ok) return probed;
    await setSecretAsync(DISCORD_TOKEN_SECRET, token);
    this.appInfo = probed.app;
    this.state.applicationId = probed.app.applicationId;
    this.persistState();
    this.lastError = null;
    this.writeDiscordConfig({ enabled: true });
    this.pairing.openWindow();
    this.log("info", `connected as ${probed.app.name} (${probed.app.applicationId})`);
    this.opts.store.audit("discord.connect", { applicationId: probed.app.applicationId });
    await this.start();
    return { ok: true, bot: probed.app, inviteUrl: probed.invite };
  }

  /** Start the gateway (no-op when already running). */
  async start(): Promise<{ ok: boolean; reason?: string }> {
    if (this.running) return { ok: true };
    const resolved = await this.resolveToken();
    if (!resolved) {
      this.lastError = "No bot token is set. Connect a bot first.";
      return { ok: false, reason: this.lastError };
    }
    const bot = this.ensureBot(resolved.token);
    try {
      // start() resolves the application and registers commands; a rejected
      // token reports through onFatal, so check after it returns.
      await bot.start();
      if (this.lastError) return { ok: false, reason: this.lastError };
    } catch (err) {
      this.running = false;
      this.lastError = `Could not start: ${(err as Error).message}`;
      this.log("error", this.lastError);
      return { ok: false, reason: this.lastError };
    }
    if (bot.appId) {
      this.appInfo = { applicationId: bot.appId, name: this.appInfo?.name ?? "XR", botUserId: this.appInfo?.botUserId ?? null };
      this.state.applicationId = bot.appId;
      this.persistState();
    }
    this.running = true;
    this.startedAt = Date.now();
    this.lastError = null;
    this.writeDiscordConfig({ enabled: true });
    this.log("info", "gateway started");
    this.opts.store.audit("discord.start", { mode: "gateway" });
    return { ok: true };
  }

  /** Stop the gateway cleanly and cancel running tasks. Keeps the token. */
  async stop(): Promise<void> {
    this.bot?.stop();
    this.bot?.cancelAll();
    this.running = false;
    this.startedAt = null;
    this.gateway = { ...this.gateway, status: "stopped", sessionActive: false };
    this.writeDiscordConfig({ enabled: false });
    this.log("info", "stopped");
    this.opts.store.audit("discord.stop", {});
  }

  /** Daemon shutdown: stop the gateway but keep `enabled` so the next boot resumes. */
  async shutdown(): Promise<void> {
    if (!this.running && !this.bot) return;
    this.bot?.stop();
    this.bot?.cancelAll();
    this.running = false;
    this.startedAt = null;
    this.log("info", "daemon shutting down; bot stopped");
  }

  /** Boot hook: start when the user left it enabled, auto-start is on, and a token exists. */
  async autoStartOnBoot(): Promise<void> {
    const cfg = this.config().discord;
    if (!cfg.enabled || !cfg.autoStart) return;
    const resolved = await this.resolveToken();
    if (!resolved) return;
    await this.start();
  }

  /** Remove the token, the pairings and the channel list. */
  async disconnect(): Promise<void> {
    await this.stop();
    await removeSecretAsync(DISCORD_TOKEN_SECRET).catch(() => {});
    this.pairing.closeWindow();
    this.issued = [];
    this.appInfo = null;
    this.bot = null;
    this.gateway = { status: "idle", latencyMs: null, lastCloseCode: null, sessionActive: false };
    this.state.sessionId = null;
    this.state.resumeGatewayUrl = null;
    this.state.seq = null;
    this.state.applicationId = null;
    this.persistState();
    this.writeDiscordConfig({ enabled: false, pairedUserIds: [], allowedChannels: [], webhookUrl: undefined });
    this.log("info", "disconnected; token and pairings removed");
    this.opts.store.audit("discord.disconnect", {});
  }

  // ── pairing ──────────────────────────────────────────────────────────────

  /** Open the pairing window and mint one code for the dialog to display. */
  openPairing(kind: "user" | "channel" = "user"): { code: string; expiresAt: number; closesAt: number } | { code: null; closesAt: number } {
    const closesAt = this.pairing.openWindow();
    const minted = this.pairing.issue({ kind, label: kind === "user" ? "Waiting for a DM" : "Waiting for a channel" });
    this.opts.store.audit("discord.pair.window_opened", { kind });
    if (!minted) return { code: null, closesAt };
    this.issued.push({ code: minted.code, kind, expiresAt: minted.expiresAt });
    return { ...minted, closesAt };
  }

  closePairing(): void {
    this.pairing.closeWindow();
    this.issued = [];
    this.opts.store.audit("discord.pair.window_closed", {});
  }

  /** Codes still displayable in the dialog (they expire with the window). */
  issuedCodes(): IssuedCode[] {
    const now = Date.now();
    this.issued = this.issued.filter((c) => c.expiresAt > now);
    return this.issued;
  }

  /** Called by the bot when a user redeemed a code. */
  private recordPairedUser(userId: string, label: string): void {
    const cfg = this.config().discord;
    const ids = [...new Set([...(cfg.pairedUserIds ?? []), userId])];
    this.writeDiscordConfig({ pairedUserIds: ids });
    this.state.labels = { ...(this.state.labels ?? {}), [userId]: label };
    this.persistState();
    this.log("info", `paired user ${userId}`);
    this.opts.store.audit("discord.paired", { userId });
  }

  private recordPairedChannel(guildId: string, channelId: string, label: string): void {
    const cfg = this.config().discord;
    const key = `${guildId}:${channelId}`;
    const list = cfg.allowedChannels ?? [];
    if (!list.some((c) => `${c.guildId}:${c.channelId}` === key)) {
      this.writeDiscordConfig({ allowedChannels: [...list, { guildId, channelId }] });
    }
    this.state.labels = { ...(this.state.labels ?? {}), [key]: label };
    this.persistState();
    this.opts.store.audit("discord.channel_allowed", { guildId, channelId });
  }

  /** Desktop: allow a channel directly (pasted id or picked from the guild list). */
  addChannel(input: { guildId: string; channelId: string }): { ok: true } | { ok: false; reason: string } {
    const guildId = normalizeDiscordId(input.guildId);
    const channelId = normalizeDiscordId(input.channelId);
    if (!guildId || !channelId) return { ok: false, reason: "Server and channel must be Discord ids (numbers)." };
    this.recordPairedChannel(guildId, channelId, `<#${channelId}>`);
    return { ok: true };
  }

  removeChannel(input: { guildId: string; channelId: string }): { ok: boolean } {
    const cfg = this.config().discord;
    const key = `${input.guildId}:${input.channelId}`;
    const list = (cfg.allowedChannels ?? []).filter((c) => `${c.guildId}:${c.channelId}` !== key);
    this.writeDiscordConfig({ allowedChannels: list });
    this.opts.store.audit("discord.channel_removed", { guildId: input.guildId, channelId: input.channelId });
    return { ok: true };
  }

  unpair(userId: string): { ok: boolean } {
    const cfg = this.config().discord;
    const ids = (cfg.pairedUserIds ?? []).filter((id) => id !== userId);
    this.writeDiscordConfig({ pairedUserIds: ids });
    this.opts.store.audit("discord.unpaired", { userId });
    this.log("info", `unpaired user ${userId}`);
    return { ok: true };
  }

  /** Server/channel picker data for the dialog. */
  async listGuilds(): Promise<DiscordGuildSummary[]> {
    return (await this.ensureClient().listGuilds()) ?? [];
  }

  async listChannels(guildId: string): Promise<DiscordChannel[]> {
    const channels = (await this.ensureClient().listGuildChannels(guildId)) ?? [];
    // Text-capable channels only (0 text, 5 announcement).
    return channels.filter((c) => c.type === 0 || c.type === 5);
  }

  private ensureClient(): DiscordClient {
    const bot = this.bot;
    if (!bot) throw new Error("Discord is not connected.");
    // The bot owns the client; expose it for read-only lookups.
    return bot.client;
  }

  // ── settings ─────────────────────────────────────────────────────────────

  async updateSettings(patch: {
    rateLimitPerMin?: number;
    maxAttachmentBytes?: number;
    autoStart?: boolean;
    webhookUrl?: string | null;
    devGuildId?: string | null;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const next: Partial<XRConfig["discord"]> = {};
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
    if (patch.webhookUrl !== undefined) {
      const url = (patch.webhookUrl ?? "").trim();
      if (url && !/^https:\/\/[^\s]+$/.test(url)) return { ok: false, reason: "The webhook URL must start with https://." };
      next.webhookUrl = url || undefined;
    }
    if (patch.devGuildId !== undefined) {
      const id = patch.devGuildId ? normalizeDiscordId(patch.devGuildId) : null;
      if (patch.devGuildId && !id) return { ok: false, reason: "The dev server id must be a Discord id (numbers)." };
      next.devGuildId = id ?? undefined;
    }
    this.writeDiscordConfig(next);
    if (patch.webhookUrl !== undefined) await this.registerInteractionsEndpoint(next.webhookUrl ?? null);
    this.opts.store.audit("discord.settings", { keys: Object.keys(next) });
    return { ok: true };
  }

  /** Point Discord's interactions endpoint at the user's reverse proxy, or clear it. */
  async registerInteractionsEndpoint(baseUrl: string | null): Promise<{ ok: boolean; reason?: string }> {
    const resolved = await this.resolveToken();
    if (!resolved) return { ok: false, reason: "No bot token is set." };
    const endpoint = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/discord/webhook` : null;
    try {
      const res = await this.f("https://discord.com/api/v10/applications/@me", {
        method: "PATCH",
        headers: { authorization: `Bot ${resolved.token}`, "content-type": "application/json" },
        body: JSON.stringify({ interactions_endpoint_url: endpoint }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        this.log("warn", `interactions endpoint rejected: ${res.status} ${detail}`);
        return { ok: false, reason: "Discord rejected the webhook URL. It must be HTTPS and reachable from Discord." };
      }
      this.log("info", endpoint ? `interactions endpoint set to ${endpoint}` : "interactions endpoint cleared");
      return { ok: true };
    } catch {
      return { ok: false, reason: "Could not reach Discord." };
    }
  }

  // ── webhook (gateway stays the default) ──────────────────────────────────

  /**
   * Handle a signed interaction from Discord's servers. Used only in webhook
   * mode; the daemon route does no other authentication.
   */
  async handleWebhook(
    headers: { signature: string | null; timestamp: string | null },
    rawBody: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const { config } = loadConfig();
    const publicKey = config.discord?.publicKey;
    const checked = verifyInteractionSignature({
      publicKey: publicKey ?? "",
      signature: headers.signature,
      timestamp: headers.timestamp,
      body: rawBody,
    });
    if (!checked.ok) {
      this.opts.store.audit("discord.webhook.rejected", { reason: checked.reason });
      return { status: 401, body: { error: "bad signature" } };
    }
    let payload: DiscordInteraction & { type?: number };
    try {
      payload = JSON.parse(rawBody) as DiscordInteraction;
    } catch {
      return { status: 400, body: { error: "bad json" } };
    }
    if (payload.type === 1) return { status: 200, body: { type: 1 } }; // PING
    const resolved = await this.resolveToken();
    if (!resolved) return { status: 503, body: { error: "not configured" } };
    await this.ensureBot(resolved.token).handleInteraction(payload).catch((err) => this.log("warn", `webhook dispatch failed: ${(err as Error).message}`));
    // The bot answered through the interaction callback URL; a deferred response
    // (type 5) is the documented ack for anything that takes longer than a blink.
    return { status: 200, body: { type: 5 } };
  }

  // ── views ────────────────────────────────────────────────────────────────

  async status(): Promise<DiscordStatusView> {
    const cfg = this.config().discord;
    const resolved = await this.resolveToken();
    const paired = cfg.pairedUserIds ?? [];
    let label: DiscordLabel = "Not set up";
    if (this.running) label = paired.length > 0 ? "Connected" : "Running";
    else if (this.lastError) label = "Error";
    else if (resolved) label = "Stopped";
    const labels = this.state.labels ?? {};
    return {
      label,
      running: this.running,
      gateway: this.gateway,
      gatewayText: gatewaySummary(this.gateway),
      bot: this.appInfo,
      inviteUrl: this.appInfo ? inviteUrl(this.appInfo.applicationId) : null,
      tokenSource: resolved?.source ?? "none",
      enabled: cfg.enabled,
      autoStart: cfg.autoStart,
      pairing: {
        open: this.pairing.isOpen(),
        closesAt: this.pairing.windowClosesAt(),
        pending: this.pairing.pending(),
        codes: this.issuedCodes(),
      },
      pairedUsers: paired.map((userId) => ({
        userId,
        label: labels[userId] ?? userId,
        source: "paired" as const,
      })),
      channels: (cfg.allowedChannels ?? []).map((c) => ({
        guildId: c.guildId,
        channelId: c.channelId,
        label: labels[`${c.guildId}:${c.channelId}`] ?? `<#${c.channelId}>`,
      })),
      settings: {
        rateLimitPerMin: Math.round(cfg.rateLimit.refillPerSec * 60),
        maxAttachmentBytes: cfg.maxAttachmentBytes,
        webhookUrl: cfg.webhookUrl ?? null,
        devGuildId: cfg.devGuildId ?? null,
        dashboardUrl: this.dashboardUrl(),
      },
      envOverrides: { token: Boolean(process.env.XR_DISCORD_TOKEN) },
      commandsRegisteredAt: this.state.commandsRegisteredAt,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  /** Last N redacted log lines (newest last). */
  tail(n = 50): Array<{ at: number; level: string; line: string }> {
    const take = Math.max(1, Math.min(LOG_CAP, Math.floor(n)));
    return this.logs.slice(-take);
  }

  /** Test seam: the current runtime state. */
  runtimeState(): Readonly<DiscordRuntimeState> {
    return this.state;
  }

  /** The live bot instance, when one exists (used by tests and the demo harness). */
  get instance(): DiscordBot | null {
    return this.bot;
  }

  /** URL the 🖥 Open XR button points at, for one approval. */
  approvalDashboardUrl(id: string): string {
    return this.openDashboardUrl(id);
  }
}

export { inviteUrl as discordInviteUrl };
