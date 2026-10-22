#!/usr/bin/env bun
/**
 * XR-LAUNCH-011 / 026 — clean-machine journey for the desktop app.
 *
 *   bun run scripts/journey/desktop-journey.ts --slug <linux-x64|windows-x64|windows-arm64|darwin-arm64|darwin-x64>
 *        --bundles <dir with the CI bundle artifact> [--webdriver] [--evidence out.json] [--class CI|LR]
 *
 * Runs on a runner that did NOT build the bundle (it downloads the artifact):
 *
 *   build/package  the bundle job's artifact is present; its sha256 is recorded
 *   install        Linux: the .deb through apt · Windows: NSIS `/S` (per-user)
 *                  macOS: the .dmg mounted read-only, XR.app copied out
 *   launch         the GUI starts and spawns its engine sidecar, whose
 *                  /api/v1/health answers. With --webdriver (Linux/Windows,
 *                  tauri-driver on PATH) a WebDriver session additionally
 *                  proves the webview rendered (title "XR", #root populated).
 *                  macOS has no WKWebView driver: launch + sidecar health only.
 *                  Closing the app must take the sidecar down with it.
 *   agent          the INSTALLED engine (the sidecar the app ships) performs a
 *                  real task against the deterministic fixture provider
 *   update         de-scoped until XR-LAUNCH-008 signing keys exist (the
 *                  updater manifest is dry-run by desktop-app.yml)
 *   uninstall      apt remove · NSIS uninstaller `/S` · removing XR.app;
 *                  binaries and the uninstall registration are gone
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { gitState, sh, sha256, tail, type JourneyEvidence, type StepName, type StepResult } from "./cli-journey.ts";
import { FIXTURE_CONTENT, FIXTURE_FILE, FIXTURE_MODEL, FIXTURE_PROVIDER, startFixtureProvider, writeFixtureConfig } from "./fixtures.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function findFiles(dir: string, pred: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!e.endsWith(".app")) findFiles(p, pred, out);
      else if (pred(e)) out.push(p);
    } else if (pred(e)) out.push(p);
  }
  return out;
}

/** Which installer flavour this journey installs per slug. */
export function flavourFor(slug: string): { channel: "deb" | "nsis" | "dmg"; match: (f: string) => boolean } {
  if (slug.startsWith("linux")) return { channel: "deb", match: (f) => f.endsWith(".deb") };
  if (slug.startsWith("windows")) return { channel: "nsis", match: (f) => /-setup\.exe$/i.test(f) };
  if (slug.startsWith("darwin")) return { channel: "dmg", match: (f) => f.endsWith(".dmg") };
  throw new Error(`unknown desktop slug ${slug}`);
}

/** Port the engine sidecar (process name xr-engine*) listens on, or null. */
async function enginePort(): Promise<number | null> {
  let out = "";
  if (process.platform === "linux") out = (await sh(["sh", "-c", "ss -ltnpH 2>/dev/null | grep xr-engine || true"])).out;
  else if (process.platform === "darwin") out = (await sh(["sh", "-c", "lsof -nP -a -c xr-engine -iTCP -sTCP:LISTEN 2>/dev/null || true"])).out;
  else out = (await sh(["pwsh.exe", "-NoProfile", "-Command", "$p = (Get-Process xr-engine* -ErrorAction SilentlyContinue).Id; if ($p) { Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $p -contains $_.OwningProcess } | ForEach-Object { '127.0.0.1:' + $_.LocalPort } }"])).out;
  const m = /127\.0\.0\.1[:.](\d{2,5})/.exec(out);
  return m ? Number(m[1]) : null;
}

async function waitForEngineHealth(timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = await enginePort();
    if (port) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) return port;
      } catch {
        /* still booting */
      }
    }
    await sleep(1000);
  }
  throw new Error(`the app's engine sidecar never answered /api/v1/health within ${timeoutMs / 1000} s`);
}

async function engineGone(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await enginePort()) === null) return true;
    await sleep(500);
  }
  return false;
}

/** Minimal W3C WebDriver client for tauri-driver (no npm dependency). */
async function webdriverSmoke(app: string): Promise<string> {
  const base = "http://127.0.0.1:4444";
  const driver = spawn("tauri-driver", [], { stdio: "ignore" });
  try {
    for (let i = 0; i < 30; i++) {
      try {
        if ((await fetch(`${base}/status`)).ok) break;
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    const wd = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json()) as { value: unknown };
      if (!r.ok) throw new Error(`WebDriver ${method} ${path}: ${JSON.stringify(j.value).slice(0, 300)}`);
      return j.value;
    };
    const session = (await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: app } } } })) as { sessionId: string };
    const sid = session.sessionId;
    try {
      let title = "", children = 0, text = 0;
      for (let i = 0; i < 40 && !(title === "XR" && children > 0 && text > 0); i++) {
        await sleep(500);
        title = String(await wd("GET", `/session/${sid}/title`));
        const v = (await wd("POST", `/session/${sid}/execute/sync`, { script: "const r = document.getElementById('root'); return [r ? r.childElementCount : 0, (document.body.innerText || '').trim().length];", args: [] })) as [number, number];
        [children, text] = v;
      }
      if (title !== "XR" || children === 0 || text === 0) throw new Error(`webview did not render: title=${JSON.stringify(title)} #root children=${children} text=${text}`);
      const port = await waitForEngineHealth(60_000);
      return `WebDriver: title "XR", #root rendered (${children} children); engine sidecar healthy on :${port}`;
    } finally {
      await wd("DELETE", `/session/${sid}`).catch(() => undefined);
    }
  } finally {
    driver.kill();
  }
}

export async function runDesktopJourney(opts: { slug: string; bundles: string; webdriver: boolean; evidenceClass: "CI" | "LR" }): Promise<JourneyEvidence> {
  const manifest = JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")) as { identity: { version: string } };
  const N = manifest.identity.version;
  const flavour = flavourFor(opts.slug);
  const steps: StepResult[] = [];
  let failed = false;
  const work = mkdtempSync(join(tmpdir(), "xr-desktop-journey-"));
  const home = join(work, "home"), ws = join(work, "workspace");
  for (const d of [home, ws]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, NO_COLOR: "1", CI: "1", XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "1" };
  if (process.platform !== "win32") delete env.XR_HOME; // Windows keeps USERPROFILE: WebView2 needs a real profile
  else env.XR_HOME = join(home, ".xr");
  const ctx = { installer: "", app: "", engine: "", pkg: "", uninstaller: "", installDir: "" };

  const step = async (name: StepName, fn: () => Promise<string>) => {
    const t0 = Date.now();
    if (failed) { steps.push({ step: name, status: "blocked", detail: "an earlier step failed", ms: 0 }); return; }
    try {
      steps.push({ step: name, status: "pass", detail: await fn(), ms: Date.now() - t0 });
    } catch (e) {
      failed = true;
      steps.push({ step: name, status: "fail", detail: (e as Error).message.slice(0, 900), ms: Date.now() - t0 });
    }
    const s = steps[steps.length - 1]!;
    console.log(`  ${s.status.padEnd(7)} ${name} (${s.ms} ms) — ${s.detail}`);
  };
  const need = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  console.log(`[desktop-journey] ${opts.slug} · ${flavour.channel} · v${N} · scratch ${work}`);

  try {
    await step("build", async () => {
      const found = findFiles(opts.bundles, flavour.match);
      need(found.length > 0, `no ${flavour.channel} bundle under ${opts.bundles}: ${findFiles(opts.bundles, () => true).map((f) => basename(f)).join(", ")}`);
      ctx.installer = found[0]!;
      return `bundle job artifact present: ${basename(ctx.installer)}`;
    });
    await step("package", async () => `sha256 ${statSync(ctx.installer).isFile() ? sha256(ctx.installer) : "(app bundle)"}`);

    await step("install", async () => {
      if (flavour.channel === "deb") {
        ctx.pkg = (await sh(["dpkg-deb", "-f", ctx.installer, "Package"])).out.trim();
        const r = await sh(["sudo", "-n", "apt-get", "install", "-y", "--no-install-recommends", resolve(ctx.installer)], { timeoutMs: 600_000 });
        need(r.status === 0, `apt-get install: ${tail(r.out)}`);
        const files = (await sh(["dpkg", "-L", ctx.pkg])).out.split(/\r?\n/).filter((f) => f.startsWith("/usr/bin/"));
        ctx.engine = files.find((f) => basename(f).startsWith("xr-engine")) ?? "";
        ctx.app = files.find((f) => !basename(f).startsWith("xr-engine")) ?? "";
      } else if (flavour.channel === "nsis") {
        const r = await sh([resolve(ctx.installer), "/S"], { timeoutMs: 600_000 });
        need(r.status === 0, `NSIS /S exit ${r.status}: ${tail(r.out)}`);
        const reg = await sh(["pwsh.exe", "-NoProfile", "-Command", "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'XR' } | Select-Object -First 1 InstallLocation, UninstallString | ConvertTo-Json -Compress"]);
        const entry = JSON.parse(reg.out.trim() || "{}") as { InstallLocation?: string; UninstallString?: string };
        need(Boolean(entry.UninstallString), `no HKCU uninstall registration for XR after install: ${tail(reg.out, 200)}`);
        ctx.uninstaller = entry.UninstallString!.replace(/^"|"$/g, "").replace(/" .*$/, "");
        ctx.installDir = (entry.InstallLocation || dirname(ctx.uninstaller)).replace(/^"|"$/g, "");
        const exes = readdirSync(ctx.installDir).filter((f) => f.toLowerCase().endsWith(".exe"));
        ctx.engine = join(ctx.installDir, exes.find((f) => f.toLowerCase().startsWith("xr-engine")) ?? "");
        ctx.app = join(ctx.installDir, exes.find((f) => !/^(xr-engine|uninstall)/i.test(f)) ?? "");
      } else {
        const mnt = join(work, "mnt");
        mkdirSync(mnt);
        const a = await sh(["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mnt, resolve(ctx.installer)]);
        need(a.status === 0, `hdiutil attach: ${tail(a.out)}`);
        try {
          const app = readdirSync(mnt).find((f) => f.endsWith(".app"));
          need(Boolean(app), `no .app inside the dmg: ${readdirSync(mnt).join(", ")}`);
          mkdirSync(join(home, "Applications"), { recursive: true });
          ctx.installDir = join(home, "Applications", app!);
          const c = await sh(["ditto", join(mnt, app!), ctx.installDir]);
          need(c.status === 0, `ditto: ${tail(c.out)}`);
        } finally {
          await sh(["hdiutil", "detach", mnt, "-force"]);
        }
        const macos = join(ctx.installDir, "Contents", "MacOS");
        const bins = readdirSync(macos);
        ctx.engine = join(macos, bins.find((f) => f.startsWith("xr-engine")) ?? "");
        ctx.app = join(macos, bins.find((f) => !f.startsWith("xr-engine")) ?? "");
      }
      need(existsSync(ctx.app) && statSync(ctx.app).isFile(), `installed app binary not found (${ctx.app || "none"})`);
      need(existsSync(ctx.engine) && statSync(ctx.engine).isFile(), `installed engine sidecar not found (${ctx.engine || "none"})`);
      return `${flavour.channel} installed: app ${ctx.app}, engine ${basename(ctx.engine)}`;
    });

    await step("launch", async () => {
      const v = await sh([ctx.engine, "--version"], { env });
      need(v.status === 0 && v.out.includes(N), `installed engine --version: ${tail(v.out, 200)}`);
      if (opts.webdriver) {
        const detail = await webdriverSmoke(ctx.app);
        need(await engineGone(15_000), "engine sidecar still listening 15 s after the app closed (containment)");
        return `${detail}; sidecar exited with the app`;
      }
      const app: ChildProcess = spawn(ctx.app, [], { env, stdio: "ignore", detached: process.platform !== "win32" });
      try {
        const port = await waitForEngineHealth(90_000);
        need(app.exitCode === null, `the app exited early (code ${app.exitCode})`);
        return `GUI process up; engine sidecar healthy on :${port}${process.platform === "darwin" ? " (no WKWebView driver on macOS: render not asserted)" : ""}`;
      } finally {
        app.kill("SIGTERM");
        if (!(await engineGone(15_000))) {
          if (process.platform === "win32") await sh(["taskkill", "/F", "/IM", basename(ctx.app)]);
          throw new Error("engine sidecar still listening 15 s after the app was closed (containment)");
        }
      }
    });

    await step("agent", async () => {
      const provider = await startFixtureProvider();
      try {
        writeFixtureConfig(env.XR_HOME ?? join(home, ".xr"), provider.url);
        const r = await sh([ctx.engine, "--cwd", ws, "--provider", FIXTURE_PROVIDER, "--model", FIXTURE_MODEL, "--json", "Write the journey proof file."], { env, timeoutMs: 120_000 });
        const proof = join(ws, FIXTURE_FILE);
        need(existsSync(proof) && readFileSync(proof, "utf8") === FIXTURE_CONTENT, `proof file not written by the installed engine (exit ${r.status}): ${tail(r.out)}`);
        need(r.status === 0, `engine exit ${r.status}: ${tail(r.out)}`);
        return "the installed engine sidecar applied write_file against the fixture provider";
      } finally {
        await provider.close();
      }
    });

    steps.push(failed
      ? { step: "update", status: "blocked", detail: "an earlier step failed", ms: 0 }
      : { step: "update", status: "descoped", detail: "desktop auto-update needs the XR-LAUNCH-008 updater signing key (owner-provisioned); latest.json generation is dry-run in desktop-app.yml", ms: 0 });
    console.log(`  ${steps[steps.length - 1]!.status.padEnd(7)} update`);

    await step("uninstall", async () => {
      if (flavour.channel === "deb") {
        const r = await sh(["sudo", "-n", "apt-get", "remove", "-y", ctx.pkg], { timeoutMs: 300_000 });
        need(r.status === 0, `apt-get remove: ${tail(r.out)}`);
        need((await sh(["dpkg", "-s", ctx.pkg])).status !== 0, `${ctx.pkg} still registered with dpkg`);
      } else if (flavour.channel === "nsis") {
        const r = await sh([ctx.uninstaller, "/S"], { timeoutMs: 300_000 });
        need(r.status === 0, `uninstaller exit ${r.status}: ${tail(r.out)}`);
        // The NSIS uninstaller re-launches itself from %TEMP% and returns at once.
        for (let i = 0; i < 60 && existsSync(ctx.app); i++) await sleep(1000);
        const reg = await sh(["pwsh.exe", "-NoProfile", "-Command", "@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'XR' }).Count"]);
        need(reg.out.trim() === "0", "HKCU uninstall registration still present");
      } else {
        rmSync(ctx.installDir, { recursive: true, force: true });
      }
      need(!existsSync(ctx.app) && !existsSync(ctx.engine), `binaries still present after uninstall: ${[ctx.app, ctx.engine].filter((f) => existsSync(f)).join(", ")}`);
      return flavour.channel === "dmg" ? "XR.app removed (the documented macOS uninstall)" : `${flavour.channel} uninstall removed the app, the engine and the registration`;
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const { commit, dirty } = await gitState();
  return {
    schema: 1, kind: "desktop-journey", channel: flavour.channel, target: `desktop-${opts.slug}`, os: process.platform, arch: process.arch,
    version: N, nextVersion: "", evidenceClass: opts.evidenceClass, commit, dirty,
    runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    runner: process.env.ImageOS ? `${process.env.ImageOS}/${process.env.ImageVersion ?? ""}` : "local",
    at: new Date().toISOString(), steps,
    result: steps.every((s) => s.status === "pass" || s.status === "descoped") ? "pass" : "fail",
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const slug = get("--slug"), bundles = get("--bundles");
  if (!slug || !bundles) { console.error("usage: desktop-journey.ts --slug <slug> --bundles <dir> [--webdriver] [--evidence file] [--class CI|LR]"); process.exit(2); }
  const ev = await runDesktopJourney({ slug, bundles, webdriver: argv.includes("--webdriver"), evidenceClass: (get("--class") ?? (process.env.GITHUB_ACTIONS ? "CI" : "LR")) as "CI" | "LR" });
  const out = get("--evidence");
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(ev, null, 2) + "\n"); }
  // Linux: the AppImage and .rpm flavours are built + shipped but not
  // installed by this journey; record their Build/Package evidence separately.
  if (out && slug.startsWith("linux")) {
    const other = findFiles(bundles, (f) => f.endsWith(".AppImage") || f.endsWith(".rpm"));
    const ok = other.some((f) => f.endsWith(".AppImage")) && other.some((f) => f.endsWith(".rpm"));
    const detail = ok ? other.map((f) => `${basename(f)} sha256 ${sha256(f).slice(0, 16)}…`).join("; ") : `missing AppImage/.rpm in ${bundles}`;
    const extra: JourneyEvidence = { ...ev, channel: "appimage+rpm", target: `desktop-${slug}-appimage`, result: ok ? "pass" : "fail",
      steps: (["build", "package"] as const).map((step) => ({ step, status: ok ? "pass" : "fail", detail, ms: 0 })) };
    writeFileSync(out.replace(/\.json$/, "-appimage.json"), JSON.stringify(extra, null, 2) + "\n");
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Desktop journey · ${ev.target} · ${ev.result.toUpperCase()}`, "", "| step | status | detail |", "|---|---|---|", ...ev.steps.map((s) => `| ${s.step} | ${s.status} | ${s.detail.replace(/\|/g, "/")} |`), ""].join("\n") + "\n");
  }
  console.log(JSON.stringify(ev));
  process.exit(ev.result === "pass" ? 0 : 1);
}
