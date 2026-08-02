#!/usr/bin/env bun
/**
 * XR Phase 8 · T4 — System Usability Scale (SUS) instrument.
 *
 * SUS (Brooke, 1996) is the standard 10-item usability questionnaire; the
 * Phase-8 target is a mean score ≥ 80 ("excellent", top-~10% adjective range
 * per Bangor, Kortum & Miller 2008).
 *
 * ── HONEST SCOPE ────────────────────────────────────────────────────────────
 * This script is the INSTRUMENT AND AGGREGATOR ONLY. It does not — and no
 * automation can — fabricate participants. `docs/ux/SUS.md` documents the
 * study protocol (recruitment, moderation, consent). Until ≥5 human
 * participants have submitted responses, anything downstream (docs, release
 * notes, README badges) must report SUS as "study pending", per the Phase-8
 * honesty exception E-1. `--report` therefore EXITS 1 when n < 5, so CI can
 * never emit a green SUS claim from an empty file.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   bun run scripts/sus.ts --collect    # run the questionnaire (human, stdin)
 *   bun run scripts/sus.ts --report     # aggregate responses → exit 0 iff n ≥ 5 && mean ≥ 80
 *   bun run scripts/sus.ts --demo       # print the 10 items (no recording)
 *
 * Responses are appended as JSON lines to a LOCAL, git-ignored file
 * (docs/ux/sus-results.local.jsonl or $SUS_RESULTS). Raw individual answers
 * are never committed — only the study aggregate recorded by a human in
 * docs/ux/SUS.md is public.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";

/** The 10 canonical SUS statements (odd = positively worded, even = negatively worded). */
export const SUS_ITEMS: readonly string[] = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
] as const;

export const SUS_TARGET = 80;

/**
 * Canonical SUS scoring (Brooke 1996): odd items contribute (response − 1),
 * even items (5 − response); the summed contributions are scaled by 2.5.
 * Throws on anything except ten integers in [1, 5] — garbage in, never a score out.
 */
export function susScore(responses: readonly number[]): number {
  if (responses.length !== SUS_ITEMS.length) {
    throw new Error(`SUS requires exactly ${SUS_ITEMS.length} responses, got ${responses.length}`);
  }
  let sum = 0;
  responses.forEach((r, i) => {
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      throw new Error(`SUS response ${i + 1} must be an integer 1–5, got ${String(r)}`);
    }
    sum += i % 2 === 0 ? r - 1 : 5 - r;
  });
  return sum * 2.5;
}

/** Adjective rating bands (Bangor, Kortum & Miller 2008 / Sauro–Lewis curved grading). */
export function adjectiveRating(score: number): string {
  if (score >= 90.9) return "best imaginable";
  if (score >= 85.5) return "excellent";
  if (score >= 71.4) return "good";
  if (score >= 50.9) return "ok";
  if (score >= 38.9) return "poor";
  return "worst imaginable";
}

interface Entry {
  participant: string;
  at: string;
  responses: number[];
  score: number;
}

function resultsPath(): string {
  return process.env.SUS_RESULTS ?? join(import.meta.dir, "../docs/ux/sus-results.local.jsonl");
}

export function aggregate(entries: readonly Entry[]): { n: number; mean: number; median: number; rating: string; claimable: boolean } {
  const scores = entries.map((e) => e.score).sort((a, b) => a - b);
  const n = scores.length;
  const mean = n ? scores.reduce((a, b) => a + b, 0) / n : 0;
  const median = n ? (n % 2 === 1 ? scores[(n - 1) / 2] : (scores[n / 2 - 1] + scores[n / 2]) / 2) : 0;
  return {
    n,
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    rating: n ? adjectiveRating(mean) : "no data",
    // SUS guidance: ≥5 for a first reliable read; Phase 8 additionally requires mean ≥ 80 to CLAIM.
    claimable: n >= 5 && mean >= SUS_TARGET,
  };
}

async function collect(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("XR — System Usability Scale");
  console.log("For each statement, answer 1 (strongly disagree) … 5 (strongly agree).\n");
  const participant = (await rl.question("Participant id (any pseudonym — never a real name/email): ")).trim() || "anon";
  const responses: number[] = [];
  for (let i = 0; i < SUS_ITEMS.length; i++) {
    for (;;) {
      const raw = (await rl.question(`${String(i + 1).padStart(2)}. ${SUS_ITEMS[i]}  [1-5]: `)).trim();
      const v = Number.parseInt(raw, 10);
      if (Number.isInteger(v) && v >= 1 && v <= 5) {
        responses.push(v);
        break;
      }
      console.log("  please enter an integer from 1 to 5");
    }
  }
  rl.close();
  const entry: Entry = { participant, at: new Date().toISOString(), responses, score: susScore(responses) };
  const path = resultsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n");
  console.log(`\nRecorded. Individual SUS score: ${entry.score.toFixed(1)} (${adjectiveRating(entry.score)})`);
  console.log(`Stored locally at ${path} (git-ignored; aggregates only are ever published).`);
}

function report(): void {
  const path = resultsPath();
  const entries: Entry[] = existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Entry)
    : [];
  const agg = aggregate(entries);
  const summary = { target: SUS_TARGET, ...agg, claim: agg.claimable ? "SUS ≥ 80 evidenced" : "study pending — do not claim" };
  console.log(JSON.stringify(summary, null, 2));
  if (!agg.claimable) {
    console.error(`SUS not claimable: n=${agg.n} (need ≥5) mean=${agg.mean} (need ≥${SUS_TARGET})`);
    process.exit(1);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--report")) report();
  else if (args.includes("--demo")) {
    SUS_ITEMS.forEach((item, i) => console.log(`${String(i + 1).padStart(2)}. ${item}`));
  } else if (args.includes("--collect")) {
    await collect();
  } else {
    console.log("usage: bun run scripts/sus.ts [--collect | --report | --demo]");
    process.exit(2);
  }
}
