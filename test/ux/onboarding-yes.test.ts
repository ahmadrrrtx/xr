/**
 * Onboarding `--yes` (F-2 / S-1 friction register).
 *
 * Before this flag, the only non-interactive path was piping stdin and relying
 * on silent EOF-defaults — invisible to scripts. `xr onboarding --yes` now
 * accepts every prompt at its documented default, matching the established
 * semantics of `xr install --yes` (src/install/system.ts approved()).
 *
 * Pinned here:
 *   1. --yes completes with no prompts (unit, direct call);
 *   2. --yes IGNORES rogue stdin answers (e2e, black-box CLI spawn);
 *   3. the pre-existing non-yes EOF-defaults path is unchanged (control e2e).
 *
 * Scripting contract note: the wizard's per-question readline interfaces drop
 * buffered piped input, so feeding an answer SEQUENCE via stdin never worked
 * (hangs at the second prompt) — the supported scripted path is `--yes`
 * (verified in test 2 by feeding a rogue sequence and asserting it is
 * ignored). Only the /dev/null-style EOF-defaults path existed before, and
 * test 3 pins that it still works.
 *
 * Side-effect guard: under --yes, the "download recommended model?" consent
 * (default true) would start a real multi-GB ollama pull. When this host has
 * Ollama installed AND running, the behavior tests skip honestly (same
 * discipline as the live-browser a11y skips).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.XR_HOME = join(mkdtempSync(join(tmpdir(), "xr-onboard-yes-")), "home");

const REPO_ROOT = resolve(import.meta.dir, "../..");
const ENTRY = join(REPO_ROOT, "src/index.ts");

interface RunResult { code: number | null; stdout: string; stderr: string }

async function runCli(args: string[], stdinText: string | null, home: string, timeoutMs = 90_000): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: home, XR_HOME: join(home, ".xr"), NO_COLOR: "1" },
    stdin: stdinText == null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdinText != null && proc.stdin) {
    proc.stdin.write(stdinText);
    proc.stdin.end();
  }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  // Both streams must be drained CONCURRENTLY: awaiting stdout while the child
  // fills the 64 KB stderr pipe buffer deadlocks the child on write (the
  // wizard is chatty on stderr when CI is unset) — first version of this test
  // hung exactly that way and exited 143 on the timeout kill.
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stdout, stderr };
}

// ── Side-effect guard ────────────────────────────────────────────────────────
// Evaluated once for the whole file; uses the same code path the wizard uses.
const { ollamaStatus } = await import("../../src/local/ollama.ts");
const ollamaLive = (await ollamaStatus()).installed && (await ollamaStatus()).running;
if (ollamaLive) {
  console.log("[onboarding-yes] Ollama installed+running on this host — behavior tests skip (would consent a real multi-GB model pull under defaults).");
}

describe("onboarding --yes", () => {
  test("unit: runOnboarding({ yes: true }) completes and writes default config with no provider secrets", async () => {
    if (ollamaLive) return; // guard: see file header

    const { runOnboarding } = await import("../../src/interfaces/onboard.ts");
    const { loadConfig, configPath } = await import("../../src/config/config.ts");

    // Capture output: the non-interactive notice must be announced.
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try {
      await runOnboarding({ yes: true });
    } finally {
      console.log = origLog;
    }

    expect(lines.join("\n")).toContain("Non-interactive onboarding (--yes)");
    // A-12 / R-5: the capability scan is rendered at first run, reusing the
    // doctor detection engine (rows exist on every host; states vary).
    expect(lines.join("\n")).toContain("What works on this machine");
    expect(lines.join("\n")).toContain("Voice tools");
    expect(lines.join("\n")).toContain("Desktop control");
    expect(lines.join("\n")).toContain("xr doctor");
    expect(existsSync(configPath())).toBe(true);

    const { config } = loadConfig();
    // Defaults accepted, not empty.
    expect(config.workspace?.name).toBe("My First Workspace");
    expect(typeof config.defaults.provider).toBe("string");
    expect(config.defaults.provider.length).toBeGreaterThan(0);
    expect(typeof config.defaults.model).toBe("string");
    expect(["local-only", "hybrid", "cloud-first"]).toContain(config.localModels.routing);

    // No provider selected by default ⇒ nothing may have been written to the
    // secret store. (listFileSecrets returns a Record, not a Map.)
    const { listFileSecrets } = await import("../../src/security/secrets.ts");
    expect(Object.keys(listFileSecrets())).toHaveLength(0);
  }, 30_000);

  test("e2e: `xr onboarding --yes` exits 0 and ignores rogue stdin answers", async () => {
    if (ollamaLive) return;

    const home = mkdtempSync(join(tmpdir(), "xr-onboard-yes-e2e-"));
    // If --yes were ignored, this input would answer the prompts instead and
    // the workspace would become "Rogue Workspace".
    const rogue = "1\nRogue Workspace\n" + "\n".repeat(20);
    const res = await runCli(["onboarding", "--yes"], rogue, home);

    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Non-interactive onboarding (--yes)");

    const configFile = join(home, ".xr", "config.json");
    expect(existsSync(configFile)).toBe(true);
    const saved = JSON.parse(readFileSync(configFile, "utf8")) as { workspace?: { name?: string } };
    expect(saved.workspace?.name).toBe("My First Workspace");
  }, 120_000);

  test("control e2e: interactive wizard with instantly-EOF'd stdin completes with defaults (no hang)", async () => {
    if (ollamaLive) return;

    const home = mkdtempSync(join(tmpdir(), "xr-onboard-interactive-"));
    // An empty, immediately-closed pipe: previously the first prompt hung
    // forever (90 s timeout witnessed); the readLine EOF fix resolves the
    // prompt's default instead. This run must finish well inside the timeout.
    const res = await runCli(["onboarding"], "", home);

    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("Non-interactive onboarding (--yes)");
    const configFile = join(home, ".xr", "config.json");
    expect(existsSync(configFile)).toBe(true);
    const saved = JSON.parse(readFileSync(configFile, "utf8")) as { workspace?: { name?: string } };
    expect(saved.workspace?.name).toBe("My First Workspace");
  }, 120_000);

  test("prompt primitives: EOF yields ask default, plain confirm keeps its default, security gates fail closed", async () => {
    // Black-box: real src primitives, real EOF-on-pipe stdin, in a tiny probe
    // process (in-process stdin manipulation would pollute the suite).
    const dir = mkdtempSync(join(tmpdir(), "xr-eof-probe-"));
    const probe = join(dir, "probe.ts");
    writeFileSync(probe, [
      `import { ask, confirm } from ${JSON.stringify(resolve(REPO_ROOT, "src/interfaces/cli.ts"))};`,
      `console.log("ASK=" + (await ask("Name", { default: "fallback" })));`,
      `console.log("PLAIN=" + (await confirm("Continue with default?", true)));`,
      `console.log("GATE=" + (await confirm("Approve this action?", true, { eofApproves: false })));`,
    ].join("\n"));

    const proc = Bun.spawn([process.execPath, probe], {
      cwd: REPO_ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.end(); // instant EOF on a pipe — the case that used to hang
    const timer = setTimeout(() => proc.kill(), 15_000);
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    clearTimeout(timer);

    expect(code).toBe(0);
    expect(stdout).toContain("ASK=fallback"); // EOF → default
    expect(stdout).toContain("PLAIN=true"); // EOF → benign informational default
    expect(stdout).toContain("GATE=false"); // EOF at a consent gate → DENY
  }, 20_000);
});
