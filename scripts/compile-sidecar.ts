#!/usr/bin/env bun
/**
 * Phase 4 · D-02 — compile the XR engine into a standalone Tauri sidecar binary.
 *
 * ONE computation source: CI (desktop-app.yml) and local dev run this same
 * script, so the artifact the bundle ships is exactly the artifact that was
 * smoke-tested. Output lands at desktop/src-tauri/binaries/xr-engine-<triple>
 * (the externalBin naming Tauri requires; .exe appended on Windows).
 *
 * Honest limitations (declared, not hidden):
 *   · playwright/playwright-core stay EXTERNAL — they are optional, capability-
 *     gated dynamic imports (src/control/browser.ts probes availability before
 *     use). In the compiled sidecar the browser-automation capability reports
 *     unavailable; everything else is embedded.
 *   · The sidecar serves from the user's XR_HOME (default ~/.xr) like any
 *     engine install — it does not carry repo dev state.
 *
 * Override the host triple with SIDECAR_TRIPLE (cross-compile is NOT claimed;
 * this only renames for runners that know their own target). `--if-missing`
 * skips the (slow) compile when the binary is already there — `tauri dev`
 * needs it to exist because tauri-build validates bundle.externalBin.
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// cwd-independent: `bun run dev:tauri` in desktop/ and CI at the repo root
// both land on the same paths.
const root = resolve(import.meta.dir, "..");
const ifMissing = process.argv.includes("--if-missing");

const TRIPLES: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "windows-x64": "x86_64-pc-windows-msvc",
};

const hostKey = `${process.platform}-${process.arch}`;
const triple = process.env.SIDECAR_TRIPLE ?? TRIPLES[hostKey];
if (!triple) {
  console.error(`[sidecar] unsupported host ${hostKey} — set SIDECAR_TRIPLE`);
  process.exit(1);
}
const ext = process.platform === "win32" ? ".exe" : "";
const out = resolve(root, `desktop/src-tauri/binaries/xr-engine-${triple}${ext}`);
mkdirSync(resolve(root, "desktop/src-tauri/binaries"), { recursive: true });

if (ifMissing && existsSync(out)) {
  console.log(`[sidecar] present, skipping (--if-missing): ${out}`);
  process.exit(0);
}

console.log(`[sidecar] compiling engine → ${out}`);
const proc = Bun.spawnSync(
  ["bun", "build", "src/index.ts", "--compile", "--external", "playwright", "--external", "playwright-core", "--outfile", out],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (proc.exitCode !== 0) process.exit(proc.exitCode);
console.log(`[sidecar] done: ${out}`);
