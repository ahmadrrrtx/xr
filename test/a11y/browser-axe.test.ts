/**
 * XR Phase 8 · T3 — live accessibility verification (WCAG 2.2 · automated half).
 *
 * A REAL headless Chromium loads the REAL daemon (no mocks), then:
 *   · runs axe-core (tags wcag2a/wcag2aa/wcag21aa/wcag22aa) over the sign-in
 *     page, the dashboard shell, and EVERY one of the 26 panels — any single
 *     violation fails the suite;
 *   · drives REAL keyboard input through the core flows (skip link, panel
 *     navigation, command-palette trap/return, aria-current sync).
 *
 * axe catches ~30–50% of WCAG issues — the manual half (keyboard walk +
 * screen-reader procedure) is documented in docs/a11y/MANUAL-TESTING.md and
 * honestly scoped in docs/a11y/CONFORMANCE.md. Never claim conformance from
 * this file alone.
 *
 * Environment: needs the Playwright chromium binary
 * (`bunx playwright install chromium`). When the binary is absent the suite
 * SKIPS loudly; set XR_A11Y_REQUIRE_BROWSER=1 (CI does) to make absence a
 * hard failure instead.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

// The repo tsconfig deliberately excludes the DOM lib (XR is a
// terminal/daemon product); callbacks below run INSIDE the browser via
// Playwright, so we declare the globals they touch locally.
declare const document: any;
declare const HTMLElement: any;
declare const getComputedStyle: any;
declare const axe: any;

const REQUIRE_BROWSER = process.env.XR_A11Y_REQUIRE_BROWSER === "1";
// Hard opt-out for RAM-constrained dev boxes (CI never sets it): the live
// browser half then runs only in the dedicated CI `a11y` job.
const SKIP_BROWSER = process.env.XR_A11Y_SKIP_BROWSER === "1";

function probeChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
const HAS_CHROMIUM = !SKIP_BROWSER && probeChromium();
if (REQUIRE_BROWSER && !HAS_CHROMIUM) {
  throw new Error(
    "XR_A11Y_REQUIRE_BROWSER=1 but the Playwright chromium binary is missing — run `bunx playwright install chromium` first.",
  );
}
if (!HAS_CHROMIUM) {
  console.warn(
    "[a11y] Playwright chromium binary not found — skipping live browser a11y verification. " +
      "Run `bunx playwright install chromium` to enable it (CI requires it).",
  );
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const TOKEN = "a11y-test-token";

let server: ReturnType<typeof Bun.serve> | undefined;
let base = "";
let browser: Browser | undefined;
let axeSrc = "";

beforeAll(() => {
  if (!HAS_CHROMIUM) return;
  const tmp = mkdtempSync(join(tmpdir(), "xr-a11y-suite-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  // Seed one session so the sessions panel renders a real (focusable) row.
  store.createSession("a11y-seed-session", "Keyboard bridge seed", "run");
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  base = `http://127.0.0.1:${server.port}`;
  axeSrc = readFileSync(join(import.meta.dir, "../../node_modules/axe-core/axe.min.js"), "utf8");
});

afterAll(async () => {
  await browser?.close();
  server?.stop();
});

async function newPage(): Promise<Page> {
  browser ??= await chromium.launch();
  return browser.newPage();
}

/**
 * Panels/dialogs activate with a fade from opacity 0 (styles.ts: viewFade /
 * paletteScale, ≤150ms). axe-core's color-contrast blends through opacity, so
 * a sweep that lands MID-ANIMATION reports a transient, nonexistent violation
 * (the flake that raced CI: `#panel-voice .card-title` — a static panel that
 * can only "fail" while its fade runs). A fixed wait long enough for a fast
 * machine is not long enough for a contended runner, so we POLL for computed
 * opacity 1: deterministic on any host, and it verifies the REAL CSS.
 */
async function settleSurface(page: Page, selector: string): Promise<void> {
  await page.waitForTimeout(50); // let the activation animation start its first frames
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).opacity === "1";
    },
    selector,
    { timeout: 5_000, polling: 100 },
  );
}

interface Violation { id: string; nodes: string[]; }
async function axeViolations(page: Page): Promise<Violation[]> {
  await page.evaluate(axeSrc);
  return page.evaluate(async (tags) => {
    // @ts-ignore — axe is injected globally
    const out = await axe.run(document, { runOnly: { type: "tag", values: tags } });
    return out.violations.map((v: any) => ({
      id: v.id,
      nodes: v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")),
    }));
  }, AXE_TAGS);
}

/**
 * Navigate to a panel through the command palette — the path every keyboard
 * user has regardless of progressive-disclosure collapse state (Phase 8 · T4).
 */
async function gotoPanel(page: Page, panel: string): Promise<void> {
  // Search by the panel's real nav label (palette entries are label-based).
  const label = await page.evaluate((pid) => {
    // NAV_LABELS is a script-level const (global lexical scope, not on window)
    try { return (0, eval)("NAV_LABELS[" + JSON.stringify(pid) + "]") ?? pid; } catch { return pid; }
  }, panel);
  await page.keyboard.press("Control+k");
  await page.fill("#palette-search", label);
  await page.keyboard.press("Enter");
  await page.waitForSelector(`.panel.active#panel-${panel}`, { timeout: 10_000 });
}

/** Land on the dashboard through the real auth bootstrap (form → cookie). */
async function signedInDashboard(page: Page): Promise<void> {
  await page.goto(`${base}/`);
  await page.fill("#token", TOKEN);
  await page.click("button.submit");
  await page.waitForSelector(".sidebar", { timeout: 10_000 });
  await page.waitForSelector("#dash-project:not(:empty)", { timeout: 10_000 }).catch(() => {});
}

describe.skipIf(!HAS_CHROMIUM)("T3 live — sign-in page (axe-core, WCAG 2.2 tags)", () => {
  test("unauthenticated browser GET returns the accessible 401 sign-in page", async () => {
    const page = await newPage();
    const res = await page.goto(`${base}/`);
    expect(res?.status()).toBe(401);
    expect(await page.title()).toContain("Sign in");
    expect(res?.headers()["content-security-policy"]).toContain("default-src 'none'");
    await page.close();
  }, 60_000);

  test("zero axe violations on the sign-in page", async () => {
    const page = await newPage();
    await page.goto(`${base}/`);
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  }, 60_000);

  test("JSON 401 contract for non-browser clients is unchanged", async () => {
    const res = await fetch(`${base}/api/overview`, { headers: { accept: "application/json" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body: any = await res.json();
    expect(body.error).toContain("unauthorized");
  });

  test("the token form submits through the one-time bootstrap to the dashboard", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    expect(page.url()).toBe(`${base}/`);
    expect(await page.locator("h1").first().textContent()).toContain("Overview");
    await page.close();
  }, 60_000);
});

describe.skipIf(!HAS_CHROMIUM)("T3 live — dashboard axe sweep (every panel)", () => {
  test("zero axe violations on the initial dashboard", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await settleSurface(page, ".panel.active");
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  }, 60_000);

  test("zero axe violations across ALL 26 panels", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await page.evaluate(axeSrc);
    const panels = await page.$$eval("button.nav-item", (els) =>
      els.map((e) => (e as any).dataset.panel ?? ""),
    );
    // T4: the "Start here" area duplicates 4 essentials as clones — panels
    // stay exactly 26 unique, buttons may number more.
    expect(new Set(panels).size).toBe(26);
    const failures: Record<string, Violation[]> = {};
    for (const panel of new Set(panels)) {
      await gotoPanel(page, panel);
      await settleSurface(page, ".panel.active");
      const v = await page.evaluate(async (tags) => {
        // @ts-ignore
        const out = await axe.run(document, { runOnly: { type: "tag", values: tags } });
        return out.violations.map((x: any) => ({
          id: x.id,
          nodes: x.nodes.slice(0, 2).map((n: any) => n.target.join(" ")),
        }));
      }, AXE_TAGS);
      if (v.length) failures[panel] = v;
    }
    await page.close();
    expect(failures).toEqual({});
  }, 180_000);

  test("zero axe violations with the command palette open (modal state)", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await page.keyboard.press("Control+k");
    await page.waitForSelector("#palette.open");
    await settleSurface(page, "#palette.open");
    expect(await axeViolations(page)).toEqual([]);
    await page.close();
  }, 60_000);
});

describe.skipIf(!HAS_CHROMIUM)("T3 live — keyboard operation (real key events)", () => {
  test("first Tab lands on the skip link; Enter moves focus to main", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.classList.contains("skip-link"))).toBe(true);
    // the skip link becomes visible when focused
    expect(await page.evaluate(() => {
      const r = document.querySelector(".skip-link")!.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })).toBe(true);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("main-content");
    await page.close();
  }, 60_000);

  test("Enter on a nav button switches panel and moves focus into it", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    // "Models" is cloned into the always-visible Start-here area.
    await page.locator('[data-area="start-here"] button.nav-item[data-panel="models"]').focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.querySelector(".panel.active")?.id)).toBe("panel-models");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("panel-models");
    await page.close();
  }, 60_000);

  test("aria-current follows keyboard navigation", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await page.locator('[data-area="start-here"] button.nav-item[data-panel="chat"]').focus();
    await page.keyboard.press("Enter");
    expect(await page.locator('[data-area="start-here"] button.nav-item[data-panel="chat"]').getAttribute("aria-current")).toBe("page");
    expect(await page.locator('[data-area="start-here"] button.nav-item[data-panel="dashboard"]').getAttribute("aria-current")).toBeNull();
    await page.close();
  }, 60_000);

  test("command palette: focus trapped inside, Esc returns focus to the invoker", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await page.locator('[data-area="start-here"] button.nav-item[data-panel="settings"]').focus();
    await page.keyboard.press("Control+k");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("palette-search");
    // Tab cycles within the dialog (its only stop is the combobox input)
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("palette-search");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.dataset.panel)).toBe("settings");
    // dialog hidden from AT when closed
    expect(await page.locator("#palette").getAttribute("aria-hidden")).toBe("true");
    await page.close();
  }, 60_000);

  test("letter shortcuts navigate and hand focus to the new panel", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelector(".panel.active")?.id)).toBe("panel-chat");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("panel-chat");
    await page.close();
  }, 60_000);

  test("Space/Enter activate a role=button session row (bridge)", async () => {
    const page = await newPage();
    await signedInDashboard(page);
    await gotoPanel(page, "sessions");
    // A session row is rendered for the seeded store entry (see beforeAll).
    const row = page.locator(".stat-row[role=button]").first();
    await row.waitFor({ timeout: 10_000 });
    await row.focus();
    const detailCall = page.waitForResponse((r) => r.url().includes("/api/v1/sessions/") && r.status() === 200, {
      timeout: 10_000,
    });
    await page.keyboard.press("Enter");
    await detailCall; // the bridge produced exactly the same effect as a click
    await page.close();
  }, 60_000);
});
