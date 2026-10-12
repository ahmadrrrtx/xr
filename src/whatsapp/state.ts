/**
 * XR — WhatsApp runtime state that changes too often for config.json.
 *
 * Holds the linked-account label, per-chat settings (`/xr model`, `/xr budget`)
 * and the outbox (numbers a message was sent to, for the "respond to contacts I
 * message first" whitelist). Written atomically with mode 0600, like the
 * Telegram and Discord state files.
 *
 * No credentials live here — the linked-device blob is in `creds.sealed`
 * (see `creds.ts`), and the allow-list is config.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatSettings } from "../bots/types.ts";
import { whatsappDir } from "./creds.ts";

export type { ChatSettings };

export interface WhatsAppRuntimeState {
  /** The account's own jid, once linked. */
  selfJid: string | null;
  /** Masked own number for the UI ("…4567"). Never the full number. */
  selfLabel: string | null;
  /** When the device was linked (ms). */
  linkedAt: number | null;
  /** Per-chat settings: model, per-task budget. Keyed by phone. */
  chats: Record<string, ChatSettings>;
  /** Display-only names WhatsApp reports for contacts, keyed by phone. */
  labels: Record<string, string>;
  /** Numbers XR has sent to (outbox whitelist source). */
  outbox: string[];
}

export function whatsappStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(whatsappDir(env), "state.json");
}

function blank(): WhatsAppRuntimeState {
  return { selfJid: null, selfLabel: null, linkedAt: null, chats: {}, labels: {}, outbox: [] };
}

export function loadWhatsAppState(path = whatsappStatePath()): WhatsAppRuntimeState {
  if (!existsSync(path)) return blank();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<WhatsAppRuntimeState>;
    const fresh = blank();
    return {
      selfJid: typeof raw.selfJid === "string" && raw.selfJid ? raw.selfJid : null,
      selfLabel: typeof raw.selfLabel === "string" && raw.selfLabel ? raw.selfLabel : null,
      linkedAt: typeof raw.linkedAt === "number" && Number.isFinite(raw.linkedAt) ? raw.linkedAt : null,
      chats: raw.chats && typeof raw.chats === "object" ? (raw.chats as Record<string, ChatSettings>) : fresh.chats,
      labels: raw.labels && typeof raw.labels === "object" ? (raw.labels as Record<string, string>) : fresh.labels,
      outbox: Array.isArray(raw.outbox) ? raw.outbox.filter((p): p is string => typeof p === "string") : fresh.outbox,
    };
  } catch {
    return blank();
  }
}

export function saveWhatsAppState(state: WhatsAppRuntimeState, path = whatsappStatePath()): void {
  mkdirSync(whatsappDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best-effort on platforms without POSIX modes */
  }
  renameSync(tmp, path);
}
