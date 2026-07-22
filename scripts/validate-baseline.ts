#!/usr/bin/env bun
/** XR 3.1.6 Phase 0 validation runner.
 * Local-only required checks; optional integrations are reported as skipped.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { versionInfo } from "../src/core/version.ts";
import { runtimeEnvironment } from "../src/baseline/status.ts";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "docs", "release", "3.1.6");
const isolatedHome = join(tmpdir(), `xr-validate-${Date.now()}`);

type Step = { id: string; command: string[]; required: boolean; status: "pass" | "fail" | "skip"; code: number | null; durationMs: number; stdoutTail: string; stderrTail: string; reason?: string };

function tail(s: string, n = 4000): string { return s.length > n ? s.slice(-n) : s; }
async function runStep(id: string, command: string[], required = true, env: Record<string, string> = {}): Promise<Step> {
  const started = performance.now();
  const proc = Bun.spawn(command, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, XR_HOME: isolatedHome, ...env } });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { id, command, required, status: code === 0 ? "pass" : "fail", code, durationMs: performance.now() - started, stdoutTail: tail(stdout), stderrTail: tail(stderr) };
}

function sha256(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const steps: Step[] = [];
steps.push(await runStep("version-sync", ["bun", "run", "set-version:check"]));
steps.push(await runStep("typecheck", ["bun", "run", "typecheck"]));
steps.push(await runStep("test", ["bun", "test"]));
steps.push(await runStep("inventory", ["bun", "run", "scripts/baseline-inventory.ts"]));
steps.push(await runStep("cli-version", ["bun", "run", "src/index.ts", "--version"]));
steps.push(await runStep("cli-help", ["bun", "run", "src/index.ts", "help"]));
steps.push(await runStep("doctor-json", ["bun", "run", "src/index.ts", "doctor", "--json"]));
steps.push(await runStep("daemon-unit", ["bun", "test", "test/daemon.test.ts"]));
steps.push(await runStep("install-sh-syntax", ["bash", "-n", "install.sh"]));
steps.push(await runStep("package-dry-run", ["bun", "pm", "pack", "--dry-run"]));
steps.push({ id: "windows-install-ps1", command: ["powershell", "-File", "install.ps1"], required: false, status: "skip", code: null, durationMs: 0, stdoutTail: "", stderrTail: "", reason: "Windows validation requires a Windows runner; support matrix marks Windows as not verified in this Linux run." });
steps.push({ id: "docker-build", command: ["docker", "build", "."], required: false, status: "skip", code: null, durationMs: 0, stdoutTail: "", stderrTail: "", reason: "Docker CLI/daemon is unavailable in this environment; Docker remains blocked for release sign-off until run on a Docker-capable host." });
steps.push({ id: "optional-cloud-providers", command: ["xr", "providers", "test"], required: false, status: "skip", code: null, durationMs: 0, stdoutTail: "", stderrTail: "", reason: "Required baseline must not depend on cloud credentials or network." });

const requiredFailures = steps.filter((s) => s.required && s.status !== "pass");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version: versionInfo(),
  environment: runtimeEnvironment(),
  commit: await (async () => {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim() || "unknown";
  })(),
  isolatedHome,
  status: requiredFailures.length === 0 ? "pass" : "fail",
  steps,
  artifacts: {
    packageJsonSha256: sha256(join(ROOT, "package.json")),
    bunLockSha256: sha256(join(ROOT, "bun.lock")),
    inventorySha256: sha256(join(OUT_DIR, "inventory.json")),
  },
  skipped: steps.filter((s) => s.status === "skip").map((s) => ({ id: s.id, reason: s.reason })),
  knownLimitations: [
    "This validation run is Linux-only unless a Windows/macOS runner executes the same command.",
    "Cloud providers and local model servers are discovery/health-checked but not required without user credentials/runtimes.",
    "Performance numbers are produced by scripts/measure-baseline.ts and are host-specific.",
  ],
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "validation-report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(OUT_DIR, "VALIDATION_REPORT.md"), `# XR 3.1.6 Validation Report\n\nGenerated: ${report.generatedAt}\n\nStatus: **${report.status.toUpperCase()}**\n\nCommit: \`${report.commit}\`\n\nEnvironment: Bun ${report.environment.bun}, Node ${report.environment.node}, ${report.environment.os}/${report.environment.arch}.\n\nIsolated XR_HOME: \`${isolatedHome}\`\n\n| Step | Required | Status | Duration ms | Command |\n|---|---:|---|---:|---|\n${steps.map((s) => `| ${s.id} | ${s.required ? "yes" : "no"} | ${s.status} | ${s.durationMs.toFixed(1)} | \`${s.command.join(" ")}\` |`).join("\n")}\n\n## Skipped optional checks\n\n${report.skipped.map((s) => `- ${s.id}: ${s.reason}`).join("\n")}\n\n## Known limitations\n\n${report.knownLimitations.map((l) => `- ${l}`).join("\n")}\n\nMachine-readable report: \`validation-report.json\`.\n`);
console.log(`wrote ${relative(ROOT, OUT_DIR)}/validation-report.json and VALIDATION_REPORT.md`);
if (requiredFailures.length > 0) process.exit(1);
