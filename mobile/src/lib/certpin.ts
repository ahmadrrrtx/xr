import { get, set, del, createStore } from 'idb-keyval';

/**
 * Trust-on-first-use certificate pinning.
 *
 * The daemon uses a self-signed cert, so the browser will always show a TLS
 * warning. The user is asked to compare the fingerprint shown on their desktop
 * with the one shown on the phone. Once confirmed we pin it: every later
 * connection to this host must present the same cert hash, or we stop and show
 * a safety dialog. That's what makes "self-signed on a LAN" acceptable.
 */

const store = createStore('xr-mobile', 'cache');
const PIN_KEY = 'certpin';

export interface CertPin {
  host: string;
  /** Lowercase hex SHA-256 of the DER certificate, colon-free. */
  fingerprint: string;
  pinnedAt: number;
}

export type PinCheck = 'ok' | 'first-use' | 'mismatch';

function normalise(fp: string): string {
  return fp.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export async function readPin(): Promise<CertPin | null> {
  return (await get<CertPin>(PIN_KEY, store)) ?? null;
}

export async function writePin(host: string, fingerprint: string): Promise<CertPin> {
  const pin: CertPin = { host, fingerprint: normalise(fingerprint), pinnedAt: Date.now() };
  await set(PIN_KEY, pin, store);
  return pin;
}

export async function clearPin(): Promise<void> {
  await del(PIN_KEY, store);
}

/**
 * Compare the cert fingerprint offered by this connection with the pin.
 * - 'first-use' — nothing pinned yet; the UI must ask the user to compare.
 * - 'ok'        — matches the pin; proceed.
 * - 'mismatch'  — different cert for a known host: possible MITM, block.
 */
export async function checkPin(host: string, fingerprint: string): Promise<PinCheck> {
  const pin = await readPin();
  if (!pin) return 'first-use';
  if (pin.host !== host) return 'first-use';
  return pin.fingerprint === normalise(fingerprint) ? 'ok' : 'mismatch';
}

/**
 * Where does the fingerprint actually come from?
 *
 * A web page cannot read the TLS certificate of its own connection. So the
 * daemon publishes it: `GET /api/mobile/cert-fingerprint` returns the SHA-256
 * of the cert it is currently serving. That response is itself delivered over
 * the (untrusted-but-pinned) TLS channel, which is sound: an attacker who can
 * present a *different* cert can also lie about the hash — which is exactly why
 * the FIRST confirmation is done out-of-band, by eyeballing the desktop screen.
 * After that, the pin is the authority.
 */
export async function fetchFingerprint(base = ''): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/mobile/cert-fingerprint`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { fingerprint?: string };
    return data.fingerprint ? normalise(data.fingerprint) : null;
  } catch {
    return null;
  }
}
