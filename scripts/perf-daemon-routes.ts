#!/usr/bin/env bun
/**
 * XR Phase 01 — daemon endpoint performance benchmark.
 *
 *   bun run scripts/perf-daemon-routes.ts [--samples 5] [--port 3141]
 *
 * Starts the daemon on an isolated XR_HOME (optional: XR_BENCH_BLACKHOLE=1
 * starts blackhole TCP listeners on the local-runtime ports to reproduce the
 * forensic slow-failing environment) and measures the Phase-01 critical
 * endpoints: health, overview, providers.list, models.list, onboarding.status,
 * chat (offline 503 path). Prints p50 / p95 / max per endpoint.
 *
 * Metrics are also exposed server-side as xr_* histograms via /api/metrics.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLES = Math.max(3, Number(process.argv.indexOf("--samples") >= 0 ? process.argv[process.argv.indexOf("--samples") + 1] : 5));
const PORT = Number(process.argv.indexOf("--port") >= 0 ? process.argv[process.argv.indexOf("--port") + 1] : 3157);
const BLACKHOLE = process.env.XR_BENCH_BLACKHOLE === "1";

const home = mkdtempSync(join(tmpdir(), "xr-perf-routes-"));

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

async function main(): Promise<void> {
  let blackhole: ReturnType<typeof Bun.serve>[] = [];
  if (BLACKHOLE) {
    for (const port of [11434, 1234, 8080, 1337, 8000, 4891, 5001, 5000, 30000]) {
      try {
        blackhole.push(
          Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Promise(() => {}) }),
        );
      } catch {
        /* port busy — skip */
      }
    }
  }

  const daemon = spawn("bun", ["run", "src/index.ts", "serve", "--port", String(PORT)], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, XR_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let token = "";
  const waitForToken = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 15_000);
    daemon.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const m = text.match(/Token:\s*([0-9a-f]+)/);
      if (m) {
        token = m[1]!;
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await waitForToken;
  if (!token) {
    console.error("daemon did not print a token");
    daemon.kill();
    process.exit(1);
  }

  const base = `http://127.0.0.1:${PORT}`;
  const auth = { authorization: `Bearer ${token}` };

  async function sample(method: string, path: string, body?: string): Promise<number> {
    const started = Date.now();
    await fetch(base + path, {
      method,
      headers: body ? { ...auth, "content-type": "application/json" } : auth,
      body,
    });
    return Date.now() - started;
  }

  const targets: Array<[string, string, string?]> = [
    ["health", "GET", "/api/health"],
    ["overview", "GET", "/api/overview"],
    ["providers.list", "GET", "/api/providers"],
    ["models.list", "GET", "/api/models"],
    ["onboarding.status", "GET", "/api/onboarding/status"],
    ["chat.offline.503", "POST", "/api/chat", '{"message":"hi"}'],
  ] as never;

  const results: Record<string, number[]> = {};
  // Warm the caches once (the first call is the cold one).
  for (const [name, method, path, body] of targets) {
    await sample(method as "GET", path as string, body as string | undefined);
    results[name as string] = [];
  }
  for (let i = 0; i < SAMPLES; i++) {
    for (const [name, method, path, body] of targets) {
      results[name as string]!.push(await sample(method as "GET", path as string, body as string | undefined));
    }
  }

  console.log(`\nXR Phase 01 daemon routes benchmark — samples=${SAMPLES} blackhole=${BLACKHOLE}\n`);
  console.log(`${"endpoint".padEnd(20)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"max".padStart(8)}`);
  for (const [name] of targets) {
    const sorted = results[name as string]!.sort((a, b) => a - b);
    console.log(
      `${name.padEnd(20)} ${percentile(sorted, 50).toFixed(0).padStart(8)} ${percentile(sorted, 95).toFixed(0).padStart(8)} ${sorted[sorted.length - 1]!.toFixed(0).padStart(8)}`,
    );
  }

  daemon.kill();
  for (const b of blackhole) b.stop();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(0);
}

void main();
