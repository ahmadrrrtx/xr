/**
 * XR Phase 3 · T2 — compiled-binary smoke tests.
 *
 * Builds (or reuses) the current-platform standalone binary and asserts the
 * three binary contract points:
 *
 *   1. `--version` exits 0 and prints the unified version identity;
 *   2. `--help` exits 0;
 *   3. `doctor --json` runs (exit 0 or the Phase-0 by-design 1 without a
 *      reachable provider) and emits parseable JSON;
 *   4. the lazy-command surface is compile-safe: `workspace list --json`
 *      and `config get provider` work in the compiled binary (they exercise
 *      the dynamic-import machinery the compiler traced).
 *
 * TIME-OUT FIX (Phase 3): cold-starting the ~90 MB standalone binary can take
 * well over bun test's default 5 s per-test budget on slow machines — old
 * CPUs without AVX, Windows Defender first-run scanning of a freshly built
 * unsigned .exe, spinning disks. Every test here therefore declares a
 * 300 s budget, `runBinary` uses a 300 s spawn timeout, and a warm-up spawn
 * in beforeAll absorbs the Defender/OS-cache hit once.
 *
 * On very slow local hardware you can skip the binary build + run entirely
 * with `XR_SKIP_BINARY_BUILD=1 bun test test/perf/` — the binary is still
 * built and smoked in CI (modern Linux runners, ~70 ms cold start).
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, test, expect, beforeAll } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");
const TARGET = `bun-${process.platform}-${process.arch}`;
const FILE: Record<string, string> = {
  "bun-linux-x64": "xr-linux-x64",
  "bun-linux-arm64": "xr-linux-arm64",
  "bun-darwin-arm64": "xr-darwin-arm64",
  "bun-darwin-x64": "xr-darwin-x64",
  "bun-win32-x64": "xr-windows-x64.exe",
};
const OUT = join(ROOT, "dist");
const BINARY = join(OUT, FILE[TARGET] ?? "xr-current");
/** Slow hardware (no AVX, Defender, spinning disks) needs generous budgets. */
const SLOW_BUDGET_MS = 300_000;

function hasBun(): boolean {
  try {
    spawnSync(process.env.BUN ?? "bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function buildIfMissing(): boolean {
  if (existsSync(BINARY)) return true;
  if (process.env.XR_SKIP_BINARY_BUILD === "1") return false;
  if (!hasBun()) return false;
  mkdirSync(OUT, { recursive: true });
  const args = [
    "build",
    join(ROOT, "src", "index.ts"),
    "--compile",
    "--target",
    TARGET,
    "--outfile",
    BINARY,
    "--external",
    "playwright",
    "--external",
    "playwright-core",
  ];
  const r = spawnSync(process.env.BUN ?? "bun", args, { cwd: ROOT, encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] });
  return r.status === 0;
}

const available = buildIfMissing();
const describeFn = available ? describe : describe.skip;

function runBinary(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const home = join(tmpdir(), `xr-binary-smoke-${process.pid}-${Date.now()}`);
  mkdirSync(home, { recursive: true });
  const r = spawnSync(BINARY, args, {
    env: { ...process.env, XR_HOME: home, XR_NONINTERACTIVE: "1", NO_COLOR: "1" },
    encoding: "utf8",
    timeout: SLOW_BUDGET_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describeFn("Phase 3 · T2 — compiled-binary smoke", () => {
  // Warm-up: the first spawn of a freshly built binary pays OS caching /
  // real-time AV scanning on some platforms; absorb it once here so the
  // assertions below measure a steady-state process.
  beforeAll(() => {
    runBinary(["--version"]);
  }, SLOW_BUDGET_MS);

  test("binary exists for the current platform", () => {
    expect(existsSync(BINARY)).toBe(true);
  }, SLOW_BUDGET_MS);

  test("--version exits 0 with the unified identity", () => {
    const r = runBinary(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+/);
  }, SLOW_BUDGET_MS);

  test("--help exits 0", () => {
    const r = runBinary(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(50);
  }, SLOW_BUDGET_MS);

  test("doctor --json runs (exit 0 or by-design 1) with parseable JSON", () => {
    const r = runBinary(["doctor", "--json"]);
    expect(r.code === 0 || r.code === 1).toBe(true);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }, SLOW_BUDGET_MS);

  test("lazy-command dynamic imports are compile-safe (workspace list --json)", () => {
    const r = runBinary(["workspace", "list", "--json"]);
    expect(r.code === 0 || r.code === 1).toBe(true);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  }, SLOW_BUDGET_MS);

  test("lazy-command dynamic imports are compile-safe (config get provider)", () => {
    const r = runBinary(["config", "get", "provider"]);
    expect(r.code).toBe(0);
  }, SLOW_BUDGET_MS);
});
