#!/usr/bin/env bun
/**
 * XR-LAUNCH-011 — clean-machine journey for the CLI, per channel.
 *
 *   bun run scripts/journey/cli-journey.ts --channel binary|npm
 *        [--evidence <file.json>] [--class CI|LR] [--keep]
 *
 * One scratch HOME, nothing from the developer's machine:
 *
 *   build      build release N from this checkout, and a synthetic N+1 from a
 *              scratch copy whose version is bumped (never published)
 *   package    binary: per-host compiled binary + SHA256SUMS per version
 *              npm:    `npm pack` tarball per version
 *   install    binary: the real install.sh / install.ps1, pointed at a loopback
 *              release server (XR_INSTALL_BASE_URL), --yes
 *              npm:    `npm install -g <N tarball>` into a scratch --prefix
 *   launch     `xr --version` reports N, `xr --help` exits 0
 *   agent      a real task against a deterministic loopback provider: the
 *              agent must write the proof file through the write_file tool
 *   update     binary: `xr update --check --json` sees N+1 (loopback releases
 *              index), then the installer is re-run for N+1 — the documented
 *              update path for installer binaries — and `xr --version` is N+1
 *              npm:    `xr update --check --json` sees N+1 (loopback registry),
 *              `xr update` delegates to npm, and `xr --version` is N+1
 *   uninstall  `xr uninstall --purge --yes` removes the launcher, install dir
 *              and data home; pre-existing shell rc files are byte-identical
 *              to the pre-install snapshot (after an installer PATH block was
 *              added, as an interactive install would)
 *
 * The last stdout line is the JSON evidence record; --evidence also writes it.
 * Exit 0 only when every step passed. Steps after a failure are reported as
 * "blocked", never as passed.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { FIXTURE_CONTENT, FIXTURE_FILE, FIXTURE_MODEL, FIXTURE_PROVIDER, startFixtureProvider, startFixtureServer, writeFixtureConfig, type Running } from "./fixtures.ts";

export const STEPS = ["build", "package", "install", "launch", "agent", "update", "uninstall"] as const;
export type StepName = (typeof STEPS)[number];
export type StepStatus = "pass" | "fail" | "blocked" | "descoped";
export interface StepResult { step: StepName; status: StepStatus; detail: string; ms: number }
export interface JourneyEvidence {
  schema: 1;
  kind: "cli-journey" | "desktop-journey" | "docker-journey";
  /** binary | npm (CLI) · deb | appimage | nsis | dmg (desktop) · image (docker) */
  channel: string;
  target: string;
  os: string;
  arch: string;
  version: string;
  nextVersion: string;
  evidenceClass: "CI" | "LR";
  commit: string;
  /** true when the working tree had uncommitted changes (local runs) */
  dirty?: boolean;
  runUrl: string | null;
  runner: string;
  at: string;
  steps: StepResult[];
  result: "pass" | "fail";
}

const ROOT = resolve(import.meta.dir, "..", "..");
const WIN = process.platform === "win32";
/** The block install.sh appends on an interactive "yes" (kept in sync by a test). */
export const INSTALLER_RC_BLOCK = '\n# >>> XR launcher >>> (added by the XR installer; removed by `xr uninstall`)\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< XR launcher <<<\n';
/** Ubuntu's default ~/.profile stanza that the pre-006 uninstall destroyed. */
const PROFILE_FIXTURE = '# ~/.profile (journey fixture)\nif [ -d "$HOME/bin" ] ; then\n    PATH="$HOME/bin:$PATH"\nfi\nif [ -d "$HOME/.local/bin" ] ; then\n    PATH="$HOME/.local/bin:$PATH"\nfi\n';

export function hostSlug(platform = process.platform, arch = process.arch): string {
  return `${platform === "win32" ? "windows" : platform}-${arch}`;
}

/** Release asset name install.sh / install.ps1 look for on this host ("" = none). */
export function binaryAsset(slug: string): string {
  return ({ "linux-x64": "xr-linux-x64", "linux-arm64": "xr-linux-arm64", "darwin-x64": "xr-darwin-x64", "darwin-arm64": "xr-darwin-arm64", "windows-x64": "xr-windows-x64.exe" } as Record<string, string>)[slug] ?? "";
}

/** N+1 for the synthetic update: next patch, tagged so it can never be mistaken for a real release. */
export function nextVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) throw new Error(`not a semver version: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}-journey.1`;
}

/**
 * Async on purpose: the loopback release server and fixture provider live in
 * this process, so a blocking spawnSync would deadlock them.
 */
export function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ status: number; out: string }> {
  // Windows: .cmd shims (npm, xr.cmd) only run through cmd.exe.
  const argv = WIN && !/\.exe$/i.test(cmd[0]!) ? ["cmd", "/d", "/s", "/c", ...cmd] : cmd;
  return new Promise((done) => {
    let out = "";
    const child = spawn(argv[0]!, argv.slice(1), { cwd: opts.cwd ?? ROOT, env: opts.env ?? (process.env as Record<string, string>), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { out += `\n[journey] timed out after ${opts.timeoutMs ?? 300_000} ms`; child.kill("SIGKILL"); }, opts.timeoutMs ?? 300_000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", (e) => { clearTimeout(timer); done({ status: 127, out: `${out}${e.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); done({ status: code ?? 1, out }); });
  });
}
/** HEAD commit + whether the tree is dirty, for evidence records. */
export async function gitState(): Promise<{ commit: string; dirty: boolean }> {
  const commit = (await sh(["git", "rev-parse", "HEAD"])).out.trim();
  const dirty = (await sh(["git", "status", "--porcelain", "--untracked-files=no"])).out.trim().length > 0;
  return { commit, dirty };
}
export const tail = (s: string, n = 400) => s.replace(/\s+/g, " ").trim().slice(-n);
export const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Copy the checkout (tracked + untracked-not-ignored) to `dest` with `version` stamped. */
async function versionedCopy(dest: string, version: string): Promise<void> {
  const files = (await sh(["git", "ls-files", "-co", "--exclude-standard", "-z"])).out.split("\0").filter(Boolean);
  for (const f of files) {
    const src = join(ROOT, f);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    cpSync(src, join(dest, f));
  }
  symlinkSync(join(ROOT, "node_modules"), join(dest, "node_modules"), WIN ? "junction" : "dir");
  const pkgPath = join(dest, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const vts = join(dest, "src", "core", "version.ts");
  writeFileSync(vts, readFileSync(vts, "utf8").replace(/version: "[^"]+"/, `version: "${version}"`));
  const man = join(dest, "release.manifest.json");
  writeFileSync(man, readFileSync(man, "utf8").replace(/("identity"\s*:\s*\{[^}]*?"version"\s*:\s*)"[^"]+"/, `$1"${version}"`));
}

export async function runJourney(opts: { channel: "binary" | "npm"; evidenceClass: "CI" | "LR"; keep?: boolean }): Promise<JourneyEvidence> {
  const manifest = JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")) as { identity: { version: string; name: string } };
  const N = manifest.identity.version;
  const N1 = nextVersion(N);
  const slug = hostSlug();
  const steps: StepResult[] = [];
  let failed = false;
  const work = mkdtempSync(join(tmpdir(), `xr-journey-${opts.channel}-`));
  const home = join(work, "home"), ws = join(work, "workspace"), rel = join(work, "releases"), prefix = join(work, "prefix");
  for (const d of [home, ws, rel, prefix]) mkdirSync(d, { recursive: true });
  const servers: Running[] = [];
  const baseEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home, USERPROFILE: home, NO_COLOR: "1", CI: "1",
    npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false",
    XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "1",
  };
  for (const k of ["XR_HOME", "XR_AUDIT_NO_AUTOKEY", "npm_config_prefix", "NPM_CONFIG_PREFIX", "npm_config_registry"]) delete baseEnv[k];
  const artifacts: Record<string, string> = {};
  let xr = "";

  const step = async (name: StepName, fn: () => Promise<string> | string) => {
    const t0 = Date.now();
    if (failed) { steps.push({ step: name, status: "blocked", detail: "an earlier step failed", ms: 0 }); return; }
    try {
      const detail = await fn();
      steps.push({ step: name, status: "pass", detail, ms: Date.now() - t0 });
    } catch (e) {
      failed = true;
      steps.push({ step: name, status: "fail", detail: (e as Error).message.slice(0, 900), ms: Date.now() - t0 });
    }
    const last = steps[steps.length - 1]!;
    console.log(`  ${last.status.padEnd(7)} ${name} (${last.ms} ms) — ${last.detail}`);
  };
  const need = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

  console.log(`[journey] ${opts.channel} · ${slug} · N=${N} → N+1=${N1} · scratch ${work}`);
  const asset = binaryAsset(slug);
  try {
    if (opts.channel === "binary" && !asset) {
      for (const s of STEPS) steps.push({ step: s, status: "descoped", detail: `no compiled binary release asset for ${slug} (install.sh/install.ps1 install the verified source archive there)`, ms: 0 });
    } else {
      await step("build", async () => {
        const next = join(work, "src-next");
        await versionedCopy(next, N1);
        if (opts.channel === "binary") {
          for (const [v, cwd] of [[N, ROOT], [N1, next]] as const) {
            const out = join(rel, `v${v}`);
            const r = await sh(["bun", "run", "scripts/build-matrix.ts", "--targets", slug, "--out", out, "--skip-smoke"], { cwd, timeoutMs: 600_000 });
            need(r.status === 0 && existsSync(join(out, asset)), `bun build --compile ${v}: ${tail(r.out)}`);
          }
          return `${asset} built for ${N} and ${N1}`;
        }
        for (const [v, cwd] of [[N, ROOT], [N1, next]] as const) {
          const out = join(rel, `npm-${v}`);
          mkdirSync(out, { recursive: true });
          const r = await sh(["npm", "pack", "--pack-destination", out, "--silent"], { cwd });
          const tgz = r.out.trim().split(/\r?\n/).pop() ?? "";
          need(r.status === 0 && tgz.endsWith(".tgz"), `npm pack ${v}: ${tail(r.out)}`);
          artifacts[v] = join(out, tgz);
        }
        return `npm tarballs for ${N} and ${N1}`;
      });

      await step("package", async () => {
        if (opts.channel === "binary") {
          for (const v of [N, N1]) {
            const dir = join(rel, `v${v}`);
            for (const f of readdirSync(dir)) if (f !== asset) rmSync(join(dir, f), { recursive: true, force: true });
            writeFileSync(join(dir, "SHA256SUMS"), `${sha256(join(dir, asset))}  ${asset}\n`);
          }
          return `SHA256SUMS written for v${N} and v${N1}`;
        }
        for (const v of [N, N1]) {
          // cwd + bare file name: Git-for-Windows' GNU tar reads `C:\…` as host:path.
          const list = (await sh(["tar", "-tzf", basename(artifacts[v]!)], { cwd: dirname(artifacts[v]!) })).out;
          need(/package\/release\.manifest\.json/.test(list) && /package\/bin\/xr/.test(list), `tarball ${v} lacks release.manifest.json or bin/xr`);
        }
        return "tarballs carry bin/xr and release.manifest.json";
      });

      // Shell rc fixtures: the snapshot that uninstall must restore byte-for-byte.
      const rcFiles = WIN ? [] : [".profile", ".bashrc", ".zshrc"].map((f) => join(home, f));
      if (!WIN) {
        writeFileSync(rcFiles[0]!, PROFILE_FIXTURE);
        writeFileSync(rcFiles[1]!, "# ~/.bashrc (journey fixture)\nalias ll='ls -l'\n");
        writeFileSync(rcFiles[2]!, "# ~/.zshrc (journey fixture)\nsetopt autocd\n");
      }
      const rcBefore = rcFiles.map((f) => readFileSync(f));
      // Windows: install.ps1 edits the HKCU user Path; uninstall must restore it exactly.
      const userPath = async () => (await sh(["pwsh", "-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"])).out.trim();
      const userPathBefore = WIN ? await userPath() : "";

      const server = await startFixtureServer({
        root: rel,
        releases: [{ version: N }, { version: N1 }],
        npm: opts.channel === "npm" ? { name: manifest.identity.name, tarballs: artifacts, latest: N1 } : undefined,
      });
      servers.push(server);
      const env: Record<string, string> = opts.channel === "binary"
        ? { ...baseEnv, XR_INSTALL_BASE_URL: server.url, XR_UPDATE_RELEASES_URL: `${server.url}/releases.json` }
        : { ...baseEnv, npm_config_prefix: prefix, "npm_config_@rrrtx:registry": server.url }; // scoped: dependencies still come from the default registry
      // install.sh → ~/.local/bin/xr; install.ps1 → ~/.xr-agent/bin-local/xr.cmd; npm → <prefix>/bin/xr | <prefix>/xr.cmd
      const binDir = opts.channel === "binary" ? (WIN ? join(home, ".xr-agent", "bin-local") : join(home, ".local", "bin")) : WIN ? prefix : join(prefix, "bin");
      env.PATH = `${binDir}${WIN ? ";" : ":"}${process.env.PATH ?? ""}`;
      xr = join(binDir, WIN ? "xr.cmd" : "xr");

      const runInstaller = async (version: string) => WIN
        ? await sh(["pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "-ReleaseVersion", version, "-AssumeYes", "-InstallMode", "minimal"], { env, timeoutMs: 600_000 })
        : await sh(["bash", join(ROOT, "install.sh"), "--yes", `--version=${version}`, "--mode=minimal"], { env, timeoutMs: 600_000 });

      await step("install", async () => {
        if (opts.channel === "binary") {
          const r = await runInstaller(N);
          need(r.status === 0, `installer exit ${r.status}: ${tail(r.out)}`);
          need(server.requests.some((q) => q.endsWith(`/v${N}/SHA256SUMS`)) && server.requests.some((q) => q.endsWith(`/v${N}/${asset}`)), `installer did not fetch the loopback release: ${server.requests.join(", ")}`);
        } else {
          const r = await sh(["npm", "install", "-g", artifacts[N]!, "--no-audit", "--no-fund"], { env });
          need(r.status === 0, `npm install -g: ${tail(r.out)}`);
        }
        need(existsSync(xr), `launcher missing at ${xr}`);
        if (!WIN) {
          // What an interactive "yes" to the PATH prompt appends (install.sh).
          appendFileSync(rcFiles[1]!, INSTALLER_RC_BLOCK);
        }
        return opts.channel === "binary" ? `install.${WIN ? "ps1" : "sh"} v${N} from ${server.url}` : `npm -g into ${prefix}`;
      });

      await step("launch", async () => {
        const v = await sh([xr, "--version"], { env });
        need(v.status === 0 && v.out.includes(N), `xr --version: exit ${v.status} ${tail(v.out, 200)}`);
        const h = await sh([xr, "--help"], { env });
        need(h.status === 0, `xr --help exit ${h.status}`);
        return tail(v.out.split(/\r?\n/)[0] ?? "", 80);
      });

      await step("agent", async () => {
        const provider = await startFixtureProvider();
        servers.push(provider);
        writeFixtureConfig(join(home, ".xr"), provider.url);
        const r = await sh([xr, "--cwd", ws, "--provider", FIXTURE_PROVIDER, "--model", FIXTURE_MODEL, "--json", "Write the journey proof file."], { env, timeoutMs: 120_000 });
        const proof = join(ws, FIXTURE_FILE);
        const chats = provider.requests.filter((q) => q.endsWith("/chat/completions")).length;
        need(existsSync(proof) && readFileSync(proof, "utf8") === FIXTURE_CONTENT, `proof file not written (exit ${r.status}, ${chats} chat turns): ${tail(r.out)}`);
        need(r.status === 0, `agent exit ${r.status}: ${tail(r.out)}`);
        await provider.close(); // later steps must never reach a model
        return `write_file applied in the workspace after ${chats} provider turn(s)`;
      });

      await step("update", async () => {
        const c = await sh([xr, "update", "--check", "--json"], { env });
        let parsed: { current?: string; latest?: string; updateAvailable?: boolean } = {};
        try { parsed = JSON.parse(c.out.trim().split(/\r?\n/).pop() ?? "{}"); } catch { /* reported below */ }
        need(c.status === 0 && parsed.current === N && parsed.latest === N1 && parsed.updateAvailable === true, `update --check: exit ${c.status} ${tail(c.out, 300)}`);
        if (opts.channel === "binary") {
          const u = await sh([xr, "update"], { env });
          need(/install/i.test(u.out), `xr update on an installer binary should point at the installer: ${tail(u.out, 300)}`);
          const r = await runInstaller(N1);
          need(r.status === 0, `installer N+1 exit ${r.status}: ${tail(r.out)}`);
        } else {
          const u = await sh([xr, "update", "--yes"], { env, timeoutMs: 600_000 });
          need(u.status === 0, `xr update exit ${u.status}: ${tail(u.out)}`);
        }
        const fetched = opts.channel === "binary" ? `/v${N1}/${asset}` : `/-/tarballs/${N1}/`;
        need(server.requests.some((q) => q.includes(fetched)), `N+1 was not fetched from the loopback source (${fetched})`);
        const v = await sh([xr, "--version"], { env });
        need(v.out.includes(N1), `after update, xr --version: ${tail(v.out, 200)}`);
        const st = await sh([xr, "status", "--json"], { env });
        need(st.status === 0, `after update, xr status --json exit ${st.status}: ${tail(st.out, 300)}`);
        return `${N} → ${N1}`;
      });

      await step("uninstall", async () => {
        const u = await sh([xr, "uninstall", "--purge", "--yes"], { env });
        need(u.status === 0 && /Uninstall complete/.test(u.out), `xr uninstall exit ${u.status}: ${tail(u.out)}`);
        if (opts.channel === "npm") {
          const r = await sh(["npm", "rm", "-g", manifest.identity.name], { env });
          need(r.status === 0, `npm rm -g: ${tail(r.out)}`);
          need(!existsSync(xr), `npm bin still present: ${xr}`);
        } else {
          if (!WIN) need(!existsSync(xr), `launcher still present: ${xr}`);
          if (!WIN) need(!existsSync(join(home, ".xr-agent")), "install dir ~/.xr-agent still present");
        }
        need(!existsSync(join(home, ".xr")), "data home ~/.xr still present after --purge");
        rcFiles.forEach((f, i) => need(readFileSync(f).equals(rcBefore[i]!), `${f} differs from its pre-install bytes`));
        if (WIN) {
          // The running xr.exe is locked; uninstall finishes the install-dir removal after exit.
          for (let i = 0; i < 20 && existsSync(join(home, ".xr-agent")); i++) await new Promise((r) => setTimeout(r, 500));
          need(!existsSync(join(home, ".xr-agent")), "install dir ~/.xr-agent still present 10 s after uninstall");
          need((await userPath()) === userPathBefore, "HKCU user Path differs from its pre-install value");
        }
        return WIN ? "launcher, install dir, data home removed; HKCU user Path restored" : "launcher, install dir, data home removed; .profile/.bashrc/.zshrc byte-identical";
      });
    }
  } finally {
    for (const s of servers) await s.close();
    if (!opts.keep) rmSync(work, { recursive: true, force: true });
  }

  const { commit, dirty } = await gitState();
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  return {
    schema: 1, kind: "cli-journey", channel: opts.channel, target: `cli-${opts.channel}-${slug}`, os: process.platform, arch: process.arch,
    version: N, nextVersion: N1, evidenceClass: opts.evidenceClass, commit, dirty, runUrl,
    runner: process.env.ImageOS ? `${process.env.ImageOS}/${process.env.ImageVersion ?? ""}` : process.env.RUNNER_NAME ?? "local",
    at: new Date().toISOString(), steps,
    result: steps.every((s) => s.status === "pass" || s.status === "descoped") ? "pass" : "fail",
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const channel = get("--channel");
  if (channel !== "binary" && channel !== "npm") { console.error("usage: cli-journey.ts --channel binary|npm [--evidence file] [--class CI|LR] [--keep]"); process.exit(2); }
  const evidenceClass = (get("--class") ?? (process.env.GITHUB_ACTIONS ? "CI" : "LR")) as "CI" | "LR";
  const ev = await runJourney({ channel, evidenceClass, keep: argv.includes("--keep") });
  const out = get("--evidence");
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(ev, null, 2) + "\n"); }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Journey · ${ev.target} · ${ev.result.toUpperCase()}`, "", "| step | status | detail |", "|---|---|---|", ...ev.steps.map((s) => `| ${s.step} | ${s.status} | ${s.detail.replace(/\|/g, "/")} |`), ""].join("\n") + "\n");
  }
  console.log(JSON.stringify(ev));
  process.exit(ev.result === "pass" ? 0 : 1);
}
