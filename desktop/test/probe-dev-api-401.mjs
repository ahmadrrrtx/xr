/**
 * Diagnose boot-time 401s (the lane's single most common failure): boot the SAME
 * preview server the lane uses and log every non-2xx response with its URL.
 *
 * A 401 here means the shell is talking to an engine it cannot authenticate to,
 * i.e. `XR_DEV_TOKEN` does not match the token the running daemon printed. Give
 * it a deliberately wrong token to exercise the shell's offline path on purpose:
 *
 *   XR_DAEMON_URL=http://127.0.0.1:3141 XR_DEV_TOKEN=<token> \
 *     bun run desktop/test/probe-dev-api-401.mjs
 */
import { createRequire } from "node:module";

const require = createRequire("/home/user/repo/package.json");
const { chromium } = require("playwright");
const { build, preview } = await import("vite");

const PORT = 5231;
await build({ root: "/home/user/repo/desktop", logLevel: "error" });
const server = await preview({
  root: "/home/user/repo/desktop",
  logLevel: "error",
  preview: { host: "127.0.0.1", port: PORT, strictPort: true },
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });

page.on("response", (r) => {
  if (r.status() >= 400) console.log(`  ${r.status()} ${r.request().method()} ${r.url()}`);
});
page.on("console", (m) => m.type() === "error" && console.log(`  console: ${m.text()}`));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
if (await page.$(".ob")) {
  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.waitForTimeout(3000);
}
console.log("--- done ---");
await browser.close();
await server.close();
process.exit(0);
