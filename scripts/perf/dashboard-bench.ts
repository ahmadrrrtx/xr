/**
 * XR Phase 3 · T10 — Dashboard first-render benchmark.
 *
 * Starts the daemon (`serve`) on an ephemeral port with an isolated XR_HOME,
 * waits for readiness, then measures the time-to-body of the dashboard HTML
 * route (`GET /`). This is the "dashboard first local render <1 s" budget.
 *
 * Prints a single JSON line: { ms, samples, extra } where ms is the median
 * request latency after the server is up (p95 is derived by the harness from
 * repeated runs).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import "./isolation.ts";
import { serve } from "../../src/daemon/server.ts";

const SAMPLES = Number(process.env.XR_BENCH_DASH_SAMPLES ?? 9);

async function main(): Promise<void> {
  const home = process.env.XR_HOME ?? join(tmpdir(), `xr-dash-bench-${process.pid}-${Date.now()}`);
  mkdirSync(home, { recursive: true });

  // Phase 4 · T4 fix — `port: 0` lets the OS assign an ephemeral port. The
  // harness spawns this bench once PER SAMPLE (21+ times); a random/fixed
  // port collides with the previous process's lingering TIME_WAIT socket
  // (EADDRINUSE) and flakes the perf gate on CI.
  const handle = await serve({ port: 0 });
  const port = handle.port;
  const url = `http://127.0.0.1:${port}/?token=${handle.token}`;
  // Phase 4 · T5 — one-time bootstrap: exchange the query token for the
  // session cookie ONCE, then measure the cookie-authenticated HTML render.
  const boot = await fetch(url, { redirect: "manual" });
  const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0];
  const cleanUrl = boot.headers.get("location") ?? url;

  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    const res = await fetch(cleanUrl, { headers: { cookie } });
    const body = await res.text();
    times.push(performance.now() - start);
    if (!res.ok || body.length < 500) {
      handle.stop();
      throw new Error(`dashboard returned ${res.status} (${body.length} bytes)`);
    }
  }
  handle.stop();

  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1)]!;
  console.log(
    JSON.stringify({
      ms: p(95),
      samples: SAMPLES,
      extra: { p50: p(50), p99: p(99), min: sorted[0], max: sorted[sorted.length - 1], port },
    }),
  );
}

await main();
