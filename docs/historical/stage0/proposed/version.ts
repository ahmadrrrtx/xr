/**
 * XR — SINGLE SOURCE OF TRUTH for version + identity.
 *
 * Replaces the six contradictory version strings found across
 * package.json, src/core/kernel.ts, src/core/version.ts (1.0.0),
 * src/index.ts (3.1C), src/business/index.ts (15.0.0) and the website (3.1.0).
 *
 * Stamp it from package.json at build time via scripts/set-version.ts so the
 * runtime, CLI, website and README can never drift again.
 */

export const PKG = {
  name: "@rrrtx/xr",
  version: "3.1.5", // <-- the ONLY place the runtime version is authored
  codename: "Helios",
  repo: "https://github.com/ahmadrrrtx/xr",
  homepage: "https://xr-gules.vercel.app",
  npm: "https://www.npmjs.com/package/@rrrtx/xr",
} as const;

/** Runtime/package version. Replaces the duplicated XRKernel.VERSION. */
export const CORE_VERSION: string = PKG.version;

/**
 * Host ABI version exposed to plugins (see src/plugins/host.ts).
 * Bump ONLY when the host surface (PluginHost / capabilities) changes in a
 * breaking way, so XR can deterministically refuse an incompatible plugin.
 */
export const PLUGIN_API_VERSION = 2;

/** Human-facing version string. */
export const DISPLAY_VERSION = `${PKG.version} (${PKG.codename})`;

/** Used by `xr version --json` and the daemon /api/overview. */
export function versionInfo() {
  return {
    name: PKG.name,
    version: PKG.version,
    codename: PKG.codename,
    display: DISPLAY_VERSION,
    repo: PKG.repo,
    homepage: PKG.homepage,
    pluginApi: PLUGIN_API_VERSION,
  };
}
