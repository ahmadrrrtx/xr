import { get, set, del, createStore } from 'idb-keyval';

/**
 * Web Push plumbing.
 *
 * Threat model: the payload is relayed by Google (FCM) or Apple (APNS), so it
 * is encrypted TWICE:
 *   1. by the browser's own Web Push encryption (RFC 8291) — protects it in
 *      transit to the device;
 *   2. by an AES-GCM key generated on this device and handed to the daemon over
 *      the paired HTTPS channel — so the push vendor sees only ciphertext.
 *
 * The daemon is the only thing that ever holds key #2 alongside the payload,
 * and it never talks to a third party beyond the push endpoint itself.
 *
 * Honest limitation: the daemon must be running for a push to be *sent*. No
 * XR-run relay exists in v1.
 */

const store = createStore('xr-mobile', 'cache');
const KEY_IDB = 'pushKey';
const SUB_IDB = 'pushSub';

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function pushPermission(): PushPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/* ------------------------------------------------- pairing symmetric payload key --- */

/** Generate the device-side AES-GCM key used for the second encryption layer. */
export async function generatePushKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', key);
  return toBase64(new Uint8Array(raw));
}

export async function readPushKey(): Promise<string | null> {
  return (await get<string>(KEY_IDB, store)) ?? null;
}

export async function ensurePushKey(): Promise<string> {
  const existing = await readPushKey();
  if (existing) return existing;
  const created = await generatePushKey();
  await set(KEY_IDB, created, store);
  return created;
}

export async function clearPushKey(): Promise<void> {
  await del(KEY_IDB, store);
}

/* ------------------------------------------------------------------ subscribe --- */

export async function readSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration('/mobile/');
  if (!reg) return null;
  return (await reg.pushManager.getSubscription()) ?? null;
}

export async function subscribePush(vapidPublicKeyB64Url: string): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKeyB64Url),
  });
}

export async function unsubscribePush(): Promise<boolean> {
  const sub = await readSubscription();
  if (!sub) return false;
  return sub.unsubscribe();
}

export async function cacheSubscription(sub: PushSubscription | null): Promise<void> {
  if (sub) await set(SUB_IDB, sub.toJSON(), store);
  else await del(SUB_IDB, store);
}

export interface WireSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function currentWireSubscription(): Promise<WireSubscription | null> {
  const sub = await readSubscription();
  if (!sub) return null;
  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/* ---------------------------------------------------------------------- utils --- */

export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/* --------------------------------------------------- second layer: AES-GCM --- */

/**
 * Decrypt the inner payload. Used by the service worker (it can read the same
 * IndexedDB the page wrote to).
 */
export async function decryptPushPayload(payload: {
  iv: string;
  ciphertext: string;
}): Promise<Record<string, unknown> | null> {
  const keyB64 = await readPushKey();
  if (!keyB64) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64(keyB64),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
