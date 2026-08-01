/**
 * XR Phase 3 · T10 — bench isolation shim.
 *
 * Must be imported BEFORE any XR module that captures `process.env.XR_HOME`
 * at import time (src/config/config.ts line ~492). Ensures every perf bench
 * runs against a throwaway XR_HOME so benches can never touch (or corrupt)
 * a real user home — and so repeated bench runs are sample-isolated.
 *
 * The harness normally passes XR_HOME via the child env; this shim only
 * creates one when a bench is invoked directly (e.g. `bun run
 * scripts/perf/retrieval-bench.ts`).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";

if (!process.env.XR_HOME) {
  process.env.XR_HOME = join(tmpdir(), `xr-perf-home-${process.pid}-${Date.now()}`);
  mkdirSync(process.env.XR_HOME, { recursive: true });
}
