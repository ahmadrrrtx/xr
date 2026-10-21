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
 * Cross-compile (launch-audit L-002/L-003): a bun compile `--target` exists
 * for every Rust triple XR ships, so SIDECAR_TRIPLE selects a REAL cross
 * compile — the produced binary literally runs on the named triple, never a
 * host binary renamed onto it (the previous hazard this script declined to
 * prevent by omission). Host vs target equality decides whether the binary is
 * runnable here; scripts/smoke-sidecar.sh enforces that distinction.
 *
 * `--if-missing` skips the (slow) compile when the binary is already there —
 * `tauri dev` needs it to exist because tauri-build validates bundle.externalBin.
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// cwd-independent: `bun run dev:tauri` in desktop/ and CI at the repo root
// both land on the same paths.
const root = resolve(import.meta.dir, "..");
const ifMissing = process.argv.includes("--if-missing");

/** hostKey (`process.platform`-`process.arch`) → Rust target triple XR ships. */
const TRIPLES: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "windows-x64": "x86_64-pc-windows-msvc",
  "windows-arm64": "aarch64-pc-windows-msvc",
};

/** Rust triple → bun compile `--target` (the truth behind every cross build). */
export const TRIPLE_TO_BUN_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
};

/** The .exe ext follows the TARGET OS — a windows triple cross-compiled from Linux/macOS still ships .exe to tauri. */
export function tripleExt(triple: string): string {
  return triple.includes("windows") ? ".exe" : "";
}

/** Argv/env-driven resolution, exported so tests pin the matrix without compiling. */
export function resolveCompile(hostKey: string, requested?: string): { triple: string; bunTarget: string; ext: string; cross: boolean } {
  const triple = requested ?? TRIPLES[hostKey];
  if (!triple) throw new Error(`unsupported host ${hostKey} — set SIDECAR_TRIPLE`);
  const bunTarget = TRIPLE_TO_BUN_TARGET[triple];
  if (!bunTarget) throw new Error(`no bun compile target for triple ${triple}`);
  return { triple, bunTarget, ext: tripleExt(triple), cross: TRIPLES[hostKey] !== triple };
}

function main(): void {
  const hostKey = `${process.platform}-${process.arch}`;
  let plan: ReturnType<typeof resolveCompile>;
  try {
    plan = resolveCompile(hostKey, process.env.SIDECAR_TRIPLE);
  } catch (err) {
    console.error(`[sidecar] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const { triple, bunTarget, ext, cross } = plan;
  const out = resolve(root, `desktop/src-tauri/binaries/xr-engine-${triple}${ext}`);
  mkdirSync(resolve(root, "desktop/src-tauri/binaries"), { recursive: true });

  if (ifMissing && existsSync(out)) {
    console.log(`[sidecar] present, skipping (--if-missing): ${out}`);
    process.exit(0);
  }

  console.log(`[sidecar] compiling engine → ${out} (${bunTarget}${cross ? ", cross" : ""})`);
  const proc = Bun.spawnSync(
    [
      "bun",
      "build",
      "src/index.ts",
      "--compile",
      "--target",
      bunTarget,
      "--external",
      "playwright",
      "--external",
      "playwright-core",
      "--outfile",
      out,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) process.exit(proc.exitCode);
  if (!existsSync(out)) {
    console.error(`[sidecar] FAIL: compile reported success but no binary at ${out}`);
    process.exit(1);
  }
  console.log(`[sidecar] done: ${out}`);
}

if (import.meta.main) main();
