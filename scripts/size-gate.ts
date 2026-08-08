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

  return {
    ok:
      unwaived.length === 0 &&
      grown.length === 0 &&
      staleWaivers.length === 0 &&
      malformedWaivers.length === 0,
    threshold: THRESHOLD,
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

  if (r.ok) {
    console.log(`[size-gate] ✓ every module is under ${r.threshold} LOC or has an owned, dated split plan`);
    process.exit(0);
  }
  process.exit(1);
}
