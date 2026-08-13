#!/usr/bin/env bun
/**
 * XR Phase 9 · T6 — Public Beta install-success metric (automated instrument).
 *
 * Measures the DEFAULT DISTRIBUTION (compiled binary) install rate on the OS
 * it runs on, N fresh attempts, each fully clean-roomed:
 *
 *   resolve platform asset → verified install (sha256 vs release SHA256SUMS)
 *   → smoke the installed binary (--version, doctor --json) → remove it.
 *
 * Sources (same canonical set either way — Art. XXII):
 *   --release-dir <dir>    local canonical assets (nightly: built in-job)
 *   --release-url <base>   real published release (e.g. .../releases/download/v1.0.0)
 *
 * Report (one JSON line): { ok, os, rate, runs, successes, failures:[step…] }.
 * Exit 0 only when rate ≥ --target (default 0.99) — the Beta acceptance gate
 * (T6: install >99% on 3 OS families), uploaded as a nightly artifact per OS.
 *
 * Honest scope: measures the machine-verifiable install+smoke journey of the
 * canonical binary. Human-installation UX is measured by the feedback loop.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface SurveyReport {
  ok: boolean;
  os: string;
  rate: number;
  runs: number;
  successes: number;
  failures: Array<{ attempt: number; step: string; detail?: string }>;
  p95Ms: number;
}

function platformFile(p: string = platform(), a: string = arch()): string {
  const map: Record<string, string> = {
    "linux-x64": "xr-linux-x64",
    "linux-arm64": "xr-linux-arm64",
    "darwin-arm64": "xr-darwin-arm64",
    "darwin-x64": "xr-darwin-x64",
    "win32-x64": "xr-windows-x64.exe",
  };
  return map[`${p}-${a}`] ?? `xr-${p}-${a}`;
}

function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{64}$/i.test(parts[0]!)) m.set(parts[1]!.replace(/^\*/, ""), parts[0]!.toLowerCase());
  }
  return m;
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

type AttemptDetail = { step: string; detail?: string };

async function attempt(opts: { releaseDir?: string; releaseUrl?: string }): Promise<AttemptDetail | null> {
  const file = platformFile();
  const home = mkdtempSync(join(tmpdir(), "xr-beta-install-"));
  try {
    const xrHome = join(home, "xr-home");
    const distDir = join(xrHome, "dist");
    mkdirSync(distDir, { recursive: true });
    const dest = join(distDir, file);

    // 1. Fetch the artifact + its signed checksum manifest from the source.
    let bytes: Uint8Array;
    let sumsText: string;
    if (opts.releaseDir) {
      const sumsPath = join(opts.releaseDir, "SHA256SUMS");
      const binPath = join(opts.releaseDir, file);
      if (!existsSync(sumsPath) || !existsSync(binPath)) return { step: "source-missing", detail: file };
      bytes = new Uint8Array(readFileSync(binPath));
      sumsText = readFileSync(sumsPath, "utf8");
    } else if (opts.releaseUrl) {
      const sumsRes = await fetch(`${opts.releaseUrl}/SHA256SUMS`);
      if (!sumsRes.ok) return { step: "sums-fetch", detail: `HTTP ${sumsRes.status}` };
      sumsText = await sumsRes.text();
      const binRes = await fetch(`${opts.releaseUrl}/${file}`);
      if (!binRes.ok) return { step: "binary-fetch", detail: `HTTP ${binRes.status}` };
      bytes = new Uint8Array(await binRes.arrayBuffer());
    } else {
      return { step: "config", detail: "no source given" };
    }

    // 2. Verified-only install (Part 20): hash must match the published sums.
    const expected = parseSums(sumsText).get(file);
    if (!expected) return { step: "sums-entry-missing", detail: file };
    if (sha256(bytes) !== expected) return { step: "integrity", detail: file };
    await Bun.write(dest, bytes);
    if (platform() !== "win32") chmodSync(dest, 0o755);

    // 3. Smoke the INSTALLED artifact in its clean room.
    const env = { ...process.env, XR_HOME: xrHome, HOME: home, XR_NONINTERACTIVE: "1", NO_COLOR: "1" };
    const ver = spawnSync(dest, ["--version"], { env, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
    if (ver.status !== 0) return { step: "smoke-version", detail: `exit ${String(ver.status)} ${(ver.stderr ?? "").slice(-160)}` };
    const doc = spawnSync(dest, ["doctor", "--json"], { env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    if (doc.status !== 0 && doc.status !== 1) return { step: "smoke-doctor", detail: `exit ${String(doc.status)}` };

    // 4. Remove (channel uninstall semantics: the artifact dir is disposable).
    rmSync(xrHome, { recursive: true, force: true });
    if (existsSync(xrHome)) return { step: "uninstall", detail: xrHome };
    return null;
  } finally {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

async function main(): Promise<void> {
  const arg = (name: string, dflt = ""): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? dflt;
  const runs = Math.max(1, Number.parseInt(arg("runs", "10"), 10) || 10);
  const target = Number.parseFloat(arg("target", "0.99"));
  const releaseDir = arg("release-dir");
  const releaseUrl = arg("release-url");
  if (!releaseDir && !releaseUrl) {
    console.error("usage: [--release-dir DIR | --release-url URL] [--runs=N] [--target=0.99]");
    process.exit(2);
  }

  const failures: SurveyReport["failures"] = [];
  const durations: number[] = [];
  let successes = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const failure = await attempt({ ...(releaseDir ? { releaseDir } : {}), ...(releaseUrl ? { releaseUrl } : {}) });
    durations.push(Date.now() - t0);
    if (failure) {
      failures.push({ attempt: i + 1, step: failure.step, ...(failure.detail ? { detail: failure.detail } : {}) });
    } else {
      successes++;
    }
  }
  const rate = successes / runs;
  const report: SurveyReport = {
    ok: rate >= target,
    os: `${platform()}-${arch()}`,
    rate: Number(rate.toFixed(4)),
    runs,
    successes,
    failures,
    p95Ms: percentile([...durations].sort((a, b) => a - b), 95),
  };
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
