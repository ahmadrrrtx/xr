/**
 * Web Push, from the daemon directly to the browser's push service.
 *
 * There is no XR-run relay in v1: the daemon POSTs straight to
 * fcm.googleapis.com / push.apple.com / updates.push.services.mozilla.com —
 * the same way it already makes outbound HTTPS calls to model providers. If the
 * desktop is asleep, no push is sent, and the app says so honestly.
 *
 * Two layers of encryption:
 *   1. RFC 8291 + RFC 8188 (aes128gcm) — the browser decrypts this with its own
 *      private key. This is standard Web Push.
 *   2. AES-GCM with a key this device generated at pairing time. Google and
 *      Apple therefore relay bytes they cannot read: the approval title and
 *      body stay opaque to them.
 *
 * Zero dependencies: WebCrypto only. Works under Bun and Node 18+.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PairedDevice } from './mobile-devices.js';

/**
 * Bun/Node compile against `lib: ["ESNext"]` — no DOM lib — so DOM names
 * (`JsonWebKey`, `BufferSource`, `BodyInit`) are not in scope. `Bytes` is the
 * shape TS ≥ 5.7 asks of `crypto.subtle` inputs: a plain `Uint8Array` widens to
 * `ArrayBufferLike` (Buffer views, SharedArrayBuffer) and does not qualify.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * The subset of JWK we persist for the VAPID key and re-import on restart.
 * Fields are optional to mirror the runtime's JsonWebKey shape (P-256 keys
 * always carry all five; the parser validates presence before use).
 */
interface VapidPrivateJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
}

const VAPID_PATH = join(homedir(), '.xr', 'vapid.json');

/** 10 minutes: an approval you resolved on your desk shouldn't buzz your phone. */
export const DEFAULT_TTL_SECONDS = 600;

interface VapidKeys {
  /** base64url, uncompressed P-256 point — the applicationServerKey. */
  publicKey: string;
  /** JWK private key. */
  privateJwk: VapidPrivateJwk;
}

let vapidCache: VapidKeys | null = null;

/* ------------------------------------------------------------------ storage --- */

export async function ensureVapidKeys(): Promise<VapidKeys> {
  if (vapidCache) return vapidCache;
  try {
    const raw = await readFile(VAPID_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { publicKey?: string; privateJwk?: VapidPrivateJwk };
    if (parsed.publicKey && parsed.privateJwk) {
      vapidCache = { publicKey: parsed.publicKey, privateJwk: parsed.privateJwk };
      return vapidCache;
    }
  } catch {
    /* first run */
  }
  return generateVapidKeys();
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const keys: VapidKeys = { publicKey: toBase64Url(raw), privateJwk };

  await mkdir(join(homedir(), '.xr'), { recursive: true, mode: 0o700 });
  await writeFile(VAPID_PATH, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  vapidCache = keys;
  return keys;
}

export async function vapidPublicKey(): Promise<string> {
  return (await ensureVapidKeys()).publicKey;
}

/* --------------------------------------------------------------------- JWT --- */

async function vapidAuthorization(endpoint: string, keys: VapidKeys): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'mailto:xr@localhost',
  };

  const unsigned = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    keys.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned)),
  );

  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

function b64urlJson(value: unknown): string {
  return toBase64Url(utf8(JSON.stringify(value)));
}

/* --------------------------------------------------------- double encryption --- */

export interface PushPayload {
  title: string;
  body: string;
  approvalId?: string;
  ts: number;
}

/**
 * Inner layer: AES-GCM with the device's pairing key.
 * Output is `{ iv, ciphertext }` (base64), which is what the service worker
 * decrypts before showing the notification.
 */
export async function encryptInner(payload: PushPayload, pushKeyB64: string): Promise<Bytes> {
  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64(pushKeyB64),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = new Uint8Array(randomBytes(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      utf8(JSON.stringify(payload)),
    ),
  );
  return utf8(
    JSON.stringify({ iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') }),
  );
}

/* ------------------------------------------------------ RFC 8291 / 8188 layer --- */

const RECORD_SIZE = 4096;

export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as Bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data as Bytes));
}

export async function encryptOuter(
  uaPublicB64Url: string,
  authB64Url: string,
  plaintext: Uint8Array,
): Promise<{ body: Bytes; asPublic: Bytes }> {
  // 1. ECDH between a fresh ephemeral key and the browser's p256dh key.
  const asPair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));
  const uaPublic = fromBase64Url(uaPublicB64Url);
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic as Bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256),
  );

  // 2. RFC 8291 §3.3: IKM = HMAC(HMAC(auth, shared), prk_info || 0x01)
  const auth = fromBase64Url(authB64Url);
  const prk = await hmacSha256(auth, shared);
  const prkInfo = concat(
    utf8('WebPush: info'),
    new Uint8Array([0]),
    uaPublic,
    asPublic,
    new Uint8Array([1]),
  );
  const ikm = (await hmacSha256(prk, prkInfo)).slice(0, 32);

  // 3. RFC 8188 §2.2/2.3 with a fresh salt.
  const salt = new Uint8Array(randomBytes(16));
  const prk2 = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk2, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonceBase = (
    await hmacSha256(prk2, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0, 1])))
  ).slice(0, 12);
  // Single record ⇒ SEQ = 0, so the nonce is just the derived value.
  const nonce = nonceBase;

  const aesKey = await crypto.subtle.importKey('raw', cek as Bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);

  // 4. Padding: single (last) record ⇒ delimiter 0x02, then nothing.
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as Bytes }, aesKey, record as Bytes),
  );

  // 5. Header: salt || rs || idlen || keyid
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  header[16] = (RECORD_SIZE >>> 24) & 0xff;
  header[17] = (RECORD_SIZE >>> 16) & 0xff;
  header[18] = (RECORD_SIZE >>> 8) & 0xff;
  header[19] = RECORD_SIZE & 0xff;
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  return { body: concat(header, ciphertext), asPublic };
}

/* -------------------------------------------------------------------- send --- */

export interface PushResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Send one push to one paired device. Never throws. */
export async function sendPush(
  device: PairedDevice,
  payload: PushPayload,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<PushResult> {
  const subscription = device.pushSubscription;
  if (!subscription) return { ok: false, error: 'No push subscription' };
  if (!device.pushKey) return { ok: false, error: 'No pairing key — push is not encrypted' };

  try {
    const keys = await ensureVapidKeys();
    const inner = await encryptInner(payload, device.pushKey);
    const { body } = await encryptOuter(subscription.keys.p256dh, subscription.keys.auth, inner);

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(Math.max(0, Math.floor(ttlSeconds))),
        Urgency: 'high',
      },
      body,
    });

    if (response.status === 201 || response.status === 200) return { ok: true, status: response.status };

    // 404/410 = the subscription is dead; the caller should drop it.
    return { ok: false, status: response.status, error: await response.text().catch(() => '') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Push failed' };
  }
}

/** Fan out to every push-capable mobile device. */
export async function sendPushToAll(
  devices: PairedDevice[],
  payload: PushPayload,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<Array<{ deviceId: string; result: PushResult }>> {
  const out: Array<{ deviceId: string; result: PushResult }> = [];
  for (const device of devices) {
    out.push({ deviceId: device.id, result: await sendPush(device, payload, ttlSeconds) });
  }
  return out;
}

/* ------------------------------------------------------------------ helpers --- */

function utf8(value: string): Bytes {
  return new TextEncoder().encode(value);
}

function concat(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(value: string): Bytes {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function fromBase64Url(value: string): Bytes {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
}
