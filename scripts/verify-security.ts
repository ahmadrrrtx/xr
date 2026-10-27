#!/usr/bin/env bun
/** Behavioral gate replacing the historical source.includes() checklist.
 * Linux must actually pass a kernel namespace self-check. Mock tests alone
 * cannot make this gate green. Online dependency audit is mandatory by default. */
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { boundedCheck } from "./lib/bounded-check";
const ROOT = resolve(import.meta.dir, ".."),
  args = process.argv.slice(2),
  outIndex = args.indexOf("--out");
if (
  args.some(
    (a, i) =>
      !["--offline", "--full", "--out"].includes(a) &&
      !(outIndex >= 0 && i === outIndex + 1),
  ) ||
  (outIndex >= 0 &&
    (!args[outIndex + 1] || args[outIndex + 1]!.startsWith("--")))
)
  throw new Error(
    "Usage: bun scripts/verify-security.ts [--out report.json] [--full (canonical segmented parity, blackboxes separate)] [--offline (incomplete, nonzero)]",
  );
const saved = { ...process.env },
  home = mkdtempSync(join(tmpdir(), "xr-security-gate-"));
const allowed = new Set([
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "CI",
  "GITHUB_REF_TYPE",
  "GITHUB_REF_NAME",
  "XR_TEST_BWRAP_PATH",
  "XR_SEG_TIMEOUT",
  "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
]);
for (const k of Object.keys(process.env))
  if (!allowed.has(k)) delete process.env[k];
process.env.HOME = home;
process.env.XR_HOME = home;
process.env.XR_SECRET_BACKEND = "file";
process.env.XR_NETWORK_PROBES = "off";
process.env.XR_SECRET_NAMESPACE = "desktop";
type Stage = {
  name: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "NOT RUN" | "NOT APPLICABLE";
  exitCode: number | null;
  wallMs: number;
  detail?: string;
  command?: string[];
};
const stages: Stage[] = [],
  start = performance.now();
async function command(name: string, command: string[], timeout = 120_000): Promise<void> {
  console.log(`\n=== ${name}: ${command.join(" ")} ===`);
  const r = await boundedCheck(command,{cwd:ROOT,env:process.env,timeoutMs:timeout,onOutput:text=>process.stdout.write(text)});
  stages.push({name,status:r.exitCode===0&&!r.error&&!r.timedOut&&!r.outputTruncated?"PASS":"FAIL",exitCode:r.exitCode,wallMs:r.wallMs,command,...(r.error||r.timedOut||r.outputTruncated?{detail:r.error??(r.timedOut?"bounded process-group timeout":"output ceiling exceeded")}:{})});
}

try {
  const expected = await Bun.file(join(ROOT, ".bun-version")).text();
  stages.push({
    name: "pinned-bun",
    status: Bun.version === expected.trim() ? "PASS" : "FAIL",
    exitCode: null,
    wallMs: 0,
    detail: `actual ${Bun.version}; expected ${expected.trim()}`,
  });
  if (process.platform === "linux") {
    const { NamespaceSandboxBackend } =
      await import("../src/runtime/trust/environment/namespace");
    const t = performance.now(),
      unshare = new NamespaceSandboxBackend({ only: "unshare" }),
      bwrap = new NamespaceSandboxBackend({
        only: "bwrap",
        ...(process.env.XR_TEST_BWRAP_PATH
          ? { bwrapPath: process.env.XR_TEST_BWRAP_PATH }
          : {}),
      });
    const a = await unshare.detect(),
      b = await bwrap.detect();
    stages.push({
      name: "linux-kernel-isolation",
      status: a || b ? "PASS" : "BLOCKED",
      exitCode: null,
      wallMs: performance.now() - t,
      detail: `real self-check: unshare=${a},bwrap=${b}; at least one mandatory; behavioral effect tests follow`,
    });
  } else
    stages.push({
      name: "linux-kernel-isolation",
      status: "NOT APPLICABLE",
      exitCode: null,
      wallMs: 0,
      detail:
        "Not Linux; this does not validate native macOS/Windows containment",
    });
  await command("release-identity", [
    process.execPath,
    "scripts/release-manifest.ts",
    "--check",
  ]);
  if (process.platform === "linux")
    await command(
      "linux-isolation-effects",
      [
        process.execPath,
        "test",
        "test/trust/namespace-confinement.test.ts",
        "test/trust/inherited-submount.test.ts",
        "test/trust/process-bounds.test.ts",
      ],
      60_000,
    );
  await command("behavioral-security", args.includes("--full") ? ["bash","scripts/parity-suite-runner.sh",process.platform,"--exclude","^test/e2e-blackbox/"] : [
    process.execPath,"test","test/trust","test/security","test/providers","test/daemon","test/phase1/turn-contract.test.ts","test/reliability/agent-benchmark.test.ts","test/release","test/supply-chain"
  ], args.includes("--full") ? 600_000 : 120_000);
  await command("agent-smoke", [
    process.execPath,
    "scripts/agent-benchmark.ts",
    "--smoke",
  ]);
  if (args.includes("--offline"))
    stages.push({
      name: "online-dependency-audit",
      status: "NOT RUN",
      exitCode: null,
      wallMs: 0,
      detail: "Offline explicitly requested; gate remains INCOMPLETE/nonzero",
    });
  else
    await command(
      "online-dependency-audit",
      ["bash", "scripts/audit-deps.sh", ".", "desktop"],
      120_000,
    );
  const complete = !stages.some((s) =>
    ["FAIL", "BLOCKED", "NOT RUN"].includes(s.status),
  );
  const report = {
    schemaVersion: 1,
    gate: "xr-behavioral-security",
    status: complete ? "PASS" : "NOT READY",
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    wallMs: performance.now() - start,
    scope:
      "Executed source/runtime security regressions + Linux kernel self-check + governed fixture smoke + dependency audit. NOT native GUI, production signatures, live providers or whole-machine absence of effects.",
    stages,
  };
  if (outIndex >= 0) {
    const path = resolve(args[outIndex + 1]!);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = complete ? 0 : 1;
} finally {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(home, { recursive: true, force: true });
}
