#!/usr/bin/env bun
/**
 * XR Phase 8 · T4 — visual proof utility (readiness banner, capability
 * badges, progressive-disclosure sidebar, undo surface).
 *
 * Boots the REAL daemon in-process on an ephemeral XR_HOME, signs in through
 * the real browser auth flow, and screenshots the T4 surfaces so a reviewer
 * (or a future regression triage) can SEE the states the structural tests
 * assert. Screenshots default to docs/ux/evidence/ (override $XR_VISUAL_OUT);
 * the five Phase-8 frames are committed there as the visual record.
 *
 * Requires the Playwright chromium binary (`bunx playwright install chromium`).
 */

import { existsSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

declare const document: any;

const TOKEN = "visual-proof-token";
const OUT = process.env.XR_VISUAL_OUT ?? join(import.meta.dir, "../../docs/ux/evidence");

async function main(): Promise<void> {
  if (!existsSync(chromium.executablePath())) {
    console.error("Playwright chromium not installed — run `bunx playwright install chromium` first.");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), "xr-visual-proof-"));
  process.env.XR_HOME = join(tmp, "home");
  const { Store } = await import("../../src/state/workspace-store.ts");
  const { makeHandler } = await import("../../src/daemon/server.ts");
  const store = new Store(join(tmp, "d.db"));
  store.createSession("visual-seed", "Visual proof seed", "run");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  const base = `http://127.0.0.1:${server.port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/`);
    await page.fill("#token", TOKEN);
    await page.click("button.submit");
    await page.waitForSelector(".sidebar", { timeout: 10_000 });

    // 1. Dashboard with the computed readiness banner + disclosure default.
    await page.waitForSelector("#readiness-banner .badge", { timeout: 10_000 });
    await page.screenshot({ path: join(OUT, "t4-dashboard-readiness.png") });

    // 2. Sidebar close-up: default disclosure = only "Start here" expanded.
    const sidebar = await page.$(".sidebar");
    await sidebar?.screenshot({ path: join(OUT, "t4-sidebar-disclosure-default.png") });

    // 3. An area toggle opened (progressive disclosure is user-controlled).
    const toggle = page.locator(".sidebar-section[data-area] > .area-toggle").nth(1);
    await toggle.click();
    await sidebar?.screenshot({ path: join(OUT, "t4-sidebar-disclosure-open.png") });

    // 4. Capabilities panel — standardized badges from real lifecycle data.
    //    Panel reachable via the real dispatcher (palette/nav reveal the
    //    collapsed area automatically — that auto-reveal IS the T4 behavior).
    await page.evaluate("navigateTo('capabilities')");
    await page.waitForSelector("#capabilities-list .badge", { timeout: 10_000 });
    await page.screenshot({ path: join(OUT, "t4-capabilities-badges.png") });

    // 5. Memory panel — the first-class Undo surface. Wait for the list to
    //    settle (spinner replaced) so the panel content is actually painted.
    await page.evaluate("navigateTo('memory')");
    await page.waitForSelector("#mem-undo-btn", { timeout: 10_000 });
    await page.waitForSelector("#mem-list .spinner", { state: "detached", timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, "t4-memory-undo.png") });

    // Report the computed banner verdict as text evidence alongside pixels.
    const verdict = await page.evaluate(() => document.getElementById("readiness-banner")?.textContent?.trim() ?? "missing");
    console.log(JSON.stringify({ ok: true, out: OUT, readinessVerdict: verdict }));
  } finally {
    await browser.close();
    server.stop(true);
  }
}

main().catch((err) => {
  console.error(`FAIL visual-proof: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
