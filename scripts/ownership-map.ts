#!/usr/bin/env bun
/**
 * XR Phase 8 · T5 — public ownership map.
 *
 * `CODEOWNERS` already routes every PR to an accountable reviewer, but a
 * *.github*-flavoured file is an awkward human reference: nobody should have
 * to parse glob syntax to answer "who owns the daemon?". This script
 * generates `docs/OWNERSHIP.md` — the public, human-readable ownership map —
 * FROM `CODEOWNERS` (single source of truth) plus a structural scan of the
 * repository's top-level areas.
 *
 * Guarantees enforced (exit 1 on violation):
 *   1. A default `*` owner exists (every byte has an accountable human).
 *   2. Every top-level area of src/, test/, scripts/, extensions/ resolves to
 *      at least one owner (explicit entry or the default).
 *   3. `--check`: the committed docs/OWNERSHIP.md matches a regeneration —
 *      ownership drift fails CI, like every other generated surface.
 *
 * Usage: bun run scripts/ownership-map.ts [--check]
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DOC_PATH = join(ROOT, "docs", "OWNERSHIP.md");
const SCAN_ROOTS = ["src", "test", "scripts", "extensions"] as const;

interface OwnerEntry {
  pattern: string;
  owners: string[];
}

function parseCodeowners(text: string): OwnerEntry[] {
  const entries: OwnerEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    entries.push({ pattern: parts[0], owners: parts.slice(1) });
  }
  return entries;
}

function topLevelAreas(root: string): string[] {
  const abs = join(ROOT, root);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((d) => !d.name.startsWith("."))
    .map((d) => `${root}/${d.name}${d.isDirectory() ? "/" : ""}`)
    .sort();
}

/**
 * Resolve CODEOWNERS the way GitHub does: LAST matching pattern wins, where a
 * pattern like `/src/core/` matches the directory exactly or by prefix.
 * We additionally treat a plain `*` as the default owner. Returns the winner
 * and whether it was an explicit (non-`*`) entry.
 */
function resolveOwner(area: string, entries: OwnerEntry[]): { owners: string[]; explicit: boolean } | null {
  const normArea = `/${area.replace(/\/$/, "")}/`;
  let owners: string[] | null = null;
  let explicit = false;
  for (const e of entries) {
    if (e.pattern === "*") {
      owners = e.owners;
      explicit = false;
      continue;
    }
    let p = e.pattern;
    if (!p.startsWith("/")) p = `/${p}`;
    const pDir = p.endsWith("/") ? p : `${p}/`;
    if (normArea === pDir || normArea.startsWith(pDir)) {
      owners = e.owners;
      explicit = true;
    }
  }
  return owners ? { owners, explicit } : null;
}

function render(areas: Array<{ area: string; owners: string[]; explicit: boolean }>, entries: OwnerEntry[]): string {
  const defaultOwners = entries.find((e) => e.pattern === "*")?.owners ?? [];
  const rows = areas
    .map(
      (a) =>
        `| \`${a.area}\` | ${a.owners.join(", ")} | ${a.explicit ? "explicit entry" : `default (${defaultOwners.join(", ")})`} |`,
    )
    .join("\n");

  return `# Ownership Map — XR

**Generated from [\`CODEOWNERS\`](../CODEOWNERS) by \`scripts/ownership-map.ts\` — do not edit by hand.**
Regenerate with \`bun run scripts/ownership-map.ts\`; CI's \`--check\` fails on drift.

Every top-level area of \`src/\`, \`test/\`, \`scripts/\`, and \`extensions/\` has exactly one
accountable owner at PR-review time (Constitution: *one responsibility, one owner per subsystem*).
"Default" means the catch-all \`*\` owner in \`CODEOWNERS\`; "explicit" means a dedicated entry.

## Areas

| Area | Owner(s) | Coverage |
|---|---|---|
${rows}

## How ownership is exercised

- **Reviews:** GitHub requests the listed owners on any PR touching the area (\`CODEOWNERS\`).
- **Trust boundary areas** (\`src/security/\`, \`src/trust/\`, \`src/core/\`, credential and release
  surfaces) carry explicit entries and demand adversarial tests with any change — see
  [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Generated surfaces** (release identity, API schema/client, this map) have exactly one
  generator script each; editing generated output by hand is a drift violation.

## Adding an area

1. Create the directory under its architectural layer (see CONTRIBUTING.md §Architecture boundaries).
2. If it is a new accountable ownership boundary, add an explicit \`CODEOWNERS\` entry with a
   comment naming the owning responsibility. Otherwise the default owner covers it.
3. Run \`bun run scripts/ownership-map.ts\` to regenerate this file. CI enforces sync.
`;
}

function main(): void {
  const checkMode = process.argv.includes("--check");
  const codeownersPath = join(ROOT, "CODEOWNERS");
  if (!existsSync(codeownersPath)) {
    console.error("FAIL ownership-map: CODEOWNERS is missing");
    process.exit(1);
  }
  const entries = parseCodeowners(readFileSync(codeownersPath, "utf8"));

  // Guarantee 1 — a default owner exists.
  if (!entries.some((e) => e.pattern === "*" && e.owners.length > 0)) {
    console.error("FAIL ownership-map: CODEOWNERS has no default `*` owner — unowned bytes would pass review");
    process.exit(1);
  }

  // Guarantee 2 — every top-level area resolves to an owner.
  const areas: Array<{ area: string; owners: string[]; explicit: boolean }> = [];
  const unowned: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const area of topLevelAreas(root)) {
      const hit = resolveOwner(area, entries);
      if (!hit || hit.owners.length === 0) {
        unowned.push(area);
        continue;
      }
      areas.push({ area, owners: hit.owners, explicit: hit.explicit });
    }
  }
  if (unowned.length > 0) {
    console.error(`FAIL ownership-map: unowned top-level areas: ${unowned.join(", ")}`);
    process.exit(1);
  }

  const rendered = render(areas, entries);
  if (checkMode) {
    const committed = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";
    if (committed !== rendered) {
      console.error(`FAIL ownership-map: ${relative(ROOT, DOC_PATH)} is out of sync — run \`bun run scripts/ownership-map.ts\``);
      process.exit(1);
    }
    console.log(`[ownership-map] ✓ docs/OWNERSHIP.md in sync · ${areas.length} areas owned`);
  } else {
    writeFileSync(DOC_PATH, rendered);
    console.log(`[ownership-map] wrote ${relative(ROOT, DOC_PATH)} · ${areas.length} areas owned`);
  }
}

main();
