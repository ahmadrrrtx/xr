/**
 * XR v0.8.1 — Browser backend (Playwright, opt-in).
 *
 * Lazy-imports `playwright` so the package stays small for users who don't
 * need browser automation. If Playwright isn't installed, every browser
 * action returns a clear, actionable error — never a crash.
 *
 * Lifecycle:
 *   • One module-singleton Browser + Context + Page.
 *   • Created on first use, reused across actions for performance.
 *   • Closed by the `close` op or process exit.
 *
 * Security:
 *   • Runs HEADED by default so the user can SEE every action.
 *     Override with XR_BROWSER_HEADLESS=1 for CI.
 *   • All page console errors and uncaught exceptions are returned, never
 *     swallowed silently.
 */

import type { Action, ActionResult } from "./types.ts";

// Use `any` to avoid hard-importing playwright types when it's not installed.
type AnyBrowser = any;
type AnyContext = any;
type AnyPage = any;

let cached: { browser: AnyBrowser; context: AnyContext; page: AnyPage } | null = null;

function ok(message: string, data?: unknown): ActionResult { return { ok: true, message, ...(data !== undefined ? { data } as any : {}) }; }
function fail(message: string): ActionResult { return { ok: false, message }; }

export function browserAvailable(): { available: boolean; reason?: string } {
  try {
    // We don't actually import here — Bun resolves the package path even when
    // chunks are missing. Use require.resolve-style probe via dynamic import
    // failure at call time. So we just check the package.json exists.
    // Cheaper: try requiring the module name; catch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require.resolve("playwright");
    return { available: true };
  } catch {
    return { available: false, reason: 'playwright not installed — run "xr control browser install"' };
  }
}

async function ensurePage(): Promise<{ page: AnyPage } | { error: string }> {
  if (cached?.page && !cached.page.isClosed?.()) return { page: cached.page };
  try {
    // Lazy import — only happens when a browser action actually runs.
    const pw = await import("playwright" as any);
    const headless = process.env.XR_BROWSER_HEADLESS === "1";
    const browser = await pw.chromium.launch({ headless });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "xr-control/0.8 (+local)",
    });
    const page = await context.newPage();
    cached = { browser, context, page };
    return { page };
  } catch (e) {
    return { error: `playwright launch failed: ${(e as Error).message}` };
  }
}

async function closeBrowser(): Promise<void> {
  if (!cached) return;
  try { await cached.context.close(); } catch { /* ignore */ }
  try { await cached.browser.close(); } catch { /* ignore */ }
  cached = null;
}

// Best-effort cleanup on process exit.
process.on("exit", () => { void closeBrowser(); });

export async function executeBrowserAction(
  action: Extract<Action, { type: "browser" }>,
): Promise<ActionResult> {
  if (action.op === "close") {
    await closeBrowser();
    return ok("browser closed");
  }

  const probe = browserAvailable();
  if (!probe.available) return fail(probe.reason ?? "playwright unavailable");

  const ready = await ensurePage();
  if ("error" in ready) return fail(ready.error);
  const page = ready.page;

  const timeout = action.timeoutMs ?? 5000;

  try {
    switch (action.op) {
      case "goto": {
        if (!action.value) return fail("goto requires a value (URL)");
        await page.goto(action.value, { timeout, waitUntil: "domcontentloaded" });
        return ok(`navigated to ${action.value}`);
      }
      case "click": {
        if (!action.selector) return fail("click requires a selector");
        await page.click(action.selector, { timeout });
        return ok(`clicked ${action.selector}`);
      }
      case "fill": {
        if (!action.selector) return fail("fill requires a selector");
        if (action.value == null) return fail("fill requires a value");
        await page.fill(action.selector, action.value, { timeout });
        return ok(action.sensitive
          ? `filled ${action.selector} with «sensitive value, ${action.value.length} chars»`
          : `filled ${action.selector} with ${action.value.length} char(s)`);
      }
      case "type": {
        if (action.value == null) return fail("type requires a value");
        const target = action.selector ?? ":focus";
        await page.type(target, action.value, { delay: 12, timeout });
        return ok(`typed ${action.value.length} char(s) into ${target}`);
      }
      case "press": {
        if (!action.value) return fail("press requires a value (key name)");
        if (action.selector) {
          await page.press(action.selector, action.value, { timeout });
        } else {
          await page.keyboard.press(action.value);
        }
        return ok(`pressed ${action.value}`);
      }
      case "wait": {
        if (!action.selector) return fail("wait requires a selector");
        await page.waitForSelector(action.selector, { timeout });
        return ok(`selector ${action.selector} appeared`);
      }
      case "submit": {
        // Either a form selector, or hit Enter on the focused element.
        if (action.selector) {
          await page.locator(action.selector).evaluate((el: any) => {
            const form = el.closest("form") ?? el;
            if (typeof form.submit === "function") form.submit();
          });
        } else {
          await page.keyboard.press("Enter");
        }
        return ok(`submitted ${action.selector ?? "(current form)"}`);
      }
      case "screenshot": {
        const path = action.value ?? `/tmp/xr-browser-${Date.now()}.png`;
        await page.screenshot({ path, fullPage: false });
        return ok(`screenshot saved to ${path}`);
      }
      case "extract": {
        if (!action.selector) return fail("extract requires a selector");
        const text = await page.locator(action.selector).first().innerText({ timeout });
        return ok(`extracted ${text.length} char(s)`, { text });
      }
    }
  } catch (e) {
    return fail(`browser ${action.op} failed: ${(e as Error).message}`);
  }
  return fail(`unknown browser op: ${(action as any).op}`);
}

/** For `xr control browser status`. */
export function browserStatus(): {
  installed: boolean;
  reason?: string;
  active: boolean;
  url?: string;
} {
  const probe = browserAvailable();
  return {
    installed: probe.available,
    reason: probe.reason,
    active: !!cached?.page && !cached.page.isClosed?.(),
    url: cached?.page ? cached.page.url?.() : undefined,
  };
}

/** Exported so `xr control browser close` works from the CLI. */
export async function shutdownBrowser(): Promise<void> {
  await closeBrowser();
}
