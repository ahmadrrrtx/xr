/**
 * XR · Article V.3 size gate — reconstructed 2026-09-20 (Phase 5) after the
 * session-boundary loss; API pinned by test/architecture/size-gate.test.ts:
 *
 *   · THRESHOLD must equal docs/perf/SIZE-WAIVERS.json#threshold
 *   · checkSizes() → { unwaived, grown, staleWaivers, malformedWaivers }
 *
 * Semantics (constitutional): a module over THRESHOLD lines needs an OWNED
 * waiver; a waived module may never GROW; a waiver for a now-small module is
 * stale rot; a waiver without owner/reason/plan/review-date is malformed.
 *
 * CLI addition (Phase 5): the desktop bundle caps (entry ≤ 350 kB, lazy
 * ≤ 750 kB) are reported as the second half of the gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const THRESHOLD = 800;
const ROOT = resolve(import.meta.dir, "..");
const REGISTER_PATH = join(ROOT, "docs/perf/SIZE-WAIVERS.json");

export interface Waiver {
  path: string;
  lines: number;
  owner: string;
  reason: string;
  plan: string;
  review: string;
}
export interface ModuleSize {
  path: string;
  lines: number;
}
export interface SizeReport {
  unwaived: ModuleSize[];
  grown: ModuleSize[];
  staleWaivers: string[];
  malformedWaivers: string[];
  over: ModuleSize[];
}

function countLines(abs: string): number {
  const text = readFileSync(abs, "utf8");
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

function walkSrc(dir: string, out: ModuleSize[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkSrc(abs, out);
    else if (name.endsWith(".ts")) {
      out.push({ path: abs.slice(ROOT.length + 1).split("\\").join("/"), lines: countLines(abs) });
    }
  }
}

export function scanModules(): ModuleSize[] {
  const out: ModuleSize[] = [];
  walkSrc(join(ROOT, "src"), out);
  return out.sort((a, b) => b.lines - a.lines);
}

export function checkSizes(): SizeReport {
  const register = JSON.parse(readFileSync(REGISTER_PATH, "utf8")) as {
    threshold: number;
    waivers: Waiver[];
  };
  const waived = new Map(register.waivers.map((w) => [w.path, w]));
  const modules = scanModules();
  const current = new Map(modules.map((m) => [m.path, m.lines]));

  const over = modules.filter((m) => m.lines > THRESHOLD);
  const unwaived = over.filter((m) => !waived.has(m.path));

  const grown: ModuleSize[] = [];
  const staleWaivers: string[] = [];
  for (const w of register.waivers) {
    const now = current.get(w.path);
    if (now === undefined || now <= THRESHOLD) staleWaivers.push(w.path);
    else if (now > w.lines) grown.push({ path: w.path, lines: now });
  }

  const malformedWaivers = register.waivers
    .filter(
      (w) =>
        !w.owner.trim() ||
        w.reason.length <= 20 ||
        w.plan.length <= 20 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(w.review),
    )
    .map((w) => w.path);

  return { unwaived, grown, staleWaivers, malformedWaivers, over };
}

/* ── Phase 5 · desktop bundle caps (interactive-shell startup budget) ─────── */

export const BUNDLE_CAPS = { entryKb: 350, lazyKb: 750 };

export function checkBundles(): { ok: boolean; lines: string[] } {
  const dir = join(ROOT, "desktop/dist/assets");
  const lines: string[] = [];
  let ok = true;
  if (!existsSync(dir)) return { ok: false, lines: ["desktop/dist missing — run `bun run build` in desktop/ first"] };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const kb = Math.round(statSync(join(dir, f)).size / 1024);
    const isEntry = f.startsWith("index");
    const cap = isEntry ? BUNDLE_CAPS.entryKb : BUNDLE_CAPS.lazyKb;
    if (kb > cap) ok = false;
    lines.push(`${kb > cap ? "✗" : "✓"} ${f} ${kb} kB (cap ${cap} kB, ${isEntry ? "entry" : "lazy"})`);
  }
  return { ok, lines };
}

if (import.meta.main) {
  const r = checkSizes();
  console.log(`[size-gate] threshold ${THRESHOLD} LOC · ${scanModules().length} modules scanned`);
  for (const m of r.over) console.log(`  over: ${m.path} (${m.lines} lines${r.unwaived.some((u) => u.path === m.path) ? ", UNWAIVED" : ", waived"})`);
  const bad = r.unwaived.length + r.grown.length + r.staleWaivers.length + r.malformedWaivers.length;
  console.log(bad === 0 ? "[size-gate] source gate OK" : `[size-gate] FAIL: unwaived=${r.unwaived.length} grown=${r.grown.length} stale=${r.staleWaivers.length} malformed=${r.malformedWaivers.length}`);
  const b = checkBundles();
  for (const l of b.lines) console.log("  " + l);
  console.log(b.ok ? "[size-gate] bundle gate OK" : "[size-gate] bundle gate FAIL");
  process.exit(bad === 0 && b.ok ? 0 : 1);
}
