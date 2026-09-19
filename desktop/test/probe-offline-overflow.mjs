/**
 * Reproduce the state the renderer lane caught the `.vd-orb` overflow in:
 * an engine the shell CANNOT authenticate to (401s), where the docked voice orb
 * renders in its `offline` state. Assert the orb no longer overflows its box.
 *
 * This is the falsification step for the vd-glow fix: run it against the
 * pre-fix CSS (inset:-6px) and it reports 80>74; against the fix (blur) it
 * reports no overflow.
 *
 *   XR_DEV_TOKEN=<deliberately-wrong> bun run desktop/test/probe-offline-overflow.mjs
 */
import { createRequire } from "node:module";

const require = createRequire("/home/user/repo/package.json");
const { chromium } = require("playwright");
const { build, preview } = await import("vite");

const PORT = Number(process.env.PROBE_PORT ?? 5234);
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
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(4000); // let the shell settle into its offline state

const report = await page.evaluate(() => {
  const orb = document.querySelector(".vd-orb");
  if (!orb) return { orbPresent: false };
  const glow = orb.querySelector(".vd-glow");
  return {
    orbPresent: true,
    orbClass: orb.className,
    orbClient: orb.clientWidth,
    orbScroll: orb.scrollWidth,
    glowRect: glow ? glow.getBoundingClientRect().width : null,
    glowFilter: glow ? getComputedStyle(glow).filter : null,
    overflowing: orb.scrollWidth > orb.clientWidth,
  };
});
console.log(JSON.stringify(report, null, 2));
console.log(
  report.orbPresent
    ? report.overflowing
      ? "FAIL: the orb still claims layout overflow"
      : "PASS: no layout overflow in the offline dock orb"
    : "SKIP: the docked orb did not render",
);

await browser.close();
await server.close();
process.exit(0);
