/**
 * XR — SINGLE SOURCE OF TRUTH for version + identity (runtime view).
 *
 * GENERATED FILE — do not edit by hand.
 * Source: release.manifest.json  ·  Regenerate: bun run release:stamp
 *
 * Constitution Article XXII.1 requires one release manifest to stamp version
 * across version.ts, package.json, README, installers and website, with CI
 * failing on drift. Editing this file directly reintroduces the drift that
 * Phase 0 exists to eliminate.
 */

export const PKG = {
  name: "@rrrtx/xr",
  version: "1.0.0",
  codename: "Truth",
  repo: "https://github.com/ahmadrrrtx/xr",
  homepage: "https://xr-gules.vercel.app",
  npm: "https://www.npmjs.com/package/@rrrtx/xr",
  description: "XR — a local-first, provider-neutral AI agent runtime. BYOK, spend-capped, tamper-evident audit, plugin/MCP extensibility.",
  author: "Muhammad Ahmad (@ahmadrrrtx)",
  license: "MIT",
} as const;

/** Runtime/package version. All code should use this, not XRKernel.VERSION directly. */
export const CORE_VERSION: string = PKG.version;

/** CLI codename — human friendly release name. */
export const CODENAME: string = PKG.codename;

/**
 * Host ABI version exposed to plugins (see src/plugins/host.ts).
 * Bump ONLY when the host surface (PluginHost / capabilities) changes in a
 * breaking way, so XR can deterministically refuse an incompatible plugin.
 */
export const PLUGIN_API_VERSION = 2;

/** Human-facing version string for `xr version` and dashboard. */
export const DISPLAY_VERSION = `${PKG.version} (${PKG.codename})`;

/** Compact identity object for cross-cutting use (website, CLI, dashboard, --json). */
export const PKG_IDENTITY = {
  name: PKG.name,
  version: PKG.version,
  codename: PKG.codename,
  repo: PKG.repo,
  homepage: PKG.homepage,
  npm: PKG.npm,
  displayVersion: DISPLAY_VERSION,
  description: PKG.description,
  author: PKG.author,
  license: PKG.license,
} as const;

export interface VersionInfo {
  name: string;
  version: string;
  codename: string;
  display: string;
  displayVersion: string;
  repo: string;
  homepage: string;
  npm: string;
  description: string;
  author: string;
  license: string;
  pluginApi: number;
}

/** Structured version payload for `--json` surfaces. */
export function versionInfo(): VersionInfo {
  return {
    name: PKG.name,
    version: PKG.version,
    codename: PKG.codename,
    display: DISPLAY_VERSION,
    displayVersion: DISPLAY_VERSION,
    repo: PKG.repo,
    homepage: PKG.homepage,
    npm: PKG.npm,
    description: PKG.description,
    author: PKG.author,
    license: PKG.license,
    pluginApi: PLUGIN_API_VERSION,
  };
}
