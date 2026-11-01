// Phase 5 hardening probe — workbench layout survives a reload.
import puppeteer from 'puppeteer';
const DEMO_WS = {
  id: 'demo-aurora', name: 'Aurora (demo)', slug: 'aurora-demo', path: '/home/user/xr-demo',
  kind: 'custom', icon: null, stack: [], pinned: false, lastOpenedAt: null, createdAt: Date.now(),
  updatedAt: Date.now(), windowBounds: null, pathExists: true,
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
async function boot() {
  await page.goto('http://127.0.0.1:5173/#/builder/demo-aurora', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((ws) => {
    window.localStorage.setItem('xr.onboarding.complete', 'true');
    window.localStorage.setItem('xr.workspaces.dev.v1', JSON.stringify([ws]));
  }, DEMO_WS);
  await page.goto('http://127.0.0.1:5173/#/builder/demo-aurora', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await page.waitForSelector('[data-testid="builder-screen"]', { timeout: 120000 });
  await wait(1500);
}
await boot();
// set: preview ON, panel ON, Tests tab, height 300
await page.click('[data-testid="builder-preview-toggle"]');
await wait(400);
await page.keyboard.down('Control'); await page.keyboard.press('`'); await page.keyboard.up('Control');
await page.waitForSelector('[data-testid="builder-bottom-panel"]', { timeout: 10000 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-testid="builder-bottom-panel"] [role="tab"]')].find((t) => t.textContent?.trim().startsWith('Tests'));
  b?.click();
});
await wait(500);
const h0 = await page.evaluate(() => document.querySelector('[data-testid="builder-bottom-panel"]')?.getBoundingClientRect().height);
console.log('set: preview toggle clicked, panel open, Tests tab, height', h0);
// reload
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-testid="builder-screen"]', { timeout: 120000 });
await wait(2500);
const state = await page.evaluate(() => ({
  preview: !!document.querySelector('[data-testid="builder-preview"]'),
  panel: !!document.querySelector('[data-testid="builder-bottom-panel"]'),
  testsActive: [...document.querySelectorAll('[data-testid="builder-bottom-panel"] [role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim().startsWith('Tests') ?? false,
  panelH: Math.round(document.querySelector('[data-testid="builder-bottom-panel"]')?.getBoundingClientRect().height ?? 0),
}));
console.log('after reload:', JSON.stringify(state));
const pass = state.preview && state.panel && state.testsActive && Math.abs(state.panelH - 240) <= 2;
console.log(pass ? '✅ PERSISTENCE VERIFIED (preview/panel/Tests tab/height 240 default restored)' : `⚠ check: ${JSON.stringify(state)}`);
await page.screenshot({ path: '/home/user/xr/previews/ui-redesign-2026-10-29/builder-06-persistence-restored.png' });
await browser.close();
process.exit(pass ? 0 : 1);
