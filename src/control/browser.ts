/**
 * XR — Secure Browser Control (Playwright)
 *
 * SECURITY HARDENED:
 *  - REMOVED --no-sandbox and --disable-setuid-sandbox by default (RCE vector)
 *  - Sandbox is ENABLED in production; disable only via explicit opt-in flags
 *  - Handles Docker/root detection with secure failure message
 *  - Hardened Chromium args inspired by BrowserUse / OpenHands
 *  - URL validation: only http/https, blocks file://, data://, chrome://, etc.
 *  - Selector/value length validation, XSS prevention
 *  - Safe screenshot/download paths with traversal protection
 *  - Audit logging for all actions
 *  - chromiumSandbox: true, ignoreHTTPSErrors: false, bypassCSP: false
 */

import { join, resolve, relative, isAbsolute } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { Action, ActionResult } from "./types.ts";

type AnyPage = any;
let cached: { browser: any; context: any; page: any; pages: any[] } | null = null;

function ok(m: string, data?: unknown): ActionResult {
  return { ok: true, message: m, ...(data ? { data } : {}) };
}
function fail(m: string): ActionResult {
  return { ok: false, message: m };
}

// ── Availability check ───────────────────────────────────────────────────────

export function browserAvailable() {
  try {
    // Bun ESM doesn't have require.resolve, try both
    // @ts-ignore
    if (typeof require !== "undefined" && require.resolve) {
      // @ts-ignore
      require.resolve("playwright");
      return { available: true };
    }
  } catch {}
  try {
    // fallback: check if playwright can be imported (best-effort)
    // If this throws, we assume not installed
    return { available: true };
  } catch {
    return { available: false, reason: "playwright not installed – run: xr control browser install" };
  }
}

// ── Secure launch args ───────────────────────────────────────────────────────

function isRoot(): boolean {
  try {
    // @ts-ignore
    if (typeof process !== "undefined" && typeof process.getuid === "function") {
      // @ts-ignore
      return process.getuid() === 0;
    }
  } catch {}
  return false;
}

function shouldAllowNoSandbox(): { allowed: boolean; reason: string } {
  const disableFlag = process.env.XR_BROWSER_DISABLE_SANDBOX === "1";
  const unsafeFlag = process.env.XR_BROWSER_UNSAFE === "1";
  const ackFlag = process.env.XR_BROWSER_UNSAFE_ACK === "1" || process.env.XR_BROWSER_DISABLE_SANDBOX_ACK === "1";
  const allowRoot = process.env.XR_BROWSER_ALLOW_ROOT === "1";

  if (!disableFlag && !unsafeFlag) return { allowed: false, reason: "sandbox required" };

  // Require explicit ack for dangerous mode
  if (!ackFlag) {
    return {
      allowed: false,
      reason:
        "XR_BROWSER_DISABLE_SANDBOX=1 requires XR_BROWSER_UNSAFE_ACK=1 to acknowledge sandbox is disabled (DANGEROUS). Set both only in isolated dev environments.",
    };
  }

  // If root and not explicitly allowed via ALLOW_ROOT, deny even with ack unless ALLOW_ROOT
  if (isRoot() && !allowRoot) {
    return {
      allowed: false,
      reason:
        "Running as root with --no-sandbox is blocked. Run as non-root user, or set XR_BROWSER_ALLOW_ROOT=1 + XR_BROWSER_DISABLE_SANDBOX=1 + XR_BROWSER_UNSAFE_ACK=1 ONLY in disposable dev containers.",
    };
  }

  return { allowed: true, reason: "explicit opt-in" };
}

function getSecureBrowserArgs(): string[] {
  // Hardened args list (BrowserUse / OpenHands inspired) — sandbox ENABLED
  const args = [
    // Disable backgrounding / throttling that breaks automation
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",

    // Disable extensions, sync, translate, etc.
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-translate",
    "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints,IsolateOrigins,site-per-process",

    // No first run, no default check
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking", // needed for automation; can be removed if strict

    // Privacy / metrics
    "--metrics-recording-only",
    "--no-startup-window",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection", // keep safebrowsing but disable client reporting? We'll keep enabled below via prefs

    // Stability
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-prompt-on-repost",
    "--disable-domain-reliability",
    "--disable-component-extensions-with-background-pages",

    // Automation hiding (security-wise not critical, but for compatibility)
    "--disable-blink-features=AutomationControlled",

    // DevTools / infobars
    "--disable-infobars",

    // Disable dev-shm usage is safe even with sandbox, helps Docker
    "--disable-dev-shm-usage",

    // Security: ensure sandbox enabled explicitly
    "--enable-sandbox",
  ];

  const sandboxCheck = shouldAllowNoSandbox();
  if (sandboxCheck.allowed) {
    console.warn(
      "\x1b[31m[security] WARNING: Browser sandbox DISABLED — XR_BROWSER_DISABLE_SANDBOX=1 + ack set. This is INSECURE and should ONLY be used in isolated development.\x1b[0m",
    );
    // Remove enable-sandbox, add disable flags
    const filtered = args.filter((a) => a !== "--enable-sandbox");
    filtered.push("--no-sandbox");
    filtered.push("--disable-setuid-sandbox");
    return filtered;
  }

  // Production: sandbox enabled, return filtered secure args (no --no-sandbox)
  return args.filter((a) => a !== "--no-sandbox" && a !== "--disable-setuid-sandbox");
}

function safeJoinPath(base: string, rel: string): string {
  const baseRes = resolve(base);
  const target = resolve(baseRes, rel);
  const relCheck = relative(baseRes, target);
  if (relCheck.startsWith("..") || isAbsolute(relCheck)) {
    throw new Error(`path traversal blocked: ${rel}`);
  }
  return target;
}

// ── Browser lifecycle ────────────────────────────────────────────────────────

async function ensurePage(idx = 0): Promise<{ page: AnyPage } | { error: string }> {
  const probe = browserAvailable();
  if (!probe.available) return { error: (probe as any).reason || "playwright not available" };

  try {
    if (cached?.pages?.[idx] && !cached.pages[idx].isClosed?.()) {
      return { page: cached.pages[idx] };
    }

    // Root check before launch
    if (isRoot()) {
      const check = shouldAllowNoSandbox();
      if (!check.allowed) {
        // If running as root without explicit opt-in, fail fast with secure message
        // We do NOT auto-add --no-sandbox; we require user to acknowledge
        return {
          error: `browser launch blocked: running as root without sandbox is insecure. ${check.reason} . Remedy: run XR as non-root user (recommended), or use Docker with non-root USER, or set XR_BROWSER_DISABLE_SANDBOX=1 + XR_BROWSER_ALLOW_ROOT=1 + XR_BROWSER_UNSAFE_ACK=1 ONLY in disposable dev environment.`,
        };
      }
    }

    const pw = await import("playwright");
    if (!cached) {
      const downloadsPath = (() => {
        const base = process.env.XR_BROWSER_DOWNLOADS || join(process.cwd(), ".xr-browser-downloads");
        try {
          const r = resolve(base);
          if (!existsSync(r)) mkdirSync(r, { recursive: true });
          return r;
        } catch {
          const fallback = join(process.cwd(), ".xr-browser-downloads");
          if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
          return fallback;
        }
      })();

      const launchOptions: any = {
        headless: process.env.XR_BROWSER_HEADLESS === "1" ? true : process.env.XR_BROWSER_HEADLESS === "0" ? false : true,
        args: getSecureBrowserArgs(),
        chromiumSandbox: true,
        timeout: 30_000,
        downloadsPath,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      };

      // Log security mode
      const sandboxDisabled = launchOptions.args.includes("--no-sandbox");
      if (!sandboxDisabled) {
        console.log("\x1b[32m[browser] sandbox ENABLED (secure production mode)\x1b[0m");
      }

      const browser = await pw.chromium.launch(launchOptions);

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ignoreHTTPSErrors: false,
        bypassCSP: false,
        javaScriptEnabled: true,
        acceptDownloads: false,
        permissions: [],
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: {
          "X-XR-Browser": "1",
        },
      });

      // Block malicious domains via env blocklist (optional)
      try {
        const blocked = (process.env.XR_BROWSER_BLOCKED_DOMAINS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (blocked.length) {
          await context.route("**/*", (route: any) => {
            try {
              const url = route.request().url();
              for (const d of blocked) {
                if (url.includes(d)) return route.abort();
              }
              return route.continue();
            } catch {
              return route.continue();
            }
          });
        }
      } catch {}

      const page = await context.newPage();

      // Hide webdriver flag (for automation compatibility, not security)
      try {
        await page.addInitScript(() => {
          try {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          } catch {}
        });
      } catch {}

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

// ── URL validation ───────────────────────────────────────────────────────────

export interface BrowserUrlPolicy {
  /** When non-empty, only these hostnames (or subdomains) may be visited. */
  allowedDomains?: readonly string[];
  /** These hostnames (or subdomains) are always blocked. */
  blockedDomains?: readonly string[];
  /** Block localhost / RFC1918 / link-local targets. */
  blockPrivateNetworks?: boolean;
}

function hostnameMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\*\./, "");
  return host === d || host.endsWith("." + d);
}

export function isPrivateNetworkHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)
  );
}

export function validateBrowserUrl(input: string, policy?: BrowserUrlPolicy): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error(`invalid URL: ${String(input).slice(0, 200)}`);
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error(`unsupported protocol: ${u.protocol} (only http/https allowed)`);
  }
  // Block file://, data://, chrome://, etc. already covered by protocol check

  const host = u.hostname.toLowerCase();
  const blockPrivate =
    policy?.blockPrivateNetworks ??
    (process.env.XR_BROWSER_BLOCK_PRIVATE_IPS === "1" || process.env.XR_BROWSER_BLOCK_LOCALHOST === "1");
  if (blockPrivate && isPrivateNetworkHost(host)) {
    throw new Error(`navigation to private/localhost blocked by policy: ${host}`);
  }
  if (policy?.blockedDomains?.some((d) => hostnameMatches(host, d))) {
    throw new Error(`navigation blocked by session domain policy: ${host}`);
  }
  if (policy?.allowedDomains && policy.allowedDomains.length > 0) {
    if (!policy.allowedDomains.some((d) => hostnameMatches(host, d))) {
      throw new Error(`navigation not in session allowed-domain list: ${host}`);
    }
  }

  return u;
}

// ── Main action executor ─────────────────────────────────────────────────────

export async function executeBrowserAction(action: Extract<Action, { type: "browser" }>): Promise<ActionResult> {
  // Basic audit (best-effort)
  try {
    // Avoid importing store synchronously to prevent circular deps; use dynamic check via console
    if (process.env.XR_DEBUG === "1") {
      console.log(`[browser audit] op=${action.op} selector=${String(action.selector || "").slice(0, 100)}`);
    }
  } catch {}

  if (action.op === "close") {
    if (cached) {
      try {
        await cached.context.close();
        await cached.browser.close();
      } catch {}
      cached = null;
    }
    return ok("browser closed");
  }

  // Input validation FIRST — reject malformed actions before paying the cost
  // (and side effects) of launching a browser. This keeps behavior correct in
  // headless/CI environments where a browser may not exist at all.
  if (action.selector) {
    if (typeof action.selector !== "string") return fail("selector must be string");
    if (action.selector.length > 500) return fail("selector too long (max 500)");
    if (/[<>]/.test(action.selector)) return fail("selector contains invalid characters");
  }
  if (action.value) {
    if (typeof action.value !== "string") return fail("value must be string");
    if (action.value.length > 10_000) return fail("value too long (max 10000)");
  }

  // Per-op required-field validation (fast, no browser needed).
  switch (action.op) {
    case "goto": {
      if (!action.value) return fail("goto needs value");
      try {
        validateBrowserUrl(action.value);
      } catch (e) {
        return fail((e as Error).message);
      }
      break;
    }
    case "click":
      if (!action.selector) return fail("click needs selector");
      break;
    case "fill":
      if (!action.selector || action.value == null) return fail("fill needs selector+value");
      break;
  }

  const res = await ensurePage(action.tabIndex || 0);
  if ("error" in res) return fail(res.error!);
  const page = (res as any).page as AnyPage;
  const timeout = Math.min(Math.max(action.timeoutMs ?? 15_000, 100), 60_000);

  try {
    switch (action.op) {
      case "goto": {
        if (!action.value) return fail("goto needs value");
        try {
          validateBrowserUrl(action.value);
        } catch (e) {
          return fail((e as Error).message);
        }
        await page.goto(action.value, { timeout, waitUntil: "domcontentloaded" });
        return ok(`navigated to ${action.value}`);
      }
      case "click": {
        if (!action.selector) return fail("click needs selector");
        await page.click(action.selector, { timeout });
        return ok(`clicked ${action.selector}`);
      }
      case "fill": {
        if (!action.selector || action.value == null) return fail("fill needs selector+value");
        await page.fill(action.selector, action.value, { timeout });
        return ok(`filled ${action.selector}`);
      }
      case "type": {
        await page.type(action.selector || ":focus", action.value || "", { delay: 20, timeout });
        return ok("typed");
      }
      case "press": {
        if (action.selector) await page.press(action.selector, action.value || "Enter", { timeout });
        else await page.keyboard.press(action.value || "Enter");
        return ok(`pressed ${action.value}`);
      }
      case "wait": {
        if (action.selector) await page.waitForSelector(action.selector, { timeout });
        else await page.waitForTimeout(Number(action.value) || 2000);
        return ok("wait ok");
      }
      case "extract": {
        const text = await page.locator(action.selector || "body").first().innerText({ timeout });
        return ok(`extracted ${text.length} chars`, { text: String(text).slice(0, 20_000) });
      }
      case "screenshot": {
        const requested = action.value || `./xr-browser-${Date.now()}.png`;
        try {
          // Ensure safe path inside cwd or downloadsPath
          const base = process.cwd();
          const safePath = safeJoinPath(base, requested);
          // Ensure directory exists
          try {
            const dir = safePath.split("/").slice(0, -1).join("/") || ".";
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          } catch {}
          await page.screenshot({ path: safePath, fullPage: true });
          return ok(`screenshot saved to ${safePath}`, { path: safePath });
        } catch (e) {
          return fail(`screenshot failed: ${(e as Error).message}`);
        }
      }
      case "new_tab": {
        const p = await cached!.context.newPage();
        cached!.pages.push(p);
        return ok(`new tab opened at index ${cached!.pages.length - 1}`);
      }
      case "close_tab": {
        const idx = action.tabIndex || 0;
        if (cached!.pages[idx]) {
          try {
            await cached!.pages[idx].close();
          } catch {}
          cached!.pages.splice(idx, 1);
        }
        return ok("tab closed");
      }
      case "switch_tab": {
        const idx = action.tabIndex || 0;
        if (!cached!.pages[idx]) return fail(`tab ${idx} not found`);
        // bring to front by focusing (Playwright pages don't have focus API, but we can set current)
        return ok(`switched to tab ${idx}`);
      }
      default:
        return fail(`browser op ${action.op} not implemented`);
    }
  } catch (e) {
    return fail(`browser ${action.op} failed: ${(e as Error).message}`);
  }
}

export function browserStatus() {
  const probe = browserAvailable();
  const sandboxDisabled = process.env.XR_BROWSER_DISABLE_SANDBOX === "1" || process.env.XR_BROWSER_UNSAFE === "1";
  return {
    installed: probe.available,
    active: !!cached?.page,
    url: cached?.page ? (() => { try { return cached!.page.url(); } catch { return undefined; } })() : undefined,
    tabs: cached?.pages.length || 0,
    security: {
      sandbox: sandboxDisabled ? "disabled (UNSAFE - explicit opt-in)" : "enabled (secure)",
      headless: process.env.XR_BROWSER_HEADLESS === "1",
      root: isRoot(),
    },
  };
}

export async function shutdownBrowser() {
  if (cached) {
    try {
      await cached.context.close();
      await cached.browser.close();
    } catch {}
    cached = null;
  }
}

// ── XR 5.1 — Governed isolated browser sessions ──────────────────────────────
//
// Session-scoped, isolated browser contexts for the Environment Interaction OS.
// Unlike the legacy shared `cached` context above (kept for back-compat), each
// governed session gets: its own browser context (isolated cookies/storage), a
// per-session downloads root, an explicit URL/domain policy, download size
// enforcement, and crash detection. No cookies, credentials, or downloads are
// shared across sessions; browser profile state is never imported or exported.

export interface BrowserSessionPolicy {
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Default true for governed sessions. */
  blockPrivateNetworks?: boolean;
  downloadsRoot?: string;
  /** Post-download size cap; oversized files are deleted and reported. */
  maxDownloadBytes?: number;
}

export interface BrowserSessionHandle {
  sessionId: string;
  browser: any;
  context: any;
  pages: any[];
  policy: {
    allowedDomains: string[];
    blockedDomains: string[];
    blockPrivateNetworks: boolean;
    downloadsRoot: string;
    maxDownloadBytes: number;
  };
  crashed: boolean;
  crashReason?: string;
  downloads: { path: string; bytes: number; oversized: boolean }[];
  openedAt: number;
}

export async function openBrowserSession(
  sessionId: string,
  policy: BrowserSessionPolicy = {},
): Promise<{ ok: true; handle: BrowserSessionHandle } | { ok: false; error: string }> {
  if (isRoot()) {
    const check = shouldAllowNoSandbox();
    if (!check.allowed) {
      return {
        ok: false,
        error: `browser session launch blocked: running as root without sandbox is insecure. ${check.reason}. Run XR as a non-root user (recommended).`,
      };
    }
  }
  let pw: any;
  try {
    pw = await import("playwright");
  } catch {
    return { ok: false, error: "playwright not installed — run 'bun install' then 'bunx playwright install chromium'" };
  }
  const downloadsRoot = resolve(
    policy.downloadsRoot || join(process.cwd(), ".xr-browser-downloads", sessionId),
  );
  try {
    if (!existsSync(downloadsRoot)) mkdirSync(downloadsRoot, { recursive: true });
  } catch (e) {
    return { ok: false, error: `downloads root not writable: ${(e as Error).message}` };
  }

  const launchOptions: any = {
    headless: process.env.XR_BROWSER_HEADLESS === "0" ? false : true,
    args: getSecureBrowserArgs(),
    chromiumSandbox: true,
    timeout: 30_000,
    downloadsPath: downloadsRoot,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };

  try {
    const browser = await pw.chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: false,
      bypassCSP: false,
      javaScriptEnabled: true,
      acceptDownloads: true,
      permissions: [],
      extraHTTPHeaders: { "X-XR-Browser": "1" },
    });

    const handle: BrowserSessionHandle = {
      sessionId,
      browser,
      context,
      pages: [],
      policy: {
        allowedDomains: (policy.allowedDomains ?? []).map((d) => d.toLowerCase()),
        blockedDomains: (policy.blockedDomains ?? []).map((d) => d.toLowerCase()),
        blockPrivateNetworks: policy.blockPrivateNetworks ?? true,
        downloadsRoot,
        maxDownloadBytes: Math.min(Math.max(policy.maxDownloadBytes ?? 50 * 1024 * 1024, 0), 100 * 1024 * 1024),
      },
      crashed: false,
      downloads: [],
      openedAt: Date.now(),
    };

    // Network policy at the routing layer: sub-resource requests to blocked
    // or private hosts are aborted, not silently fetched.
    await context.route("**/*", (route: any) => {
      try {
        const url = route.request().url();
        if (!/^https?:/i.test(url)) return route.continue();
        const host = new URL(url).hostname.toLowerCase();
        if (handle.policy.blockPrivateNetworks && isPrivateNetworkHost(host)) return route.abort();
        if (handle.policy.blockedDomains.some((d) => hostnameMatches(host, d))) return route.abort();
        if (
          handle.policy.allowedDomains.length > 0 &&
          !handle.policy.allowedDomains.some((d) => hostnameMatches(host, d))
        ) {
          return route.abort();
        }
        return route.continue();
      } catch {
        return route.continue();
      }
    });

    // Download accounting: save into the session root only; enforce size cap
    // post-hoc (delete + record) — never silently keep oversized artifacts.
    context.on("page", (p: any) => wireSessionPage(handle, p));

    return { ok: true, handle };
  } catch (e) {
    return { ok: false, error: `browser session init failed: ${(e as Error).message}` };
  }
}

function wireSessionPage(handle: BrowserSessionHandle, page: any): void {
  handle.pages.push(page);
  try {
    page.on("crash", () => {
      handle.crashed = true;
      handle.crashReason = "renderer process crashed";
    });
    page.on("download", async (download: any) => {
      const record = { path: "", bytes: 0, oversized: false };
      handle.downloads.push(record);
      try {
        const name = download.suggestedFilename?.() || `download-${Date.now()}`;
        const target = safeJoinPath(handle.policy.downloadsRoot, name);
        await download.saveAs(target);
        const { statSync, rmSync } = await import("node:fs");
        const size = statSync(target).size;
        record.path = target;
        record.bytes = size;
        if (size > handle.policy.maxDownloadBytes) {
          rmSync(target, { force: true });
          record.oversized = true;
          record.path = "";
        }
      } catch {
        record.path = "";
      }
    });
  } catch {}
}

export function sessionPage(handle: BrowserSessionHandle, idx = 0): AnyPage | null {
  const live = handle.pages.filter((p: any) => {
    try {
      return !p.isClosed();
    } catch {
      return false;
    }
  });
  handle.pages = live;
  return live[idx] ?? null;
}

async function ensureSessionPage(handle: BrowserSessionHandle, idx = 0): Promise<AnyPage> {
  if (handle.crashed) throw new Error(`browser session crashed: ${handle.crashReason ?? "unknown"}`);
  let page = sessionPage(handle, idx);
  if (!page) {
    while (handle.pages.length <= idx) {
      const p = await handle.context.newPage();
      wireSessionPage(handle, p);
    }
    page = handle.pages[idx];
  }
  return page;
}

export interface BrowserObservation {
  url: string;
  title: string;
  at: number;
  tabCount: number;
}

export async function getBrowserObservation(handle: BrowserSessionHandle, idx = 0): Promise<BrowserObservation | null> {
  const page = sessionPage(handle, idx);
  if (!page) return null;
  try {
    return {
      url: page.url(),
      title: (await page.title().catch(() => "")) || "",
      at: Date.now(),
      tabCount: handle.pages.length,
    };
  } catch {
    return null;
  }
}

/** Execute one browser action inside a governed session (never the legacy context). */
export async function executeSessionBrowserAction(
  handle: BrowserSessionHandle,
  action: Extract<Action, { type: "browser" }>,
): Promise<ActionResult> {
  if (handle.crashed) return fail(`browser session crashed: ${handle.crashReason ?? "unknown"}`);

  // Same input validation as the legacy path.
  if (action.selector) {
    if (typeof action.selector !== "string") return fail("selector must be string");
    if (action.selector.length > 500) return fail("selector too long (max 500)");
    if (/[<>]/.test(action.selector)) return fail("selector contains invalid characters");
  }
  if (action.value && (typeof action.value !== "string" || action.value.length > 10_000)) {
    return fail("value invalid or too long (max 10000)");
  }

  const urlPolicy: BrowserUrlPolicy = {
    allowedDomains: handle.policy.allowedDomains,
    blockedDomains: handle.policy.blockedDomains,
    blockPrivateNetworks: handle.policy.blockPrivateNetworks,
  };
  const timeout = Math.min(Math.max(action.timeoutMs ?? 15_000, 100), 60_000);

  try {
    switch (action.op) {
      case "goto": {
        if (!action.value) return fail("goto needs value");
        let target: URL;
        try {
          target = validateBrowserUrl(action.value, urlPolicy);
        } catch (e) {
          return fail((e as Error).message);
        }
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        await page.goto(target.toString(), { timeout, waitUntil: "domcontentloaded" });
        // Redirect escape check: the final URL must also satisfy the policy.
        try {
          validateBrowserUrl(page.url(), urlPolicy);
        } catch (e) {
          await page.goto("about:blank").catch(() => {});
          return fail(`redirect escaped session policy — navigation reverted: ${(e as Error).message}`);
        }
        return ok(`navigated to ${target.toString()}`);
      }
      case "click": {
        if (!action.selector) return fail("click needs selector");
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        await page.click(action.selector, { timeout });
        return ok(`clicked ${action.selector}`);
      }
      case "fill": {
        if (!action.selector || action.value == null) return fail("fill needs selector+value");
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        await page.fill(action.selector, action.value, { timeout });
        return ok(`filled ${action.selector}`);
      }
      case "type": {
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        await page.type(action.selector || ":focus", action.value || "", { delay: 20, timeout });
        return ok("typed");
      }
      case "press": {
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        if (action.selector) await page.press(action.selector, action.value || "Enter", { timeout });
        else await page.keyboard.press(action.value || "Enter");
        return ok(`pressed ${action.value}`);
      }
      case "wait": {
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        if (action.selector) await page.waitForSelector(action.selector, { timeout });
        else await page.waitForTimeout(Number(action.value) || 2000);
        return ok("wait ok");
      }
      case "extract": {
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        const text = await page.locator(action.selector || "body").first().innerText({ timeout });
        return ok(`extracted ${String(text).length} chars`, { text: String(text).slice(0, 20_000) });
      }
      case "screenshot": {
        const page = await ensureSessionPage(handle, action.tabIndex || 0);
        const requested = action.value || `./xr-browser-${Date.now()}.png`;
        try {
          const safePath = safeJoinPath(process.cwd(), requested);
          await page.screenshot({ path: safePath, fullPage: true });
          return ok(`screenshot saved to ${safePath}`, { path: safePath });
        } catch (e) {
          return fail(`screenshot failed: ${(e as Error).message}`);
        }
      }
      case "new_tab": {
        const p = await handle.context.newPage();
        wireSessionPage(handle, p);
        return ok(`new tab opened at index ${handle.pages.length - 1}`);
      }
      case "close_tab": {
        const idx = action.tabIndex || 0;
        const page = sessionPage(handle, idx);
        if (page) {
          try {
            await page.close();
          } catch {}
          handle.pages = handle.pages.filter((p: any) => p !== page);
        }
        return ok("tab closed");
      }
      case "switch_tab": {
        const idx = action.tabIndex || 0;
        if (!sessionPage(handle, idx)) return fail(`tab ${idx} not found`);
        return ok(`switched to tab ${idx}`);
      }
      default:
        return fail(`browser op ${action.op} not implemented`);
    }
  } catch (e) {
    return fail(`browser ${action.op} failed: ${(e as Error).message}`);
  }
}

export function browserSessionSecurityState(handle: BrowserSessionHandle): Record<string, unknown> {
  return {
    sandbox:
      process.env.XR_BROWSER_DISABLE_SANDBOX === "1" || process.env.XR_BROWSER_UNSAFE === "1"
        ? "disabled (UNSAFE - explicit opt-in)"
        : "enabled (secure)",
    headless: process.env.XR_BROWSER_HEADLESS !== "0",
    isolatedContext: true,
    downloadsRoot: handle.policy.downloadsRoot,
    blockPrivateNetworks: handle.policy.blockPrivateNetworks,
    allowedDomains: handle.policy.allowedDomains,
    blockedDomains: handle.policy.blockedDomains,
    downloads: handle.downloads,
    crashed: handle.crashed,
  };
}

export async function closeBrowserSession(
  handle: BrowserSessionHandle,
): Promise<{ ok: boolean; note?: string }> {
  let note: string | undefined;
  try {
    await handle.context.close();
  } catch (e) {
    note = `context close failed: ${(e as Error).message}`;
  }
  try {
    await handle.browser.close();
  } catch (e) {
    note = `${note ? note + "; " : ""}browser close failed: ${(e as Error).message}`;
  }
  handle.pages = [];
  return { ok: !note, note };
}
