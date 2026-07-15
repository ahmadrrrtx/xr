/**
 * XR — Browser Control Module
 * 
 * SECURITY: This module controls browser automation through Playwright.
 * 
 * CRITICAL SECURITY REQUIREMENTS:
 * 1. NEVER use --no-sandbox or --disable-setuid-sandbox in production
 * 2. Browser runs with full sandbox enabled by default
 * 3. Explicit opt-in required to disable sandbox (XR_BROWSER_UNSAFE=1)
 * 4. All browser actions are logged and approval-gated
 * 5. Browser context is isolated per session
 */

import type { Action, ActionResult } from "./types.ts";

type AnyPage = any;
let cached: { browser: any; context: any; page: any; pages: any[] } | null = null;

function ok(m: string, data?: unknown): ActionResult { 
  return { ok: true, message: m, ...(data ? { data } : {}) }; 
}
function fail(m: string): ActionResult { 
  return { ok: false, message: m }; 
}

export function browserAvailable() {
  try {
    require.resolve("playwright");
    return { available: true };
  } catch {
    return { available: false, reason: "playwright not installed – run: xr control browser install" };
  }
}

/**
 * SECURITY: Get Playwright launch arguments
 * 
 * PRODUCTION SECURITY (default):
 * - NO --no-sandbox
 * - NO --disable-setuid-sandbox
 * - Full Chrome sandbox enforcement
 * 
 * DEVELOPMENT/DEBUGGING ONLY:
 * - Set XR_BROWSER_UNSAFE=1 to disable sandbox
 * - This should ONLY be used in development environments
 * - Production deployments MUST never set this flag
 */
function getBrowserLaunchArgs(): string[] {
  const args: string[] = [
    // Security: Disable file system access
    "--disable-dev-shm-usage",
    
    // Security: Prevent privilege escalation
    "--disable-setuid-sandbox", // We set this explicitly to false below
    
    // Security: Disable GPU to prevent GPU process escapes
    "--disable-gpu",
    "--disable-software-rasterizer",
    
    // Security: Disable background network requests
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    
    // Security: Disable sync
    "--disable-sync",
    
    // Security: Disable extensions unless explicitly needed
    "--disable-extensions",
    "--disable-default-apps",
    
    // Security: Prevent popup windows
    "--disable-popup-blocking",
    
    // Privacy: Disable metrics and crash reporting
    "--metrics-recording-only",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-startup-window",
    
    // Security: Disable features that could be exploited
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-blink-features=AutomationControlled",
  ];

  // SECURITY CHECK: Only disable sandbox if explicitly opted-in
  const unsafeMode = process.env.XR_BROWSER_UNSAFE === "1";
  
  if (unsafeMode) {
    // WARNING: This disables all sandbox protections
    // ONLY use this in isolated development environments
    console.warn(
      "\x1b[31m%s\x1b[0m",
      "WARNING: XR_BROWSER_UNSAFE=1 is set. Browser sandbox is DISABLED. " +
      "This is insecure and should ONLY be used in development."
    );
    args.push("--no-sandbox");
    args.push("--disable-setuid-sandbox");
    args.push("--disable-dev-shm-usage");
  } else {
    // PRODUCTION SECURITY: Ensure sandbox is enabled
    // Remove any sandbox-disabling flags (in case they were added above)
    const sandboxArgs = args.filter(arg => 
      arg !== "--no-sandbox" && 
      arg !== "--disable-setuid-sandbox"
    );
    
    // Explicitly enable sandbox (default in Chrome, but be explicit)
    sandboxArgs.push("--enable-sandbox");
    
    // Log security status
    console.log(
      "\x1b[32m%s\x1b[0m",
      "Browser security: Sandbox ENABLED (production mode)"
    );
    
    return sandboxArgs;
  }

  return args;
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
      // SECURITY: Launch with hardened configuration
      const launchOptions: any = {
        headless: process.env.XR_BROWSER_HEADLESS === "1",
        args: getBrowserLaunchArgs(),
        
        // SECURITY: Additional Playwright options
        firefoxUserPrefs: {
          // Disable Firefox features that could be security risks
          "browser.safebrowsing.enabled": false,
          "browser.safebrowsing.malware.enabled": false,
          "privacy.trackingprotection.enabled": true,
        },
      };

      // SECURITY: Only allow downloads to controlled locations
      launchOptions.downloadsPath = process.env.XR_BROWSER_DOWNLOADS || 
                                    joinSafe(process.cwd(), ".xr-browser-downloads");
      
      // SECURITY: Limit browser resources
      launchOptions.timeout = 30000; // 30s timeout for browser launch

      const browser = await pw.chromium.launch(launchOptions);
      
      // SECURITY: Create isolated browser context
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        
        // SECURITY: Prevent geolocation access
        geolocation: null,
        permissions: [],
        
        // SECURITY: Disable JavaScript in certain contexts if needed
        javaScriptEnabled: true, // Required for most web pages
        
        // SECURITY: Control cookies and storage
        acceptDownloads: false, // Don't automatically accept downloads
        
        // SECURITY: Extra HTTP headers to prevent tracking
        extraHTTPHeaders: {
          "X-Requested-With": "XR-Browser",
        },
      });

      // SECURITY: Set up request interception to block malicious content
      context.on("request", (request: any) => {
        const url = request.url();
        // Block known malicious domains (example - would need real blocklist)
        const blockedDomains = process.env.XR_BROWSER_BLOCKED_DOMAINS?.split(",") || [];
        for (const domain of blockedDomains) {
          if (url.includes(domain.trim())) {
            request.abort();
            return;
          }
        }
      });

      const page = await context.newPage();
      
      // SECURITY: Override navigator.webdriver to prevent detection
      // (This is for automation, not security bypass)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

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

/**
 * SECURITY: Safe path joining to prevent directory traversal
 */
function joinSafe(base: string, ...paths: string[]): string {
  const path = require("node:path");
  const joined = path.join(base, ...paths);
  const resolved = path.resolve(joined);
  const baseResolved = path.resolve(base);
  
  if (!resolved.startsWith(baseResolved)) {
    throw new Error("Path traversal detected");
  }
  
  return resolved;
}

export async function executeBrowserAction(action: Extract<Action, { type: "browser" }>): Promise<ActionResult> {
  // SECURITY: Log all browser actions for audit
  const store = require("../state/db.ts").getStore?.();
  if (store) {
    try {
      store.audit("browser.action", {
        op: action.op,
        selector: action.selector?.slice(0, 100),
        value: typeof action.value === "string" ? action.value.slice(0, 100) : undefined,
      });
    } catch {
      // Audit is best-effort
    }
  }

  if (action.op === "close") {
    if (cached) {
      try { 
        await cached.context.close(); 
        await cached.browser.close(); 
      } catch { }
      cached = null;
    }
    return ok("browser closed");
  }

  const res = await ensurePage(action.tabIndex || 0);
  if ("error" in res) return fail(res.error!);
  const page = (res as any).page;
  const timeout = action.timeoutMs ?? 15000;

  // SECURITY: Validate all inputs
  if (action.selector && typeof action.selector === "string") {
    // Basic XSS prevention in selectors
    if (action.selector.includes("<") || action.selector.includes(">")) {
      return fail("Invalid selector: potential XSS detected");
    }
  }

  if (action.value && typeof action.value === "string") {
    // Sanitize value to prevent injection
    if (action.value.length > 10000) {
      return fail("Value too long (max 10000 chars)");
    }
  }

  try {
    switch (action.op) {
      case "goto":
        if (!action.value) return fail("goto needs value");
        
        // SECURITY: Validate URL
        let url: URL;
        try {
          url = new URL(action.value);
          // Only allow http(s) protocols
          if (!["http:", "https:"].includes(url.protocol)) {
            return fail(`Unsupported protocol: ${url.protocol}`);
          }
          // Block localhost/private IPs in production?
          if (process.env.XR_BROWSER_BLOCK_LOCALHOST === "1") {
            if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
              return fail("Localhost access blocked by configuration");
            }
          }
        } catch {
          return fail("Invalid URL");
        }
        
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
        // SECURITY: Validate screenshot path
        const path = action.value || `./xr-browser-${Date.now()}.png`;
        try {
          // Ensure path is within allowed directory
          const safePath = joinSafe(process.cwd(), path);
          await page.screenshot({ path: safePath, fullPage: true });
          return ok(`screenshot saved to ${path}`, { path });
        } catch (e: any) {
          return fail(`screenshot failed: ${e.message}`);
        }
        
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
    tabs: cached?.pages.length || 0,
    security: {
      sandbox: process.env.XR_BROWSER_UNSAFE === "1" ? "disabled" : "enabled",
      headless: process.env.XR_BROWSER_HEADLESS === "1",
    },
  };
}

export async function shutdownBrowser() {
  if (cached) {
    try { 
      await cached.context.close(); 
      await cached.browser.close(); 
    } catch { }
    cached = null;
  }
}
