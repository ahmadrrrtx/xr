/**
 * XR Phase 11 — repo intelligence metrics.
 *
 * Structural only: durations, counts, cache hits. Never source text.
 */

import { Histogram, Counter, registerMetric } from "../observability/metrics.ts";
import type { IndexStats, RepoMapResult } from "./types.ts";

let registered = false;
let indexDuration: Histogram;
let queryDuration: Histogram;
let mapDuration: Histogram;
let indexFiles: Counter;
let cacheHits: Counter;
let cacheMisses: Counter;
let indexErrors: Counter;

function ensure(): void {
  if (registered) return;
  registered = true;
  try {
    indexDuration = registerMetric(new Histogram("xr_repo_index_duration_ms", "Repository index duration (ms)."));
    queryDuration = registerMetric(new Histogram("xr_repo_query_duration_ms", "Repository query duration (ms)."));
    mapDuration = registerMetric(new Histogram("xr_repo_map_duration_ms", "Repo-map generation duration (ms)."));
    indexFiles = registerMetric(new Counter("xr_repo_index_files_total", "Files seen during repository indexing."));
    cacheHits = registerMetric(new Counter("xr_repo_index_cache_hits_total", "Parse-cache hits during indexing."));
    cacheMisses = registerMetric(new Counter("xr_repo_index_cache_misses_total", "Parse-cache misses during indexing."));
    indexErrors = registerMetric(new Counter("xr_repo_index_errors_total", "Repository index errors."));
  } catch {
    // Metrics already registered (tests reset + re-import) — look up later writes no-op.
  }
}

export function recordIndexMetrics(stats: IndexStats): void {
  try {
    ensure();
    indexDuration?.observe({}, stats.durationMs);
    indexFiles?.inc({}, stats.files);
    cacheHits?.inc({}, stats.cacheHits);
    cacheMisses?.inc({}, stats.cacheMisses);
    if (stats.errors) indexErrors?.inc({}, stats.errors);
  } catch {
    /* metrics never break indexing */
  }
}

export function recordQueryMetrics(durationMs: number): void {
  try {
    ensure();
    queryDuration?.observe({}, durationMs);
  } catch {
    /* ignore */
  }
}

export function recordMapMetrics(result: RepoMapResult): void {
  try {
    ensure();
    mapDuration?.observe({}, result.durationMs);
  } catch {
    /* ignore */
  }
}
