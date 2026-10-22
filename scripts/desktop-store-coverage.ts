#!/usr/bin/env bun
/**
 * XR-LAUNCH-026 — coverage floor for desktop/src/stores.
 *
 * Runs the desktop frontend tests (test/desktop) with bun's lcov coverage and
 * compares line coverage of each store listed in desktop/coverage-floor.json
 * against its floor. The floor is a RATCHET: it may only go up. `--update`
 * raises floors to the measured value (rounded down to a whole percent) and
 * refuses to lower any.
 *
 *   bun run scripts/desktop-store-coverage.ts            # check (CI)
 *   bun run scripts/desktop-store-coverage.ts --update   # raise floors after adding tests
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const FLOOR_FILE = join(ROOT, "desktop", "coverage-floor.json");

type Floors = { $comment?: string; stores: Record<string, number> };

export function parseLcov(text: string, root: string): Map<string, { hit: number; found: number }> {
  const out = new Map<string, { hit: number; found: number }>();
  let file = "";
  let hit = 0;
  let found = 0;
  for (const raw of text.split(/\r?\n/)) {
    const ln = raw.trim();
    if (ln.startsWith("SF:")) { file = relative(root, ln.slice(3).startsWith("/") ? ln.slice(3) : join(root, ln.slice(3))).replace(/\\/g, "/"); hit = found = 0; }
    else if (ln.startsWith("LF:")) found = Number(ln.slice(3));
    else if (ln.startsWith("LH:")) hit = Number(ln.slice(3));
    else if (ln === "end_of_record" && file) { out.set(file, { hit, found }); file = ""; }
  }
  return out;
}

export function compare(floors: Floors, measured: Map<string, { hit: number; found: number }>): { violations: string[]; pct: Record<string, number> } {
  const violations: string[] = [];
  const pct: Record<string, number> = {};
  for (const [file, floor] of Object.entries(floors.stores)) {
    const m = measured.get(file);
    if (!m || m.found === 0) { violations.push(`${file}: not exercised by any desktop test (floor ${floor}%)`); continue; }
    const p = (100 * m.hit) / m.found;
    pct[file] = p;
    if (p + 1e-9 < floor) violations.push(`${file}: ${p.toFixed(1)}% line coverage < floor ${floor}%`);
  }
  return { violations, pct };
}

if (import.meta.main) {
  const update = process.argv.includes("--update");
  const floors = JSON.parse(readFileSync(FLOOR_FILE, "utf8")) as Floors;
  const dir = mkdtempSync(join(tmpdir(), "xr-desktop-cov-"));
  try {
    const r = Bun.spawnSync([process.execPath, "test", "test/desktop", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${dir}`], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) { console.error(`[desktop-coverage] desktop tests failed (exit ${r.exitCode})`); process.exit(1); }
    const measured = parseLcov(readFileSync(join(dir, "lcov.info"), "utf8"), ROOT);
    const { violations, pct } = compare(floors, measured);
    for (const [f, p] of Object.entries(pct)) console.log(`[desktop-coverage] ${f.padEnd(40)} ${p.toFixed(1)}% (floor ${floors.stores[f]}%)`);
    if (update) {
      for (const [f, p] of Object.entries(pct)) floors.stores[f] = Math.max(floors.stores[f]!, Math.floor(p));
      writeFileSync(FLOOR_FILE, JSON.stringify(floors, null, 2) + "\n");
      console.log("[desktop-coverage] floors raised (never lowered)");
    }
    if (violations.length) {
      for (const v of violations) console.error(`[desktop-coverage] ✗ ${v}`);
      process.exit(1);
    }
    console.log(`[desktop-coverage] OK — ${Object.keys(floors.stores).length} store floors met`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
