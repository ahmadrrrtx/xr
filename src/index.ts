#!/usr/bin/env bun
/**
 * XR 3.1.5 (Helios) — Product CLI bootstrap
 *
 * Professional command-line entry aligned with Shell redesign.
 *
 * Fast paths (no kernel):
 *   xr | xr shell | xr --tui   → Shell
 *   xr help | xr --help       → help
 *   xr --version | xr -v      → version
 *   xr serve                  → Control Center
 *
 * Everything else boots the kernel lazily via the CLI router.
 *
 * Spec: docs/xr-3.1/*  ·  CLI redesign XR 3.1.5 (Helios)
 */

import { runCli } from "./cli/router.ts";
import { EXIT } from "./cli/flags.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const code = await runCli(argv);
  if (code !== EXIT.OK && process.exitCode == null) {
    process.exit(code);
  } else if (process.exitCode == null && code === EXIT.OK) {
    // success — leave exitCode unset (0)
  } else if (code !== EXIT.OK) {
    process.exit(code);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("fatal:", msg);
  if (process.env.XR_DEBUG === "1") console.error(e);
  process.exit(EXIT.ERROR);
});
