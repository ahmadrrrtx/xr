import { get, set, del, keys, createStore } from 'idb-keyval';
import type { Approval, Budget, ChatMessage, ChatSummary, ModelInfo, QueuedRequest } from '../types';

/**
 * Offline storage. IndexedDB (via idb-keyval, ~600 B) because localStorage is
 * synchronous, 5 MB-capped, and unusable from the service worker.
 *
 * Everything here stays on the device. Nothing is ever sent anywhere except
 * back to the user's own daemon.
 */

const store = createStore('xr-mobile', 'cache');

export const KEYS = {
  chats: 'chats',
  messages: (chatId: string) => `messages:${chatId}`,
  approvals: 'approvals',
  budget: 'budget',
  models: 'models',
  meta: 'meta',
  queue: 'queue',
  pin: 'certpin',
  settings: 'settings',
  lastChat: 'lastChat',
  pushKey: 'pushKey',
  pushSub: 'pushSub',
  voiceLog: 'voiceLog',
} as const;

/* ------------------------------------------------------------------ limits --- */

export const LIMITS = {
  chats: 50,
  messagesPerChat: 200,
  approvals: 200,
  /** Hard ceiling for the offline cache; LRU-evicted past this. */
  maxBytes: 20 * 1024 * 1024,
} as const;

function byteLength(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------- cache --- */

export async function cacheChats(chats: ChatSummary[]): Promise<void> {
  await set(KEYS.chats, chats.slice(0, LIMITS.chats), store);
  await trimCache().catch(() => {});
}

export async function readChats(): Promise<ChatSummary[]> {
  return (await get<ChatSummary[]>(KEYS.chats, store)) ?? [];
}

export async function cacheMessages(chatId: string, messages: ChatMessage[]): Promise<void> {
  const trimmed = messages
    .filter((m) => !m.streaming)
    .slice(-LIMITS.messagesPerChat)
    .map((m) => ({ ...m, streaming: false }));
  await set(KEYS.messages(chatId), trimmed, store);
  await set(KEYS.lastChat, chatId, store);
  await trimCache().catch(() => {});
}

export async function readMessages(chatId: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(KEYS.messages(chatId), store)) ?? [];
}

export async function readLastChat(): Promise<string | null> {
  return (await get<string>(KEYS.lastChat, store)) ?? null;
}

export async function cacheApprovals(approvals: Approval[]): Promise<void> {
  await set(KEYS.approvals, approvals.slice(0, LIMITS.approvals), store);
  await trimCache().catch(() => {});
}

export async function readApprovals(): Promise<Approval[]> {
  return (await get<Approval[]>(KEYS.approvals, store)) ?? [];
}

export async function cacheBudget(budget: Budget): Promise<void> {
  await set(KEYS.budget, budget, store);
}
export async function readBudget(): Promise<Budget | null> {
  return (await get<Budget>(KEYS.budget, store)) ?? null;
}

export async function cacheModels(models: ModelInfo[]): Promise<void> {
  await set(KEYS.models, models, store);
}
export async function readModels(): Promise<ModelInfo[]> {
  return (await get<ModelInfo[]>(KEYS.models, store)) ?? [];
}

export async function cacheMeta(meta: unknown): Promise<void> {
  await set(KEYS.meta, meta, store);
}
export async function readMeta<T>(): Promise<T | null> {
  return (await get<T>(KEYS.meta, store)) ?? null;
}

export interface VoiceLogEntry {
  id: string;
  transcript: string;
  response?: string | undefined;
  createdAt: number;
}
export async function pushVoiceLog(entry: VoiceLogEntry): Promise<void> {
  const current = (await get<VoiceLogEntry[]>(KEYS.voiceLog, store)) ?? [];
  current.unshift(entry);
  await set(KEYS.voiceLog, current.slice(0, 10), store);
}
export async function readVoiceLog(): Promise<VoiceLogEntry[]> {
  return (await get<VoiceLogEntry[]>(KEYS.voiceLog, store)) ?? [];
}

/* ---------------------------------------------------------------------- LRU --- */

/** Approximate total cache size in bytes. */
export async function cacheSize(): Promise<number> {
  const all = await keys(store);
  let total = 0;
  for (const key of all) {
    total += byteLength(await get(key, store));
  }
  return total;
}

/**
 * Evict least-recently-updated per-chat message caches until we're under
 * LIMITS.maxBytes. Chat list, approvals, budget and models are always kept —
 * they're small and they're what makes offline useful.
 */
export async function trimCache(): Promise<void> {
  const size = await cacheSize();
  if (size <= LIMITS.maxBytes) return;

  const all = await keys(store);
  const messageKeys = all
    .filter((k): k is string => typeof k === 'string' && k.startsWith('messages:'))
    .map((k) => ({ key: k, chatId: k.slice('messages:'.length) }));

  const chats = await readChats();
  const order = new Map(chats.map((c, index) => [c.id, index]));

  messageKeys.sort((a, b) => {
    const ra = order.get(a.chatId) ?? Number.MAX_SAFE_INTEGER;
    const rb = order.get(b.chatId) ?? Number.MAX_SAFE_INTEGER;
    return rb - ra; // newest chats first → evict from the tail
  });

  let current = size;
  while (current > LIMITS.maxBytes && messageKeys.length > 0) {
    const victim = messageKeys.pop();
    if (!victim) break;
    current -= byteLength(await get(victim.key, store));
    await del(victim.key, store);
  }
}

export async function clearCache(): Promise<void> {
  const all = await keys(store);
  await Promise.all(
    all
      .filter((k) => typeof k === 'string' && !k.startsWith('settings') && k !== KEYS.pin)
      .map((k) => del(k, store)),
  );
}

/** Wipe everything including pairing — "Reset app" in Settings → Advanced. */
export async function resetAll(): Promise<void> {
  const all = await keys(store);
  await Promise.all(all.map((k) => del(k, store)));
}

/* -------------------------------------------------------------------- queue --- */

export async function readQueue(): Promise<QueuedRequest[]> {
  return (await get<QueuedRequest[]>(KEYS.queue, store)) ?? [];
}

export async function writeQueue(items: QueuedRequest[]): Promise<void> {
  await set(KEYS.queue, items, store);
}

export async function enqueue(item: QueuedRequest): Promise<QueuedRequest[]> {
  const current = await readQueue();
  const next = [...current, item];
  await writeQueue(next);
  return next;
}

export async function dequeue(id: string): Promise<QueuedRequest[]> {
  const next = (await readQueue()).filter((item) => item.id !== id);
  await writeQueue(next);
  return next;
}

/* ----------------------------------------------------------------- settings --- */

export interface PersistedSettings {
  theme?: string | undefined;
  model?: string | undefined;
  pushEnabled?: boolean | undefined;
  reduceMotion?: boolean | undefined;
  opens?: number | undefined;
  installPromptDismissed?: boolean | undefined;
  deviceName?: string | undefined;
}

export async function readSettings(): Promise<PersistedSettings> {
  return (await get<PersistedSettings>(KEYS.settings, store)) ?? {};
}

export async function writeSettings(patch: PersistedSettings): Promise<PersistedSettings> {
  const next = { ...(await readSettings()), ...patch };
  await set(KEYS.settings, next, store);
  return next;
}
