/**
 * `xr serve --lan` wiring (Phase 2.4 · P1-1). CLI-owned LAN preparation:
 * the shipping serve() stays the ONE daemon; this module only assembles the
 * cert material and prints the loud banner. Invariant: without the flag
 * nothing here runs; no code path binds 0.0.0.0 by accident.
 */
import { ensureLanCert, lanAddresses, lanUrl, type LanCert } from '../daemon/lan-tls.js';
import { setQrRenderer } from '../daemon/mobile-pairing.js';
import { ensureVapidKeys } from '../daemon/web-push.js';

/** What the CLI hands to serve() + the banner: cert material and display facts
 * only — token material never flows through this module. */
export interface LanStartup {
  lan: true;
  cert: LanCert;
  host: '0.0.0.0';
  port: number;
  url: string;
}

/** Default daemon port; wallet/menu apps pass their own. */
export const DEFAULT_LAN_PORT = 3141;

/**
 * Mint/reuse the TLS cert and the VAPID keys, and install the QR renderer
 * (the optional `qrcode` dependency — pairing still works without an image;
 * the 6-digit code and URL carry every secret needed).
 * Throws on any failure; the caller exits non-zero rather than leave a
 * half-open listener or an insecure fallback dressed as LAN.
 */
export async function prepareLan(port = DEFAULT_LAN_PORT): Promise<LanStartup> {
  const cert = await ensureLanCert(port);
  await ensureVapidKeys();
  try {
    const qr = await import('qrcode');
    setQrRenderer((text) => qr.default.toDataURL(text));
  } catch {
    /* qrcode is optional: the code + URL below carry every secret needed */
  }
  return { lan: true, cert, host: '0.0.0.0', port, url: lanUrl(port) };
}

const C = '\x1b[36m', B = '\x1b[1m', D = '\x1b[2m', R = '\x1b[0m';

/** The loud, honest banner. Deliberately impossible to miss. */
export function printLanBanner(startup: LanStartup): void {
  const lines = [
    '',
    `${C}⚠️  LAN mode: XR is reachable on your WiFi network at ${startup.url}.${R}`,
    `${C}    Only devices on the same network AND with the pairing code can connect.${R}`,
    `${C}    Run without --lan to disable.${R}`,
    '',
    `   Certificate fingerprint`,
    `   ${B}${startup.cert.fingerprintPretty}${R}`,
    `   ${D}(compare this on your phone before you tap Pair)${R}`,
    '',
    `   LAN addresses   ${lanAddresses().join(', ')}`,
    `   Mobile pairing  ${startup.url}`,
    `   ${D}Pair a phone: Settings → Mobile → Pair new device${R}`,
    `   ${D}Push requires this computer to stay awake.${R}`,
    '',
  ];
  console.log(lines.join('\n'));
}
