/**
 * XR Phase 2.5 · P1-4 + §15#16 — unknown flags are errors, not task text.
 *
 * REPRODUCTION: `xr --yolo` booted the synced corpus worker (task/coder path)
 * and exited 0 — the flag was silently treated as task text. Any future
 * `--flag=…` equally disappeared. `xr daemon` was also a task prompt.
 *
 * Coherent CLI policy (this phase owns it):
 *   - unrecognized dashed tokens BEFORE the first positional → usage error, exit 2,
 *     BEFORE any task/coder/kernel work; the fix line mentions `--`;
 *   - `--` remains the end-of-options escape: dashed text after it is task input;
 *   - `xr daemon` (any spelling incl. --help) → exit 2 with the precise `xr serve`
 *     relocation — never a task, never command-help, never a kernel boot;
 *   - Phase 2.4's `xr serve --lan` (the declared example) still survives strict
 *     parsing — consumed by the SAME parser via the declarative catalog flags,
 *     not by a third parser;
 *   - everything else untouched: ordinary words, `xr skill --list`-style command
 *     locals, and flags AFTER a command positional pass through as before.
 *
 * These run the SHIPPING path (runCli) under a temp HOME so nothing workspace is needed.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseGlobalFlags } from "../../src/cli/flags.ts";

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "p25-flags-"));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.XDG_DATA_HOME = join(home, ".local", "share");
  return home;
}

async function runArgv(argv: string[]): Promise<{ code: number; stderr: string }> {
  const { runCli } = await import("../../src/cli/router.ts");
  const stderr: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => stderr.push(a.map(String).join(" "));
  try {
    const code = await runCli(argv);
    return { code, stderr: stderr.join("\n") };
  } finally {
    console.error = origError;
  }
}

describe("P1-4 unknown flags → usage error before any task work", () => {
  test("--yolo (the §15#16 repro token) exits 2 with a structured usage error", async () => {
    const home = freshHome();
    const { code, stderr } = await runArgv(["--yolo"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option: --yolo");
    expect(stderr).toContain("--"); // the fix line points at the end-of-options escape
    rmSync(home, { recursive: true, force: true });
  });

  test("--yolo=42 style flags containing values also exit 2 (name is the error surface)", async () => {
    const home = freshHome();
    const { code, stderr } = await runArgv(["--nonsense-flag=42"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option: --nonsense-flag");
    rmSync(home, { recursive: true, force: true });
  });

  test("unknown dashed token before a task word exits 2 — the word is NOT content-carried", async () => {
    const home = freshHome();
    const { code, stderr } = await runArgv(["--bogus", "fix", "the", "tests"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option: --bogus");
    rmSync(home, { recursive: true, force: true });
  });

  test("dashed tokens AFTER a task word pass through verbatim (existing policy unchanged)", () => {
    const flags = parseGlobalFlags(["fix", "--yolo", "tests"]);
    expect(flags.errors).toBeUndefined();
    expect(flags.args).toEqual(["fix", "--yolo", "tests"]);
    expect(flags.pendingDashes).toBeUndefined();
  });

  test("`--` end-of-options escape: dashed task text after it is task input, not an option", () => {
    const flags = parseGlobalFlags(["--", "--dashed-task-word"]);
    expect(flags.errors).toBeUndefined();
    expect(flags.pendingDashes).toBeUndefined();
    expect(flags.args).toEqual(["--dashed-task-word"]);
  });

  test("known globals and booleans still parse: no false-positive errors", () => {
    const flags = parseGlobalFlags(["--model", "opus", "--json", "fix", "things"]);
    expect(flags.errors).toBeUndefined();
    expect(flags.pendingDashes).toBeUndefined();
    expect(flags.model).toBe("opus");
    expect(flags.json).toBe(true);
    expect(flags.args).toEqual(["fix", "things"]);
  });
});

describe("P1-4 scoping: command-local options are never rejected", () => {
  test("xr <command> --local-option passes through to the command (declare/equivalence is out of scope)", () => {
    const flags = parseGlobalFlags(["skill", "--list"]);
    expect(flags.errors).toBeUndefined();
    expect(flags.pendingDashes).toBeUndefined();
    expect(flags.args).toEqual(["skill", "--list"]);
  });

  test("serve-local validation rejects only non-declared serve options", async () => {
    const home = freshHome();
    const { code, stderr } = await runArgv(["serve", "--bogus-flag"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option for serve: --bogus-flag");
    rmSync(home, { recursive: true, force: true });
  });

  test("catalog is the single declarative source: serve declares --lan exactly once", async () => {
    const { getCatalogEntry } = await import("../../src/cli/catalog.ts");
    const serve = getCatalogEntry("serve");
    expect(serve?.flags).toEqual(["--lan"]);
  });
});

describe("§15#16 `xr daemon` → precise relocation, never a task", () => {
  test("bare daemon exits 2 with the exact relocate-to-serve guidance", async () => {
    const home = freshHome();
    const { code, stderr } = await runArgv(["daemon"]);
    expect(code).toBe(2);
    expect(stderr).toContain("`daemon` is not a command");
    expect(stderr).toContain("xr serve");
    rmSync(home, { recursive: true, force: true });
  });

  test("daemon --help is the SAME relocation (not command-help, not a task)", async () => {
    const home = freshHome();
    const { code, stderr } = await runArgv(["daemon", "--help"]);
    expect(code).toBe(2);
    expect(stderr).toContain("`daemon` is not a command");
    rmSync(home, { recursive: true, force: true });
  });

  test("decideRoute classifies daemon before task heuristics and before --help", async () => {
    const { decideRoute } = await import("../../src/cli/route-decision.ts");
    expect(decideRoute({ head: "daemon", flagsVersion: false, flagsHelp: false, wantsCommandHelp: false }).kind).toBe("daemon");
    expect(decideRoute({ head: "daemon", flagsVersion: false, flagsHelp: true, wantsCommandHelp: true }).kind).toBe("daemon");
    expect(decideRoute({ head: "--dashed-task", flagsVersion: false, flagsHelp: false, wantsCommandHelp: false }).kind).toBe("task"); // `--`-escaped task text
  });
});
