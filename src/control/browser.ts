import type { Action, ActionResult } from "./types.ts";

type AnyPage = any;
let cached: { browser: any; context: any; page: any; pages: any[] } | null = null;

function ok(m: string, data?: unknown): ActionResult { return { ok: true, message: m, ...(data ? { data } : {}) }; }
function fail(m: string): ActionResult { return { ok: false, message: m }; }

export function browserAvailable() {
  try {
    require.resolve("playwright");
    return { available: true };
  } catch {
    return { available: false, reason: "playwright not installed – run: xr control browser install" };
  }
}

async function ensurePage(idx = 0) {
  const probe = browserAvailable();
  if (!probe.available) return { error: probe.reason };

  try {
    if (cached?.pages?.[idx] && !cached.pages[idx].isClosed?.()) {
      return { page: cached.pages[idx] };
    }

    const pw = await import("playwright");
    if (!cached) {
      const browser = await pw.chromium.launch({
        headless: process.env.XR_BROWSER_HEADLESS === "1",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      });
      const page = await context.newPage();
      cached = { browser, context, page, pages: [page] };
    }

    while (cached.pages.length <= idx) {
      cached.pages.push(await cached.context.newPage());
    }

    return { page: cached.pages[idx] };
  } catch (e) {
    return { error: `browser init failed: ${(e as Error).message}` };
  }
}

export async function executeBrowserAction(action: Extract<Action, { type: "browser" }>): Promise<ActionResult> {
  if (action.op === "close") {
    if (cached) {
      try { await cached.context.close(); await cached.browser.close(); } catch { }
      cached = null;
    }
    return ok("browser closed");
  }

  const res = await ensurePage(action.tabIndex || 0);
  if ("error" in res) return fail(res.error!);
  const page = (res as any).page;
  const timeout = action.timeoutMs ?? 15000;

  try {
    switch (action.op) {
      case "goto":
        if (!action.value) return fail("goto needs value");
        await page.goto(action.value, { timeout, waitUntil: "domcontentloaded" });
        return ok(`navigated to ${action.value}`);
      case "click":
        if (!action.selector) return fail("click needs selector");
        await page.click(action.selector, { timeout });
        return ok(`clicked ${action.selector}`);
      case "fill":
        if (!action.selector || action.value == null) return fail("fill needs selector+value");
        await page.fill(action.selector, action.value, { timeout });
        return ok(`filled ${action.selector}`);
      case "type":
        await page.type(action.selector || ":focus", action.value || "", { delay: 20, timeout });
        return ok("typed");
      case "press":
        if (action.selector) await page.press(action.selector, action.value || "Enter", { timeout });
        else await page.keyboard.press(action.value || "Enter");
        return ok(`pressed ${action.value}`);
      case "wait":
        if (action.selector) await page.waitForSelector(action.selector, { timeout });
        else await page.waitForTimeout(Number(action.value) || 2000);
        return ok("wait ok");
      case "extract":
        const text = await page.locator(action.selector || "body").first().innerText({ timeout });
        return ok(`extracted ${text.length} chars`, { text });
      case "screenshot":
        const path = action.value || `./xr-browser-${Date.now()}.png`;
        await page.screenshot({ path, fullPage: true });
        return ok(`screenshot saved to ${path}`, { path });
      case "new_tab":
        const p = await cached!.context.newPage();
        cached!.pages.push(p);
        return ok(`new tab opened at index ${cached!.pages.length - 1}`);
      case "close_tab":
        const idx = action.tabIndex || 0;
        if (cached!.pages[idx]) {
          await cached!.pages[idx].close();
          cached!.pages.splice(idx, 1);
        }
        return ok("tab closed");
      default:
        return fail(`browser op ${action.op} not implemented`);
    }
  } catch (e) {
    return fail(`browser ${action.op} failed: ${(e as Error).message}`);
  }
}

export function browserStatus() {
  const probe = browserAvailable();
  return {
    installed: probe.available,
    active: !!cached?.page,
    url: cached?.page ? cached.page.url() : undefined,
    tabs: cached?.pages.length || 0
  };
}

export async function shutdownBrowser() {
  if (cached) {
    try { await cached.context.close(); await cached.browser.close(); } catch { }
    cached = null;
  }
}
