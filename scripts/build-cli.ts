#!/usr/bin/env bun
/**
 * Phase 23 — compile the `xr` coding-agent CLI to a single executable.
 *
 *   bun run build:cli                 → dist/xr (host platform)
 *   bun run build:cli -- --out <path> → custom output path
 *
 * Pure `bun build --compile`: no postinstall, no native addon, no network.
 * The entry is src/index.ts, the same entry the npm `bin` uses.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const out = resolve(root, outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1]! : "dist/xr");
mkdirSync(dirname(out), { recursive: true });

const proc = Bun.spawn(
  // playwright is late-bound (browser tools) and not needed by the coding agent; the
  // same externals as scripts/build-matrix.ts keep the bundle from tracing it.
  [
    process.execPath,
    "build",
    "--compile",
    "--minify",
    resolve(root, "src/index.ts"),
    "--external",
    "playwright",
    "--external",
    "playwright-core",
    "--outfile",
    out,
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
const code = await proc.exited;
if (code !== 0) {
  console.error(`build:cli failed (exit ${code})`);
  process.exit(code);
}

const check = Bun.spawn([out, "--version"], { stdout: "pipe", stderr: "pipe" });
const version = (await new Response(check.stdout).text()).trim();
const checkCode = await check.exited;
if (checkCode !== 0 || !version) {
  console.error(`build:cli produced a binary that does not run --version (exit ${checkCode})`);
  process.exit(1);
}
console.log(`built ${out} (${version})`);
