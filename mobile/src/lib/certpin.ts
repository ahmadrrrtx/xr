import { get, set, del, createStore } from 'idb-keyval';

/**
 * An application-reported fingerprint change detector, NOT TLS pinning.
 * Browser JavaScript cannot inspect the actual peer certificate. An attacker
 * who controls the endpoint can return a previously seen fingerprint and serve
 * altered JavaScript; this check cannot authenticate the connection. Browser/
 * OS certificate validation or independent certificate verification is needed.
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
 * Compare a server-reported fingerprint with the stored application value.
 * - 'first-use' — nothing pinned yet; the UI must ask the user to compare.
 * - 'ok'        — matches the pin; proceed.
 * - 'mismatch'  — different reported value for a known host: warn.
 */
export async function checkPin(host: string, fingerprint: string): Promise<PinCheck> {
  const pin = await readPin();
  if (!pin) return 'first-use';
  if (pin.host !== host) return 'first-use';
  return pin.fingerprint === normalise(fingerprint) ? 'ok' : 'mismatch';
}

/** Fetch the server's self-reported fingerprint. It is not proof of the TLS
 * peer certificate and cannot substitute for independent TLS authentication. */
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
