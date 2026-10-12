/**
 * XR — Discord runtime state that changes too often for config.json.
 *
 * Holds the gateway session (so a restart resumes instead of re-identifying),
 * when slash commands were last registered, and per-chat settings set from a
 * chat (/model, /budget). Written atomically with mode 0600, like the Telegram
 * state file. Contains no credentials: the bot token lives in the SecretBroker.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChatSettings } from "../bots/types.ts";

export type { ChatSettings };

export interface DiscordRuntimeState {
  /** Gateway session id, for RESUME after a reconnect. */
  sessionId: string | null;
  /** Resume URL the gateway handed us at READY. */
  resumeGatewayUrl: string | null;
  /** Last received sequence number, for RESUME. */
  seq: number | null;
  /** Application id resolved at connect time (needed for webhook/interaction URLs). */
  applicationId: string | null;
  /** When slash commands were last registered (ms). */
  commandsRegisteredAt: number | null;
  /** Per-channel settings: model, per-task budget. */
  chats: Record<string, ChatSettings>;
  /**
   * Human labels for paired users and allowed channels, keyed by user id or
   * `guildId:channelId`. Display only — never used for authorization.
   */
  labels: Record<string, string>;
}

export function discordStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XR_HOME ?? join(homedir(), ".xr"), "discord", "state.json");
}

function blank(): DiscordRuntimeState {
  return {
    sessionId: null,
    resumeGatewayUrl: null,
    seq: null,
    applicationId: null,
    commandsRegisteredAt: null,
    chats: {},
    labels: {},
  };
}

export function loadDiscordState(path = discordStatePath()): DiscordRuntimeState {
  if (!existsSync(path)) return blank();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DiscordRuntimeState>;
    const fresh = blank();
    return {
      sessionId: typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : null,
      resumeGatewayUrl: typeof raw.resumeGatewayUrl === "string" && raw.resumeGatewayUrl ? raw.resumeGatewayUrl : null,
      seq: Number.isSafeInteger(raw.seq) ? (raw.seq as number) : null,
      applicationId: typeof raw.applicationId === "string" && raw.applicationId ? raw.applicationId : null,
      commandsRegisteredAt:
        typeof raw.commandsRegisteredAt === "number" && Number.isFinite(raw.commandsRegisteredAt)
          ? raw.commandsRegisteredAt
          : null,
      chats: raw.chats && typeof raw.chats === "object" ? (raw.chats as Record<string, ChatSettings>) : fresh.chats,
      labels: raw.labels && typeof raw.labels === "object" ? (raw.labels as Record<string, string>) : fresh.labels,
    };
  } catch {
    return blank();
  }
}

export function saveDiscordState(state: DiscordRuntimeState, path = discordStatePath()): void {
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
