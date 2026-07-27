/**
 * XR — SINGLE SOURCE OF TRUTH for version + identity.
 *
 * This file is the authoritative runtime source for all version and identity
 * information. Every other module (CLI, TUI, dashboard, website, MCP, docs)
 * must import from here — no hardcoded duplicates.
 *
 * At release time, `bun run scripts/set-version.ts` stamps this file from
 * `package.json`, so package.json remains the ultimate source but the runtime
 * always reads from here. This mirrors how Goose stamps Cargo.toml,
 * how Tailwind/Vercel CLI stamp from package.json, and how Deno maintains
 * a single source of truth for its emulated Node version.
 *
 * Replaces six contradictory version strings previously found across:
 *   package.json (3.1.5), src/core/kernel.ts (3.1.5),
 *   src/core/version.ts (1.0.0), src/cli/catalog.ts (3.1.5 + 3.1C),
 *   src/business/index.ts (15.0.0), website/src/lib/site.ts (3.1.0)
 */

export const PKG = {
  name: "@rrrtx/xr",
  version: "5.2.0",
  codename: "Capability Ecosystem",
  repo: "https://github.com/ahmadrrrtx/xr",
  homepage: "https://xr-gules.vercel.app",
  npm: "https://www.npmjs.com/package/@rrrtx/xr",
  description: "XR 5.2 (Capability Ecosystem) — a trusted, discoverable, testable, composable capability ecosystem for plugins, skills, MCP servers, providers, tools, workflows, integrations, and artifact transforms: common inspectable descriptors; publisher/provenance/package-integrity metadata; declared-vs-effective authority; dependency/compatibility inspection; evidence-based discovery; certification contract tests; safe install/update/disable/quarantine/rollback; and CLI/daemon/dashboard inspection, all routed through existing execution, trust, durability, context, workflow, marketplace, signing, and permission systems without introducing Phase 10 business/control-plane capabilities.",
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

/** Used by `xr version --json`, `xr --json`, and the daemon /api/overview. */
export function versionInfo() {
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
  } as const;
}

export type VersionInfo = ReturnType<typeof versionInfo>;

/** Legacy exports for backward-compat — do not use in new code, use PKG / CORE_VERSION. */
export const VERSION = CORE_VERSION;
export const XR_VERSION_LEGACY = CORE_VERSION;
export const XR_CODENAME_LEGACY = CODENAME;
