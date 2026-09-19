/**
 * XR — is browser control actually usable on THIS machine, right now?
 *
 * WHY THIS IS ITS OWN MODULE
 * ─────────────────────────────────────────────────────────────────────────────
 * The probe is a capability claim, so it has to be true, cheap, and testable in
 * isolation. Keeping it out of `browser.ts` also keeps that file under its size
 * waiver while the probe stays fully documented.
 *
 * WHAT WAS WRONG BEFORE
 * ─────────────────────────────────────────────────────────────────────────────
 * The original probe returned `{ available: true }` unconditionally: the first
 * branch only proved that the *package* resolved, and the fallback
 *
 *     try { return { available: true }; } catch { return { available: false } }
 *
 * could never throw, so the negative branch was unreachable dead code. Two
 * user-visible lies followed:
 *   · `xr control browser` printed "✓ installed" with no browser on disk;
 *   · `ensurePage()` skipped its own gate, so the failure surfaced later as an
 *     opaque launch error instead of an honest, actionable status.
 *
 * The browsers root is read from the environment ON EVERY CALL. Playwright's
 * registry snapshots `PLAYWRIGHT_BROWSERS_PATH` the first time it is loaded, so
 * a per-call check is the only one that stays honest (and testable) after
 * playwright has been imported — which is exactly what the negative-path test in
 * test/control/browser.test.ts injects.
 */
import { join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

/** A `chromium*` build directory that actually contains a browser executable. */
function hasChromiumBuild(root: string): boolean {
  const execHints = [
    ["chrome-linux", "chrome"],
    ["chrome-linux", "headless_shell"],
    ["chrome-win", "chrome.exe"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  ];
  try {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith("chromium")) continue;
      if (execHints.some((hint) => existsSync(join(root, entry, ...hint)))) return true;
      // Unusual packaging (custom arch/channel): prefer a populated build
      // directory over a false negative.
      try {
        if (readdirSync(join(root, entry)).length > 0) return true;
      } catch {
        /* unreadable — keep looking */
      }
    }
  } catch {
    return false; // root does not exist → no browsers, full stop
  }
  return false;
}

/** The directory Playwright resolves browser builds from, for THIS call. */
export function playwrightBrowsersRoot(): string {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (env === "0") return join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
  if (env) return resolve(env);
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "ms-playwright");
  }
  if (process.platform === "darwin") return join(home, "Library", "Caches", "ms-playwright");
  return join(home, ".cache", "ms-playwright");
}

/** True only when both the package AND a downloaded Chromium build are present. */
export function browserAvailable(): { available: boolean; reason?: string } {
  const pkgMissing = "playwright not installed — run: xr control browser install";
  try {
    // @ts-ignore — Bun exposes require.resolve inside ESM
    if (typeof require === "undefined" || !require.resolve) return { available: false, reason: pkgMissing };
    // @ts-ignore
    require.resolve("playwright");
  } catch {
    return { available: false, reason: pkgMissing };
  }

  const root = playwrightBrowsersRoot();
  if (!hasChromiumBuild(root)) {
    return {
      available: false,
      reason: `playwright browser binaries not found under ${root} — run: bunx playwright install chromium`,
    };
  }
  return { available: true };
}
