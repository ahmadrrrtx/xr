#!/usr/bin/env bun
/**
 * XR — Version stamping script
 *
 * Single source of truth flow:
 *   package.json (ultimate source)  →  src/core/version.ts (runtime source) → everything else
 *   website/src/lib/site.ts is also stamped to keep marketing site in sync.
 *
 * Mirrors best practices from:
 *  - Goose (Cargo.toml stamped at build time + canary SHA suffix in CI)
 *  - Tailwind CSS / Vercel CLI (version from package.json at build time)
 *  - Bun (packageManager + .bun-version pin)
 *  - Deno (single source for Node version emulation)
 *
 * Usage:
 *   bun run scripts/set-version.ts
 *   bun run scripts/set-version.ts --check   # CI: fails if out of sync
 *   bun run scripts/set-version.ts --write   # (default) writes files
 *
 * The script is idempotent and preserves codename (defaults to Helios).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PKG_PATH = join(ROOT, "package.json");
const VERSION_TS_PATH = join(ROOT, "src/core/version.ts");
const SITE_TS_PATH = join(ROOT, "website/src/lib/site.ts");

type PkgJson = {
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string } | string;
  author?: string;
  license?: string;
};

function readJson(path: string): PkgJson {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extractCodename(versionTsContent: string): string {
  const m = versionTsContent.match(/codename:\s*["']([^"']+)["']/);
  return m?.[1] ?? "Helios";
}

function buildVersionTs(pkg: PkgJson, codename: string): string {
  const repoUrl =
    typeof pkg.repository === "string"
      ? pkg.repository.replace(/^git\+/, "").replace(/\.git$/, "")
      : pkg.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? "https://github.com/ahmadrrrtx/xr";

  const homepage = pkg.homepage ?? "https://xr-gules.vercel.app";
  const npmUrl = `https://www.npmjs.com/package/${pkg.name}`;
  const description =
    pkg.description ??
    `XR ${pkg.version} — The Unified AI Operating System. Local-first, BYOK, secure desktop automation, persistent RAG memories, and workflow supervisor.`;
  const author = typeof pkg.author === "string" ? pkg.author : "Muhammad Ahmad (@ahmadrrrtx)";
  const license = pkg.license ?? "MIT";

  return `/**
 * XR — SINGLE SOURCE OF TRUTH for version + identity.
 *
 * This file is the authoritative runtime source for all version and identity
 * information. Every other module (CLI, TUI, dashboard, website, MCP, docs)
 * must import from here — no hardcoded duplicates.
 *
 * At release time, \`bun run scripts/set-version.ts\` stamps this file from
 * \`package.json\`, so package.json remains the ultimate source but the runtime
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
  name: "${pkg.name}",
  version: "${pkg.version}",
  codename: "${codename}",
  repo: "${repoUrl}",
  homepage: "${homepage}",
  npm: "${npmUrl}",
  description: ${JSON.stringify(description)},
  author: ${JSON.stringify(author)},
  license: "${license}",
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

/** Human-facing version string for \`xr version\` and dashboard. */
export const DISPLAY_VERSION = \`\${PKG.version} (\${PKG.codename})\`;

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

/** Used by \`xr version --json\`, \`xr --json\`, and the daemon /api/overview. */
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
`;
}

function updateWebsiteSiteTs(pkg: PkgJson, codename: string): void {
  if (!existsSync(SITE_TS_PATH)) {
    console.warn(`[set-version] website file not found, skipping: ${SITE_TS_PATH}`);
    return;
  }
  let src = readFileSync(SITE_TS_PATH, "utf8");

  const repoUrl =
    typeof pkg.repository === "string"
      ? pkg.repository.replace(/^git\+/, "").replace(/\.git$/, "")
      : pkg.repository?.url?.replace(/^git\+/, "").replace(/\.git$/, "") ?? "https://github.com/ahmadrrrtx/xr";
  const homepage = pkg.homepage ?? "https://xr-gules.vercel.app";
  const npmUrl = `https://www.npmjs.com/package/${pkg.name}`;

  // Replace version identity
  src = src.replace(/version:\s*["'][^"']+["']/, `version: "${pkg.version}"`);
  src = src.replace(/codename:\s*["'][^"']+["']/, `codename: "${codename}"`);
  src = src.replace(/displayVersion:\s*["'][^"']+["']/, `displayVersion: "${pkg.version} (${codename})"`);
  src = src.replace(/Version:\s*[^\n*]+— from src\/core\/version\.ts/, `Version: ${pkg.version} (${codename}) — from src/core/version.ts`);

  // Replace github
  src = src.replace(/github:\s*["'][^"']+["']/, `github: "${repoUrl}"`);

  // Replace npm
  src = src.replace(/npm:\s*["'][^"']+["']/, `npm: "${npmUrl}"`);

  // Replace url
  src = src.replace(/url:\s*["'][^"']+["']/, `url: "${homepage}"`);

  // Replace twitter if needed (keep author)
  // Replace tagline to real identity if still fake
  if (src.includes("The Agentic Runtime for Software")) {
    src = src.replace(
      /tagline:\s*["'][^"']+["']/,
      `tagline: "The AI Agent You Can Actually Trust — BYOK, local-first, secure"`,
    );
  }
  if (src.includes("12,000+ skills")) {
    src = src.replace(
      /description:\s*\n?\s*["'][^"']+["'],?/m,
      `description: "XR is an open-source, local-first AI operating system — BYOK, secure, with persistent memory, research, voice, plugins, MCP, multi-agent runtime, and workflow automation. Built on Bun + TypeScript + SQLite.",`,
    );
  }

  // Fix installCmd
  src = src.replace(/installCmd:\s*["'][^"']+["']/, `installCmd: "npm i -g ${pkg.name} && xr"`);

  writeFileSync(SITE_TS_PATH, src, "utf8");
  console.log(`[set-version] stamped website/src/lib/site.ts → v${pkg.version}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");

  const pkg = readJson(PKG_PATH);
  console.log(`[set-version] package.json → ${pkg.name}@${pkg.version}`);

  const existingVersionTs = existsSync(VERSION_TS_PATH) ? readFileSync(VERSION_TS_PATH, "utf8") : "";
  const codename = extractCodename(existingVersionTs);

  const nextContent = buildVersionTs(pkg, codename);

  if (checkMode) {
    if (existingVersionTs.trim() === nextContent.trim()) {
      console.log(`[set-version] ✓ src/core/version.ts is in sync (v${pkg.version} ${codename})`);
      // Also check website?
      if (existsSync(SITE_TS_PATH)) {
        const siteContent = readFileSync(SITE_TS_PATH, "utf8");
        if (
          siteContent.includes(`version: "${pkg.version}"`) &&
          siteContent.includes(`codename: "${codename}"`) &&
          siteContent.includes(`displayVersion: "${pkg.version} (${codename})"`) &&
          siteContent.includes(pkg.name) &&
          siteContent.includes("github.com/ahmadrrrtx/xr")
        ) {
          console.log(`[set-version] ✓ website/src/lib/site.ts looks in sync`);
        } else {
          console.error(`[set-version] ✗ website/src/lib/site.ts out of sync`);
          process.exit(1);
        }
      }
      process.exit(0);
    } else {
      console.error(`[set-version] ✗ src/core/version.ts out of sync`);
      console.error(`  expected version: ${pkg.version} (${codename})`);
      console.error(`  run: bun run scripts/set-version.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(VERSION_TS_PATH, nextContent, "utf8");
    console.log(`[set-version] wrote ${VERSION_TS_PATH} → v${pkg.version} (${codename})`);
    updateWebsiteSiteTs(pkg, codename);

    // Verify dashboard and other places don't need stamping — they import from version.ts now
    console.log(`[set-version] done. All consumers import from src/core/version.ts`);
    console.log(`  - CLI: src/cli/catalog.ts → CORE_VERSION`);
    console.log(`  - Kernel: src/core/kernel.ts → CORE_VERSION`);
    console.log(`  - MCP: src/mcp/client.ts → CORE_VERSION`);
    console.log(`  - Dashboard: src/daemon/dashboard.ts → DISPLAY_VERSION`);
    console.log(`  - BusinessOS: src/business/index.ts → PKG.version`);
  }
}

main();
