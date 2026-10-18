#!/usr/bin/env node
/**
 * Phase 2.4 · P1-1 — shipping-daemon LAN harness runner.
 *
 * Starts the REAL shipping CLI (`bun run src/index.ts serve --lan --port 0`)
 * on an isolated home, waits for the TLS/bound-port signal WITHOUT echoing
 * the token, then runs the existing LAN harness (tools/test-lan-flow.mjs)
 * against that process and always tears the child down.
 *
 * Safety:
 *  - token/pairing values are REDACTED in every failure/log transcript;
 *  - child process is always killed in a finally, even on assertion failure;
 *  - rejects a plain-HTTP or loopback-only posture: that means the wiring
 *    regressed to the loopback daemon and all 25 checks would be meaningless.
 *
 * Usage: node tools/test-lan-flow-shipping.mjs
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'xr-lan-shipping-'));
const REDACT = (s) => String(s).replace(/token=[A-Za-z0-9_.\/+=-]+/g, 'token=REDACTED-TOKEN');
// Operator-set token (same posture as `XR_DAEMON_TOKEN=… xr serve --lan`): the
// LAN banner never prints token material, so the harness operator supplies it.
const TOKEN = `it-${randomBytes(12).toString('hex')}`;

const child = spawn(
  'bun',
  ['run', 'src/index.ts', 'serve', '--lan', '--port', '0'],
  {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, HOME: home, XR_HOME: join(home, 'home'), XR_DAEMON_TOKEN: TOKEN, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let transcript = '';
let resolved = null;
const lanLine = /LAN mode: XR is reachable on your WiFi network at (\S+)\./;

function settle() {
  const lan = lanLine.exec(transcript)?.[1];
  const loopbackOnly = /127\.0\.0\.1 only — not exposed to the network/.test(transcript);
  if (loopbackOnly) {
    throw new Error('REGRESSION: --lan produced a loopback-only, plain-HTTP daemon (P1-1 before-state).');
  }
  if (lan) {
    resolved = { base: `${lan.replace(/\/$/, '')}`, token: TOKEN };
    return true;
  }
  return false;
}

const deadline = Date.now() + 45_000;
function waitReady() {
  return new Promise((resolveReady, rejectReady) => {
    const iv = setInterval(() => {
      let ok = false;
      try { ok = settle(); } catch (err) { clearInterval(iv); rejectReady(err); return; }
      if (ok) { clearInterval(iv); resolveReady(); }
      else if (Date.now() > deadline) {
        clearInterval(iv);
        rejectReady(new Error(`shipping daemon did not reach LAN/TLS readiness in time.\n${REDACT(transcript.slice(-800))}`));
      }
    }, 250);
  });
}
child.stdout.on('data', (d) => { transcript += String(d); });
child.stderr.on('data', (d) => { transcript += String(d); });

let code = 1;
try {
  await waitReady();
  await new Promise((resolveProc) => {
    const harness = spawn(
      'node',
      ['tools/test-lan-flow.mjs'],
      {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, XR_BASE: resolved.base, XR_DAEMON_TOKEN: resolved.token, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    harness.stdout.on('data', (d) => process.stdout.write(REDACT(d)));
    harness.stderr.on('data', (d) => process.stderr.write(REDACT(d)));
    harness.on('exit', (c) => { code = c ?? 1; resolveProc(); });
  });
} catch (err) {
  console.error(`[shipping-runner] ${REDACT(err.message ?? err)}`);
  code = 1;
} finally {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  rmSync(home, { recursive: true, force: true });
}
console.log(code === 0 ? '\nSHIPPING LAN HARNESS: ALL CHECKS PASSED' : `\nSHIPPING LAN HARNESS FAILED (exit=${code})`);
process.exit(code);
