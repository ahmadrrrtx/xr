#!/usr/bin/env bun
/**
 * XR Phase 1 · T9 — Hermetic black-box E2E from a published artifact.
 *
 *   1. Pack the package (npm pack honours the `files` allowlist).
 *   2. Install the tarball into a clean temp dir (npm install <tarball>).
 *   3. Drive the ARTIFACT's own launcher + sources (not this checkout):
 *        - `xr doctor --json`  → version identity matches release.manifest;
 *        - `xr audit verify`   → chain intact on a fresh XR_HOME;
 *        - a driver that boots the artifact's WorkspaceStore, writes audits,
 *          and verifies the chain (proves the shipped code is durable).
 *   4. Print a JSON report; exit non-zero on any failed effect.
 *
 * The launcher (bin/xr.cjs) requires Bun on PATH — CI provides it.
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const reports: string[] = [];
let failed = false;
function check(name: string, cond: boolean, detail = ""): void {
  reports.push(`${name}: ${cond ? "PASS" : "FAIL"}`);
  // eslint-disable-next-line no-console
  console.log(`${cond ? "CHECK" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!cond) failed = true;
}

const work = mkdtempSync(join(tmpdir(), "xr-e2e-"));
const tarballDir = join(work, "tarball");
const installDir = join(work, "install");
const xrHome = join(work, "data");
mkdirs(tarballDir, installDir, xrHome);

function mkdirs(...dirs: string[]): void {
  for (const d of dirs) {
    // eslint-disable-next-line no-undef
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(d, { recursive: true });
  }
}

const env = { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`, XR_HOME: xrHome };

// ── 1. Pack ───────────────────────────────────────────────────────────────
const pack = spawnSync("npm", ["pack", "--pack-destination", tarballDir], {
  cwd: ROOT, env, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"],
});
check("pack-succeeds", pack.status === 0, (pack.stderr ?? "").slice(0, 300));
const tarball = pack.stdout.trim().split("\n").pop()?.trim() ?? "";
check("tarball-produced", tarball.endsWith(".tgz"), tarball);

// ── 2. Install the artifact ───────────────────────────────────────────────
const npmInstall = spawnSync("npm", ["install", "--no-audit", "--no-fund", join(tarballDir, tarball)], {
  cwd: installDir, env, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"],
});
check("artifact-installs", npmInstall.status === 0, (npmInstall.stderr ?? "").slice(0, 300));
const bin = join(installDir, "node_modules", ".bin", process.platform === "win32" ? "xr.cmd" : "xr");
check("launcher-present", existsSync(bin));

const run = (args: string[], cwd: string) =>
  spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });

// ── 3a. Doctor + version identity (Phase 0 invariant) ─────────────────────
// NOTE: in a fresh hermetic environment the doctor correctly reports
// `summary.state: fail` when no cloud API keys are configured (fail-closed).
// We assert the identity + audit signals from its JSON, not the exit code.
const doctor = run(["doctor", "--json"], installDir);
let doctorVersion = "";
let doctorAuditOk = false;
try {
  const doc = JSON.parse(doctor.stdout);
  doctorVersion = doc.version?.version ?? "";
  doctorAuditOk = (doc.checks ?? []).some((c: { id: string; state: string }) => c.id === "audit" && c.state === "ok");
} catch {
  /* fallthrough */
}
const manifest = JSON.parse(
  (require("node:fs") as typeof import("node:fs")).readFileSync(join(ROOT, "release.manifest.json"), "utf8"),
) as { identity?: { version?: string } };
check("doctor-emits-json", doctorVersion.length > 0);
check("version-identity", doctorVersion === manifest.identity?.version, `doctor=${doctorVersion} manifest=${manifest.identity?.version}`);
check("doctor-audit-ok", doctorAuditOk);

// ── 3b. Audit surface of the artifact ─────────────────────────────────────
const auditVerify = run(["audit", "verify", "--json"], installDir);
check("audit-verify-ok", auditVerify.status === 0, (auditVerify.stderr ?? "").slice(0, 300));

// ── 3c. Durability driver against the artifact's own sources ──────────────
const pkgDir = join(installDir, "node_modules", "@rrrtx", "xr");
const driver = join(installDir, "driver.ts");
writeFileSync(
  driver,
  `
import { WorkspaceStore } from ${JSON.stringify(join(pkgDir, "src/state/workspace-store.ts"))};
const store = new WorkspaceStore("artifact", process.env.XR_HOME + "/artifact.db");
for (let i = 0; i < 10; i++) store.audit("artifact.e2e", { i });
store.createSession("a-sess", "artifact", "chat");
const okChain = store.verifyChain().valid;
const okCount = store.auditCount() >= 10;
const okSession = store.recentSessions(5).some((s) => s.id === "a-sess");
console.log(JSON.stringify({ okChain, okCount, okSession, auditCount: store.auditCount() }));
store.close();
if (!okChain || !okCount || !okSession) process.exit(1);
`,
);
const driverRun = spawnSync("bun", ["run", driver], { cwd: installDir, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
check("artifact-durability-driver", driverRun.status === 0, (driverRun.stderr ?? "").slice(0, 400));
const driverOut = driverRun.stdout.trim().split("\n").pop() ?? "{}";
let parsedDriver: Record<string, unknown> = {};
try {
  parsedDriver = JSON.parse(driverOut);
} catch {
  /* ignore */
}
check("artifact-chain-valid", parsedDriver.okChain === true, driverOut);
check("artifact-audit-count", (parsedDriver.auditCount as number) >= 10, driverOut);
check("artifact-session-persisted", parsedDriver.okSession === true, driverOut);

// ── Report ────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log(JSON.stringify({ ok: !failed, tarball, doctorVersion, reports }));
try {
  rmSync(work, { recursive: true, force: true });
} catch {
  /* keep temp for debugging */
}
if (failed) process.exit(1);

