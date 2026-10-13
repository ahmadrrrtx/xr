/// <reference lib="webworker" />

/**
 * XR service worker.
 *
 * Responsibilities, in order of importance:
 *   1. Serve the app shell offline (precache).
 *   2. Deliver push notifications — decrypting the second, device-side layer
 *      so the push vendor never sees the approval text.
 *   3. Replay the offline outbox (Background Sync) when connectivity returns.
 *   4. Cache read-only API responses (stale-while-revalidate).
 *
 * Explicitly NOT cached: SSE streams (ephemeral), POSTs (never replayed from
 * cache), and anything under /files, /terminal, /git, /mcp — which the daemon
 * refuses to serve to mobile sessions anyway.
 */

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute, setDefaultHandler } from 'workbox-routing';
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const APP_SHELL = '/mobile/index.html';
const SCOPE = '/mobile/';

precacheAndRoute(self.__WB_MANIFEST);

/* --------------------------------------------------------------- navigation --- */

registerRoute(new NavigationRoute(createHandlerBoundToURL(APP_SHELL), { denylist: [/^\/api\//] }));

/* ------------------------------------------------------- read-only API cache --- */

const CACHEABLE = [/^\/api\/v1\/chats(\?|$)/, /^\/api\/v1\/models(\?|$)/, /^\/api\/v1\/budget(\?|$)/, /^\/api\/v1\/approvals(\?|$)/];

for (const pattern of CACHEABLE) {
  registerRoute(
    ({ url, request }) => request.method === 'GET' && pattern.test(url.pathname),
    new StaleWhileRevalidate({
      cacheName: 'xr-api',
      plugins: [
        {
          cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null),
        },
      ],
    }),
  );
}

/*
 * Writes and liveness probes are NEVER served from cache.
 *
 * /api/meta/version is how the app decides whether it can still see the daemon.
 * Serving a stale 200 from cache would make a revoked or unreachable daemon look
 * healthy for seconds at a time — exactly the wrong thing for a fail-closed app.
 */
registerRoute(
  ({ request, url }) =>
    request.method !== 'GET' || url.pathname.startsWith('/api/meta/') || url.pathname.includes('/chat'),
  new NetworkOnly(),
);

/* Everything else: network first, fall back to cache, never fabricate data.
   3s cap so "offline" is felt immediately instead of after a long hang. */
setDefaultHandler(
  new NetworkFirst({
    cacheName: 'xr-fallback',
    networkTimeoutSeconds: 3,
    plugins: [{ cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null) }],
  }),
);

/* -------------------------------------------------------------------- push --- */

interface PushEnvelope {
  iv: string;
  ciphertext: string;
}
interface PushPayload {
  title?: string;
  body?: string;
  approvalId?: string;
  ts?: number;
}

const PUSH_TTL_MS = 10 * 60 * 1000;

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event: PushEvent): Promise<void> {
  let payload: PushPayload | null = null;

  try {
    const raw = event.data?.json() as PushEnvelope | PushPayload | null;
    if (raw && 'ciphertext' in raw && 'iv' in raw) {
      payload = (await decrypt(raw)) as PushPayload | null;
    } else if (raw) {
      // Unencrypted fallback (should never happen) — show it, but mark it.
      payload = raw as PushPayload;
    }
  } catch {
    payload = null;
  }

  if (!payload) {
    await self.registration.showNotification('XR', {
      body: 'Something needs your attention.',
      data: { url: `${SCOPE}?open=approvals` },
    });
    return;
  }

  // Stale approvals are noise: if it's older than the TTL, or already resolved
  // (the user may have hit Approve on their desktop), stay quiet.
  if (payload.ts && Date.now() - payload.ts > PUSH_TTL_MS) return;
  if (payload.approvalId && (await isResolved(payload.approvalId))) return;

  const pending = await pendingCount();

  await self.registration.showNotification(payload.title ?? 'XR approval needed', {
    body: payload.body ?? 'Open XR to review.',
    tag: payload.approvalId ? `approval-${payload.approvalId}` : 'xr-general',
    renotify: true,
    badge: `${SCOPE}icons/badge-72.png`,
    icon: `${SCOPE}icons/icon-192.png`,
    data: {
      url: payload.approvalId
        ? `${SCOPE}?open=approvals&id=${encodeURIComponent(payload.approvalId)}`
        : `${SCOPE}?open=approvals`,
    },
  } as NotificationOptions);

  const nav = self.navigator as {
    setAppBadge?: (count: number) => Promise<void>;
  };
  if (typeof nav.setAppBadge === 'function') {
    await nav.setAppBadge(pending).catch(() => {});
  }
}

async function decrypt(envelope: PushEnvelope): Promise<PushPayload | null> {
  try {
    const keyB64 = await idbGet<string>('pushKey');
    if (!keyB64) return null;
    const key = await crypto.subtle.importKey('raw', fromBase64(keyB64), { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as PushPayload;
  } catch {
    return null;
  }
}

async function isResolved(approvalId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`/api/v1/approvals/${encodeURIComponent(approvalId)}`, {
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status !== 'pending';
  } catch {
    return false;
  }
}

async function pendingCount(): Promise<number> {
  try {
    const res = await fetch('/api/v1/approvals?status=pending', { credentials: 'include' });
    if (!res.ok) return 1;
    const data = (await res.json()) as { approvals?: unknown[] };
    return data.approvals?.length ?? 1;
  } catch {
    return 1;
  }
}

/* -------------------------------------------------------- notification click --- */

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  notification.close();
  event.waitUntil(openApp((notification.data as { url?: string } | null)?.url ?? SCOPE));
});

async function openApp(url: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    if ('focus' in client) {
      await client.focus();
      client.postMessage({ type: 'xr-navigate', url });
      if ('navigate' in client) {
        try {
          await (client as WindowClient & { navigate: (url: string) => Promise<void> }).navigate(url);
        } catch {
          /* some browsers block navigate(); the postMessage handles it */
        }
      }
      return;
    }
  }
  await self.clients.openWindow(url);
}

/* ---------------------------------------------------------- background sync --- */

const INFLIGHT_MS = 60_000;

/** Minimal shape of the Background Sync event (not in the WebWorker lib yet). */
interface SyncEventLike extends ExtendableEvent {
  tag: string;
  lastChance?: boolean;
}

self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEventLike;
  if (syncEvent.tag === 'xr-outbox') syncEvent.waitUntil(replayOutbox());
});

/** Also attempt a drain opportunistically whenever the worker starts. */
self.addEventListener('message', (event) => {
  const data = (event as ExtendableMessageEvent).data as { type?: string } | null;
  if (data?.type === 'xr-drain-now') {
    (event as ExtendableMessageEvent).waitUntil(replayOutbox());
  }
});

interface QueuedRequest {
  id: string;
  url: string;
  method: 'POST' | 'DELETE';
  body: unknown;
  createdAt: number;
  localId?: string;
  kind: 'chat' | 'new-chat' | 'approval' | 'transcribe';
  attempts: number;
  inflight?: number;
}

async function replayOutbox(): Promise<void> {
  const items = (await idbGet<QueuedRequest[]>('queue')) ?? [];
  const pending = items
    .filter((item) => !(item.inflight && Date.now() - item.inflight < INFLIGHT_MS))
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const item of pending) {
    // Voice transcripts are never silently replayed days later.
    if (item.kind === 'transcribe') {
      await removeFromQueue(item.id);
      continue;
    }
    try {
      const res = await fetch(item.url, {
        method: item.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
        // 4xx won't succeed on retry — drop it rather than loop forever.
        await removeFromQueue(item.id);
      } else {
        await bumpAttempts(item);
        break;
      }
    } catch {
      await bumpAttempts(item);
      break; // still offline; try again next time
    }
  }

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'xr-drain' });
}

async function removeFromQueue(id: string): Promise<void> {
  const items = (await idbGet<QueuedRequest[]>('queue')) ?? [];
  await idbSet(
    'queue',
    items.filter((item) => item.id !== id),
  );
}

async function bumpAttempts(item: QueuedRequest): Promise<void> {
  const items = (await idbGet<QueuedRequest[]>('queue')) ?? [];
  const next = items.map((entry) =>
    entry.id === item.id ? { ...entry, attempts: entry.attempts + 1, inflight: undefined } : entry,
  );
  const capped = next.filter((entry) => entry.attempts < 8 || entry.id !== item.id);
  await idbSet('queue', capped);
}

/* --------------------------------------------------------- tiny IDB shim ------
   The service worker can't import the app's idb-keyval bundle (different
   context), so we talk to the same store with a ~40-line native wrapper.
   --------------------------------------------------------------------------- */

const DB_NAME = 'xr-mobile';
const STORE_NAME = 'cache';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => resolve(undefined);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/* ---------------------------------------------------------------- lifecycle --- */

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('xr-') && !name.startsWith('workbox-precache'))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

export {};
