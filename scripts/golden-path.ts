#!/usr/bin/env bun
/**
 * XR Phase 1 · T6 — Golden path (hermetic, deterministic, effect-asserting).
 *
 * Journey:  install → verify → first answer → restart → resume →
 *           second answer → uninstall
 *
 * Runs with XR_HOME + HOME pinned by the caller so nothing touches real user
 * data. Every step asserts a REAL effect (audit rows, execution records, chain
 * integrity, filesystem state) and the script exits non-zero with
 * `FAIL <step>: <reason>` on the first broken effect. The final line is a JSON
 * report consumed by test/reliability/golden-path.test.ts.
 *
 * Cross-platform notes (Phase 1 · T6/T7):
 *   - The wizard subprocess is spawned with `process.execPath` (the absolute
 *     path of the running bun binary) instead of the bare `bun` command name —
 *     on Windows, spawning a bare command from inside bun is not reliably
 *     resolved via PATH, which failed the Windows CI job.
 *   - FAIL lines are printed to BOTH stderr and stdout so GitHub Actions shows
 *     the exact failing step in the (truncated) step output.
 *   - A top-level try/catch converts any thrown error into a clean FAIL line
 *     instead of an uncaught stack (which the CI annotation hides).
 *
 * The "answers" use a deterministic in-process stub adapter (a test harness,
 * not a product feature): no network, no model, full persistence.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const results: Record<string, unknown> = [];
function ok(name: string): void {
  results.push(name);
  console.log(`CHECK ${name}`);
}
function fail(name: string, reason: string): never {
  const line = `FAIL ${name}: ${reason}`;
  console.error(line); // raw log
  console.log(line); // visible in the truncated GitHub step output
  process.exit(1);
}
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) ok(name);
  else fail(name, detail);
}

async function main(): Promise<void> {
  const XR_HOME = process.env.XR_HOME!;
  if (!XR_HOME) fail("env", "XR_HOME must be set");
  const HOME = process.env.HOME ?? homedir();
  const packageRoot = join(import.meta.dir, "..");
  console.log(
    `GOLDEN_PATH start bun=${process.execPath} platform=${process.platform} XR_HOME=${XR_HOME} HOME=${HOME} root=${packageRoot}`,
  );

  // ── 1. Install ──────────────────────────────────────────────────────────
  // Use the absolute bun binary path — bare "bun" is not reliably resolvable
  // via PATH when spawned from inside bun on Windows.
  const bunBin = process.execPath;
  const installRes = spawnSync(
    bunBin,
    ["run", "src/index.ts", "install", "--mode", "minimal", "--yes", "--from-bootstrap"],
    { cwd: packageRoot, env: { ...process.env, XR_HOME, HOME }, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (installRes.error) {
    fail("install-wizard-exit-0", `spawn failed: ${String(installRes.error)}`);
  }
  check(
    "install-wizard-exit-0",
    installRes.status === 0,
    `exit=${installRes.status} stdout=${(installRes.stdout ?? "").slice(0, 300)} stderr=${(installRes.stderr ?? "").slice(0, 300)}`,
  );
  check("install-creates-config", existsSync(join(XR_HOME, "config.json")), XR_HOME);
  check("install-creates-db", existsSync(join(XR_HOME, "xr.db")));

  // Simulate install.sh artifacts (launcher + package dir) so the uninstall
  // step has real filesystem targets. The launcher name must match
  // resolveUninstallPaths (xr.cmd on Windows, xr elsewhere).
  const launcher = join(HOME, ".local", "bin", process.platform === "win32" ? "xr.cmd" : "xr");
  const installDir = join(HOME, ".xr-agent");
  mkdirSync(join(HOME, ".local", "bin"), { recursive: true });
  mkdirSync(installDir, { recursive: true });
  writeFileSync(launcher, "#!/usr/bin/env bash\nexec bun run \"$HOME/.xr-agent/src/index.ts\" \"$@\"\n", { mode: 0o755 });
  writeFileSync(join(installDir, "marker.txt"), "package");

  // ── Boot the runtime ────────────────────────────────────────────────────
  const { XRKernel } = await import("../src/core/kernel.ts");
  const { Tokens } = await import("../src/core/tokens.ts");

  let kernel = new XRKernel();
  await kernel.bootstrap();
  const firstExec = kernel.registry.resolve(Tokens.Execution);

  // ── 2. First answer (deterministic stub model adapter) ──────────────────
  const first = await firstExec.execute({
    workspaceId: "default",
    capability: { kind: "model_call", name: "golden_model" },
    actor: { kind: "user", source: "cli" },
    intent: { summary: "golden path first answer", origin: { kind: "user", source: "cli" } },
    idempotency: "naturally_idempotent",
    inputSummary: "golden path first answer",
    run: async () => ({ summary: "FIRST-ANSWER: 42", transportOk: true }),
  });
  check("first-answer-succeeded", first.outcome?.kind === "succeeded", JSON.stringify(first.outcome));

  const store1 = kernel.registry.resolve(Tokens.Store);
  const countAfterFirst = store1.auditCount();
  check("first-answer-audited", countAfterFirst > 0);
  check("chain-intact-after-first", store1.verifyChain().valid === true);

  // ── 3. Restart (full shutdown + fresh boot) ─────────────────────────────
  await kernel.shutdown();
  kernel = new XRKernel();
  await kernel.bootstrap();
  await kernel.start();
  const store2 = kernel.registry.resolve(Tokens.Store);
  check("restart-preserves-audit", store2.auditCount() >= countAfterFirst);
  check("chain-intact-after-restart", store2.verifyChain().valid === true);
  const exec2 = kernel.registry.resolve(Tokens.Execution);

  // ── 4. Resume (startup recovery classification) ─────────────────────────
  const recovery = await exec2.startupRecovery("default");
  check("recovery-runs", Array.isArray(recovery));
  check("no-unresolved-work", recovery.every((r: { recoveryState: string }) => r.recoveryState !== "recovery_blocked"));

  // ── 5. Second answer after restart ──────────────────────────────────────
  const second = await exec2.execute({
    workspaceId: "default",
    capability: { kind: "model_call", name: "golden_model" },
    actor: { kind: "user", source: "cli" },
    intent: { summary: "golden path second answer", origin: { kind: "user", source: "cli" } },
    idempotency: "naturally_idempotent",
    inputSummary: "golden path second answer",
    run: async () => ({ summary: "SECOND-ANSWER: 7", transportOk: true }),
  });
  check("second-answer-succeeded", second.outcome?.kind === "succeeded", JSON.stringify(second.outcome));
  check("chain-intact-final", store2.verifyChain().valid === true);

  // ── 6. Uninstall (keep-data) ────────────────────────────────────────────
  const { performUninstall, resolveUninstallPaths } = await import("../src/install/uninstall.ts");
  const paths = resolveUninstallPaths();
  const uninstallSummary = performUninstall({ mode: "keep-data", yes: true, packageRoot }, paths);
  check("uninstall-launcher-removed", uninstallSummary.launcherRemoved);
  check("uninstall-data-kept", uninstallSummary.dataHomeRemoved === false);
  check("uninstall-launcher-gone", !existsSync(launcher));
  // installDir === dataHome when XR_HOME is set (install.sh/config.ts both
  // honour XR_HOME) → --keep-data keeps the shared directory.
  if (paths.installDir === paths.dataHome) {
    check("uninstall-keeps-shared-dir", uninstallSummary.installDirRemoved === false);
  } else {
    check("uninstall-install-dir-removed", uninstallSummary.installDirRemoved);
  }
  check("uninstall-data-home-present", existsSync(join(XR_HOME, "config.json")));

  // Capture final state BEFORE shutdown (the store closes with the kernel).
  const { PKG } = await import("../src/core/version.ts");
  const report = {
    ok: true,
    version: PKG.version,
    steps: results,
    auditEntries: store2.auditCount(),
    chainValid: store2.verifyChain().valid,
    firstOutcome: first.outcome?.kind,
    secondOutcome: second.outcome?.kind,
    recoveryCount: recovery.length,
  };
  await kernel.shutdown();
  console.log(JSON.stringify(report));
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  const line = `FAIL uncaught: ${msg.slice(0, 600)}`;
  console.error(line);
  console.log(line);
  process.exit(1);
});
