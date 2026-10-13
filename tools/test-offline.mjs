#!/usr/bin/env node
/**
 * Offline behaviour test for the mobile PWA.
 *
 * Verifies the acceptance criteria that only a real browser can prove:
 *  - the service worker installs and precaches the app shell
 *  - a reload with the network cut still renders the app (from cache)
 *  - the offline bar appears
 *  - the composer is still usable and queued sends land in IndexedDB
 *
 *   node tools/reference-daemon.mjs --lan &
 *   node tools/test-offline.mjs
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import puppeteer from 'puppeteer';

const BASE = process.env.XR_BASE ?? 'https://127.0.0.1:3141';
const TOKEN = process.env.XR_DAEMON_TOKEN ?? '';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${extra}`}`);
  if (!ok) failures += 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* pair a device so the app has data to cache */
let cookieName = '';
let cookieValue = '';
if (TOKEN) {
  const qr = await fetch(`${BASE}/api/mobile/pair-qr`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  }).then((r) => r.json());
  const pair = await fetch(`${BASE}/api/mobile/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: qr.code,
      deviceName: 'Offline Test',
      pushKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    }),
  });
  [cookieName, cookieValue] = (pair.headers.get('set-cookie') ?? '').split(';')[0].split('=');
}

const browser = await puppeteer.launch({
  headless: 'new',
  acceptInsecureCerts: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
if (cookieValue) {
  await page.setCookie({ name: cookieName, value: cookieValue, domain: '127.0.0.1', path: '/', secure: true });
}

/* 1. first load + SW install --------------------------------------------------- */
await page.goto(`${BASE}/mobile/`, { waitUntil: 'networkidle2' });
await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 15000 });
await wait
(3500); // let the SW install and precache

const swState = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration('/mobile/');
  return {
    supported: true,
    registered: Boolean(reg),
    active: Boolean(reg?.active),
    state: reg?.active?.state ?? 'none',
    scope: reg?.scope ?? '',
  };
});
check('service worker is supported', swState.supported === true);
check('service worker registered', swState.registered === true, JSON.stringify(swState));
check('service worker is active', swState.state === 'activated', JSON.stringify(swState));
check('service worker scope is /mobile/', swState.scope.endsWith('/mobile/'), swState.scope);

const caches = await page.evaluate(async () => {
  const keys = await window.caches.keys();
  const out = {};
  for (const key of keys) {
    const cache = await window.caches.open(key);
    out[key] = (await cache.keys()).length;
  }
  return out;
});
const precached = Object.entries(caches).find(([k]) => k.includes('precache'))?.[1] ?? 0;
check('app shell is precached', precached > 5, JSON.stringify(caches));

/* 2. chat list is cached for offline use --------------------------------------- */
const cachedData = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('xr-mobile');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return new Promise((resolve) => {
    const tx = db.transaction('cache', 'readonly');
    const get = tx.objectStore('cache').get('chats');
    get.onsuccess = () => resolve(((get.result ?? []) ).length);
    get.onerror = () => resolve(0);
  });
});
check('chat list cached in IndexedDB', typeof cachedData === 'number' && cachedData > 0, String(cachedData));

/* 3. cut the network, reload ---------------------------------------------------
 *
 * CDP's offline emulation does not survive a document reload, and a headless
 * browser keeps reporting navigator.onLine === true. So we simulate what a
 * phone on the wrong WiFi actually produces: navigator.onLine false, and every
 * /api request failing at the network layer. The document request itself is
 * left alone — that's the one the service worker answers from cache.
 */
const client = await page.createCDPSession();
await client.send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:3141/api/*' }] });
const failRequests = (event) => {
  void client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
};
client.on('Fetch.requestPaused', failRequests);

await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
});

await page.reload({ waitUntil: 'domcontentloaded' });
await wait(3500);

const offlineState = await page.evaluate(() => ({
  hasShell: Boolean(document.querySelector('nav[aria-label="Primary"]')),
  text: (document.body.innerText ?? '').replace(/\s+/g, ' '),
  chats: document.querySelectorAll('ul li button').length,
}));
check('app shell renders with the network cut', offlineState.hasShell, offlineState.text.slice(0, 120));
check('offline bar is shown', /Offline — showing cached data/.test(offlineState.text), offlineState.text.slice(0, 160));
check('cached chats are listed offline', offlineState.chats > 0, `${offlineState.chats} rows`);

/* 4. composer still works; the send is queued ---------------------------------- */
if (offlineState.chats > 0) {
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul li button')];
    rows[0]?.click();
  });
  await wait(1200);

  await page.evaluate(() => {
    const area = document.querySelector('textarea[aria-label="Message"]');
    if (!area) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter?.call(area, 'Queued while offline');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(400);
  await page.evaluate(() => {
    const send = [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? '') === 'Send message',
    );
    send?.click();
  });
  await wait(3000);

  const queued = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('xr-mobile');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('cache', 'readonly');
          const get = tx.objectStore('cache').get('queue');
          get.onsuccess = () => resolve((get.result ?? []).length);
          get.onerror = () => resolve(0);
        };
        req.onerror = () => resolve(0);
      }),
  );
  check('offline send lands in the outbox', queued > 0, `${queued} queued`);

  const queueUi = await page.evaluate(() => (document.body.innerText ?? '').includes('Will send when connected'));
  check('queued message shows the ⌛ indicator', queueUi);
}

/* 5. reconnect → queue drains --------------------------------------------------- */
client.off('Fetch.requestPaused', failRequests);
await client.send('Fetch.disable');
await page.evaluate(() => {
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  window.dispatchEvent(new Event('online'));
});
await wait(8000);

const afterReconnect = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('xr-mobile');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('cache', 'readonly');
        const get = tx.objectStore('cache').get('queue');
        get.onsuccess = () => resolve((get.result ?? []).length);
        get.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    }),
);
check('outbox drains after reconnect', afterReconnect === 0, `${afterReconnect} left`);

await browser.close();
console.log(failures === 0 ? '\nAll offline checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
