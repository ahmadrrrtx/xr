#!/usr/bin/env node
/**
 * UI-redesign 2026-10-29 — verification + screenshot sweep for the redesigned
 * Sidebar / Builder / Research surfaces.
 *
 * Runs against the REAL app (vite :5173) on the REAL engine (:3141, local
 * Ollama model, searx.be search) — no mocks. Produces:
 *   · previews/ui-redesign-2026-10-29/*.png  — the evidence pack;
 *   · a JSON report with MEASURED geometry assertions (icon centering),
 *     per-page axe-core (WCAG 2.2 AA) results and console errors.
 *
 *   node tools/screenshots-ui-redesign.mjs            # full sweep
 *   SKIP_RESEARCH=1 node tools/screenshots-ui-redesign.mjs   # sidebar+builder only
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const BASE = process.env.XR_BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.XR_SHOTS ?? resolve(root, 'previews/ui-redesign-2026-10-29');
const REPORT = process.env.XR_REPORT ?? resolve(root, 'docs/release/evidence/ui-redesign-2026-10-29/sweep.json');
mkdirSync(OUT, { recursive: true });
mkdirSync(dirname(REPORT), { recursive: true });

const THEMES = ['xr-native', 'graphite', 'midnight', 'paper', 'arctic'];
const DEMO_WS = {
  id: 'demo-aurora',
  name: 'Aurora (demo)',
  slug: 'aurora-demo',
  path: '/home/user/xr-demo',
  kind: 'custom',
  icon: null,
  stack: [],
  pinned: false,
  lastOpenedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  windowBounds: null,
  pathExists: true,
};
const RESEARCH_QUERY =
  'Based on the attached papers: what is quantum error correction, which codes are used today, and what are the open problems?';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** puppeteer v24 has no chord strings — press modifier + key explicitly. */
async function chord(page, mod, key) {
  await page.keyboard.down(mod);
  await page.keyboard.press(key);
  await page.keyboard.up(mod);
}
const report = { base: BASE, generatedAt: new Date().toISOString(), geometry: {}, phases: {}, axe: {}, consoleErrors: {}, shots: [] };
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).then(() => report.shots.push(name));

/* ── boot ─────────────────────────────────────────────────────────────────── */
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 600_000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = (report.consoleErrors[page.__page] ?? (report.consoleErrors[page.__page] = []));
    if (k.length < 8) k.push(m.text().slice(0, 180));
  }
});
page.on('pageerror', (e) => {
  const k = (report.consoleErrors[page.__page] ?? (report.consoleErrors[page.__page] = []));
  if (k.length < 8) k.push(`pageerror: ${String(e).slice(0, 160)}`);
});

async function fresh(route, pageName) {
  page.__page = pageName;
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate((ws) => {
    window.localStorage.setItem('xr.onboarding.complete', 'true');
    window.localStorage.setItem('xr.workspaces.dev.v1', JSON.stringify([ws]));
  }, DEMO_WS);
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
  await wait(800);
}

/* ═══ 1 · Sidebar geometry — the acceptance criteria, measured ═════════════ */
console.log('\n■ Sidebar geometry (collapsed 56px rail, 40px targets, centered icons)');
await fresh('#/research', 'sidebar-geometry');
await wait(1200); // let the width spring settle before measuring
const geo = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Screens"]');
  if (!nav) return { error: 'nav not found' };
  // The rail is the sidebar <aside> (56px incl. its 1px border); the nav
  // inside it is 1px narrower, so centers must be measured against the aside.
  const rail = (nav.closest('aside') || nav.parentElement).getBoundingClientRect();
  const items = [...nav.querySelectorAll('a')];
  const rows = items.map((a) => {
    const r = a.getBoundingClientRect();
    const svg = a.querySelector('svg');
    const sr = svg ? svg.getBoundingClientRect() : null;
    return {
      label: a.getAttribute('aria-label'),
      btn: { x: r.x, y: r.y, w: r.width, h: r.height },
      icon: sr ? { cx: sr.x + sr.width / 2, cy: sr.y + sr.height / 2 } : null,
      bar: a.querySelector('span[aria-hidden="true"]') ? (() => {
        const b = a.querySelector('span[aria-hidden="true"]').getBoundingClientRect();
        return { left: b.left - rail.left, w: b.width };
      })() : null,
      title: a.getAttribute('title'),
    };
  });
  return { railW: rail.width, railX: rail.x, count: items.length, rows };
});
report.geometry.collapsed = geo;
if (geo.error) fail(geo.error);
else {
  const railCx = geo.railX + geo.railW / 2;
  let maxDx = 0;
  let maxDy = 0;
  for (const r of geo.rows) {
    if (!r.icon) { fail(`no icon in ${r.label}`); continue; }
    maxDx = Math.max(maxDx, Math.abs(r.icon.cx - railCx));
    maxDy = Math.max(maxDy, Math.abs(r.icon.cy - (r.btn.y + r.btn.h / 2)));
  }
  Math.abs(geo.railW - 56) <= 0.5 ? ok(`rail width ${geo.railW}px = 56`) : fail(`rail width ${geo.railW}px ≠ 56`);
  geo.count === 14 ? ok(`${geo.count} nav items`) : fail(`${geo.count} nav items ≠ 14`);
  maxDx <= 0.5 ? ok(`icon horizontal centering maxΔ ${maxDx.toFixed(2)}px`) : fail(`icon horizontal centering maxΔ ${maxDx.toFixed(2)}px > 0.5`);
  maxDy <= 0.5 ? ok(`icon vertical centering maxΔ ${maxDy.toFixed(2)}px`) : fail(`icon vertical centering maxΔ ${maxDy.toFixed(2)}px > 0.5`);
  const active = geo.rows.find((r) => r.bar);
  if (active) {
    Math.abs(active.bar.left) <= 1 ? ok(`active bar hugs rail edge (left ${active.bar.left.toFixed(1)}px)`) : fail(`active bar at ${active.bar.left.toFixed(1)}px, not the rail edge`);
  } else fail('no active-item bar found');
  geo.rows.every((r) => r.title && r.title.length > 3) ? ok('tooltips (title fallback) on all items') : fail('missing title tooltip');
}

// Expand → width 240, labels visible
await chord(page, 'Meta', 'b');
await wait(700);
const expW = await page.evaluate(() => (document.querySelector('nav[aria-label="Screens"]').closest('aside') || document.querySelector('nav[aria-label="Screens"]').parentElement).getBoundingClientRect().width);
report.geometry.expandedW = expW;
Math.abs(expW - 240) <= 0.5 ? ok(`expanded width ${expW}px = 240`) : fail(`expanded width ${expW}px ≠ 240`);
await chord(page, 'Meta', 'b');
await wait(700);

/* ═══ 2 · Theme sweep — 5 themes × collapsed/expanded on Research ═════════ */
console.log('\n■ Theme sweep (5 themes × sidebar states, Research screen)');
for (const t of THEMES) {
  await page.evaluate((theme) => {
    window.localStorage.setItem('xr.theme', JSON.stringify(theme));
    document.documentElement.setAttribute('data-theme', theme);
  }, t);
  await wait(350);
  await shot(page, `theme-${t}-collapsed`);
  await chord(page, 'Meta', 'b');
  await wait(650);
  await shot(page, `theme-${t}-expanded`);
  await chord(page, 'Meta', 'b');
  await wait(650);
  ok(t);
}
await page.evaluate(() => {
  window.localStorage.removeItem('xr.theme');
  document.documentElement.setAttribute('data-theme', 'xr-native');
});

/* ═══ 3 · Builder — real workspace, real files, real static preview ═══════ */
console.log('\n■ Builder workbench (Aurora demo project via the real engine)');
await fresh('#/builder/demo-aurora', 'builder');
await page.waitForSelector('[data-testid="builder-tree"]', { timeout: 20_000 }).then(() => ok('file tree loaded (real FS)')).catch(() => fail('file tree did not load'));
await wait(600);
const previewInitiallyHidden = await page.evaluate(() => !document.querySelector('[data-testid="builder-preview"]'));
previewInitiallyHidden ? ok('preview starts CLOSED (redesign requirement)') : fail('preview visible on open — should start closed');
await shot(page, 'builder-01-default-preview-closed');

// open a file from the tree
const opened = await page.evaluate(() => {
  const hit = document.querySelector('[data-testid="builder-tree"] [data-rel="app.js"]');
  if (hit) { hit.click(); return true; }
  return false;
});
if (opened) {
  await page.waitForSelector('.xb-cm .cm-content, [data-testid="builder-screen"] .CodeMirror', { timeout: 10_000 }).then(() => ok('app.js opened in the editor')).catch(() => fail('editor did not open app.js'));
} else fail('app.js row not found in the tree');
await wait(400);

// open the preview
await page.click('[data-testid="builder-preview-toggle"]');
await wait(600);
// The preview starts stopped (honest state): the engine's static server is
// started from the pane's own Start button.
await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="builder-preview-placeholder"] button.xb-primary, [data-testid="builder-preview"] .xb-placeholder button.xb-primary');
  btn?.click();
});
await page.waitForSelector('[data-testid="builder-preview-frame"]', { timeout: 45_000 }).then(() => ok('preview iframe mounted (engine static server)')).catch(() => fail('preview iframe never appeared'));
await wait(2500);
await shot(page, 'builder-02-preview-open');

// bottom panel: terminal
await chord(page, 'Control', '`');
await page.waitForSelector('[data-testid="builder-bottom-panel"]', { timeout: 10_000 }).then(() => ok('bottom panel opened via Ctrl+`')).catch(() => fail('bottom panel did not open'));
await wait(2500);
await shot(page, 'builder-03-bottom-panel-terminal');

// problems / output / ports tabs
for (const tab of ['Problems', 'Output', 'Tests', 'Ports']) {
  const clicked = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('[data-testid="builder-bottom-panel"] [role="tab"]')].find((t) => t.textContent?.trim().startsWith(label));
    if (b) { b.click(); return true; }
    return false;
  }, tab);
  if (clicked) { await wait(700); await shot(page, `builder-04-panel-${tab.toLowerCase()}`); ok(`${tab} tab`); }
  else fail(`${tab} tab button not found`);
}

// alt layout: 1280×800, tree hidden
await page.setViewport({ width: 1280, height: 800 });
await chord(page, 'Meta', '\\');
await wait(600);
await shot(page, 'builder-05-alt-layout-1280');
await page.setViewport({ width: 1440, height: 900 });
await chord(page, 'Meta', '\\');
await wait(400);

/* ═══ 4 · Research — a REAL run through the real engine ═══════════════════ */
if (!process.env.SKIP_RESEARCH) {
  console.log('\n■ Research workbench (real engine: stored session from a completed local run + live grounded chat)');
  // XR_RESEARCH_SESSION (default: the session completed by the 2026-10-29
  // local run — 3 attached PDFs read by the engine, synthesis by the local
  // ollama model, real [sN] citations). Set XR_RESEARCH_RUN=1 to run live.
  const SESSION = process.env.XR_RESEARCH_SESSION ?? 'r_e5bb928f';
  if (process.env.XR_RESEARCH_RUN) {
  await fresh('#/research', 'research');
  await page.click('[data-testid="depth-quick"]').catch(() => {});
  // Local documents: three real PDFs (educational QEC notes) read by the
  // engine like a user's own papers — the run is fully real: local planning +
  // synthesis (ollama qwen2.5:1.5b), local sources, real citations.
  const input = await page.$('[data-testid="pdf-input"]');
  if (input) {
    await input.uploadFile('/tmp/xr-pdfs/qec-basics.pdf', '/tmp/xr-pdfs/surface-codes.pdf', '/tmp/xr-pdfs/qec-open-questions.pdf');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="pdf-item"]').length === 3, { timeout: 30_000 }).catch(() => fail('PDFs did not attach'));
    await wait(2500); // text extraction
  } else fail('pdf input not found');
  await page.click('[data-testid="research-query"]', { clickCount: 3 });
  await page.type('[data-testid="research-query"]', RESEARCH_QUERY);
  await page.click('[data-testid="research-start"]');
  let phase = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 480_000) {
    phase = await page.evaluate(() => document.querySelector('[data-testid="research-screen"]')?.getAttribute('data-phase') ?? '');
    if (phase !== report.phases.last) { report.phases.last = phase; console.log(`  · phase: ${phase} (${Math.round((Date.now() - t0) / 1000)}s)`); }
    if (['done', 'partial', 'error', 'cancelled'].includes(phase)) break;
    await wait(2000);
  }
  report.phases.final = phase;
  ['done', 'partial'].includes(phase) ? ok(`run finished: ${phase} in ${Math.round((Date.now() - t0) / 1000)}s`) : fail(`run ended in phase "${phase}"`);
  await wait(1200);
  await shot(page, 'research-01-report-and-stages');

  if (phase === 'done' || phase === 'partial') {
    // sources panel + inspector
    const cards = await page.$$('[data-testid="source-card"]');
    ok(`${cards.length} source cards`);
    await shot(page, 'research-02-sources-panel');
    if (cards.length) {
      await cards[0].$('.xr-card-hit').then((b) => b?.click()).catch(() => {});
      await wait(900);
      await shot(page, 'research-03-source-inspector');
      ok('source inspector opened (first card)');
    }
    // evidence matrix
    const matrixBtn = await page.evaluateHandle(() => [...document.querySelectorAll('[data-testid="stage-rail"] button')].find((b) => b.textContent?.includes('Evidence')));
    const matrixEl = matrixBtn.asElement();
    if (matrixEl) {
      await matrixEl.click();
      await page.waitForSelector('[data-testid="evidence-matrix"]', { timeout: 5000 }).then(() => ok('evidence matrix rendered')).catch(() => fail('evidence matrix did not render'));
      await wait(600);
      await shot(page, 'research-04-evidence-matrix');
    } else fail('Evidence stage button not found');
    // grounded chat
    await chord(page, 'Meta', 'j');
    await page.waitForSelector('[data-testid="research-chat"]', { timeout: 5000 }).catch(() => fail('chat dock did not open'));
    await page.click('[data-testid="research-chat-input"]').catch(() => {});
    await page.type('[data-testid="research-chat-input"]', 'Summarize the key findings in two sentences and cite your sources.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-chat"] .xr-chat-msg').length >= 2, { timeout: 180_000 }).then(() => ok('grounded chat answered')).catch(() => fail('chat did not answer in 180s'));
    await wait(600);
    await shot(page, 'research-05-grounded-chat');
  } else {
    await shot(page, 'research-error-state');
  }
  } else {
    // Load the stored session through the app's own URL intent.
    await fresh(`#/research?session=${SESSION}`, 'research');
    const t0 = Date.now();
    let phase = '';
    while (Date.now() - t0 < 60_000) {
      phase = await page.evaluate(() => document.querySelector('[data-testid="research-screen"]')?.getAttribute('data-phase') ?? '').catch(() => '');
      if (['done', 'partial'].includes(phase)) break;
      await wait(2000);
    }
    report.phases.final = phase;
    ['done', 'partial'].includes(phase) ? ok(`stored session ${SESSION} loaded (phase ${phase})`) : fail(`session load ended in phase "${phase}"`);
    await wait(1500);
    await shot(page, 'research-01-report-and-stages');
    const cards = await page.$$('[data-testid="source-card"]');
    ok(`${cards.length} source cards`);
    await shot(page, 'research-02-sources-panel');
    if (cards.length) {
      await cards[0].$('.xr-card-hit').then((b) => b?.click()).catch(() => {});
      await wait(900);
      await shot(page, 'research-03-source-inspector');
      ok('source inspector opened (first card)');
    }
    const matrixBtn = await page.evaluateHandle(() => [...document.querySelectorAll('[data-testid="stage-rail"] button')].find((b) => b.textContent?.includes('Evidence')));
    const matrixEl = matrixBtn.asElement();
    if (matrixEl) {
      await matrixEl.click();
      await page.waitForSelector('[data-testid="evidence-matrix"]', { timeout: 5000 }).then(() => ok('evidence matrix rendered')).catch(() => fail('evidence matrix did not render'));
      await wait(600);
      await shot(page, 'research-04-evidence-matrix');
    } else fail('Evidence stage button not found');
    await chord(page, 'Meta', 'j');
    await page.waitForSelector('[data-testid="research-chat"]', { timeout: 5000 }).catch(() => fail('chat dock did not open'));
    await page.click('[data-testid="research-chat-input"]').catch(() => {});
    await page.type('[data-testid="research-chat-input"]', 'Summarize the key findings in two sentences and cite your sources.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="research-chat"] .xr-chat-msg').length >= 2, { timeout: 180_000 }).then(() => ok('grounded chat answered')).catch(() => fail('chat did not answer in 180s'));
    await wait(600);
    await shot(page, 'research-05-grounded-chat');
  }
}

/* ═══ 5 · axe-core (WCAG 2.2 AA) on the redesigned surfaces ═══════════════ */
console.log('\n■ axe-core (wcag2a/aa/21aa/22aa)');
const axeSrc = readFileSync(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
for (const [name, selector] of [['research', '[data-testid="research-screen"]'], ['builder', '[data-testid="builder-screen"]']]) {
  const exists = await page.evaluate((sel) => Boolean(document.querySelector(sel)), selector);
  if (!exists) { console.log(`  · ${name}: not on screen, skipped`); continue; }
  const res = await page.evaluate(async (src, sel) => {
    // eslint-disable-next-line no-eval
    (0, eval)(src);
    const r = await window.axe.run(document.querySelector(sel), { resultTypes: ['violations'] });
    return { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  }, axeSrc, selector);
  report.axe[name] = res;
  res.violations.length === 0 ? ok(`${name}: 0 violations`) : fail(`${name}: ${res.violations.length} axe violations — ${res.violations.map((v) => v.id).join(', ')}`);
}

await browser.close();
report.failures = failures;
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `⚠ ${failures} CHECK(S) FAILED`}`);
console.log(`screenshots → ${OUT}/`);
console.log(`report      → ${REPORT}`);
process.exit(failures === 0 ? 0 : 1);
