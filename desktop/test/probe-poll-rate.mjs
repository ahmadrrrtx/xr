/**
 * Measure the shell's real engine request rate on the running app.
 *
 * The polling hub claims ~59 requests/minute where five independent pollers
 * used to produce ~133. This opens the BUILT app, idles for a fixed window, and
 * reports what the ENGINE actually logged — the only measurement that counts.
 *
 *   XR_DAEMON_URL=... XR_DEV_TOKEN=<token> bun run desktop/test/probe-poll-rate.mjs [seconds]
 */
import { createRequire } from "node:module";
const require = createRequire("/home/user/repo/package.json");
const { chromium } = require("playwright");
const { build, preview } = await import("vite");

const SECONDS = Number(process.argv[2] ?? 60);
const PORT = Number(process.env.PROBE_PORT ?? 5241);
const LOG = process.env.XR_DAEMON_LOG ?? "";

const { readFileSync, statSync } = await import("node:fs");
const logSize = () => {
  try { return statSync(LOG).size; } catch { return 0; }
};

await build({ root: "/home/user/repo/desktop", logLevel: "error" });
const server = await preview({
  root: "/home/user/repo/desktop",
  logLevel: "error",
  preview: { host: "127.0.0.1", port: PORT, strictPort: true },
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('.rail, .ob, .splash[data-state="offline"]', { timeout: 30_000 });
if (await page.$(".ob")) {
  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.waitForTimeout(1500);
}
await page.waitForSelector(".rail", { timeout: 20_000 });
await page.waitForTimeout(3000); // let the first fan-out settle

const mark = logSize();
const t0 = Date.now();
await page.waitForTimeout(SECONDS * 1000);
const elapsed = (Date.now() - t0) / 1000;

// Read only what the daemon appended during the window.
const tail = readFileSync(LOG, "utf8").slice(mark);
const routes = new Map();
for (const line of tail.split("\n")) {
  const m = /"route":"([^"]+)"/.exec(line);
  if (m) routes.set(m[1], (routes.get(m[1]) ?? 0) + 1);
}
const total = [...routes.values()].reduce((a, b) => a + b, 0);

console.log(`\nobserved ${total} engine request(s) in ${elapsed.toFixed(1)}s`);
console.log(`  → ${((total / elapsed) * 60).toFixed(1)} requests/minute`);
for (const [route, n] of [...routes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${route.padEnd(24)} ${n}  (${((n / elapsed) * 60).toFixed(1)}/min)`);
}
await browser.close();
await server.close();
process.exit(0);
