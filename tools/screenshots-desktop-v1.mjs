#!/usr/bin/env node
/**
 * V1 Phase 3.5 — desktop UI audit + screenshot sweep.
 *
 * Walks the real desktop app (vite dev seam, engine = reference daemon) on the
 * three release-viewport sizes and captures:
 *   · screenshots (previews/v1-3.5/<w>x<h>-<route>.png) for the evidence pack;
 *   · a programmatic layout/typography audit (JSON) — horizontal overflow,
 *     viewport-piercing elements, off-scale typography, mixed font stacks,
 *     eternal spinners, console errors — because this environment has no human
 *     eyes on the pixels: every finding is a measured invariant, and the PNGs
 *     ship alongside for human review.
 *
 *   node tools/reference-daemon.mjs --lan &     # engine surface
 *   cd desktop && bun run dev &                 # app surface
 *   node tools/screenshots-desktop-v1.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const BASE = process.env.XR_BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.XR_SHOTS ?? resolve(root, 'previews/v1-3.5');
const REPORT = process.env.XR_REPORT ?? resolve(root, 'docs/release/evidence/v1-2026-10-28/desktop-ui-audit.json');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900, tag: 'laptop' },
  { width: 1280, height: 800, tag: 'small-laptop' },
  { width: 1024, height: 768, tag: 'ipad-landscape' },
];

/* High-priority routes first (Phase 3.5 brief): Research, Builder, then the rest. */
const ROUTES = [
  { hash: '#/research', name: 'research' },
  { hash: '#/builder', name: 'builder' },
  { hash: '#/chat', name: 'chat' },
  { hash: '#/workspaces', name: 'workspaces' },
  { hash: '#/agents', name: 'agents' },
  { hash: '#/runs', name: 'runs' },
  { hash: '#/memory', name: 'memory' },
  { hash: '#/budget', name: 'budget' },
  { hash: '#/skills', name: 'skills' },
  { hash: '#/shield', name: 'shield' },
  { hash: '#/integrations', name: 'integrations' },
  { hash: '#/settings', name: 'settings' },
  { hash: '#/onboarding', name: 'onboarding' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT_JS = () => {
  const doc = document.scrollingElement ?? document.documentElement;
  const vw = window.innerWidth;
  const issues = { overflowX: null, piercers: [], spinners: [], tinyText: [], fontStacks: {}, fontSizes: {} };

  issues.overflowX = { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, excess: doc.scrollWidth - doc.clientWidth };

  // Elements that visibly pierce the viewport width. A pierce is only a defect
  // when NO scrollable ancestor contains it (chip strips, template carousels
  // and wide-table scrollers intentionally bleed into horizontal scroll).
  const scrollable = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && !scrollable(el) && !el.closest('[data-scroll]')) {
      // only leaf-ish elements (text/image carriers), max 8
      if (issues.piercers.length < 8) {
        issues.piercers.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 90),
          right: Math.round(r.right),
          text: (el.textContent ?? '').trim().slice(0, 60),
        });
      }
    }
  }

  // Typography census: font-size/weight/family of visible text nodes.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent?.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.offsetParent === null) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const size = cs.fontSize;
    const fam = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    issues.fontSizes[size] = (issues.fontSizes[size] ?? 0) + 1;
    issues.fontStacks[fam] = (issues.fontStacks[fam] ?? 0) + 1;
    const px = parseFloat(size);
    if (px > 0 && px < 11) {
      if (issues.tinyText.length < 8) issues.tinyText.push({ px, text: t.slice(0, 40), cls: String(el.className).slice(0, 60) });
    }
  }

  // Spinners that never settle (still animating after the settle window).
  for (const el of document.querySelectorAll('[class*="animate-spin"], [class*="animate-pulse"]')) {
    if (issues.spinners.length < 8) issues.spinners.push(String(el.className).slice(0, 90));
  }
  return issues;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = { base: BASE, generatedAt: new Date().toISOString(), pages: [], consoleErrors: {} };
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = (report.consoleErrors[page.__route] ?? (report.consoleErrors[page.__route] = []));
    if (k.length < 6) k.push(m.text().slice(0, 160));
  }
});
page.on('pageerror', (e) => {
  const k = (report.consoleErrors[page.__route] ?? (report.consoleErrors[page.__route] = []));
  if (k.length < 6) k.push(`pageerror: ${String(e).slice(0, 140)}`);
});

for (const vp of VIEWPORTS) {
  await page.setViewport({ width: vp.width, height: vp.height });
  for (const route of ROUTES) {
    const name = `${vp.width}x${vp.height}-${route.name}`;
    page.__route = name;
    try {
      await page.goto(`${BASE}/${route.hash}`, { waitUntil: 'networkidle2', timeout: 25_000 });
    } catch {
      await page.goto(`${BASE}/${route.hash}`, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
    }
    // The onboarding gate owns the router until first-run completes; the audit
    // targets the POST-first-run app, so mark completion (the store reads
    // localStorage 'xr.onboarding.complete' === true) and reload once.
    if ((await page.evaluate(() => location.hash)) === '#/onboarding') {
      await page.evaluate(() => window.localStorage.setItem('xr.onboarding.complete', 'true'));
      await page.reload({ waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => {});
    }
    await wait(900); // settle animations/loads
    const audit = await page.evaluate(AUDIT_JS);
    const landed = await page.evaluate(() => location.hash);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    report.pages.push({ viewport: `${vp.width}x${vp.height}`, route: route.name, landed, ...audit });
    const flag = audit.overflowX.excess > 1 || audit.piercers.length > 0 || landed !== route.hash ? ' ⚠' : '';
    console.log(`✓ ${name}${flag} (landed=${landed}, overflowX=${audit.overflowX.excess}px, piercers=${audit.piercers.length}, tiny=${audit.tinyText.length})`);
  }
}

await browser.close();
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\nreport → ${REPORT}`);
console.log(`screenshots → ${OUT}/`);
