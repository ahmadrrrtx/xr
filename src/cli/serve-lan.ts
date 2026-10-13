/**
 * `xr serve --lan` wiring.
 *
 * This module is additive: the existing `src/cli/serve.ts` keeps ownership of
 * argument parsing and daemon startup, and calls into here for the LAN parts.
 *
 * Suggested integration in src/cli/serve.ts:
 *
 *   import { parseLanFlag, startLanServer, printLanBanner } from './serve-lan.js';
 *
 *   .option('--lan', 'Allow paired mobile devices on this WiFi network (opt-in)')
 *   .action(async (opts) => {
 *     const lan = parseLanFlag(opts);          // --lan or XR_DAEMON_LAN=1
 *     if (!lan) return startLoopback(opts);    // unchanged behaviour
 *     const tls = await startLanServer(opts, handler);
 *     printLanBanner(tls);
 *   });
 *
 * The important invariant: without the flag, nothing here runs and the daemon
 * stays on 127.0.0.1 exactly as before. There is no code path that binds
 * 0.0.0.0 by accident.
 */

import { ensureLanCert, lanAddresses, lanUrl, type LanCert } from '../daemon/lan-tls.js';
import { ensureVapidKeys, vapidPublicKey } from '../daemon/web-push.js';
import { pairingUrl } from '../daemon/mobile-pairing.js';

export interface LanStartup {
  lan: true;
  cert: LanCert;
  host: '0.0.0.0';
  port: number;
  url: string;
  vapidPublicKey: string;
}

export const DEFAULT_LAN_PORT = 3141;

/** `--lan`, or the XR_DAEMON_LAN=1 env var. Explicit opt-in only. */
export function parseLanFlag(options: { lan?: boolean | undefined } = {}): boolean {
  if (options.lan === true) return true;
  return process.env['XR_DAEMON_LAN'] === '1';
}

/**
 * Prepare LAN mode: mint/reuse the TLS cert and the VAPID keys.
 * Returns everything the daemon needs to bind, or throws — in which case the
 * caller must fall back to loopback and never leave a half-open listener.
 */
export async function prepareLan(port = DEFAULT_LAN_PORT): Promise<LanStartup> {
  const cert = await ensureLanCert(port);
  await ensureVapidKeys();
  return {
    lan: true,
    cert,
    host: '0.0.0.0',
    port,
    url: lanUrl(port),
    vapidPublicKey: await vapidPublicKey(),
  };
}

/**
 * Bun.serve TLS options. Pass straight through:
 *   Bun.serve({ ...base, ...bunTlsOptions(startup) })
 */
export function bunTlsOptions(startup: LanStartup): {
  hostname: string;
  port: number;
  tls: { key: string; cert: string };
} {
  return {
    hostname: startup.host,
    port: startup.port,
    tls: { key: startup.cert.key, cert: startup.cert.cert },
  };
}

const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** The loud, honest banner. Deliberately impossible to miss. */
export function printLanBanner(startup: LanStartup): void {
  const lines = [
    '',
    `${CYAN}⚠️  LAN mode: XR is reachable on your WiFi network at ${startup.url}.${RESET}`,
    `${CYAN}    Only devices on the same network AND with the pairing code can connect.${RESET}`,
    `${CYAN}    Run without --lan to disable.${RESET}`,
    '',
    `   Certificate fingerprint`,
    `   ${BOLD}${startup.cert.fingerprintPretty}${RESET}`,
    `   ${DIM}(compare this on your phone before you tap Pair)${RESET}`,
    '',
    `   LAN addresses   ${lanAddresses().join(', ')}`,
    `   Mobile app      ${startup.url}/mobile/`,
    `   ${DIM}Pair a phone: Settings → Mobile → Pair new device${RESET}`,
    `   ${DIM}Push requires this computer to stay awake.${RESET}`,
    '',
  ];
  console.log(lines.join('\n'));
}

/**
 * Print the manual pairing URL. The scannable QR lives in the desktop Settings
 * card (280px) — terminals render QR codes inconsistently, and a moused-over
 * URL is more useful than a mangled one.
 */
export function printPairingUrl(code: string, fingerprint: string, port: number): void {
  const url = pairingUrl(lanUrl(port), code, fingerprint);
  console.log(`\n   Pair manually: ${url}`);
  console.log(`   ${DIM}Or open Settings → Mobile in XR desktop to scan.${RESET}\n`);
}
