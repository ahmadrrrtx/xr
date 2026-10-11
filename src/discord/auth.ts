/**
 * XR — Discord access control and pairing (Phase 26).
 *
 * Fail-closed. A DM from a user who is not paired gets no reply. A guild
 * message is answered only when its channel is whitelisted AND the sender is
 * paired. Pairing codes are issued by the desktop (the dialog shows the code),
 * then redeemed in Discord with `/xr pair <code>` (DM) or
 * `/xr pairchannel <code>` (channel). Codes are 6 digits, single-use, expire
 * after 10 minutes, and five wrong guesses lock that kind of code until a new one is issued.
 *
 * Persisted state holds ids and settings only. The bot token lives in SecretBroker.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomInt, timingSafeEqual } from "node:crypto";

export const DISCORD_CODE_TTL_MS = 10 * 60_000;
export const DISCORD_MAX_FAILED_ATTEMPTS = 5;

export interface DiscordPairedUser {
  userId: string;
  pairedAt: number;
}

export interface DiscordAllowedChannel {
  guildId: string;
  channelId: string;
  addedBy: string;
  addedAt: number;
}

export interface DiscordChatSettings {
  model?: string;
  budgetUsd?: number;
}

export interface DiscordState {
  version: 1;
  autoStart: boolean;
  botId: string | null;
  botUsername: string | null;
  appId: string | null;
  paired: DiscordPairedUser[];
  channels: DiscordAllowedChannel[];
  chats: Record<string, DiscordChatSettings>;
}

export function discordStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XR_HOME ?? join(homedir(), ".xr"), "discord", "state.json");
}

export function blankDiscordState(): DiscordState {
  return { version: 1, autoStart: false, botId: null, botUsername: null, appId: null, paired: [], channels: [], chats: {} };
}

export function loadDiscordState(path = discordStatePath()): DiscordState {
  if (!existsSync(path)) return blankDiscordState();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DiscordState>;
    const fresh = blankDiscordState();
    return {
      version: 1,
      autoStart: raw.autoStart === true,
      botId: typeof raw.botId === "string" ? raw.botId : null,
      botUsername: typeof raw.botUsername === "string" ? raw.botUsername : null,
      appId: typeof raw.appId === "string" ? raw.appId : null,
      paired: Array.isArray(raw.paired) ? raw.paired.filter((p) => typeof p?.userId === "string") : fresh.paired,
      channels: Array.isArray(raw.channels) ? raw.channels.filter((c) => typeof c?.channelId === "string" && typeof c?.guildId === "string") : [],
      chats: raw.chats && typeof raw.chats === "object" ? raw.chats : {},
    };
  } catch {
    return blankDiscordState();
  }
}

export function saveDiscordState(state: DiscordState, path = discordStatePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best-effort on platforms without POSIX modes */
  }
  renameSync(tmp, path);
}

/** The persisted allow-list: who may talk to XR and where. */
export class DiscordAccess {
  constructor(
    readonly state: DiscordState,
    private readonly persist: (s: DiscordState) => void,
  ) {}

  private save(): void {
    this.persist(this.state);
  }

  isPaired(userId: string): boolean {
    return this.state.paired.some((p) => p.userId === userId);
  }

  pairUser(userId: string, now = Date.now()): void {
    if (this.isPaired(userId)) return;
    this.state.paired.push({ userId, pairedAt: now });
    this.save();
  }

  unpair(userId: string): void {
    this.state.paired = this.state.paired.filter((p) => p.userId !== userId);
    this.save();
  }

  isAllowedChannel(guildId: string | undefined, channelId: string): boolean {
    return this.state.channels.some((c) => c.channelId === channelId && (guildId === undefined || c.guildId === guildId));
  }

  allowChannel(guildId: string, channelId: string, addedBy: string, now = Date.now()): void {
    if (this.isAllowedChannel(guildId, channelId)) return;
    this.state.channels.push({ guildId, channelId, addedBy, addedAt: now });
    this.save();
  }

  removeChannel(channelId: string): void {
    this.state.channels = this.state.channels.filter((c) => c.channelId !== channelId);
    this.save();
  }

  chat(chatId: string): DiscordChatSettings {
    return this.state.chats[chatId] ?? {};
  }

  setChat(chatId: string, patch: DiscordChatSettings): void {
    this.state.chats[chatId] = { ...this.chat(chatId), ...patch };
    this.save();
  }

  setAutoStart(on: boolean): void {
    this.state.autoStart = on;
    this.save();
  }

  setIdentity(id: { botId: string; botUsername: string; appId: string }): void {
    this.state.botId = id.botId;
    this.state.botUsername = id.botUsername;
    this.state.appId = id.appId;
    this.save();
  }

  /** Forget all pairings and channels (disconnect). Settings stay. */
  clearAccess(): void {
    this.state.paired = [];
    this.state.channels = [];
    this.save();
  }
}

export type CodeKind = "dm" | "channel";

interface Issued {
  code: string;
  expiresAt: number;
  failed: number;
}

/** In-memory pairing codes. A restart clears them, which is fail-closed. */
export class DiscordCodes {
  private readonly issued = new Map<CodeKind, Issued>();

  issue(kind: CodeKind, now = Date.now()): { code: string; expiresAt: number } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const entry: Issued = { code, expiresAt: now + DISCORD_CODE_TTL_MS, failed: 0 };
    this.issued.set(kind, entry);
    return { code, expiresAt: entry.expiresAt };
  }

  /** Check a redemption attempt. A correct code is consumed on success. */
  redeem(kind: CodeKind, attempt: string, now = Date.now()): "ok" | "invalid" | "locked" {
    const entry = this.issued.get(kind);
    if (!entry || entry.expiresAt <= now) {
      this.issued.delete(kind);
      return "invalid";
    }
    if (entry.failed >= DISCORD_MAX_FAILED_ATTEMPTS) return "locked";
    if (safeEqual(entry.code, attempt.trim())) {
      this.issued.delete(kind);
      return "ok";
    }
    entry.failed += 1;
    if (entry.failed >= DISCORD_MAX_FAILED_ATTEMPTS) return "locked";
    return "invalid";
  }

  clear(): void {
    this.issued.clear();
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
