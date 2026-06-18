/**
 * XR Stage 2 — installation subsystem.
 *
 * This file is intentionally dependency-light and side-effect explicit.  It
 * probes, explains, asks, then acts.  Optional component packs are independent,
 * resumable and idempotent.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform as nodePlatform, release } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { banner, ask, confirm, info, ok, warn, colors as C, password } from "../interfaces/cli.ts";
import { XR_HOME, configPath, loadConfig, saveConfig, type XRConfig } from "../config/config.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../local/hardware.ts";
import { recommendLocalModel } from "../local/recommend.ts";
import { ollamaStatus, pullOllamaModel, testOllamaModel } from "../local/ollama.ts";
import { validateOllamaModelId } from "../local/registry.ts";
import { knownProviders, PRESETS } from "../providers/factory.ts";
import { preferredSecretBackend, setSecret } from "../security/secrets.ts";

export type XROs = "windows" | "macos" | "linux" | "termux" | "unknown";
export type XRArch = "x64" | "arm64" | "arm" | "unknown";
export type HealthState = "ok" | "warn" | "fail" | "skip";
export type InstallPack = "core" | "local-ai" | "voice" | "browser" | "control" | "research" | "security" | "business" | "dev";

export interface PlatformInfo {
  os: XROs;
  arch: XRArch;
  shell: string;
  terminal: "tty" | "non-tty";
  ci: boolean;
  admin: boolean;
  home: string;
  xrHome: string;
  release: string;
}

export interface HealthCheck {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
  remediation?: string;
}

export interface InstallOptions {
  yes?: boolean;
  allowSystem?: boolean;
  network?: boolean;
  mode?: "minimal" | "local" | "byok" | "hybrid" | "full";
}

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

export function packageRoot(): string {
  return rootDir;
}

export function commandExists(cmd: string): boolean {
  const res = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 2000,
  });
  return res.status === 0;
}

export function runCommand(cmd: string, args: string[], opts: { cwd?: string; inherit?: boolean; timeoutMs?: number } = {}): { ok: boolean; status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    encoding: opts.inherit ? undefined : "utf8",
    shell: false,
    timeout: opts.timeoutMs ?? 120_000,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
  };
}

function detectOs(): XROs {
  if (process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux")) return "termux";
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "linux") return "linux";
  return "unknown";
}

function detectArch(): XRArch {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  if (process.arch.startsWith("arm")) return "arm";
  return "unknown";
}

function detectAdmin(): boolean {
  if (process.platform !== "win32") return typeof process.getuid === "function" && process.getuid() === 0;
  const ps = commandExists("pwsh") ? "pwsh" : commandExists("powershell") ? "powershell" : undefined;
  if (!ps) return false;
  const res = runCommand(ps, ["-NoProfile", "-NonInteractive", "-Command", "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"], { timeoutMs: 3000 });
  return /True/i.test(res.stdout);
}

export function detectPlatform(): PlatformInfo {
  return {
    os: detectOs(),
    arch: detectArch(),
    shell: process.env.SHELL || process.env.ComSpec || "unknown",
    terminal: isTTY ? "tty" : "non-tty",
    ci: Boolean(process.env.CI || process.env.GITHUB_ACTIONS),
    admin: detectAdmin(),
    home: homedir(),
    xrHome: XR_HOME,
    release: release(),
  };
}

function ensureDirs(): void {
  for (const dir of [XR_HOME, join(XR_HOME, "backups"), join(XR_HOME, "logs"), join(XR_HOME, "models"), join(XR_HOME, "voices"), join(XR_HOME, "components")]) {
    mkdirSync(dir, { recursive: true });
  }
}

export function backupConfig(reason = "backup"): string | undefined {
  ensureDirs();
  const src = configPath();
  if (!existsSync(src)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(XR_HOME, "backups", `config.${stamp}.${reason}.json`);
  copyFileSync(src, dest);
  try { chmodSync(dest, 0o600); } catch {}
  return dest;
}

export function saveConfigSafely(config: XRConfig, reason = "config-change"): void {
  ensureDirs();
  backupConfig(reason);
  const tmp = `${configPath()}.tmp`;
  saveConfig(config);
  copyFileSync(configPath(), tmp);
  renameSync(tmp, configPath());
  try { chmodSync(configPath(), 0o600); } catch {}
}

export function ensureConfig(): XRConfig {
  ensureDirs();
  const { config, warnings } = loadConfig();
  if (warnings.length) backupConfig("pre-repair-invalid");
  saveConfigSafely(config, "ensure");
  return config;
}

function parseOptions(args: string[]): InstallOptions {
  const opts: InstallOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--allow-system") opts.allowSystem = true;
    else if (a === "--network") opts.network = true;
    else if (a === "--mode") {
      const m = args[++i] as InstallOptions["mode"];
      if (["minimal", "local", "byok", "hybrid", "full"].includes(String(m))) opts.mode = m;
    }
  }
  return opts;
}

async function approved(question: string, defaultYes: boolean, opts: InstallOptions, system = false): Promise<boolean> {
  if (system && !opts.allowSystem) {
    if (!isTTY) return false;
    return await confirm(`${question} ${C.dim("(system-level; pass --allow-system for unattended approval)")}`, false);
  }
  if (opts.yes) return defaultYes;
  if (!isTTY) return false;
  return await confirm(question, defaultYes);
}

function packageManager(): "bun" | "npm" | undefined {
  if (commandExists("bun")) return "bun";
  if (commandExists("npm")) return "npm";
  return undefined;
}

async function checkInternet(): Promise<boolean> {
  try {
    const res = await fetch("https://registry.npmjs.org/", { method: "HEAD", signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function auditStatus(): Promise<HealthCheck> {
  try {
    const { AuditStore } = await import("../state/stores/audit-store.ts");
    const store = new AuditStore();
    const chain = store.verifyChain();
    const count = store.count();
    store.close();
    return chain.valid
      ? { id: "audit", label: "Audit chain", state: "ok", detail: `${count} entries intact` }
      : { id: "audit", label: "Audit chain", state: "fail", detail: `broken at row ${chain.brokenAt}`, remediation: "Restore ~/.xr/xr.db from backup or archive it and start a new audit chain." };
  } catch (e) {
    return { id: "audit", label: "Audit chain", state: "warn", detail: (e as Error).message, remediation: "Run xr repair after installing Bun dependencies." };
  }
}

export async function probeHealth(opts: InstallOptions = {}): Promise<HealthCheck[]> {
  const p = detectPlatform();
  const checks: HealthCheck[] = [];
  checks.push({ id: "platform", label: "Platform", state: p.os === "unknown" ? "warn" : "ok", detail: `${p.os}/${p.arch} · ${p.terminal}${p.ci ? " · CI" : ""}` });
  checks.push({ id: "bun", label: "Bun runtime", state: commandExists("bun") ? "ok" : "fail", detail: commandExists("bun") ? runCommand("bun", ["--version"], { timeoutMs: 3000 }).stdout.trim() : "missing", remediation: "Install Bun from https://bun.sh, then run xr repair." });
  checks.push({ id: "git", label: "Git", state: commandExists("git") ? "ok" : "warn", detail: commandExists("git") ? "installed" : "missing", remediation: "Install Git for update/rollback support." });
  checks.push({ id: "package-manager", label: "Package manager", state: packageManager() ? "ok" : "fail", detail: packageManager() ?? "missing", remediation: "Install Bun or npm." });

  try {
    const { warnings } = loadConfig();
    checks.push({ id: "config", label: "Config", state: warnings.length ? "warn" : "ok", detail: warnings.length ? `${warnings.length} warning(s)` : configPath(), remediation: warnings.join("; ") || undefined });
  } catch (e) {
    checks.push({ id: "config", label: "Config", state: "fail", detail: (e as Error).message, remediation: "Run xr repair to recreate a safe config." });
  }

  const { config } = loadConfig();
  const selectedModel = config.localModels.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
  const ollama = await ollamaStatus(selectedModel);
  checks.push({ id: "ollama-cli", label: "Ollama CLI", state: ollama.installed ? "ok" : (config.localModels.enabled ? "fail" : "warn"), detail: ollama.installed ? "installed" : "missing", remediation: "Run xr models install after installing Ollama from https://ollama.com." });
  checks.push({ id: "ollama-server", label: "Ollama server", state: ollama.running ? "ok" : (config.localModels.enabled ? "warn" : "skip"), detail: ollama.running ? "running" : "not running", remediation: "Start Ollama, then rerun xr doctor." });
  checks.push({ id: "local-model", label: "Local model", state: ollama.models.includes(selectedModel) ? "ok" : (config.localModels.enabled ? "warn" : "skip"), detail: selectedModel, remediation: `Run xr models install ${selectedModel}.` });

  const secretBackend = preferredSecretBackend();
  checks.push({ id: "secrets", label: "Secret store", state: secretBackend === "file" ? "warn" : "ok", detail: secretBackend, remediation: secretBackend === "file" ? `Keys fall back to ${join(XR_HOME, ".env")} with chmod 600. Install OS secret tooling for stronger storage.` : undefined });

  const ffmpeg = commandExists("ffmpeg");
  const whisper = commandExists("whisper-cli") || commandExists("main") || existsSync(join(XR_HOME, "components", "whisper.cpp"));
  const piper = commandExists("piper") || existsSync(join(XR_HOME, "components", "piper"));
  checks.push({ id: "voice", label: "Voice tools", state: ffmpeg && (process.env.XR_STT_URL || whisper) && (process.env.XR_TTS_URL || piper) ? "ok" : "warn", detail: `ffmpeg=${ffmpeg ? "yes" : "no"}, whisper=${whisper ? "yes" : "no"}, piper=${piper ? "yes" : "no"}`, remediation: "Run xr voice setup. Voice remains disabled until you start it explicitly." });

  const playwrightInstalled = existsSync(join(rootDir, "node_modules", "playwright"));
  checks.push({ id: "browser", label: "Browser automation", state: playwrightInstalled ? "ok" : "warn", detail: playwrightInstalled ? "Playwright package present" : "Playwright/Chromium not installed", remediation: "Run xr control browser install or xr install --mode full." });

  const control = controlCapabilitySummary(p.os);
  checks.push({ id: "control", label: "Desktop control", state: control.ok ? "ok" : "warn", detail: control.detail, remediation: control.remediation });

  checks.push(await auditStatus());

  if (opts.network) {
    const online = await checkInternet();
    checks.push({ id: "network", label: "Internet", state: online ? "ok" : "warn", detail: online ? "reachable" : "not reachable", remediation: "Offline/local mode is supported; online installs and cloud providers will fail until network is available." });
  } else {
    checks.push({ id: "network", label: "Internet", state: "skip", detail: "not probed by default", remediation: "Run xr doctor --network to test connectivity." });
  }

  return checks;
}

function controlCapabilitySummary(os: XROs): { ok: boolean; detail: string; remediation?: string } {
  if (os === "macos") {
    const okBase = commandExists("osascript") && commandExists("open");
    const mouse = commandExists("cliclick");
    return { ok: okBase, detail: `osascript=${okBase ? "yes" : "no"}, cliclick=${mouse ? "yes" : "no"}`, remediation: mouse ? undefined : "For mouse control: brew install cliclick." };
  }
  if (os === "linux") {
    const wayland = (process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland";
    const okLinux = commandExists("xdotool") && commandExists("wmctrl") && commandExists("xdg-open") && !wayland;
    return { ok: okLinux, detail: `xdotool=${commandExists("xdotool") ? "yes" : "no"}, wmctrl=${commandExists("wmctrl") ? "yes" : "no"}, session=${process.env.XDG_SESSION_TYPE || "unknown"}`, remediation: wayland ? "Wayland blocks synthetic desktop input; use X11 or browser automation." : "Install xdotool wmctrl xdg-utils." };
  }
  if (os === "windows") return { ok: commandExists("powershell") || commandExists("pwsh"), detail: `PowerShell=${commandExists("powershell") || commandExists("pwsh") ? "yes" : "no"}` };
  if (os === "termux") return { ok: false, detail: "Android shell", remediation: "Desktop control is unavailable in Termux; use browser/local model features." };
  return { ok: false, detail: "unknown platform" };
}

function stateIcon(state: HealthState): string {
  if (state === "ok") return C.green("✓");
  if (state === "warn") return C.amber("!");
  if (state === "fail") return C.red("✗");
  return C.dim("-");
}

export async function printStatus(args: string[] = []): Promise<void> {
  const opts = parseOptions(args);
  const json = args.includes("--json");
  const checks = await probeHealth(opts);
  if (json) {
    console.log(JSON.stringify({ platform: detectPlatform(), checks }, null, 2));
    return;
  }
  banner();
  console.log(C.bold("XR System Status"));
  for (const c of checks) {
    console.log(`  ${c.label.padEnd(20)} ${stateIcon(c.state)} ${c.detail}`);
  }
  const failures = checks.filter((c) => c.state === "fail");
  const warnings = checks.filter((c) => c.state === "warn");
  console.log("");
  if (!failures.length && !warnings.length) ok("XR is healthy.");
  else if (failures.length) warn(`${failures.length} failure(s), ${warnings.length} warning(s). Run xr repair for safe fixes.`);
  else warn(`${warnings.length} warning(s). Optional components may be missing.`);
  for (const c of [...failures, ...warnings].filter((c) => c.remediation)) console.log(`  ${C.dim("→")} ${c.label}: ${c.remediation}`);
}

export async function repairXR(args: string[] = []): Promise<void> {
  const opts = parseOptions(args);
  banner();
  console.log(C.bold("XR Repair"));
  ensureConfig();
  ok(`Config present: ${configPath()}`);
  const envFile = join(XR_HOME, ".env");
  if (existsSync(envFile)) { try { chmodSync(envFile, 0o600); ok("Secret fallback file permissions hardened."); } catch { warn("Could not chmod ~/.xr/.env on this platform."); } }

  const pm = packageManager();
  if (pm && (opts.yes || await approved(`Run ${pm} install to repair dependencies?`, false, opts))) {
    const cmd = pm;
    const installArgs = pm === "bun" ? ["install"] : ["install"];
    const res = runCommand(cmd, installArgs, { cwd: rootDir, inherit: true, timeoutMs: 600_000 });
    if (res.ok) ok("Dependencies repaired."); else warn(`${pm} install failed.`);
  }
  await printStatus(args.filter((a) => a === "--json" || a === "--network"));
}

export async function updateXR(args: string[] = []): Promise<void> {
  const opts = parseOptions(args);
  banner();
  console.log(C.bold("XR Update"));
  backupConfig("pre-update");
  let oldHead = "";
  if (existsSync(join(rootDir, ".git")) && commandExists("git")) {
    oldHead = runCommand("git", ["rev-parse", "HEAD"], { cwd: rootDir }).stdout.trim();
    const pull = runCommand("git", ["pull", "--ff-only", "origin", "main"], { cwd: rootDir, inherit: true, timeoutMs: 300_000 });
    if (!pull.ok) {
      warn("Git update failed. Existing installation was left unchanged.");
      return;
    }
  } else {
    warn("This installation is not a Git checkout. Re-run the bootstrap installer or update through your package manager.");
  }

  const pm = packageManager();
  if (pm) {
    const deps = runCommand(pm, ["install"], { cwd: rootDir, inherit: true, timeoutMs: 600_000 });
    if (!deps.ok && oldHead && await approved("Dependency install failed. Roll back Git checkout to previous revision?", true, opts)) {
      runCommand("git", ["reset", "--hard", oldHead], { cwd: rootDir, inherit: true, timeoutMs: 120_000 });
      warn("Rolled back code checkout. Config backup is in ~/.xr/backups.");
      return;
    }
    if (deps.ok) ok("Dependencies updated.");
  }
  ensureConfig();
  ok("Update complete.");
}

export async function resetXR(args: string[] = []): Promise<void> {
  const opts = parseOptions(args);
  const hard = args.includes("--hard");
  banner();
  console.log(C.bold("XR Reset"));
  console.log(`  Config: ${configPath()}`);
  console.log(`  Database: ${join(XR_HOME, "xr.db")}`);
  console.log(`  Secrets: ${hard ? "file fallback will be removed" : "kept"}`);
  if (!await approved(hard ? "Factory reset XR and remove file fallback secrets?" : "Reset XR config and database?", false, opts, false)) {
    info("Cancelled.");
    return;
  }
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const file of [configPath(), join(XR_HOME, "xr.db")]) {
    if (existsSync(file)) copyFileSync(file, join(XR_HOME, "backups", `${stamp}.${file.split(/[\\/]/).pop()}`));
    rmSync(file, { force: true });
  }
  if (hard) rmSync(join(XR_HOME, ".env"), { force: true });
  ensureConfig();
  ok("Reset complete. Backups were written before deletion.");
}

export async function installComponent(pack: InstallPack, opts: InstallOptions = {}): Promise<void> {
  ensureConfig();
  switch (pack) {
    case "core":
      ok("Core pack is present.");
      return;
    case "local-ai":
      return await setupLocalAI(opts);
    case "voice":
      return await setupVoice(opts);
    case "browser":
      return await setupBrowser(opts);
    case "control":
      return await setupControl(opts);
    case "research":
      return await setupResearch(opts);
    case "security":
      return await setupSecurity(opts);
    case "business":
    case "dev":
      warn(`${pack} pack has no installer yet. Core XR remains usable.`);
      return;
  }
}

async function setupLocalAI(opts: InstallOptions): Promise<void> {
  const specs = detectHardwareSpecs();
  const rec = recommendLocalModel(specs);
  const status = await ollamaStatus(rec.model.id);
  console.log(C.bold("Local AI Pack"));
  console.log(`  Hardware: ${formatHardwareSummary(specs)}`);
  console.log(`  Recommended model: ${C.green(rec.model.id)} ${C.dim(rec.reason)}`);
  if (!status.installed) {
    warn("Ollama is not installed. XR will not run an external installer silently.");
    if (await approved("Install Ollama using the platform package manager/official installer?", false, opts, true)) {
      await installOllama(opts);
    } else {
      info("Install Ollama from https://ollama.com, then run xr models install.");
      return;
    }
  }
  const model = isTTY && !opts.yes ? await ask("Ollama model to use", { default: rec.model.id }) : rec.model.id;
  if (!validateOllamaModelId(model)) { warn("Invalid model id."); return; }
  const after = await ollamaStatus(model);
  if (after.installed && after.running && !after.models.includes(model) && await approved(`Download ${model} with ollama pull?`, true, opts)) {
    const pulled = await pullOllamaModel(model);
    if (!pulled) { warn(`Failed to pull ${model}.`); return; }
  }
  const { config } = loadConfig();
  config.localModels.enabled = true;
  config.localModels.runtime = "ollama";
  config.localModels.selected = model;
  config.localModels.recommended = rec.model.id;
  config.localModels.recommendationReason = rec.reason;
  config.localModels.routing = opts.mode === "local" ? "local-only" : "hybrid";
  if (opts.mode === "local") {
    config.defaults.provider = "ollama";
    config.defaults.model = model;
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel = undefined;
  } else {
    config.defaults.fallbackProvider = "ollama";
    config.defaults.fallbackModel = model;
  }
  saveConfigSafely(config, "local-ai-pack");
  ok(`Local AI configured with ${model}.`);
  const finalStatus = await ollamaStatus(model);
  if (finalStatus.running && finalStatus.models.includes(model) && await approved("Run local model smoke test?", true, opts)) {
    const test = await testOllamaModel(model);
    if (test.ok) ok(`${model} responded in ${test.latencyMs}ms.`); else warn(test.detail);
  }
}

async function installOllama(opts: InstallOptions): Promise<void> {
  const os = detectPlatform().os;
  if (os === "macos" && commandExists("brew")) runCommand("brew", ["install", "ollama"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "linux" && commandExists("curl")) runCommand("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "windows" && commandExists("winget")) runCommand("winget", ["install", "-e", "--id", "Ollama.Ollama"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "termux") warn("Ollama is not supported directly in standard Termux. Use a remote Ollama endpoint or BYOK mode.");
  else warn("No safe automatic Ollama installer is available for this platform. Install from https://ollama.com.");
}

async function setupVoice(opts: InstallOptions): Promise<void> {
  console.log(C.bold("Voice Pack"));
  if (!commandExists("ffmpeg")) {
    warn("ffmpeg is missing.");
    if (await approved("Install ffmpeg with the platform package manager?", false, opts, true)) await installFfmpeg();
  } else ok("ffmpeg detected.");
  const { config } = loadConfig();
  config.voice.alwaysListen = false;
  saveConfigSafely(config, "voice-pack");
  info("XR voice currently uses XR_STT_URL/XR_TTS_URL endpoints or installed local tools when wired by the voice service.");
  info("This pack does not enable always-listening or microphone capture. Start explicitly with: xr voice start");
  if (!process.env.XR_STT_URL) info("Set XR_STT_URL for STT service, or install/run whisper.cpp yourself under ~/.xr/components/whisper.cpp.");
  if (!process.env.XR_TTS_URL) info("Set XR_TTS_URL for TTS service, or install/run Piper yourself under ~/.xr/components/piper.");
}

async function installFfmpeg(): Promise<void> {
  const os = detectPlatform().os;
  if (os === "macos" && commandExists("brew")) runCommand("brew", ["install", "ffmpeg"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "linux" && commandExists("apt-get")) runCommand("sudo", ["apt-get", "install", "-y", "ffmpeg"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "linux" && commandExists("dnf")) runCommand("sudo", ["dnf", "install", "-y", "ffmpeg"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "linux" && commandExists("pacman")) runCommand("sudo", ["pacman", "-S", "--needed", "ffmpeg"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "termux" && commandExists("pkg")) runCommand("pkg", ["install", "-y", "ffmpeg"], { inherit: true, timeoutMs: 900_000 });
  else if (os === "windows" && commandExists("winget")) runCommand("winget", ["install", "-e", "--id", "Gyan.FFmpeg"], { inherit: true, timeoutMs: 900_000 });
  else warn("Install ffmpeg from https://ffmpeg.org/download.html.");
}

async function setupBrowser(opts: InstallOptions): Promise<void> {
  console.log(C.bold("Browser Automation Pack"));
  const pm = packageManager();
  if (!pm) { warn("Bun/npm missing; cannot install Playwright."); return; }
  if (!await approved("Install Playwright package and Chromium browser download? (~150-200MB)", true, opts)) return;
  const addArgs = pm === "bun" ? ["add", "playwright"] : ["install", "playwright"];
  const installed = runCommand(pm, addArgs, { cwd: rootDir, inherit: true, timeoutMs: 900_000 });
  if (!installed.ok) { warn("Playwright package install failed."); return; }
  const runner = pm === "bun" ? "bunx" : "npx";
  const browser = runCommand(runner, ["playwright", "install", "chromium"], { cwd: rootDir, inherit: true, timeoutMs: 900_000 });
  if (browser.ok) ok("Playwright Chromium installed."); else warn("Chromium install failed. Run: npx playwright install chromium");
}

async function setupControl(opts: InstallOptions): Promise<void> {
  console.log(C.bold("Desktop Control Pack"));
  const p = detectPlatform();
  const caps = controlCapabilitySummary(p.os);
  console.log(`  ${caps.detail}`);
  if (!caps.ok && caps.remediation) warn(caps.remediation);
  if (p.os === "macos" && !commandExists("cliclick") && commandExists("brew") && await approved("Install cliclick for mouse control?", false, opts, true)) runCommand("brew", ["install", "cliclick"], { inherit: true, timeoutMs: 600_000 });
  if (p.os === "linux" && !String(process.env.XDG_SESSION_TYPE).toLowerCase().includes("wayland") && commandExists("apt-get") && await approved("Install xdotool wmctrl xdg-utils?", false, opts, true)) runCommand("sudo", ["apt-get", "install", "-y", "xdotool", "wmctrl", "xdg-utils"], { inherit: true, timeoutMs: 600_000 });
  const { config } = loadConfig();
  config.control.enabled = false;
  saveConfigSafely(config, "control-pack");
  info("Desktop control remains disabled. Enable explicitly with: xr control start");
}

async function setupResearch(opts: InstallOptions): Promise<void> {
  console.log(C.bold("Research Pack"));
  const { config } = loadConfig();
  if (!config.security.egressAllowlist.includes("searx.be")) config.security.egressAllowlist.push("searx.be");
  saveConfigSafely(config, "research-pack");
  info("Research uses configured provider + egress allow-list. Set XR_SEARXNG to your own SearXNG for local/private search.");
  if (opts.network) {
    const online = await checkInternet();
    if (online) ok("Network reachable."); else warn("Network not reachable; research will need local/private search or connectivity.");
  }
}

async function setupSecurity(opts: InstallOptions): Promise<void> {
  console.log(C.bold("Security Pack"));
  const { config } = loadConfig();
  config.security.requireApproval = Array.from(new Set([...(config.security.requireApproval ?? []), "write_file", "delete", "shell", "send"]));
  config.plugins.requireTrust = true;
  saveConfigSafely(config, "security-pack");
  ok(`Approval gates hardened. Secret backend: ${preferredSecretBackend()}.`);
}

function providerDefaultModel(provider: string): string {
  return PRESETS[provider]?.defaultModel ?? "gpt-4o-mini";
}

function normalizeMode(input?: string): InstallOptions["mode"] {
  if (input === "1" || input === "minimal") return "minimal";
  if (input === "2" || input === "local") return "local";
  if (input === "3" || input === "byok") return "byok";
  if (input === "5" || input === "full") return "full";
  return "hybrid";
}

export async function runInstallWizard(args: string[] = []): Promise<void> {
  const opts = parseOptions(args);
  ensureConfig();
  banner();
  console.log(C.bold("XR Stage 2 Installation Wizard"));
  console.log(C.dim("Idempotent · resumable · local-first · no optional component is enabled silently\n"));
  const platform = detectPlatform();
  console.log(`  Platform: ${platform.os}/${platform.arch} · ${platform.terminal}`);
  console.log(`  XR home:  ${XR_HOME}`);
  console.log("");

  if (!isTTY && !opts.yes) {
    warn("Non-interactive terminal detected. Created/validated core config only.");
    info("Run `xr install --yes --mode minimal` for unattended minimal setup, or run `xr install` in a real terminal for the wizard.");
    return;
  }

  let mode = opts.mode;
  if (!mode && isTTY && !opts.yes) {
    console.log(`${C.bold("Install mode")}
  [1] Minimal core only
  [2] Local only — Ollama/local model, no cloud keys
  [3] BYOK cloud — provider keys, no local model required
  [4] Hybrid — cloud primary with local fallback
  [5] Full power-user setup — asks for optional packs`);
    mode = normalizeMode(await ask("Choose mode", { default: "4" }));
  } else mode = mode ?? "hybrid";
  opts.mode = mode;

  const packs = new Set<InstallPack>(["core", "security"]);
  if (mode === "local" || mode === "hybrid" || mode === "full") packs.add("local-ai");
  if (mode === "full") for (const p of ["voice", "browser", "control", "research"] as InstallPack[]) packs.add(p);
  if (isTTY && !opts.yes) {
    if (mode !== "full") {
      if (await confirm("Add voice pack?", false)) packs.add("voice");
      if (await confirm("Add browser automation pack?", false)) packs.add("browser");
      if (await confirm("Add desktop control prerequisites?", false)) packs.add("control");
      if (await confirm("Add research pack?", mode === "hybrid")) packs.add("research");
    }
  }

  const { config } = loadConfig();
  if (mode === "local") {
    config.defaults.provider = "ollama";
    config.defaults.model = config.localModels.selected ?? "qwen2.5:7b";
    config.budget.perTaskUsd = 0;
  }

  if (mode === "byok" || mode === "hybrid" || mode === "full") {
    if (isTTY && !opts.yes) {
      console.log(`\n${C.bold("Cloud provider keys (optional, BYOK)")}`);
      console.log(`  Supported: ${knownProviders().filter((p) => p !== "ollama").join(", ")}`);
      const selected = await ask("Providers to configure (comma-separated, blank to skip)", { default: mode === "byok" ? "openai" : "" });
      let firstProvider = "";
      for (const provider of selected.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!knownProviders().includes(provider) || provider === "ollama") { warn(`Skipping unknown provider: ${provider}`); continue; }
        const envName = PRESETS[provider]?.apiKeyEnv;
        if (!envName) continue;
        const key = await password(`Enter API key for ${provider}:`);
        if (!key) continue;
        const backend = setSecret(envName, key);
        process.env[envName] = key;
        ok(`Saved ${provider} key in ${backend}.`);
        firstProvider ||= provider;
      }
      if (firstProvider) {
        config.defaults.provider = firstProvider;
        config.defaults.model = providerDefaultModel(firstProvider);
      }

      // Stage 3: custom OpenAI-compatible endpoint onboarding
      if (await confirm("Add a custom OpenAI-compatible endpoint (e.g., LM Studio, vLLM, enterprise proxy)?", false)) {
        const id = await ask("Custom provider ID (short, lowercase, no spaces)", { default: "custom" });
        const label = await ask("Provider label", { default: id });
        const baseUrl = await ask("Base URL (must end in /v1 for OpenAI compat)", { default: "http://localhost:8080/v1" });
        const defaultModel = await ask("Default model name", { default: "llama" });
        const useKey = await confirm("Does this endpoint require an API key?", false);
        let apiKeyEnv: string | undefined;
        if (useKey) {
          apiKeyEnv = await ask("Environment variable name for the key", { default: `${id.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_API_KEY` });
          const key = await password(`Enter API key for ${id}:`);
          if (key) {
            const backend = setSecret(apiKeyEnv, key);
            process.env[apiKeyEnv] = key;
            ok(`Saved ${id} key in ${backend}.`);
          }
        }
        config.providerEngine.customProviders = config.providerEngine.customProviders ?? [];
        config.providerEngine.customProviders.push({
          id,
          label,
          baseUrl,
          defaultModel,
          apiKeyEnv,
          capabilities: { chat: true },
        });
        if (!firstProvider) {
          config.defaults.provider = id;
          config.defaults.model = defaultModel;
        }
      }
    }
    const cap = isTTY && !opts.yes ? await ask("Hard spend cap per cloud task in USD", { default: mode === "byok" ? "0.25" : "0.10" }) : (mode === "byok" ? "0.25" : "0.10");
    const parsed = Math.max(0, Math.min(100, Number.parseFloat(cap) || 0));
    config.budget.perTaskUsd = parsed;
  }
  saveConfigSafely(config, "install-wizard");

  console.log(`\n${C.bold("Selected packs")}: ${Array.from(packs).join(", ")}`);
  for (const pack of packs) await installComponent(pack, opts);

  console.log(`\n${C.bold("Final health summary")}`);
  await printStatus(args.includes("--network") ? ["--network"] : []);
  console.log(`\n${C.bold("Next steps")}`);
  console.log(`  xr doctor${C.dim("        # verify health")}`);
  console.log(`  xr models recommend${C.dim(" # see local model recommendation")}`);
  console.log(`  xr "hello"${C.dim("       # run your first task")}`);
}
