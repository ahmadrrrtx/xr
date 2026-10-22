#!/usr/bin/env bun
/**
 * XR-LAUNCH-009 gate — the production desktop bundle carries no demo data.
 *
 *   bun run scripts/desktop-seed-gate.ts [distDir]   (default: desktop/dist)
 *
 * Run it after `vite build` (production mode). Every seed generator sits
 * behind `import.meta.env.DEV`, so its content must be absent from the build.
 * Each probe string is also required to still exist in its seed source; if a
 * seed is reworded the gate fails loudly instead of silently passing forever.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/** [seed source (repo-relative), probe string only that seed produces]. */
export const SEED_PROBES: ReadonlyArray<readonly [string, string]> = [
  ["desktop/src/runs/seed.ts", "agentic AI trust frameworks"],
  ["desktop/src/runs/seed.ts", "xr-runs-seed-v1"],
  ["desktop/src/runs/seed.ts", "claude-3.5-sonnet"],
  ["desktop/src/budget/seed.ts", "client-acme"],
  ["desktop/src/shield/seed.ts", "~/Documents/contracts"],
  ["desktop/src/shield/seed.ts", "No publisher signature"],
  ["desktop/src/shield/seed.ts", "Identity could not be established"],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|html|css|json|map)$/.test(name) && !name.endsWith(".map")) out.push(p);
  }
  return out;
}

export function scanDist(dist: string): { stale: string[]; hits: string[] } {
  const stale: string[] = [];
  for (const [src, probe] of SEED_PROBES) {
    const file = join(ROOT, src);
    if (!existsSync(file) || !readFileSync(file, "utf8").includes(probe)) stale.push(`${src}: "${probe}"`);
  }
  const hits: string[] = [];
  for (const file of walk(dist)) {
    const text = readFileSync(file, "utf8");
    for (const [src, probe] of SEED_PROBES) {
      if (text.includes(probe)) hits.push(`${relative(ROOT, file)} contains "${probe}" (from ${src})`);
    }
  }
  return { stale, hits };
}

if (import.meta.main) {
  const dist = resolve(process.argv[2] ?? join(ROOT, "desktop", "dist"));
  if (!existsSync(dist) || walk(dist).length === 0) {
    console.error(`desktop-seed-gate: no build output at ${dist} — run \`vite build\` first.`);
    process.exit(2);
  }
  const { stale, hits } = scanDist(dist);
  if (stale.length) {
    console.error("desktop-seed-gate: probe strings no longer found in their seed source (update SEED_PROBES):");
    for (const s of stale) console.error(`  - ${s}`);
  }
  if (hits.length) {
    console.error("desktop-seed-gate: demo/seed data found in the production bundle (XR-LAUNCH-009):");
    for (const h of hits) console.error(`  - ${h}`);
  }
  if (stale.length || hits.length) process.exit(1);
  console.log(`desktop-seed-gate: OK — ${SEED_PROBES.length} seed probes absent from ${relative(ROOT, dist) || dist}.`);
}
