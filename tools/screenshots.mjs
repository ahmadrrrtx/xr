#!/usr/bin/env node
/**
 * Phase 28 screenshot set.
 *
 * Drives the real app in a real browser against the real LAN daemon:
 *   - pairs a device through POST /api/mobile/pair (so the shots show live data)
 *   - walks the 4 tabs on an iPhone-sized viewport
 *   - opens the desktop Settings -> Mobile card in a second page
 *
 *   node tools/reference-daemon.mjs --lan &
 *   node tools/screenshots.mjs
 *
 * Output: previews/implementation/phase-28/ (repo-relative; override: XR_SHOTS=...)
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

// The daemon serves a self-signed cert (that's the whole point of LAN mode).
// This harness talks to its own machine over its own network, so we accept it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = process.env.XR_SHOTS ?? resolve(root, 'previews/implementation/phase-28');
const BASE = process.env.XR_BASE ?? 'https://127.0.0.1:3141';
const DESKTOP_PREVIEW = 'http://127.0.0.1:4181';

mkdirSync(OUT, { recursive: true });

const TOKEN = process.env.XR_DAEMON_TOKEN ?? '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The delivered push, drawn as it appears on a locked iPhone. The payload text
 * is what the service worker shows AFTER decrypting the second layer — the
 * push vendor only ever saw ciphertext.
 */
const LOCK_SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #000; color: #fff; width: 393px; height: 852px; overflow: hidden; }
  .bg { position: absolute; inset: 0;
        background: radial-gradient(120% 90% at 50% 8%, #0b1626 0%, #05080f 55%, #010306 100%); }
  .orb { position: absolute; left: 50%; top: 150px; transform: translateX(-50%); opacity: .5; }
  .status { position: absolute; top: 18px; left: 24px; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
  .status-right { position: absolute; top: 18px; right: 24px; font-size: 13px; opacity: .9; }
  .date { position: absolute; top: 96px; width: 100%; text-align: center; }
  .date .day { font-size: 22px; font-weight: 500; opacity: .92; }
  .date .time { font-size: 76px; font-weight: 300; letter-spacing: -0.02em; margin-top: -6px; }
  .notif { position: absolute; left: 12px; right: 12px; top: 268px;
           background: rgba(28,28,30,0.72); backdrop-filter: blur(24px);
           border-radius: 22px; padding: 14px 16px 12px; border: 1px solid rgba(255,255,255,.08); }
  .notif-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
  .app-icon { width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
              background: radial-gradient(circle at 32% 28%, #16202F 0%, #05080F 70%); border: 1px solid rgba(0,229,255,.4); }
  .app-icon span { font-size: 7px; font-weight: 700; color: #00E5FF; }
  .app-name { font-size: 12.5px; opacity: .95; letter-spacing: .01em; }
  .app-time { margin-left: auto; font-size: 11.5px; opacity: .6; }
  .notif-title { font-size: 15px; font-weight: 600; margin: 2px 0 2px; }
  .notif-body { font-size: 14px; opacity: .82; line-height: 1.35; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions div { flex: 1; text-align: center; padding: 9px 0; border-radius: 12px; font-size: 13.5px; font-weight: 600; }
  .approve { background: #34D399; color: #04140C; }
  .deny { border: 1.5px solid #F87171; color: #F87171; }
  .hint { position: absolute; bottom: 96px; width: 100%; text-align: center; font-size: 12.5px; opacity: .55; }
  .bar { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
         width: 134px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.85); }
</style></head>
<body>
  <div class="bg"></div>
  <svg class="orb" width="240" height="240" viewBox="0 0 100 100">
    <defs>
      <radialGradient id="halo" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#00E5FF" stop-opacity=".28"/>
        <stop offset="70%" stop-color="#008DA8" stop-opacity=".05"/>
        <stop offset="100%" stop-color="#00E5FF" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="core" cx="34%" cy="28%" r="80%">
        <stop offset="0%" stop-color="#2A3A4E"/><stop offset="36%" stop-color="#0B1220"/>
        <stop offset="100%" stop-color="#010306"/>
      </radialGradient>
      <linearGradient id="ring" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#E8EDF3" stop-opacity=".15"/>
        <stop offset="45%" stop-color="#E8EDF3" stop-opacity=".9"/>
        <stop offset="60%" stop-color="#00E5FF" stop-opacity=".9"/>
        <stop offset="100%" stop-color="#B7C2CF" stop-opacity=".2"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#halo)"/>
    <circle cx="50" cy="50" r="34" fill="url(#core)"/>
    <g transform="rotate(-19 50 50)"><ellipse cx="50" cy="50" rx="44" ry="12" fill="none" stroke="url(#ring)" stroke-width="1.6"/></g>
    <circle cx="50" cy="50" r="34" fill="url(#core)" opacity=".92"/>
    <g transform="rotate(-19 50 50)"><path d="M 6 50 A 44 12 0 0 0 94 50" fill="none" stroke="url(#ring)" stroke-width="1.6"/></g>
    <circle cx="50" cy="50" r="3.4" fill="#00E5FF" opacity=".95"/>
  </svg>
  <div class="status">XR</div>
  <div class="status-right">100%</div>
  <div class="date"><div class="day">Monday 13 October</div><div class="time">9:41</div></div>
  <div class="notif">
    <div class="notif-head">
      <div class="app-icon"><span>XR</span></div>
      <div class="app-name">XR</div>
      <div class="app-time">now</div>
    </div>
    <div class="notif-title">XR approval needed</div>
    <div class="notif-body">Run npm test in xr-api — about 90 seconds, no network calls.</div>
    <div class="actions"><div class="approve">Approve</div><div class="deny">Deny</div></div>
  </div>
  <div class="hint">Decrypted on your phone — FCM/APNS only relayed ciphertext.</div>
  <div class="bar"></div>
</body></html>`;

/* ------------------------------------------------- pair a device for the demo --- */

async function pairDevice() {
  const qr = await fetch(`${BASE}/api/mobile/pair-qr`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  }).then((r) => r.json());

  const pair = await fetch(`${BASE}/api/mobile/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: qr.code,
      deviceName: 'iPhone',
      pushKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    }),
  });
  const setCookie = pair.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

const cookieHeader = TOKEN ? await pairDevice() : '';
console.log(cookieHeader ? '·  paired a demo device' : '·  no token: pairing screen will be shown');
const [cookieName, cookieValue] = cookieHeader.split('=');

/* --------------------------------------------------------- desktop preview --- */

let preview = null;
function startPreview() {
  preview = spawn('npx', ['vite', 'preview', '--config', 'tools/desktop-preview/vite.config.mts'], {
    cwd: root,
    stdio: 'ignore',
    detached: false,
  });
}
async function waitForPreview() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(DESKTOP_PREVIEW, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  return false;
}

/* ------------------------------------------------------------------ shots --- */

const browser = await puppeteer.launch({
  headless: 'new',
  acceptInsecureCerts: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

const shot = async (page, name) => {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path });
  // Print a little of the rendered text — a screenshot of an error state is
  // still a PNG, so we assert on content too, not just pixels.
  const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
  console.log('✓', `${name}.png`, '—', text.slice(0, 96));
  return path;
};

async function newPhonePage(context) {
  const page = await context.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // "Follow system" is the default theme, so pin the OS preference to dark —
  // that's how XR Native ships on an iPhone set to Dark Appearance.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );
  return page;
}

const clickTab = async (page, label) => {
  await page.evaluate((text) => {
    const buttons = [...document.querySelectorAll('nav[aria-label="Primary"] button')];
    const target = buttons.find((b) => (b.getAttribute('aria-label') ?? '').startsWith(text));
    target?.click();
  }, label);
  await wait(700);
};

/* --- paired phone: the four tabs ------------------------------------------- */
if (cookieValue) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(BASE, []);
  const page = await newPhonePage(context);
  await page.setCookie({
    name: cookieName,
    value: cookieValue,
    domain: '127.0.0.1',
    path: '/',
    secure: true,
    sameSite: 'Strict',
  });

  await page.goto(`${BASE}/mobile/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 15000 });
  await wait(1500);
  await shot(page, '01-chat-list');

  // Conversation
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul li button')];
    const first = rows.find((b) => (b.textContent ?? '').includes('embedding'));
    (first ?? rows[0])?.click();
  });
  await wait(1800);
  console.log(
    '·  conversation rendered code blocks:',
    await page.evaluate(() => document.querySelectorAll('pre code').length),
    '| avatar pills:',
    await page.evaluate(() => document.querySelectorAll('[title="XR"], [title="You"]').length),
  );
  await shot(page, '02-conversation');

  // Voice
  await clickTab(page, 'Voice');
  await wait(900);
  console.log(
    '·  voice orb svg present:',
    await page.evaluate(() => document.querySelectorAll('svg').length > 0),
  );
  await shot(page, '03-voice-orb');

  // Approvals
  await clickTab(page, 'Approvals');
  await wait(1400);
  await shot(page, '04-approvals');

  // Approval detail sheet
  await page.evaluate(() => {
    const card = document.querySelector('article button[aria-label^="Open approval"]');
    card?.click();
  });
  await wait(900);
  console.log(
    '·  approval sheet open:',
    await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))),
  );
  await shot(page, '05-approval-detail');
  await page.keyboard.press('Escape');
  await wait(500);

  // Settings
  await clickTab(page, 'Settings');
  await wait(1200);
  await shot(page, '06-settings');

  // Light theme (Arctic) to prove the theme system
  await page.evaluate(() => {
    const swatches = [...document.querySelectorAll('button[aria-label="Arctic"]')];
    swatches[0]?.click();
  });
  await wait(900);
  console.log('·  theme after tapping Arctic:', await page.evaluate(() => document.documentElement.dataset.theme));
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(300);
  await shot(page, '07-settings-arctic');
  await context.close();
}

/* --- unpaired phone: the pairing screen ------------------------------------- */
{
  const context = await browser.createBrowserContext();
  const page = await newPhonePage(context);
  await page.goto(`${BASE}/mobile/pair?code=482913&fp=9c8b1d4e2f7a6350bc19de48a7c25f30ab6e19d4c7b8a2e5f1309c8b7a6d5e4f`, {
    waitUntil: 'networkidle2',
  });
  await wait(1600);
  await shot(page, '08-pairing-confirm');
  await context.close();
}

/* --- desktop: Settings -> Mobile with QR ------------------------------------- */
if (TOKEN) {
  let up = false;
  try {
    const res = await fetch(DESKTOP_PREVIEW, { signal: AbortSignal.timeout(1500) });
    up = res.ok;
  } catch {
    startPreview();
    up = await waitForPreview();
  }
  if (up) console.log('·  desktop preview reachable');
  if (up) {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.goto(`${DESKTOP_PREVIEW}/?token=${encodeURIComponent(TOKEN)}`, { waitUntil: 'networkidle2' });
    await wait(1200);
    await shot(page, '09-desktop-mobile-card');

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes('Pair new device'),
      );
      button?.click();
    });
    await wait(2500);
    console.log(
      '·  QR dialog:',
      await page.evaluate(() => {
        const img = document.querySelector('img[alt="Pairing QR code"]');
        return img ? `rendered ${img.naturalWidth}x${img.naturalHeight}` : 'MISSING';
      }),
      '| code:',
      await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('p')].map((n) => n.textContent ?? '');
        return nodes.find((t) => /^\d{6}$/.test(t.trim())) ?? 'none';
      }),
    );
    await shot(page, '10-desktop-pairing-qr');
    await page.close();
  } else {
    console.log('·  desktop preview did not start — skipping QR shots');
  }
}

/* --- lock-screen push notification (illustration of the delivered payload) --- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2 });
  await page.setContent(LOCK_SCREEN_HTML, { waitUntil: 'load' });
  await wait(500);
  await shot(page, '11-push-lock-screen');
  await page.close();
}

await browser.close();
if (preview) preview.kill('SIGTERM');

console.log('\nScreenshots →', OUT);
try {
  execSync('ls -la ' + JSON.stringify(OUT));
} catch {
  /* ignore */
}
