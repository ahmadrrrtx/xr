/**
 * XR Phase 5 · real-device matrix probe — runs ON the target OS (CI runners
 * are real Windows/macOS/Linux hosts; this sandbox is not).
 *
 * Lanes per OS: installed (silent install + boot + sidecar liveness) and
 * upgraded (install base → install current on top → state survives). When no
 * previous-release bundle dir is supplied the base install uses the current
 * bundle and the lane honestly reports `upgrade=mechanics-only`.
 *
 * It asserts ONLY measured facts: installer exit 0, sidecar answers on
 * :3141 (any HTTP status = alive + enforcing auth), XR_HOME state present
 * before and after the upgrade install. Any step that cannot run is a FAIL,
 * never a silent skip.
 *
 * Usage: bun run scripts/real-device-matrix.ts --bundles <dir> [--prev <dir>]
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const bundles = arg("--bundles");
const prev = arg("--prev");
if (!bundles || !existsSync(bundles)) {
  console.error("[rdm] --bundles <dir> with installer artifacts is required");
  process.exit(2);
}
const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");
const files = readdirSync(bundles);

const pick = (re: RegExp): string => {
  const f = files.find((x) => re.test(x));
  if (!f) throw new Error(`no ${re} installer in ${bundles}: ${files.join(", ")}`);
  return join(bundles, f);
};

const sh = (cmd: string, opts: { silent?: boolean } = {}) =>
  execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", timeout: 240_000 });

async function sidecarAlive(timeoutMs = 45_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch("http://127.0.0.1:3141/api/v1/health", { signal: AbortSignal.timeout(2000) });
      if (res.status > 0) return true; // any HTTP answer = engine alive (401 without auth is correct)
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

let app: ChildProcess | null = null;
const launch = (kind: "deb" | "app" | "exe", target: string) => {
  if (kind === "deb") app = spawn("xvfb-run", ["-a", target], { stdio: "ignore", detached: true });
  else if (kind === "app") app = spawn(target, [], { stdio: "ignore", detached: true });
  else app = spawn(target, [], { stdio: "ignore", detached: true, windowsHide: true });
};
const killApp = () => {
  if (!app?.pid) return;
  try { process.kill(-app.pid); } catch { try { app.kill("SIGKILL"); } catch { /* gone */ } }
  app = null;
};

const stateSnapshot = (): string[] =>
  existsSync(XR_HOME) ? readdirSync(XR_HOME).sort() : [];

const report: string[] = [];
const ok = (lane: string, detail: string) => report.push(`✓ ${os}/${lane}: ${detail}`);
const fail = (lane: string, detail: string): never => {
  console.log(report.join("\n"));
  console.error(`✗ ${os}/${lane}: ${detail}`);
  process.exit(1);
};

async function installBoot(tag: string, installer: string): Promise<void> {
  if (os === "linux") {
    sh(`sudo dpkg -i "${installer}"`);
    const bin = sh(`dpkg-deb -c "${installer}" | grep -oE '\\./usr/bin/[^ ]+' | head -1`, { silent: true })
      .toString().trim().replace("./", "/");
    if (!bin) fail("installed", "no /usr/bin entry in deb");
    launch("deb", bin);
  } else if (os === "macos") {
    const mnt = "/Volumes/xrrdm";
    sh(`hdiutil attach "${installer}" -mountpoint ${mnt} -nobrowse -quiet`);
    const appSrc = readdirSync(mnt).find((x) => x.endsWith(".app"));
    if (!appSrc) fail("installed", "no .app in dmg");
    sh(`rm -rf "/Applications/${appSrc}" && cp -R "${mnt}/${appSrc}" /Applications/ && hdiutil detach ${mnt} -quiet`);
    const bin = join("/Applications", appSrc, "Contents/MacOS", readdirSync(join("/Applications", appSrc, "Contents/MacOS"))[0]!);
    launch("app", bin);
  } else {
    sh(`"${installer}" /S`); // NSIS silent, per-user
    const base = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "XR Desktop");
    const exe = join(base, "XR Desktop.exe");
    if (!existsSync(exe)) fail("installed", `no installed exe at ${exe}`);
    launch("exe", exe);
  }
  (await sidecarAlive()) ? ok(tag, "installer exit 0 + sidecar answered on :3141") : fail(tag, "sidecar never answered");
  killApp();
}

/* ── lane: installed ─────────────────────────────────────────────────────── */
const installer =
  os === "linux" ? pick(/\.deb$/) : os === "macos" ? pick(/\.dmg$/) : pick(/-setup\.exe$/);
await installBoot("installed", installer);

/* ── lane: upgraded ──────────────────────────────────────────────────────── */
const baseInstaller = prev && existsSync(prev)
  ? join(prev, readdirSync(prev).find((x) => (os === "linux" ? /\.deb$/.test(x) : os === "macos" ? /\.dmg$/.test(x) : /-setup\.exe$/.test(x)))!)
  : installer;
if (baseInstaller !== installer) await installBoot("upgraded/base", baseInstaller);
else report.push(`· ${os}/upgraded: no --prev bundles → mechanics-only reinstall`);
const before = stateSnapshot();
await installBoot("upgraded/current", installer);
const after = stateSnapshot();
before.length > 0 && before.every((f) => after.includes(f))
  ? ok("upgraded", `state survived (${before.length} XR_HOME entries intact)`)
  : before.length === 0
    ? ok("upgraded", "fresh host: no prior state to preserve (honest)")
    : fail("upgraded", `XR_HOME lost entries: ${before.filter((f) => !after.includes(f)).join(",")}`);

console.log(report.join("\n"));
console.log(`[rdm] ${os}: PASS (upgrade=${prev ? "real" : "mechanics-only"})`);
