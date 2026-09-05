#!/usr/bin/env bun
/**
 * XR Phase 2 · T7 — module size/complexity gate.
 *
 * Constitution Art. V.3: *"No module exceeds a defined size/complexity
 * threshold without an owned plan to split."*
 *
 * The gate is deliberately two-tier, because Art. V.3 permits an
 * over-threshold module **with an owned plan** — it does not demand that every
 * module be under the line today:
 *
 *   · Any module over THRESHOLD that is NOT in the waiver register  → FAIL
 *   · Any waived module that has GROWN since its waiver was recorded → FAIL
 *     (a waiver is permission to be big, never permission to get bigger)
 *   · A waiver with no owner, no reason, or no review date           → FAIL
 *   · A waiver for a file that is now under threshold                → FAIL
 *     (stale waivers must be removed, so the register stays truthful)
 *
 * That last rule matters: a register full of obsolete entries is exactly the
 * "green but not true" signal this project exists to eliminate.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const REGISTER = join(ROOT, "docs/perf/SIZE-WAIVERS.json");

/** Lines of code per module. */
export const THRESHOLD = 800;

/**
 * ── Phase 5 · the TREE ceiling (ADR-0028) ───────────────────────────────────
 *
 * The per-module threshold above says nothing about total size: a repo can be
 * 500k LOC with every file under 800 and pass. Phase 5 removed 23,376 LOC of
 * userless surface from core, and the only thing that keeps that won is a
 * ceiling on the whole tree — otherwise the sprawl grows back one compliant
 * 799-line module at a time, which is exactly how it arrived.
 *
 * The number is MEASURED, not aspirational. The Phase 5 plan targeted
 * "≤ ~110,000 LOC", written against a 149,722-LOC tree four phases stale; the
 * tree was 154,426 when the phase began, and extracting everything the plan
 * listed would still have landed near 124k. Gating on 110k would have meant
 * either failing the build forever or deleting genuine runtime to satisfy an
 * estimate — so the gate holds the line actually achieved, and the roadmap
 * keeps 110k as a direction of travel (docs/historical/phase-5/loc-census.md).
 *
 * Raising this number is allowed — it just has to be a decision someone makes
 * on purpose, in a diff, with a reason. That is the whole mechanism.
 */
export const TREE_CEILING = 135_000;

interface Waiver {
  readonly path: string;
  readonly lines: number;
  readonly owner: string;
  readonly reason: string;
  readonly plan: string;
  readonly review: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Lines of code, using `wc -l` semantics (count newline terminators) so the
 * number in the waiver register matches what a developer sees from the shell.
 * A trailing newline on the final line is not counted as an extra line.
 */
function countLines(file: string): number {
  const text = readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

export interface SizeReport {
  ok: boolean;
  threshold: number;
  /** Total LOC across src/ — the anti-regrowth ceiling (Phase 5). */
  treeLines: number;
  treeCeiling: number;
  treeOver: boolean;
  overThreshold: Array<{ path: string; lines: number }>;
  unwaived: Array<{ path: string; lines: number }>;
  grown: Array<{ path: string; lines: number; waivedAt: number }>;
  staleWaivers: string[];
  malformedWaivers: string[];
}

export function checkSizes(): SizeReport {
  const waivers: Waiver[] = JSON.parse(readFileSync(REGISTER, "utf8")).waivers;
  const byPath = new Map(waivers.map((w) => [w.path, w]));

  const sizes = walk(SRC)
    .map((f) => ({ path: relative(ROOT, f).replace(/\\/g, "/"), lines: countLines(f) }))
    .sort((a, b) => b.lines - a.lines);

  const overThreshold = sizes.filter((s) => s.lines > THRESHOLD);
  const unwaived = overThreshold.filter((s) => !byPath.has(s.path));
  const grown = overThreshold
    .filter((s) => byPath.has(s.path) && s.lines > byPath.get(s.path)!.lines)
    .map((s) => ({ ...s, waivedAt: byPath.get(s.path)!.lines }));

  const overPaths = new Set(overThreshold.map((s) => s.path));
  const staleWaivers = waivers.map((w) => w.path).filter((p) => !overPaths.has(p));

  const malformedWaivers = waivers
    .filter((w) => !w.owner?.trim() || !w.reason?.trim() || !w.plan?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(w.review ?? ""))
    .map((w) => w.path);

  const treeLines = sizes.reduce((n, m) => n + m.lines, 0);
  const treeOver = treeLines > TREE_CEILING;

  return {
    ok:
      unwaived.length === 0 &&
      grown.length === 0 &&
      staleWaivers.length === 0 &&
      malformedWaivers.length === 0 &&
      !treeOver,
    threshold: THRESHOLD,
    treeLines,
    treeCeiling: TREE_CEILING,
    treeOver,
    overThreshold,
    unwaived,
    grown,
    staleWaivers,
    malformedWaivers,
  };
}

if (import.meta.main) {
  const r = checkSizes();
  console.log(`[size-gate] threshold ${r.threshold} LOC · ${r.overThreshold.length} module(s) over, all waived unless listed below`);

  for (const m of r.unwaived) {
    console.error(`  FAIL over threshold with no owned plan: ${m.path} (${m.lines} lines)`);
  }
  for (const m of r.grown) {
    console.error(`  FAIL waived module grew: ${m.path} ${m.waivedAt} -> ${m.lines} lines`);
  }
  for (const p of r.staleWaivers) {
    console.error(`  FAIL stale waiver (module is now under threshold): ${p}`);
  }
  for (const p of r.malformedWaivers) {
    console.error(`  FAIL waiver needs owner, reason, plan and an ISO review date: ${p}`);
  }

  const pct = ((r.treeLines / r.treeCeiling) * 100).toFixed(1);
  console.log(`[size-gate] tree ${r.treeLines.toLocaleString()} LOC of ${r.treeCeiling.toLocaleString()} ceiling (${pct}%)`);
  if (r.treeOver) {
    console.error(
      `  FAIL core grew past the Phase 5 ceiling: ${r.treeLines.toLocaleString()} > ${r.treeCeiling.toLocaleString()} LOC.\n` +
      `       Phase 5 extracted 23,376 LOC to satellite packages so a one-person team could own core.\n` +
      `       Either move the new surface to a satellite, or raise TREE_CEILING in scripts/size-gate.ts\n` +
      `       deliberately, in a diff, with a reason (ADR-0028).`,
    );
  }

  if (r.ok) {
    console.log(`[size-gate] ✓ every module is under ${r.threshold} LOC or has an owned, dated split plan`);
    process.exit(0);
  }
  process.exit(1);
}
