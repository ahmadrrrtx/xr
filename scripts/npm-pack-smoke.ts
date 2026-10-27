#!/usr/bin/env bun
/**
 * Exercise the PACKED npm artifact, not the checkout or an ambient Bun.
 *
 * Pack and install with scripts disabled, first globally and then locally, in
 * scratch directories. The install and launch PATH contains Node but no Bun.
 * Also check the failure mode when optional dependencies are deliberately
 * omitted. Requires Node/npm, Bun (to run this test), and registry access.
 * CI runs this on Linux, macOS, and Windows; other OS/CPU/libc combinations
 * and coding-agent/provider effects need additional native tests.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WIN = process.platform === "win32";
const manifest = JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")) as { identity: { version: string } };
const VERSION = manifest.identity.version;
const BUN_VERSION = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();
const node = Bun.which("node");
const npm = Bun.which("npm");
if (!node || !npm) throw new Error("npm-pack-smoke requires Node and npm on PATH");
const cmdExe = WIN ? (process.env.ComSpec ?? process.env.COMSPEC ?? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe")) : "";

type Env = Record<string, string | undefined>;
function run(cmd: string[], opts: { cwd?: string; env?: Env } = {}) {
  const argv = WIN ? [cmdExe, "/d", "/s", "/c", ...cmd] : cmd;
  const p = Bun.spawnSync(argv, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, stdout: "pipe", stderr: "pipe" });
  return { status: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}
function step(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? " ok " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
function detail(p: { stdout: string; stderr: string }): string {
  return (p.stdout + p.stderr).trim().split(/\r?\n/).slice(-2).join(" | ").slice(0, 350);
}

let failures = 0;
const work = mkdtempSync(join(tmpdir(), "xr-npm-smoke-"));
const prefix = join(work, "prefix"), local = join(work, "local"), omitted = join(work, "omit"), home = join(work, "home");
const nodeOnly = join(work, "node-only");
for (const dir of [prefix, local, omitted, home, nodeOnly]) mkdirSync(dir, { recursive: true });
// npm's POSIX shim uses /usr/bin/env node. On Windows copy node.exe so neither
// installation nor execution can discover the runner's Bun through PATH.
if (WIN) copyFileSync(node, join(nodeOnly, "node.exe"));
else symlinkSync(node, join(nodeOnly, "node"));
const env: Env = { ...process.env };
for (const k of Object.keys(env)) if (k.toLowerCase() === "path") delete env[k];
delete env.XR_BINARY; delete env.NODE_PATH;
Object.assign(env, {
  PATH: nodeOnly, HOME: home, USERPROFILE: home, XR_HOME: join(home, ".xr"),
  npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false",
});

try {
  console.log(`[npm-pack-smoke] @rrrtx/xr ${VERSION} on ${process.platform}-${process.arch}`);
  const noBun = Bun.spawnSync([node, "-e", "const p=require('child_process').spawnSync('bun',['--version']); process.stdout.write(p.error?.code || 'FOUND')"], { env, stdout: "pipe", stderr: "pipe" });
  step("install/launch PATH has Node but no Bun", noBun.exitCode === 0 && noBun.stdout.toString() === "ENOENT");
  if (failures) throw new Error("Node-only PATH setup failed");

  const pack = run([npm, "pack", "--ignore-scripts", "--pack-destination", work, "--silent"], { env });
  const tgz = pack.stdout.trim().split(/\r?\n/).pop() ?? "";
  step("npm pack --ignore-scripts", pack.status === 0 && tgz.endsWith(".tgz"), pack.status === 0 ? tgz : detail(pack));
  if (failures) throw new Error("pack failed");
  const tarball = join(work, tgz);

  const inst = run([npm, "install", "-g", tarball, "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"], { env });
  step("global install without Bun or scripts", inst.status === 0, inst.status === 0 ? prefix : detail(inst));
  if (failures) throw new Error("global install failed");
  const pkgDir = WIN ? join(prefix, "node_modules", "@rrrtx", "xr") : join(prefix, "lib", "node_modules", "@rrrtx", "xr");
  step("package ships release manifest and Bun notice", existsSync(join(pkgDir, "release.manifest.json")) && existsSync(join(pkgDir, "licenses", `bun-v${BUN_VERSION}-LICENSE.md`)));
  const bin = WIN ? join(prefix, "xr.cmd") : join(prefix, "bin", "xr");
  step("global xr launcher installed", existsSync(bin), bin);

  const ver = run([bin, "--version"], { env });
  step("global xr --version with no Bun on PATH", ver.status === 0 && ver.stdout.includes(VERSION), detail(ver));
  const check = run([bin, "update", "--check"], { env });
  step("xr update --check exits 0", check.status === 0, detail(check));
  const json = run([bin, "update", "--check", "--json"], { env });
  let parsed: { current?: string; source?: string } = {};
  try { parsed = JSON.parse(json.stdout.trim().split(/\r?\n/).pop() ?? "{}"); } catch { /* reported below */ }
  step("xr update --check --json reports running version", json.status === 0 && parsed.current === VERSION && /npm/.test(parsed.source ?? ""), JSON.stringify(parsed));

  const localInstall = run([npm, "install", tarball, "--prefix", local, "--ignore-scripts", "--no-audit", "--no-fund"], { env });
  step("local install without Bun or scripts", localInstall.status === 0, localInstall.status === 0 ? local : detail(localInstall));
  const localBin = join(local, "node_modules", ".bin", WIN ? "xr.cmd" : "xr");
  const localVer = localInstall.status === 0 ? run([localBin, "--version"], { env }) : { status: 1, stdout: "", stderr: "install failed" };
  step("locally installed xr --version with hoisted runtime", localVer.status === 0 && localVer.stdout.includes(VERSION), detail(localVer));

  // npm 10 can retain a global package's own optional deps despite --omit;
  // a fresh local install actually omits them and exercises this failure mode.
  const noOptional = run([npm, "install", tarball, "--prefix", omitted, "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund"], { env });
  step("local install with optional dependencies omitted", noOptional.status === 0, noOptional.status === 0 ? omitted : detail(noOptional));
  const omittedBin = join(omitted, "node_modules", ".bin", WIN ? "xr.cmd" : "xr");
  const absent = noOptional.status === 0 ? run([omittedBin, "--version"], { env }) : { status: 1, stdout: "", stderr: "install failed" };
  step("omitted runtime fails with actionable diagnostic", absent.status === 127 && absent.stderr.includes("--omit=optional"), detail(absent));
} catch (err) {
  if (!failures) step("smoke", false, err instanceof Error ? err.message : String(err));
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures) {
  console.error(`[npm-pack-smoke] FAIL — ${failures} step(s) failed`);
  process.exit(1);
}
console.log("[npm-pack-smoke] PASS");
