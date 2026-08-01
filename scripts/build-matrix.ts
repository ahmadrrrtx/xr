#!/usr/bin/env bun
/**
 * XR Phase 3 · T2 — Standalone compiled-binary build matrix.
 *
 *   bun run scripts/build-matrix.ts [--targets linux-x64,linux-arm64,...]
 *                                   [--out dist] [--minify] [--skip-smoke]
 *
 * Builds the XR standalone binary per target with `bun build --compile`:
 *
 *   linux-x64, linux-arm64, darwin-arm64, darwin-x64, windows-x64
 *
 * Constraints honored:
 *   - Static-import tracing: `bun --compile` statically traces imports, so
 *     every dynamic import in the tree is a static literal path (Global
 *     Rule 7) — this build is the proof. Any computed-string dynamic import
 *     fails here at build time.
 *   - Late-bound deps (playwright for browser control) are `--external` and
 *     resolved at runtime; the binary never embeds them.
 *   - No secrets are embedded: the binary embeds only source; credentials
 *     live in the OS keychain / $XR_HOME (never compiled in).
 *   - Signing is NOT performed here (Phase 9); the binary ships unsigned.
 *
 * Cross-target builds succeed on any host (bun cross-compiles); smoke tests
 * run only for the current platform's binary (a darwin binary cannot run on
 * linux CI — verified per-platform instead).
 */

import { join } from "node:path";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const TARGETS = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-arm64", "bun-darwin-x64", "bun-windows-x64"];

export const TARGET_FILE: Record<string, string> = {
  "bun-linux-x64": "xr-linux-x64",
  "bun-linux-arm64": "xr-linux-arm64",
  "bun-darwin-arm64": "xr-darwin-arm64",
  "bun-darwin-x64": "xr-darwin-x64",
  "bun-windows-x64": "xr-windows-x64.exe",
};

export function parseArgs(): { targets: string[]; out: string; minify: boolean; skipSmoke: boolean } {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const targetArg = get("--targets");
  const targets = targetArg
    ? targetArg.split(",").map((t) => `bun-${t}`)
    : [...TARGETS];
  return {
    targets,
    out: get("--out") ?? join(ROOT, "dist"),
    minify: argv.includes("--minify"),
    skipSmoke: argv.includes("--skip-smoke"),
  };
}

/** Run `xr --version` / `--help` / `doctor --json` against a binary. */
export function smokeBinary(binaryPath: string): { ok: boolean; detail: string } {
  const home = join(process.env.XR_HOME ?? "/tmp", `.xr-smoke-${process.pid}`);
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, XR_HOME: home, XR_NONINTERACTIVE: "1", NO_COLOR: "1" };
  const checks: Array<[string, string[]]> = [
    ["--version", ["--version"]],
    ["--help", ["--help"]],
    ["doctor --json", ["doctor", "--json"]],
  ];
  for (const [label, args] of checks) {
    const r = spawnSync(binaryPath, args, { env, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
    const okCode = label.startsWith("doctor") ? r.status === 0 || r.status === 1 : r.status === 0;
    if (!okCode) return { ok: false, detail: `${label} failed (exit ${r.status}): ${(r.stderr ?? "").slice(0, 300)}` };
  }
  return { ok: true, detail: "version + help + doctor smoke passed" };
}

export async function buildTarget(target: string, out: string, minify: boolean): Promise<string> {
  const file = TARGET_FILE[target];
  if (!file) throw new Error(`unknown target ${target}`);
  const outfile = join(out, file);
  if (process.platform === "win32" && target.endsWith(".exe")) {
    // windows target is already covered by TARGET_FILE mapping (win32-x64)
  }
  mkdirSync(out, { recursive: true });
  const args = [
    "build",
    join(ROOT, "src", "index.ts"),
    "--compile",
    "--target",
    target,
    "--outfile",
    outfile,
    "--external",
    "playwright",
    "--external",
    "playwright-core",
  ];
  if (minify) args.push("--minify");
  const r = spawnSync(process.env.BUN ?? "bun", args, { cwd: ROOT, encoding: "utf8", timeout: 900_000, stdio: ["inherit", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(`build ${target} failed: ${(r.stderr ?? "").slice(0, 2000)}`);
  }
  if (!existsSync(outfile)) throw new Error(`build ${target} produced no binary at ${outfile}`);
  return outfile;
}

async function main(): Promise<void> {
  const { targets, out, minify, skipSmoke } = parseArgs();
  console.log(`building ${targets.length} targets → ${out}${minify ? " (minified)" : ""}`);
  const built: Array<{ target: string; file: string; bytes: number; smoke: string }> = [];
  for (const target of targets) {
    const started = Date.now();
    const bin = await buildTarget(target, out, minify);
    const size = (await Bun.file(bin).size) / 1024 / 1024;
    let smoke = "skipped (cross-target)";
    if (!skipSmoke && target === `bun-${process.platform}-${process.arch}`) {
      const r = smokeBinary(bin);
      smoke = r.ok ? "PASS" : `FAIL: ${r.detail}`;
    }
    console.log(`  ${target.padEnd(18)} ${size.toFixed(1)} MiB  ${((Date.now() - started) / 1000).toFixed(1)}s  smoke: ${smoke}`);
    built.push({ target, file: TARGET_FILE[target]!, bytes: Math.round(size * 1024 * 1024), smoke });
  }
  const failed = built.filter((b) => b.smoke.startsWith("FAIL"));
  if (failed.length > 0) {
    console.error(`❌ smoke failures: ${failed.map((f) => `${f.target}: ${f.smoke}`).join("; ")}`);
    process.exit(1);
  }
  console.log(`✅ matrix complete: ${built.length} binaries built.`);
}

await main();
