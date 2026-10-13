/**
 * Cross-validation for the Web Push implementation.
 *
 * We cannot reach FCM/APNS from a sandbox, so instead we validate both
 * directions against the reference `web-push` package:
 *
 *   A. web-push encrypts  -> our RFC 8188/8291 decryptor recovers the plaintext
 *   B. our encryptOuter   -> our decryptor recovers the plaintext
 *   C. full double layer  -> inner AES-GCM recovered after outer decrypt
 *
 * (A) is the important one: it proves our understanding of the wire format
 * matches an implementation that real browsers accept.
 *
 *   node tools/test-web-push.mjs
 */
import webpush from 'web-push';
import { encryptOuter, encryptInner, hmacSha256 } from '/tmp/xr-build/web-push.mjs';

const { webcrypto } = await import('node:crypto');
const subtle = webcrypto.subtle;

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/* ---- fake "browser" subscription ------------------------------------------- */
const uaPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
const uaPublicRaw = new Uint8Array(await subtle.exportKey('raw', uaPair.publicKey));
const uaPublicB64 = b64url(uaPublicRaw);
const uaPrivateJwk = await subtle.exportKey('jwk', uaPair.privateKey);
const auth = new Uint8Array(webcrypto.getRandomValues(new Uint8Array(16)));
const authB64 = b64url(auth);

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/fake',
  keys: { p256dh: uaPublicB64, auth: authB64 },
};

/* ---- independent RFC 8188/8291 decryptor (mirrors what browsers do) -------- */
async function decryptOuter(body) {
  const salt = body.slice(0, 16);
  const rs = (body[16] << 24) | (body[17] << 16) | (body[18] << 8) | body[19];
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const uaPrivate = await subtle.importKey('jwk', uaPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));

  const prk = await hmacSha256(auth, shared);
  const prkInfo = concat(enc('WebPush: info'), new Uint8Array([0]), uaPublicRaw, asPublic, new Uint8Array([1]));
  const ikm = (await hmacSha256(prk, prkInfo)).slice(0, 32);

  const prk2 = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk2, concat(enc('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk2, concat(enc('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12);

  const aesKey = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const record = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext));

  // Strip padding: last non-zero octet is the delimiter and must be 0x02.
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end -= 1;
  const delimiter = record[end - 1];
  if (delimiter !== 2) throw new Error(`bad padding delimiter: ${delimiter}`);
  return { plaintext: record.slice(0, end - 1), rs };
}

async function decryptInner(plaintext, pushKeyB64) {
  const { iv, ciphertext } = JSON.parse(dec(plaintext));
  const key = await subtle.importKey('raw', fromB64url(pushKeyB64), { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ciphertext));
  return JSON.parse(dec(new Uint8Array(plain)));
}

/* ------------------------------------------------------------------ tests --- */
let failures = 0;
const check = (name, condition, extra = '') => {
  console.log(`${condition ? '✓' : '✗'} ${name}${condition ? '' : ` — ${extra}`}`);
  if (!condition) failures += 1;
};

// A. reference implementation -> our decryptor
{
  const payload = 'Approve "npm test"?';
  const out = webpush.encrypt(subscription.keys.p256dh, subscription.keys.auth, Buffer.from(payload), 'aes128gcm');
  const { plaintext, rs } = await decryptOuter(new Uint8Array(out.cipherText));
  check('A. web-push ciphertext decrypts with our RFC 8188/8291 reader', dec(plaintext) === payload, `got "${dec(plaintext)}"`);
  check('A. record size is sane', rs >= 18 && rs <= 4096, `rs=${rs}`);
}

// B. our encryptor -> our decryptor
{
  const payload = enc('Run migrations on prod?');
  const { body } = await encryptOuter(subscription.keys.p256dh, subscription.keys.auth, payload);
  const { plaintext } = await decryptOuter(body);
  check('B. our encryptOuter round-trips', dec(plaintext) === dec(payload), `got "${dec(plaintext)}"`);
}

// C. full double layer, as the daemon actually sends it
{
  const pushKey = b64url(new Uint8Array(webcrypto.getRandomValues(new Uint8Array(32))));
  const approval = {
    title: 'XR approval needed',
    body: 'Run npm test in xr-api',
    approvalId: 'apr_8f3a',
    ts: Date.now(),
  };
  const inner = await encryptInner(approval, pushKey);
  const { body } = await encryptOuter(subscription.keys.p256dh, subscription.keys.auth, inner);
  const outer = await decryptOuter(body);
  const recovered = await decryptInner(outer.plaintext, pushKey);
  check('C. inner payload survives both layers', JSON.stringify(recovered) === JSON.stringify(approval), JSON.stringify(recovered));
  check('C. ciphertext reveals no approval text', !dec(body).includes('npm test') && !dec(body).includes('apr_8f3a'));
}

// D. tamper detection
{
  const { body } = await encryptOuter(subscription.keys.p256dh, subscription.keys.auth, enc('secret'));
  const tampered = body.slice();
  tampered[tampered.length - 1] ^= 0xff;
  let threw = false;
  try { await decryptOuter(tampered); } catch { threw = true; }
  check('D. tampered ciphertext fails authentication', threw);
}

console.log(failures === 0 ? '\nAll push encryption checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
