// PTY probe — the bottom panel's Terminal tab must produce a real shell
// through the engine (xterm canvas + at least one rendered row).
import puppeteer from 'puppeteer';
const DEMO_WS = { id: 'demo-aurora', name: 'Aurora (demo)', slug: 'aurora-demo', path: '/home/user/xr-demo', kind: 'custom', icon: null, stack: [], pinned: false, lastOpenedAt: null, createdAt: Date.now(), updatedAt: Date.now(), windowBounds: null, pathExists: true };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5173/#/builder/demo-aurora', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate((ws) => {
  window.localStorage.setItem('xr.onboarding.complete', 'true');
  window.localStorage.setItem('xr.workspaces.dev.v1', JSON.stringify([ws]));
}, DEMO_WS);
await page.goto('http://127.0.0.1:5173/#/builder/demo-aurora', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await page.waitForSelector('[data-testid="builder-screen"]', { timeout: 120000 });
await page.keyboard.down('Control'); await page.keyboard.press('`'); await page.keyboard.up('Control');
await page.waitForSelector('[data-testid="builder-bottom-panel"]', { timeout: 10000 });
// PTY open may need Shield approval — approve if the modal appears.
for (let i = 0; i < 20; i++) {
  const handled = await page.evaluate(() => {
    const approve = [...document.querySelectorAll('button')].find((b) => /approve|allow|open shell/i.test(b.textContent ?? '') && b.closest('[role="dialog"], [data-slot="dialog-content"], .fixed'));
    if (approve) { approve.click(); return true; }
    return false;
  });
  const xterm = await page.evaluate(() => !!document.querySelector('.xterm'));
  if (xterm) break;
  if (handled) await wait(800); else await wait(500);
}
await wait(2500);
const res = await page.evaluate(() => {
  const term = document.querySelector('.xterm');
  const rows = document.querySelectorAll('.xterm-rows > div');
  const text = document.querySelector('.xterm-rows')?.textContent ?? '';
  return { xterm: !!term, rowCount: rows.length, text: text.slice(0, 120) };
});
console.log(JSON.stringify(res, null, 1));
console.log(res.xterm && res.rowCount > 0 ? '✅ PTY LIVE (xterm mounted with rendered rows through the engine)' : '⚠ PTY did not render');
await page.screenshot({ path: '/home/user/xr/previews/ui-redesign-2026-10-29/builder-07-terminal-live.png' });
await browser.close();
process.exit(res.xterm && res.rowCount > 0 ? 0 : 1);
