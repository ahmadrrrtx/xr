#!/usr/bin/env bun
/**
 * XR Phase 9 · T6 — Public-Beta install-success metric.
 *
 * The nightly beta-install matrix (3 OS families × installer channel) appends
 * one JSON line per attempt. This script aggregates them and enforces the
 * Phase-9 bar honestly:
 *
 *   bun run scripts/beta-metric.ts record  --file metrics.jsonl --os linux --channel installer --ok 1 [--job-url …]
 *   bun run scripts/beta-metric.ts report  --file metrics.jsonl [--json]
 *   bun run scripts/beta-metric.ts gate    --file metrics.jsonl --threshold 0.99 --window 30
 *
 * Honesty rules (Art. IX.4 / ADR-10, matching the Phase-8 precedent E-1):
 *   - The >99% claim is only emitted when ≥ window attempts are recorded.
 *     With fewer, the report says PROVISIONAL with the recorded N — never a
 *     projected pass.
 *   - Failed attempts are never dropped; unknown fields fail closed.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export interface BetaAttempt {
  ts: string; // ISO timestamp
  os: "linux" | "macos" | "windows";
  channel: string;
  version: string;
  ok: boolean;
  jobUrl?: string;
}

export interface BetaAggregate {
  total: number;
  succeeded: number;
  rate: number;
  byOs: Record<string, { total: number; succeeded: number; rate: number }>;
  window: number;
  provisional: boolean;
}

const VALID_OS = new Set(["linux", "macos", "windows"]);

export function parseAttempt(line: string): BetaAttempt {
  const o = JSON.parse(line) as Record<string, unknown>;
  if (typeof o.ts !== "string" || typeof o.channel !== "string" || typeof o.version !== "string") {
    throw new Error(`malformed beta attempt line: ${line.slice(0, 120)}`);
  }
  if (!VALID_OS.has(o.os as string)) throw new Error(`unknown os "${String(o.os)}" in beta attempt`);
  if (typeof o.ok !== "boolean") throw new Error(`beta attempt ok must be boolean: ${line.slice(0, 120)}`);
  return {
    ts: o.ts,
    os: o.os as BetaAttempt["os"],
    channel: o.channel,
    version: o.version,
    ok: o.ok,
    jobUrl: typeof o.jobUrl === "string" ? o.jobUrl : undefined,
  };
}

export function readAttempts(file: string): BetaAttempt[] {
  if (!existsSync(file)) return [];
  const out: BetaAttempt[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim()) out.push(parseAttempt(line));
  }
  return out;
}

export function aggregate(attempts: BetaAttempt[], window: number): BetaAggregate {
  const recent = attempts.slice(-window);
  const byOs: BetaAggregate["byOs"] = {};
  for (const a of recent) {
    const cur = byOs[a.os] ?? { total: 0, succeeded: 0, rate: 0 };
    cur.total++;
    if (a.ok) cur.succeeded++;
    byOs[a.os] = cur;
  }
  for (const k of Object.keys(byOs)) {
    byOs[k]!.rate = byOs[k]!.total > 0 ? byOs[k]!.succeeded / byOs[k]!.total : 0;
  }
  const succeeded = recent.filter((a) => a.ok).length;
  return {
    total: recent.length,
    succeeded,
    rate: recent.length > 0 ? succeeded / recent.length : 0,
    byOs,
    window,
    // The rolling claim needs a full window behind it.
    provisional: attempts.length < window,
  };
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      out[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (i++, next) : true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const file = typeof args.file === "string" ? args.file : "beta-metrics.jsonl";

  switch (cmd) {
    case "record": {
      const attempt: BetaAttempt = {
        ts: new Date().toISOString(),
        os: args.os as BetaAttempt["os"],
        channel: (args.channel as string) ?? "installer",
        version: (args.version as string) ?? "unknown",
        ok: args.ok === "1" || args.ok === true,
        jobUrl: typeof args["job-url"] === "string" ? args["job-url"] : undefined,
      };
      parseAttempt(JSON.stringify(attempt)); // fail closed on malformed input
      appendFileSync(file, JSON.stringify(attempt) + "\n", "utf8");
      console.log(`[beta-metric] recorded ${attempt.os}/${attempt.channel} ok=${attempt.ok} (v${attempt.version}) → ${file}`);
      return;
    }
    case "report": {
      const agg = aggregate(readAttempts(file), Number(args.window ?? 30));
      if (args.json) {
        writeFileSync(0, JSON.stringify(agg, null, 2) + "\n");
        return;
      }
      console.log(`Beta install-success (last ${agg.window} recorded attempts): ${agg.succeeded}/${agg.total} = ${(agg.rate * 100).toFixed(2)}%${agg.provisional ? "  ** PROVISIONAL (window not full — not a >99% claim yet) **" : ""}`);
      for (const [os, s] of Object.entries(agg.byOs)) {
        console.log(`  ${os.padEnd(8)} ${s.succeeded}/${s.total} = ${(s.rate * 100).toFixed(2)}%`);
      }
      return;
    }
    case "gate": {
      const threshold = Number(args.threshold ?? 0.99);
      const window = Number(args.window ?? 30);
      const agg = aggregate(readAttempts(file), window);
      if (agg.provisional) {
        console.log(`[beta-metric] PROVISIONAL pass: only ${agg.total}/${window} attempts recorded (${(agg.rate * 100).toFixed(2)}% so far). The >${threshold * 100}% claim opens once the window is full.`);
        return; // not a claim; the nightly keeps accumulating
      }
      if (agg.rate >= threshold) {
        console.log(`[beta-metric] PASS: ${agg.succeeded}/${agg.total} = ${(agg.rate * 100).toFixed(2)}% ≥ ${threshold * 100}% over the last ${window} recorded attempts.`);
        return;
      }
      console.error(`[beta-metric] FAIL: ${(agg.rate * 100).toFixed(2)}% < ${threshold * 100}% over the last ${window} recorded attempts.`);
      process.exit(1);
    }
    default:
      console.error("usage: beta-metric.ts record|report|gate --file <metrics.jsonl> [options]");
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[beta-metric] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
