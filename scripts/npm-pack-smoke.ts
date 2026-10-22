#!/usr/bin/env bun
/**
 * XR-LAUNCH-007 acceptance — the PACKED npm artifact can check for updates.
 *
 *   bun run scripts/npm-pack-smoke.ts
 *
 * 1. `npm pack` this checkout into a scratch directory.
 * 2. `npm install -g <tarball> --prefix <scratch>` — never the real global prefix.
 * 3. The installed package carries release.manifest.json.
 * 4. `xr --version` prints the manifest version.
 * 5. `xr update --check` exits 0 and `--json` reports the running version.
 *
 * Needs npm, Bun on PATH (the package's launcher is `#!/usr/bin/env bun`) and
 * network access to registry.npmjs.org for step 5. HOME/XR_HOME point into the
 * scratch directory, so the developer's real config is never touched. Runs in
 * CI on Linux, macOS and Windows (.github/workflows/npm-pack-smoke.yml).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WIN = process.platform === "win32";
const manifest = JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")) as { identity: { version: string } };
const VERSION = manifest.identity.version;

function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const argv = WIN ? ["cmd", "/d", "/s", "/c", ...cmd] : cmd;
  const p = Bun.spawnSync(argv, { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env }, stdout: "pipe", stderr: "pipe" });
  return { status: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

function step(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? " ok " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures += 1;
  }
}

let failures = 0;
const work = mkdtempSync(join(tmpdir(), "xr-npm-smoke-"));
const prefix = join(work, "prefix");
const home = join(work, "home");
mkdirSync(prefix, { recursive: true });
mkdirSync(home, { recursive: true });
const env = { HOME: home, USERPROFILE: home, XR_HOME: join(home, ".xr"), npm_config_update_notifier: "false" };

try {
  console.log(`[npm-pack-smoke] @rrrtx/xr ${VERSION} on ${process.platform}-${process.arch}`);
  const pack = run(["npm", "pack", "--pack-destination", work, "--silent"]);
  const tgz = pack.stdout.trim().split(/\r?\n/).pop() ?? "";
  step("npm pack", pack.status === 0 && tgz.endsWith(".tgz"), pack.status === 0 ? tgz : pack.stderr.trim().slice(0, 300));
  if (failures) throw new Error("pack failed");

  const inst = run(["npm", "install", "-g", join(work, tgz), "--prefix", prefix, "--no-audit", "--no-fund"], { env });
  step("npm install -g (scratch --prefix)", inst.status === 0, inst.status === 0 ? prefix : inst.stderr.trim().slice(0, 300));
  if (failures) throw new Error("install failed");

  const pkgDir = WIN ? join(prefix, "node_modules", "@rrrtx", "xr") : join(prefix, "lib", "node_modules", "@rrrtx", "xr");
  step("package ships release.manifest.json", existsSync(join(pkgDir, "release.manifest.json")), pkgDir);

  const bin = WIN ? join(prefix, "xr.cmd") : join(prefix, "bin", "xr");
  step("xr launcher installed", existsSync(bin), bin);

  const ver = run([bin, "--version"], { env });
  step("xr --version", ver.status === 0 && ver.stdout.includes(VERSION), ver.stdout.trim().split(/\r?\n/)[0] ?? ver.stderr.trim());

  const check = run([bin, "update", "--check"], { env });
  step("xr update --check exits 0", check.status === 0, (check.stdout + check.stderr).trim().split(/\r?\n/).slice(-2).join(" | "));

  const json = run([bin, "update", "--check", "--json"], { env });
  let parsed: { current?: string; source?: string } = {};
  try {
    parsed = JSON.parse(json.stdout.trim().split(/\r?\n/).pop() ?? "{}");
  } catch {
    /* reported below */
  }
  step(
    "xr update --check --json reports the running version",
    json.status === 0 && parsed.current === VERSION && /npm/.test(parsed.source ?? ""),
    JSON.stringify(parsed),
  );
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
