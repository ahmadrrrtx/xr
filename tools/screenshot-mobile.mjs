#!/usr/bin/env node
/**
 * V1-P5-001 evidence — screenshots of the SHIPPED PWA against the reference
 * daemon: the pre-auth pairing screen (what an unpaired phone sees first) and
 * the paired app (chats, a conversation, approvals, settings).
 *
 * Prereqs (same as test-offline): a running `node tools/reference-daemon.mjs
 * --lan` and XR_DAEMON_TOKEN in the env; `npm --prefix tools install` once.
 *
 * Output: docs/release/evidence/v1-2026-10-28/mobile-pwa-*.png (override with
 * OUT_DIR). Exits non-zero when a capture fails — evidence is never partial.
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

/* The reference daemon serves a self-signed LAN cert (TOFU by design). */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE = process.env.XR_DAEMON_URL ?? 'https://127.0.0.1:3141';
const TOKEN = process.env.XR_DAEMON_TOKEN ?? '';
const OUT = process.env.OUT_DIR ?? 'docs/release/evidence/v1-2026-10-28';
mkdirSync(OUT, { recursive: true });

if (!TOKEN) {
  console.error('XR_DAEMON_TOKEN is required (start tools/reference-daemon.mjs and export its token).');
  process.exit(1);
}

/* Pair a device the same way the offline test does, then ride its cookie. */
const qr = await fetch(`${BASE}/api/mobile/pair-qr`, {
  method: 'POST',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
}).then((r) => r.json());
const pair = await fetch(`${BASE}/api/mobile/pair`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    code: qr.code,
    deviceName: 'Evidence Capture',
    pushKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
  }),
});
if (!pair.ok) {
  console.error('pairing failed:', pair.status, await pair.text());
  process.exit(1);
}
const [cookieName, cookieValue] = (pair.headers.get('set-cookie') ?? '').split(';')[0].split('=');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  acceptInsecureCerts: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const viewport = { width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
let failures = 0;
const shoot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png`);
};

/* 1 — pre-auth: what an unpaired phone sees on first load. */
const anonCtx = await browser.createBrowserContext();
let page = await anonCtx.newPage();
await page.setViewport(viewport);
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.goto(`${BASE}/mobile/`, { waitUntil: 'networkidle2', timeout: 20_000 });
await wait(600);
try {
  await shoot('mobile-pwa-01-pairing-screen');
} catch (e) {
  failures += 1;
  console.error('pairing screen capture failed:', e.message);
}
await anonCtx.close();

/* 2 — paired app. */
const ctx = await browser.createBrowserContext();
page = await ctx.newPage();
await page.setViewport(viewport);
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.setCookie({ name: cookieName, value: cookieValue, domain: '127.0.0.1', path: '/', secure: true });
await page.goto(`${BASE}/mobile/`, { waitUntil: 'networkidle2', timeout: 20_000 });
await wait(800);

const step = async (name, action) => {
  try {
    await action();
    await wait(500);
    await shoot(name);
  } catch (e) {
    failures += 1;
    console.error(`${name} failed:`, e.message);
  }
};

await step('mobile-pwa-02-chats', async () => {});
await step('mobile-pwa-03-conversation', async () => {
  /* Open a real chat row by its title (rows are buttons containing the title). */
  const clicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      if (el.textContent?.includes('Trim the embedding spend')) {
        el.click();
        return true;
      }
    }
    return false;
  });
  if (!clicked) throw new Error('chat row not found');
  await wait(1200);
});
await step('mobile-pwa-04-approvals', async () => {
  /* The tab's aria-label carries the pending badge ("Approvals, N waiting"). */
  await page.click('[aria-label^="Approvals"]');
});
await step('mobile-pwa-05-settings', async () => {
  await page.click('[aria-label="Settings"]');
});

await browser.close();
if (failures) {
  console.error(`\n${failures} capture(s) failed.`);
  process.exit(1);
}
console.log('\nAll mobile PWA screenshots captured.');
