#!/usr/bin/env bun
/**
 * XR Phase 9 · T3 — channel renderer CLI.
 *
 * The channel FILES themselves are stamp targets (see release.manifest.json):
 * `bun run release:stamp` regenerates them and `bun run release:check` fails on
 * drift. This CLI adds the two release-pipeline operations that are not
 * identity stamping:
 *
 *   bun run scripts/channel-render.ts --print packaging/scoop/xr.json
 *       Print a rendered channel file (review/debug).
 *
 *   bun run scripts/channel-render.ts --fill-hashes <hashes.json> --dest <dir>
 *       Render every channel file and pin real sha256 digests from a release's
 *       hashes.json (produced by scripts/release-build.ts). Refuses to emit any
 *       file that still contains a __SHA256_…__ placeholder — no unpinned
 *       channel is ever published (Part 20).
 *
 *   bun run scripts/channel-render.ts --fill-release-date YYYY-MM-DD <file>
 *       (used with --fill-hashes) fills the WinGet __RELEASE_DATE__ token.
 *
 * Exit codes: 0 success; 1 any failure (fail closed).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { ROOT, loadManifest } from "./release-manifest.ts";
import {
  renderChannelFiles,
  renderSupportMatrix,
  renderDistributionModule,
  fillHashes,
  type ReleaseHashes,
  type MinimalManifest,
} from "./distribution-model.ts";

export function renderAll(manifest: MinimalManifest): Record<string, string> {
  return {
    ...renderChannelFiles(manifest),
    "docs/release/SUPPORT_MATRIX.md": renderSupportMatrix(manifest),
    "website/src/lib/distribution.ts": renderDistributionModule(manifest),
  };
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();

  if (typeof args.print === "string") {
    const all = renderAll(manifest as unknown as MinimalManifest);
    const content = all[args.print];
    if (content === undefined) {
      console.error(`[channel-render] "${args.print}" is not a generated channel file. Known files:`);
      for (const p of Object.keys(all)) console.error(`  ${p}`);
      process.exit(1);
    }
    process.stdout.write(content);
    return;
  }

  if (typeof args["fill-hashes"] === "string" && typeof args.dest === "string") {
    const hashesPath = args["fill-hashes"];
    if (!existsSync(hashesPath)) {
      console.error(`[channel-render] hashes.json not found: ${hashesPath}`);
      process.exit(1);
    }
    const hashes = JSON.parse(readFileSync(hashesPath, "utf8")) as ReleaseHashes;
    if (hashes.version !== manifest.identity.version) {
      console.error(
        `[channel-render] hashes.json version ${hashes.version} != manifest version ${manifest.identity.version} — refusing (channel drift, Art. XXII.1)`,
      );
      process.exit(1);
    }
    const releaseDate = typeof args["fill-release-date"] === "string" ? args["fill-release-date"] : undefined;
    const all = renderAll(manifest as unknown as MinimalManifest);
    let written = 0;
    for (const [relPath, content] of Object.entries(all)) {
      // docs/website/stamp surfaces are not "published channels"; only the
      // packaging/** channel files are staged for publishing.
      if (!relPath.startsWith("packaging/")) continue;
      let pinned = fillHashes(content, hashes);
      if (releaseDate) pinned = pinned.split("__RELEASE_DATE__").join(releaseDate);
      if (pinned.includes("__RELEASE_DATE__")) {
        console.error(`[channel-render] ${relPath}: __RELEASE_DATE__ unresolved (pass --fill-release-date)`);
        process.exit(1);
      }
      const out = join(args.dest as string, relPath);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, pinned, "utf8");
      written++;
    }
    console.log(`[channel-render] pinned ${written} channel file(s) from ${hashesPath} → ${args.dest}`);
    return;
  }

  console.log(`usage:
  bun run scripts/channel-render.ts --print <path>
  bun run scripts/channel-render.ts --fill-hashes <hashes.json> --dest <dir> [--fill-release-date YYYY-MM-DD]`);
  process.exit(1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[channel-render] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
