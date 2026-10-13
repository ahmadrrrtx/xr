#!/usr/bin/env node
/**
 * Phase 30 screenshot set.
 *
 * Drives the real website in a real browser against the real dev server:
 *   - the marketing surfaces (/pricing, /security, /download)
 *   - the auth surfaces (/auth/signin, /auth/signup, /auth/error)
 *   - the admin console (/dashboard/*) in **demo mode**, which is the state a
 *     reviewer sees with no cloud service running: example data behind a visible
 *     banner, not a fake signed-in account.
 *
 *   cd website && bunx next dev -p 3000 &
 *   node tools/screenshots-phase30.mjs
 *
 * Output: previews/implementation/phase-30/ (override: XR_SHOTS=…)
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = process.env.XR_SHOTS ?? resolve(root, 'previews/implementation/phase-30');
const BASE = process.env.XR_BASE ?? 'http://127.0.0.1:3000';

mkdirSync(OUT, { recursive: true });

/**
 * 1440×900 — a laptop, the size these pages are designed at.
 *
 * Scale factor 1 for full-page shots: several of these pages are 4,000–6,000 px
 * tall, and rendering them at 2× exhausted the renderer in this container (the
 * first run died with `Target closed` halfway through the list). Viewport shots
 * stay at 2× because they are the ones a reviewer zooms into.
 */
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const VIEWPORT_RETINA = { width: 1440, height: 900, deviceScaleFactor: 2 };

const SHOTS = [
  ['01-pricing.png', '/pricing', 'full'],
  ['02-security-trust.png', '/security', 'full'],
  ['03-download.png', '/download', 'full'],
  ['04-legal-privacy.png', '/legal/privacy', 'full'],
  ['05-auth-signin.png', '/auth/signin', 'viewport'],
  ['06-auth-signup.png', '/auth/signup', 'viewport'],
  ['07-auth-error.png', '/auth/error?code=not_a_member', 'viewport'],
  ['08-console-overview.png', '/dashboard', 'full'],
  ['09-console-members.png', '/dashboard/members', 'full'],
  ['10-console-sso.png', '/dashboard/sso', 'full'],
  ['11-console-policies.png', '/dashboard/policies', 'full'],
  ['12-console-workspaces.png', '/dashboard/workspaces', 'full'],
  ['13-console-memory.png', '/dashboard/memory', 'full'],
  ['14-console-billing.png', '/dashboard/billing', 'full'],
  ['15-console-audit.png', '/dashboard/audit', 'full'],
  ['16-console-compliance.png', '/dashboard/compliance', 'full'],
  ['17-console-api-keys.png', '/dashboard/keys', 'full'],
];

const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--max-old-space-size=2048'];

function launch() {
  return puppeteer.launch({ args: LAUNCH_ARGS });
}

/** Dev-server HMR sockets are not page errors, and every shot would otherwise
 *  report one. Everything else is reported, even when it does not fail the run. */
function isNoise(text) {
  return /_next\/hmr|WebSocket connection to 'ws:\/\/127\.0\.0\.1:(3000|3001)\/_next|Download the React DevTools/i.test(text);
}

let browser = await launch();
let failures = 0;
const notes = [];

// `XR_ONLY=17` re-captures a single shot without redrawing the whole set — used
// when a renderer dies on the last page and the other sixteen are already good.
const only = process.env.XR_ONLY?.trim();
const set = only ? SHOTS.filter(([name]) => name.startsWith(only) || name.includes(only)) : SHOTS;

for (const [name, path, mode] of set) {
  const url = `${BASE}${path}`;
  let attempt = 0;
  // One retry with a fresh browser: full-page rasterisation is the one thing that
  // can take the renderer down here, and a retry costs two seconds.
  for (;;) {
    attempt += 1;
    const problems = [];
    let page = null;
    try {
      page = await browser.newPage();
      await page.setViewport(mode === 'full' ? VIEWPORT : VIEWPORT_RETINA);
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isNoise(msg.text())) problems.push(msg.text());
      });
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
      const status = res?.status() ?? 0;
      // Let fonts settle so the type in the shots is the type people see.
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: resolve(OUT, name), fullPage: mode === 'full' });
      const ok = status === 200 && problems.length === 0;
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? 'ok  ' : 'WARN'} ${name.padEnd(28)} ${status}${problems.length ? ` · ${problems.length} console error(s): ${problems[0].slice(0, 90)}` : ''}`,
      );
      if (problems.length) notes.push(`${name}: ${problems[0].slice(0, 140)}`);
      break;
    } catch (error) {
      const message = String(error).split('\n')[0];
      if (attempt === 1) {
        console.log(`  retry ${name.padEnd(27)} ${message}`);
        try {
          await browser.close();
        } catch {
          /* the browser is already gone; that is why we are here */
        }
        browser = await launch();
        continue;
      }
      failures += 1;
      console.log(`  FAIL ${name.padEnd(28)} ${message}`);
      break;
    } finally {
      if (page) await page.close().catch(() => undefined);
    }
  }
}

await browser.close();

console.log(`\n${set.length - failures}/${set.length} captured into ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
