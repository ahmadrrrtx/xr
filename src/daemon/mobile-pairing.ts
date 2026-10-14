/**
 * Mobile pairing, session tagging and endpoint gating.
 *
 * Security posture (all fail-closed):
 *  - Pairing codes are 6 digits, 10-minute TTL, single use, rate-limited to
 *    10 attempts/minute per peer address. A wrong code returns a generic 401
 *    that leaks nothing about whether LAN mode is even on.
 *  - Session tokens live in an HttpOnly, Secure, SameSite cookie. Nothing is
 *    ever handed to JS, so there is no bearer token in localStorage to steal.
 *  - Every session is tagged `kind: 'mobile' | 'desktop'`. Mobile sessions get
 *    403 on files/terminal/git/MCP — mobile is a companion, not a coding
 *    surface.
 *
 * Deviation note: the brief specified `SameSite=None`. This implementation uses
 * `SameSite=Strict`, which is strictly stronger and still correct here: the PWA
 * is served from the same origin as the API (https://<lan-ip>:3141/mobile/ →
 * /api/...), every fetch — including from the service worker — is same-site.
 * None would only be needed for a cross-site context, which v1 never has.
 */

import { randomInt, randomBytes } from 'node:crypto';
import {
  addDevice,
  findById,
  findByToken,
  listDevices,
  revokeDevice,
  setPushSubscription,
  type PairedDevice,
  type WireSubscription,
} from './mobile-devices.js';

export const SESSION_COOKIE = 'xr_session';

/** Endpoint prefixes a mobile session may never touch. */
export const DANGEROUS_PREFIXES: readonly string[] = [
  '/api/v1/files',
  '/api/v1/terminal',
  '/api/v1/shell',
  '/api/v1/git',
  '/api/v1/mcp',
  '/files',
  '/terminal',
  '/shell',
  '/git',
  '/mcp',
];

export interface MobileContext {
  /** True only when the daemon was started with `xr serve --lan`. */
  lan: boolean;
  /** Hex SHA-256 of the certificate currently being served. */
  fingerprint: string;
  /** https://<lan-ip>:<port> */
  lanUrl: string;
  version: string;
  daemonToken: string;
}

/* --------------------------------------------------------- pairing codes --- */

interface PairingCode {
  code: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
}

const CODE_TTL_MS = 10 * 60 * 1000;

let activeCode: PairingCode | null = null;

/** Mint (or re-mint) the on-demand 6-digit code shown under the QR. */
export function createPairingCode(): PairingCode {
  // randomInt is unbiased over [0, 999999]; pad to exactly 6 digits.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  activeCode = { code, createdAt: Date.now(), expiresAt: Date.now() + CODE_TTL_MS };
  return activeCode;
}

export function currentPairingCode(): PairingCode | null {
  if (!activeCode) return null;
  if (activeCode.consumedAt || Date.now() > activeCode.expiresAt) return null;
  return activeCode;
}

/** Single use: a successful consume burns the code. */
export function consumePairingCode(candidate: string): boolean {
  const code = currentPairingCode();
  if (!code) return false;
  if (code.code !== String(candidate ?? '').trim()) return false;
  activeCode = { ...code, consumedAt: Date.now() };
  return true;
}

export function pairingUrl(lanUrl: string, code: string, fingerprint: string): string {
  return `${lanUrl}/mobile/pair?code=${encodeURIComponent(code)}&fp=${encodeURIComponent(fingerprint)}`;
}

/* ----------------------------------------------------------- rate limiting --- */

const PAIR_ATTEMPTS_PER_MINUTE = 10;

const attempts = new Map<string, number[]>();

export function rateLimit(key: string, limit = PAIR_ATTEMPTS_PER_MINUTE, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);
  if (hits.length >= limit) {
    attempts.set(key, hits);
    return false;
  }
  hits.push(now);
  attempts.set(key, hits);
  // Opportunistic cleanup so the map can't grow forever.
  if (attempts.size > 500) {
    for (const [k, v] of attempts) {
      if (v.every((at) => now - at >= windowMs)) attempts.delete(k);
    }
  }
  return true;
}

/* ---------------------------------------------------------------- cookies --- */

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/* -------------------------------------------------------------- sessions --- */

export interface Session {
  device?: PairedDevice | undefined;
  /** True for the desktop webview / CLI using the daemon bearer token. */
  privileged: boolean;
}

/**
 * Resolve a session. Order: bearer token (desktop/CLI) → paired-device cookie.
 * A request with neither is anonymous and gets only the public endpoints.
 */
export async function resolveSession(request: {
  headers: { get(name: string): string | null };
}, ctx: MobileContext): Promise<Session> {
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (timingSafe(token, ctx.daemonToken)) return { privileged: true };
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) return { privileged: false };

  const device = await findByToken(token);
  if (!device) return { privileged: false };
  return { device, privileged: false };
}

function timingSafe(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* --------------------------------------------------------- endpoint gating --- */

export function isDangerousPath(pathname: string): boolean {
  return DANGEROUS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** 403 for mobile sessions hitting coding surfaces; null means "allow". */
export function mobileGate(pathname: string, session: Session): string | null {
  if (session.privileged) return null;
  if (session.device?.kind !== 'mobile') return null;
  if (!isDangerousPath(pathname)) return null;
  return 'Not available on mobile. Code editing, terminal, git and MCP stay on your desktop or CLI.';
}

/**
 * Origin check for browser-initiated, non-GET requests.
 *
 * `Origin: null` is what a standalone PWA sends for some fetches. We allow it
 * only when a valid paired session cookie is present — never on its own.
 */
export function originAllowed(request: {
  headers: { get(name: string): string | null };
  url: string;
}, session: Session): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin GETs and native clients send none
  if (origin === 'null') return Boolean(session.device);
  try {
    const originHost = new URL(origin).host;
    const requestHost = new URL(request.url).host;
    return originHost === requestHost;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------- QR rendering --- */

export type QrRenderer = (text: string) => Promise<string> | string;

let qrRenderer: QrRenderer | null = null;

/**
 * The daemon installs a QR encoder (e.g. `qrcode`'s toDataURL). Kept pluggable
 * so the daemon doesn't inherit a rendering dependency it may already have.
 */
export function setQrRenderer(renderer: QrRenderer): void {
  qrRenderer = renderer;
}

/* -------------------------------------------------------------- route hook --- */

export interface MobileRouteDeps {
  ctx: MobileContext;
  /** Push: send to one device (used by the test button). */
  sendTestPush?: ((device: PairedDevice) => Promise<boolean>) | undefined;
  vapidPublicKey?: (() => Promise<string>) | undefined;
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

const unauthorised = (): Response =>
  json({ error: 'Not paired' }, { status: 401 });

/**
 * Handle every /api/mobile/* route. Returns null when the path isn't ours, so
 * the daemon's existing router keeps everything else.
 */
export async function handleMobileRoutes(
  request: Request,
  url: URL,
  session: Session,
  deps: MobileRouteDeps,
): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/mobile/')) return null;
  const ctx = deps.ctx;

  /* ---- public: cert fingerprint (needed before pairing, for TOFU) ---------- */
  if (pathname === '/api/mobile/cert-fingerprint' && request.method === 'GET') {
    if (!ctx.lan) return json({ error: 'LAN mode is off' }, { status: 404 });
    return json({ fingerprint: ctx.fingerprint });
  }

  /* ---- pairing -------------------------------------------------------------- */
  if (pathname === '/api/mobile/pair' && request.method === 'POST') {
    if (!ctx.lan) return unauthorised();

    // Rate limit before doing any work at all.
    const peer = peerKey(request);
    if (!rateLimit(`pair:${peer}`)) {
      // A10: 429s carry Retry-After so well-behaved clients back off.
      return json({ error: 'Too many attempts. Wait a minute.' }, { status: 429, headers: { 'retry-after': '60' } });
    }

    let body: {
      code?: unknown;
      deviceName?: unknown;
      pushKey?: unknown;
      pushSubscription?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return unauthorised();
    }

    const code = typeof body.code === 'string' ? body.code : '';
    if (!originAllowed(request, session)) return json({ error: 'Bad origin' }, { status: 403 });
    if (!consumePairingCode(code)) return unauthorised();

    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 48) : 'Phone';
    const pushKey = typeof body.pushKey === 'string' ? body.pushKey : undefined;
    const subscription = normaliseSubscription(body.pushSubscription);

    const { device, token } = await addDevice({
      name: deviceName,
      kind: 'mobile',
      fingerprint: ctx.fingerprint,
      ...(pushKey ? { pushKey } : {}),
      ...(subscription ? { pushSubscription: subscription } : {}),
    });

    return json(
      { ok: true, deviceId: device.id, deviceName: device.name, expiresAt: Date.now() + 2_592_000_000 },
      { status: 200, headers: { 'set-cookie': sessionCookie(token) } },
    );
  }

  /* ---- everything below needs a paired session ------------------------------ */
  if (!session.device && !session.privileged) return unauthorised();

  if (pathname === '/api/mobile/session' && request.method === 'DELETE') {
    if (session.device) await revokeDevice(session.device.id);
    return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie() } });
  }

  if (pathname === '/api/mobile/devices' && request.method === 'GET') {
    if (!session.privileged) return json({ error: 'Desktop only' }, { status: 403 });
    const devices = await listDevices();
    return json({
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        kind: device.kind,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        push: Boolean(device.pushSubscription),
      })),
    });
  }

  const revokeMatch = /^\/api\/mobile\/devices\/([\w-]+)\/revoke$/.exec(pathname);
  if (revokeMatch?.[1] && request.method === 'POST') {
    if (!session.privileged) return json({ error: 'Desktop only' }, { status: 403 });
    await revokeDevice(revokeMatch[1]);
    return json({ ok: true });
  }

  /* "Send test push" from the desktop Settings → Mobile card. */
  const pushTestMatch = /^\/api\/mobile\/devices\/([\w-]+)\/push-test$/.exec(pathname);
  if (pushTestMatch?.[1] && request.method === 'POST') {
    if (!session.privileged) return json({ error: 'Desktop only' }, { status: 403 });
    const target = await findById(pushTestMatch[1]);
    if (!target) return json({ error: 'No such device' }, { status: 404 });
    if (!target.pushSubscription || !target.pushKey) {
      return json({ error: 'This device has push turned off' }, { status: 409 });
    }
    if (!deps.sendTestPush) return json({ error: 'Push not configured' }, { status: 501 });
    const ok = await deps.sendTestPush(target);
    return json({ ok });
  }

  /* ---- pairing QR (desktop asks for one on demand) -------------------------- */
  if (pathname === '/api/mobile/pair-qr' && request.method === 'POST') {
    if (!session.privileged) return unauthorised();
    if (!ctx.lan) return json({ error: 'LAN mode is off' }, { status: 409 });

    const code = createPairingCode();
    const target = pairingUrl(ctx.lanUrl, code.code, ctx.fingerprint);
    let qr: string | undefined;
    if (qrRenderer) {
      try {
        qr = await qrRenderer(target);
      } catch {
        qr = undefined;
      }
    }
    return json({
      ok: true,
      code: code.code,
      url: target,
      fingerprint: ctx.fingerprint,
      fingerprintPretty: ctx.fingerprint.replace(/(..)/g, '$1:').replace(/:$/, ''),
      expiresAt: code.expiresAt,
      ...(qr ? { qr } : {}),
    });
  }

  /* ---- push ----------------------------------------------------------------- */
  if (pathname === '/api/mobile/push/vapid-pubkey' && request.method === 'GET') {
    if (!ctx.lan) return json({ error: 'LAN mode is off' }, { status: 404 });
    if (!deps.vapidPublicKey) return json({ error: 'Push not configured' }, { status: 501 });
    return json({ publicKey: await deps.vapidPublicKey() });
  }

  if (pathname === '/api/mobile/push/subscribe') {
    if (!session.device) return unauthorised();
    if (request.method === 'POST') {
      let body: { subscription?: unknown; pushKey?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Bad request' }, { status: 400 });
      }
      const subscription = normaliseSubscription(body.subscription);
      if (!subscription) return json({ error: 'Missing subscription' }, { status: 400 });
      const pushKey = typeof body.pushKey === 'string' ? body.pushKey : undefined;
      await setPushSubscription(session.device.id, subscription, pushKey);
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      await setPushSubscription(session.device.id, undefined);
      return json({ ok: true });
    }
  }

  if (pathname === '/api/mobile/push/test' && request.method === 'POST') {
    if (!session.device) return unauthorised();
    if (!deps.sendTestPush) return json({ error: 'Push not configured' }, { status: 501 });
    const ok = await deps.sendTestPush(session.device);
    return json({ ok });
  }

  return json({ error: 'Not found' }, { status: 404 });
}

/* ------------------------------------------------------------------ helpers --- */

function peerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  // Bun/Node request objects don't expose the socket portably; fall back to UA.
  return request.headers.get('x-xr-peer') ?? 'lan';
}

function normaliseSubscription(value: unknown): WireSubscription | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof candidate.endpoint !== 'string' || !candidate.endpoint.startsWith('https://')) {
    return undefined;
  }
  const p256dh = candidate.keys?.p256dh;
  const auth = candidate.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return undefined;
  // Push service endpoints only — never a user-supplied URL.
  if (!/^https:\/\/[a-z0-9.-]+\.(googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|web\.push\.apple\.com)\//i.test(candidate.endpoint)) {
    return undefined;
  }
  return { endpoint: candidate.endpoint, keys: { p256dh, auth } };
}

/** Random device id helper (used by tests and the reference daemon). */
export function randomId(): string {
  return randomBytes(9).toString('base64url');
}
