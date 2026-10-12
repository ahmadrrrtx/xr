/**
 * XR — Telegram runtime state that changes too often for config.json.
 *
 * Holds the getUpdates offset (so a restart resumes without dropping or
 * replaying messages), the webhook secret token, and per-chat settings set
 * from chat (/model, /budget). Written atomically with mode 0600. Contains no
 * credentials: the bot token lives in the SecretBroker.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Per-chat settings. The shape moved to the shared chat runtime
 * (src/bots/types.ts) in Phase 26 · PR 2 because Discord and WhatsApp store the
 * same two fields; the re-export keeps Phase 24 importers unchanged.
 */
import type { ChatSettings } from "../bots/types.ts";
export type { ChatSettings };

export interface TelegramRuntimeState {
  offset: number;
  webhookSecret: string;
  chats: Record<string, ChatSettings>;
}

export function telegramStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XR_HOME ?? join(homedir(), ".xr"), "telegram", "state.json");
}

function blank(): TelegramRuntimeState {
  return { offset: 0, webhookSecret: randomBytes(24).toString("hex"), chats: {} };
}

export function loadTelegramState(path = telegramStatePath()): TelegramRuntimeState {
  if (!existsSync(path)) return blank();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TelegramRuntimeState>;
    const fresh = blank();
    return {
      offset: Number.isSafeInteger(raw.offset) && (raw.offset as number) >= 0 ? (raw.offset as number) : 0,
      webhookSecret: typeof raw.webhookSecret === "string" && raw.webhookSecret ? raw.webhookSecret : fresh.webhookSecret,
      chats: raw.chats && typeof raw.chats === "object" ? raw.chats : {},
    };
  } catch {
    return blank();
  }
}

export function saveTelegramState(state: TelegramRuntimeState, path = telegramStatePath()): void {
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
