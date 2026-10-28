/**
 * V1-P5-001 — mobile companion chat store (~/.xr/mobile-chats.json).
 *
 * Shipping truth (Phase 2.4): the daemon holds no server-side chat list for
 * the DESKTOP — the desktop keeps history client-side. The phone is different:
 * it syncs through the daemon (a re-installed or second phone recovers its
 * conversations), so the companion chat surface needs server-side rows. They
 * live HERE, mobile-scoped, and never touch the desktop's stores.
 *
 * Rules (mirrors the paired-device registry beside it):
 *   · JSON file under ~/.xr with 0600 perms, 0700 directory;
 *   · read-modify-write serialized through a promise chain (no torn writes);
 *   · bounded: the most recent 200 chats, the most recent 500 messages per
 *     chat — companion sync, not an archive.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface MobileChatRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MobileMessageRow {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

interface MobileChatRegistry {
  version: 1;
  chats: MobileChatRow[];
  messages: Record<string, MobileMessageRow[]>;
}

const STORE_PATH = () => join(homeDir(), ".xr", "mobile-chats.json");
const MAX_CHATS = 200;
const MAX_MESSAGES_PER_CHAT = 500;

/**
 * Resolve the user home per call from $HOME (fallback: os.homedir()). Bun
 * snapshots os.homedir() at process start, so tests that pin HOME at module
 * load (this repo's convention) would otherwise leak state into the real
 * home; reading the env per call is identical in production and isolatable
 * in tests.
 */
function homeDir(): string {
  return process.env.HOME ?? homedir();
}

let cache: MobileChatRegistry | null = null;
/** Serializes read-modify-write cycles so concurrent requests cannot tear. */
let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<MobileChatRegistry> {
  if (cache) return cache;
  try {
    const raw = await readFile(STORE_PATH(), "utf8");
    const parsed = JSON.parse(raw) as MobileChatRegistry;
    cache = parsed.version === 1 ? parsed : { version: 1, chats: [], messages: {} };
  } catch {
    cache = { version: 1, chats: [], messages: {} };
  }
  return cache;
}

async function save(registry: MobileChatRegistry): Promise<void> {
  cache = registry;
  await mkdir(join(homeDir(), ".xr"), { recursive: true, mode: 0o700 });
  await writeFile(STORE_PATH(), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
}

/** Run a mutation under the write chain; the caller returns the result. */
function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function listChats(limit = 50): Promise<MobileChatRow[]> {
  return mutate(async () => {
    const reg = await load();
    return [...reg.chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  });
}

export function createChat(title: string): Promise<MobileChatRow> {
  return mutate(async () => {
    const reg = await load();
    const now = Date.now();
    const row: MobileChatRow = {
      id: `mcht_${randomUUID().slice(0, 12)}`,
      title: title.slice(0, 120) || "New chat",
      createdAt: now,
      updatedAt: now,
    };
    reg.chats.unshift(row);
    if (reg.chats.length > MAX_CHATS) {
      for (const dropped of reg.chats.splice(MAX_CHATS)) delete reg.messages[dropped.id];
    }
    await save(reg);
    return row;
  });
}

export function getChat(id: string): Promise<MobileChatRow | null> {
  return mutate(async () => {
    const reg = await load();
    return reg.chats.find((c) => c.id === id) ?? null;
  });
}

export function listMessages(chatId: string, limit = 200): Promise<MobileMessageRow[]> {
  return mutate(async () => {
    const reg = await load();
    return (reg.messages[chatId] ?? []).slice(-limit);
  });
}

/** Append a message and touch the chat (created on demand for local-first
 * phone ids that never round-tripped through POST /api/mobile/chats). */
export function appendMessage(chatId: string, role: "user" | "assistant", content: string): Promise<MobileMessageRow> {
  return mutate(async () => {
    const reg = await load();
    const now = Date.now();
    if (!reg.chats.some((c) => c.id === chatId)) {
      reg.chats.unshift({ id: chatId, title: content.slice(0, 80) || "New chat", createdAt: now, updatedAt: now });
      if (reg.chats.length > MAX_CHATS) {
        for (const dropped of reg.chats.splice(MAX_CHATS)) delete reg.messages[dropped.id];
      }
    }
    const row: MobileMessageRow = { id: `mmsg_${randomUUID().slice(0, 12)}`, chatId, role, content, createdAt: now };
    const list = reg.messages[chatId] ?? (reg.messages[chatId] = []);
    list.push(row);
    if (list.length > MAX_MESSAGES_PER_CHAT) reg.messages[chatId] = list.slice(-MAX_MESSAGES_PER_CHAT);
    const chat = reg.chats.find((c) => c.id === chatId)!;
    chat.updatedAt = now;
    if (role === "user") chat.title = chat.title === "New chat" ? content.slice(0, 80) : chat.title;
    await save(reg);
    return row;
  });
}

/** Test hook: drop the in-memory cache + the on-disk file (isolated HOME). */
export async function resetMobileChatsForTest(): Promise<void> {
  cache = null;
  chain = Promise.resolve();
  try {
    const { rmSync } = await import("node:fs");
    rmSync(STORE_PATH(), { force: true });
  } catch {
    /* absent file is fine */
  }
}
