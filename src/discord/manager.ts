/**
 * XR — DiscordManager: the daemon-owned lifecycle for the Discord surface (Phase 26).
 *
 * Owns the bot instance, the persisted access state (paired users, allowed
 * channels, per-chat settings), and the in-memory pairing codes. The token
 * lives only in SecretBroker (XR_DISCORD_BOT_TOKEN). It is never written to
 * the state file, the log buffer, or an API response.
 */
import type { Store } from "../state/workspace-store.ts";
import { getSecretAsync, setSecretAsync, removeSecretAsync } from "../security/secrets.ts";
import { getApprovalStore } from "../control/approval-store.ts";
import { DiscordBot, DiscordError, type DiscordBotDeps } from "./bot.ts";
import { DiscordAccess, DiscordCodes, discordStatePath, loadDiscordState, saveDiscordState, type DiscordState, type CodeKind } from "./auth.ts";
import type { GatewayStatus, WsCtor } from "./gateway.ts";
import { DISCORD_API_BASE, XR_INVITE_PERMISSIONS } from "./types.ts";

export const DISCORD_TOKEN_SECRET = "XR_DISCORD_BOT_TOKEN";
export const DISCORD_COPY_RUNNING = "XR must be running on your computer for the bot to respond.";

/** Discord bot tokens: base64 user id, timestamp, HMAC. Checked before any network call. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;

export interface DiscordManagerDeps {
  store: Store;
  env?: NodeJS.ProcessEnv;
  statePath?: string;
  apiBase?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  WebSocketCtor?: WsCtor;
  runAgent?: DiscordBotDeps["runAgent"];
  secrets?: {
    get: (name: string) => Promise<string | undefined>;
    set: (name: string, value: string) => Promise<unknown>;
    remove: (name: string) => Promise<unknown>;
  };
}

export interface DiscordStatusView {
  connected: boolean;
  running: boolean;
  status: GatewayStatus | "idle";
  bot: { id: string; username: string } | null;
  guilds: number;
  pairedUsers: number;
  allowedChannels: Array<{ guildId: string; channelId: string }>;
  autoStart: boolean;
  inviteUrl: string | null;
  spendTodayUsd: number;
  lastError: string | null;
  copy: string;
}

export function discordInviteUrl(appId: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    scope: "bot applications.commands",
    permissions: String(XR_INVITE_PERMISSIONS),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

interface LogLine {
  at: number;
  level: "info" | "warn" | "error";
  line: string;
}

export class DiscordManager {
  private state: DiscordState;
  private readonly access: DiscordAccess;
  private readonly codes = new DiscordCodes();
  private bot: DiscordBot | null = null;
  private token: string | null = null;
  private gatewayStatus: GatewayStatus | "idle" = "idle";
  private lastError: string | null = null;
  private readonly logs: LogLine[] = [];
  private readonly secrets: NonNullable<DiscordManagerDeps["secrets"]>;
  private readonly statePath: string;
  private starting: Promise<{ ok: boolean; reason?: string }> | null = null;

  constructor(private readonly deps: DiscordManagerDeps) {
    this.statePath = deps.statePath ?? discordStatePath(deps.env ?? process.env);
    this.state = loadDiscordState(this.statePath);
    this.access = new DiscordAccess(this.state, (s) => saveDiscordState(s, this.statePath));
    this.secrets = deps.secrets ?? {
      get: getSecretAsync,
      set: setSecretAsync,
      remove: removeSecretAsync,
    };
  }

  /** Token precedence: environment (for headless setups), then SecretBroker. */
  async resolveToken(): Promise<string | null> {
    const env = (this.deps.env ?? process.env)[DISCORD_TOKEN_SECRET];
    if (env && TOKEN_SHAPE.test(env.trim())) return env.trim();
    const stored = await this.secrets.get(DISCORD_TOKEN_SECRET);
    return stored && TOKEN_SHAPE.test(stored) ? stored : null;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Validate and store a bot token, then start the bot. The token is saved
   * only after Discord accepts it, so a typo never replaces a working token.
   */
  async connect(rawToken: string): Promise<{ ok: true; bot: { id: string; username: string } } | { ok: false; reason: string }> {
    const token = rawToken.trim();
    if (!TOKEN_SHAPE.test(token)) return { ok: false, reason: "That does not look like a Discord bot token." };
    await this.stop();
    const bot = this.makeBot(token);
    try {
      const identity = await bot.start();
      await this.secrets.set(DISCORD_TOKEN_SECRET, token);
      this.token = token;
      this.bot = bot;
      this.state.autoStart = true;
      this.access.setAutoStart(true);
      this.access.setIdentity({ botId: identity.botId, botUsername: identity.username, appId: identity.appId ?? identity.botId });
      this.lastError = null;
      this.record("info", `connected as ${identity.username}`);
      this.deps.store.audit("discord.connected", { botId: identity.botId });
      return { ok: true, bot: { id: identity.botId, username: identity.username } };
    } catch (err) {
      bot.stop();
      const reason = err instanceof DiscordError ? err.message : "Could not reach Discord. Check the connection and try again.";
      this.lastError = reason;
      this.record("warn", reason);
      return { ok: false, reason };
    }
  }

  /** Start the bot with the stored token. Idempotent. */
  start(): Promise<{ ok: boolean; reason?: string }> {
    if (this.bot) return Promise.resolve({ ok: true });
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const token = await this.resolveToken();
      if (!token) return { ok: false, reason: "No bot token is saved. Connect Discord first." };
      const bot = this.makeBot(token);
      try {
        const identity = await bot.start();
        this.token = token;
        this.bot = bot;
        this.lastError = null;
        this.access.setIdentity({ botId: identity.botId, botUsername: identity.username, appId: identity.appId ?? identity.botId });
        this.record("info", `started as ${identity.username}`);
        return { ok: true };
      } catch (err) {
        bot.stop();
        const reason = err instanceof DiscordError ? err.message : "Could not reach Discord.";
        this.lastError = reason;
        this.record("warn", reason);
        return { ok: false, reason };
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  async stop(): Promise<void> {
    if (!this.bot) return;
    this.bot.stop();
    this.bot = null;
    this.gatewayStatus = "stopped";
    this.record("info", "stopped");
  }

  async shutdown(): Promise<void> {
    await this.stop();
  }

  /** Daemon boot: start the bot only when the user left it connected. */
  async autoStartOnBoot(): Promise<void> {
    if (!this.state.autoStart) return;
    const res = await this.start();
    if (!res.ok) this.record("warn", `autostart skipped: ${res.reason ?? "unknown"}`);
  }

  /** Disconnect: stop, remove the token, forget pairings and channels. Settings stay. */
  async disconnect(): Promise<void> {
    await this.stop();
    await this.secrets.remove(DISCORD_TOKEN_SECRET);
    this.token = null;
    this.codes.clear();
    this.access.clearAccess();
    this.access.setAutoStart(false);
    this.lastError = null;
    this.record("info", "disconnected");
    this.deps.store.audit("discord.disconnected", {});
  }

  // ── pairing and access (desktop side) ────────────────────────────────────

  setAutoStart(on: boolean): void {
    this.access.setAutoStart(on);
  }

  /** A code for `/xr pair` in a DM. The desktop shows it; the user types it in Discord. */
  openPairing(kind: CodeKind = "dm"): { code: string; expiresAt: number } {
    const issued = this.codes.issue(kind);
    this.deps.store.audit("discord.pair.code_issued", { kind });
    return issued;
  }

  unpair(userId: string): void {
    this.access.unpair(userId);
    this.deps.store.audit("discord.unpaired", { userId });
  }

  removeChannel(channelId: string): void {
    this.access.removeChannel(channelId);
    this.deps.store.audit("discord.channel.removed", { channelId });
  }

  pairedUserIds(): string[] {
    return this.access.state.paired.map((p) => p.userId);
  }

  // ── status and logs ──────────────────────────────────────────────────────

  async status(): Promise<DiscordStatusView> {
    const token = this.token ?? (await this.resolveToken());
    const bot = this.bot;
    const identity = bot?.info.identity ?? null;
    const appId = identity?.appId ?? this.access.state.appId ?? this.access.state.botId;
    return {
      connected: Boolean(token),
      running: Boolean(bot),
      status: this.gatewayStatus,
      bot: this.access.state.botId ? { id: this.access.state.botId, username: this.access.state.botUsername ?? "XR" } : null,
      guilds: bot?.info.guilds ?? 0,
      pairedUsers: this.access.state.paired.length,
      allowedChannels: this.access.state.channels.map((c) => ({ guildId: c.guildId, channelId: c.channelId })),
      autoStart: this.access.state.autoStart,
      inviteUrl: appId ? discordInviteUrl(appId) : null,
      spendTodayUsd: this.spendToday(),
      lastError: this.lastError,
      copy: DISCORD_COPY_RUNNING,
    };
  }

  private spendToday(): number {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return this.deps.store.getSpendForPeriod(startOfDay);
  }

  /** Recent log lines. The token is redacted, and the buffer holds nothing else secret. */
  tail(n = 50): LogLine[] {
    return this.logs.slice(-Math.max(1, Math.min(n, 200)));
  }

  /** Approvals waiting in Discord chats (for the desktop status). */
  pendingApprovals(): number {
    return getApprovalStore(this.deps.store).listPending().filter((r) => r.surface === "discord").length;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private makeBot(token: string): DiscordBot {
    return new DiscordBot({
      token,
      store: this.deps.store,
      access: this.access,
      codes: this.codes,
      apiBase: this.deps.apiBase ?? DISCORD_API_BASE,
      fetchFn: this.deps.fetchFn,
      sleep: this.deps.sleep,
      WebSocketCtor: this.deps.WebSocketCtor,
      runAgent: this.deps.runAgent,
      log: (line) => this.record("info", line),
      onStatus: (s, detail) => {
        this.gatewayStatus = s;
        if (s === "fatal") {
          this.lastError = detail ?? "Discord closed the connection.";
          this.bot = null;
          this.record("error", this.lastError);
          this.deps.store.audit("discord.fatal", {});
        }
      },
    });
  }

  private record(level: LogLine["level"], line: string): void {
    const clean = this.redact(line);
    this.logs.push({ at: Date.now(), level, line: clean });
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }

  private redact(line: string): string {
    let out = line;
    if (this.token) out = out.split(this.token).join("[redacted]");
    return out.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}/g, "[redacted]");
  }
}
