#!/usr/bin/env bun
/**
 * Phase 11 — repository intelligence benchmark.
 *
 * Measures initial index, incremental index, query, and repo-map generation.
 * Writes benchmarks/repo-intelligence/latest.json. Never logs source text.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceStore } from "../src/state/workspace-store.ts";
import { createRepoIntelligence, countTokens } from "../src/repo/index.ts";
import { generateRepoMap } from "../src/repo/repo-map.ts";
import { writeFileSync as write, mkdirSync as mkdir, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function pct(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const home = join(tmpdir(), `xr-repo-bench-${process.pid}`);
  mkdir(home, { recursive: true });
  const root = join(home, "proj");
  mkdir(root, { recursive: true });
  mkdir(join(root, "src"), { recursive: true });
  for (let i = 0; i < 120; i++) {
    write(join(root, "src", `f${i}.ts`), `export function fn${i}(x: number): number { return x + ${i}; }\n`);
  }
  write(join(root, "src", "gateway.ts"), `export class ProviderGateway { selectProvider() { return "p"; } }\n`);

  process.env.XR_HOME = home;
  const store = new WorkspaceStore("bench", join(home, "xr.db"));
  const intel = createRepoIntelligence({ workspaceId: "bench", root, store });

  const t0 = performance.now();
  const first = await intel.index({ force: true });
  const initialMs = performance.now() - t0;

  const t1 = performance.now();
  const second = await intel.index();
  const incrementalMs = performance.now() - t1;

  const qSamples: number[] = [];
  for (let i = 0; i < 21; i++) {
    const s = performance.now();
    intel.search("ProviderGateway");
    qSamples.push(performance.now() - s);
  }

  const mSamples: number[] = [];
  let lastMap = await intel.map("Fix the provider fallback logic", 1024);
  for (let i = 0; i < 21; i++) {
    const s = performance.now();
    lastMap = await intel.map("Fix the provider fallback logic", 1024);
    mSamples.push(performance.now() - s);
  }

  const report = {
    measuredAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch },
    initial: { files: first.files, durationMs: Math.round(initialMs), cacheMisses: first.cacheMisses },
    incremental: {
      durationMs: Math.round(incrementalMs),
      changedFiles: second.changedFiles,
      cacheHits: second.cacheHits,
      cacheMisses: second.cacheMisses,
      hitRate: second.cacheHits / Math.max(1, second.cacheHits + second.cacheMisses),
    },
    query: { p50: pct(qSamples, 50), p95: pct(qSamples, 95), samples: qSamples.length },
    repoMap: {
      p50: pct(mSamples, 50),
      p95: pct(mSamples, 95),
      tokens: lastMap.tokens,
      budget: lastMap.budget,
      files: lastMap.files,
      symbols: lastMap.symbols,
      estimator: lastMap.tokenEstimator,
      tokenCheck: countTokens(lastMap.text),
    },
  };

  const outDir = join(import.meta.dir, "..", "benchmarks", "repo-intelligence");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "latest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  store.close();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

void main();
