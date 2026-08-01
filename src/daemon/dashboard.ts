/**
 * XR 3.1F — CONTROL CENTER (MISSION CONTROL)
 *
 * This is the definitive browser-based dashboard for the XR Unified AI Operating System.
 * Rebuilt from the ground up from the immutable UX/UI architecture.
 *
 * Core design qualities:
 *  - Professional, Minimal, Calm, Fast, Trustworthy, Transparent, Organized.
 *  - Zero telemetry, local-first by design.
 *  - High-density bento system health matrix (all 12 subsystems visible at a glance).
 *  - Sleek Liquid layout (sidebar nav + topbar breadcrumbs + main views + right rail inspector).
 *  - Inline vector SVG icons — offline-safe, portable, rendering beautifully in sandboxed previews.
 *  - Keyboard-first: Cmd+K palette, contextual help (?), in-composer slash commands (/), focus states.
 *  - Preserves 100% backward compatibility with frozen server-side REST APIs.
 */

import { DISPLAY_VERSION, CORE_VERSION, PKG, versionInfo } from "../core/version.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assetDataUri(name: string): string {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", name);
    if (!existsSync(file)) return "";
    return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

export function dashboardHtml(token: string): string {
  return PAGE
    .replaceAll("__TOKEN__", token)
    .replaceAll("__XR_VERSION__", DISPLAY_VERSION)
    .replaceAll("__XR_CORE_VERSION__", CORE_VERSION)
    .replaceAll("__XR_PKG_NAME__", PKG.name)
    .replaceAll("__XR_REPO__", PKG.repo)
    .replaceAll("__XR_HOMEPAGE__", PKG.homepage)
    .replaceAll("__XR_LOGO__", assetDataUri("logo.png"))
    .replaceAll("__XR_AVATAR__", assetDataUri("avatar.png"));
}

import { DASHBOARD_PAGE as PAGE } from "./dashboard/markup.ts";
import { DASHBOARD_CSS } from "./dashboard/styles.ts";
import { DASHBOARD_SCRIPT } from "./dashboard/client-script.ts";

export { DASHBOARD_PAGE } from "./dashboard/markup.ts";
export { DASHBOARD_CSS } from "./dashboard/styles.ts";
export { DASHBOARD_SCRIPT } from "./dashboard/client-script.ts";

/**
 * Phase 4 · T5 — external asset accessors. The dashboard is served under a
 * strict CSP (`script-src 'self'`): the client application and stylesheet are
 * EXTERNAL assets (never inline), so no `unsafe-inline` is needed anywhere.
 */
export function dashboardCssAsset(): string {
  return DASHBOARD_CSS;
}

export function dashboardScriptAsset(): string {
  return DASHBOARD_SCRIPT;
}
