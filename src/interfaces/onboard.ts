/**
 * XR 3.1E — Complete Onboarding Experience (ENHANCED)
 * Calm · Fast · Trustworthy · Transparent · Minimal · Professional
 * < 60 seconds to first message for non-technical users
 *
 * Enhancements:
 * - Visual welcome with avatar presence
 * - Hardware profile visualization
 * - Model recommendations as visual cards
 * - Clear local/cloud/hybrid indicators
 * - Progress indication
 *
 * Backend engines (provider/memory/research/voice/plugin/MCP/computer/shield/kernel) untouched
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadConfig, XR_HOME, configPath, saveConfig } from "../config/config.ts";
import { knownProviders, PRESETS } from "../providers/factory.ts";
import { banner, info, ok, warn, ask, confirm, password, colors as C } from "./cli.ts";
import { StepTracker } from "../ui/spinner.ts";
import { section, kv, divider, notify } from "../ui/layout.ts";
import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, SYM } from "../ui/theme.ts";
import { renderCompactAvatar, renderLargeAvatar, type AvatarState } from "../ui/avatar.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../local/hardware.ts";
import { recommendLocalModel } from "../local/recommend.ts";
import { ollamaStatus, pullOllamaModel, testOllamaModel } from "../local/ollama.ts";
import { setSecret, preferredSecretBackend } from "../security/secrets.ts";
import { detectPlatform, probeHealth } from "../install/system.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OnboardingState {
  mode: "local" | "cloud" | "hybrid";
  providerId: string;
  model: string;
  localModel: string;
  localEnabled: boolean;
  apiKeys: Record<string, string>;
  workspaceName: string;
  theme: "dark" | "high-contrast" | "reduced-motion";
  accessibility: { largeText: boolean; screenReader: boolean };
  importPath?: string;
  dependenciesInstalled: string[];
}

// ── Avatar State for Onboarding ───────────────────────────────────────────────

let onboardingAvatar: AvatarState = "idle";

function setOnboardingAvatar(state: AvatarState): void {
  onboardingAvatar = state;
}

// ── Non-interactive mode ──────────────────────────────────────────────────────

let assumeYes = false;

function askO(promptText: string, options?: { default?: string }): Promise<string> {
  if (assumeYes) return Promise.resolve(options?.default ?? "");
  return ask(promptText, options);
}

function confirmO(promptText: string, defaultYes = true): Promise<boolean> {
  if (assumeYes) return Promise.resolve(defaultYes);
  return confirm(promptText, defaultYes);
}

function passwordO(promptText: string): Promise<string> {
  if (assumeYes) return Promise.resolve(""); // no providers are preselected in --yes mode
  return password(promptText);
}

// ── Visual Helpers ────────────────────────────────────────────────────────────

/** Render a visual card in terminal */
function visualCard(title: string, lines: string[], accent: "cyan" | "green" | "violet" | "amber"): string[] {
  const color = accent === "cyan" ? xrCyan
    : accent === "green" ? xrGreen
    : accent === "violet" ? xrViolet
    : xrAmber;

  const result: string[] = [];
  result.push(xrDim("┌" + "─".repeat(Math.max(20, title.length + 2)) + "┐"));
  result.push(color(`│ ${title}`));
  result.push(xrDim("│"));
  for (const line of lines) {
    result.push(xrDim(`│  ${line}`));
  }
  result.push(xrDim("└" + "─".repeat(Math.max(20, title.length + 2)) + "┘"));
  return result;
}

/** Render hardware profile card */
function hardwareCard(specs: ReturnType<typeof detectHardwareSpecs>): string[] {
  return visualCard("Your Computer", [
    `● CPU: ${specs.cpuCores} cores`,
    `● Memory: ${specs.memoryGb} GB`,
    `● Storage: ${specs.storageGb} GB available`,
    `● OS: ${specs.os}`,
  ], "cyan");
}

/** Render model recommendation card */
function modelCard(model: ReturnType<typeof recommendLocalModel>["default"], index: number): string[] {
  const isRecommended = model.reason === "recommended";
  const marker = isRecommended ? "★ " : "  ";

  return [
    xrDim("┌" + "─".repeat(50) + "┐"),
    isRecommended ? xrCyan(`│ ${marker}${model.name}  [RECOMMENDED]`)
      : xrDim(`│ ${marker}${model.name}`),
    xrDim(`│  ${model.description}`),
    xrDim(`│  Size: ${model.sizeGB} GB  ·  RAM: ~${model.ramGb} GB`),
    xrDim(`│  ${model.reason}`),
    xrDim("└" + "─".repeat(50) + "┘"),
  ];
}

/** Render provider card */
function providerCard(name: string, preset: typeof PRESETS[name], index: number): string[] {
  const type = preset.local ? "⬡ Local" : "☁ Cloud";
  const defaultModel = preset.defaultModel;

  return [
    xrDim("┌" + "─".repeat(40) + "┐"),
    xrCyan(`│ ${name}`),
    xrDim(`│  ${type}  ·  ${defaultModel}`),
    xrDim("└" + "─".repeat(40) + "┘"),
  ];
}

// ── Privacy & Local-first Messaging ───────────────────────────────────────────

function showPrivacyLocalExplanation(): void {
  const avatarLine = renderCompactAvatar(onboardingAvatar, "XR");

  section("Privacy & Local-first by Design");
  console.log();
  console.log(`  ${avatarLine}`);
  console.log(`  ${SYM.local} ${xrGreen("Everything stays on your machine unless you choose a cloud provider.")}`);
  console.log(`  ${SYM.secure} ${xrGreen("Prompts sent to a cloud provider only when you select that provider.")}`);
  console.log(`  ${SYM.secure} ${xrGreen("No data is ever sent to XR servers.")}`);
  console.log(`  ${SYM.secure} ${xrGreen("Microphone / filesystem access is requested only when you enable voice or computer control.")}`);
  console.log(`  ${xrDim("You can change any of these settings later in Settings → Privacy.")}`);
  console.log();
}

// ── Welcome Screen ────────────────────────────────────────────────────────────

function showWelcome(): void {
  const platform = detectPlatform();
  banner();

  // Avatar welcome
  setOnboardingAvatar("idle");
  const avatarLines = renderLargeAvatar(onboardingAvatar, "XR");

  console.log(`  ${avatarLines[0]}`);
  console.log(`  ${avatarLines[1]}  ${xrBold("XR")}`);
  console.log(`  ${avatarLines[2]}  ${xrDim("—")} ${xrCyan("one operating system")}`);
  console.log();
  console.log(`  ${xrBold("Welcome to XR.")} Your calm, local-first AI agent runtime.`);
  console.log();
  console.log(`  ${xrDim("Install → Configure → First message in under 60 seconds.")}`);
  console.log();

  console.log(`  ${SYM.local} ${xrGreen("Local-first")}  — run 100% offline with Ollama`);
  console.log(`  ${SYM.secure} ${xrGreen("Privacy-first")} — you control every byte`);
  console.log(`  ${SYM.budget} ${xrGreen("Spend-capped")} — hard budget ceiling enforced in code`);
  console.log(`  ${SYM.secure} ${xrGreen("BYOK")} — bring your own keys, zero vendor lock-in`);
  console.log();
  kv("Platform", `${platform.os} / ${platform.arch}`, "cyan");
  kv("Shell", platform.shell, "dim");
  console.log();

  // Hardware detection with visual card
  setOnboardingAvatar("working");
  console.log(`  ${renderCompactAvatar(onboardingAvatar, "Detecting")} Detecting your computer...`);
  const specs = detectHardwareSpecs();
  for (const line of hardwareCard(specs)) {
    console.log(`  ${line}`);
  }
  console.log();
}

// ── Provider Setup Options ────────────────────────────────────────────────────

async function chooseProviderMode(): Promise<"local" | "cloud" | "hybrid"> {
  setOnboardingAvatar("listening");
  console.log(`  ${renderCompactAvatar(onboardingAvatar, "XR")} How do you want to use XR?`);
  console.log();

  const options = [
    ["1", "Local", "⬡", xrGreen("100% offline · Free · Your models"), "Best for privacy and offline use"],
    ["2", "Cloud", "☁", xrAmber("Powerful models · Easy setup"), "Uses internet to access cloud AI"],
    ["3", "Hybrid", "⬡☁", xrCyan("Local + cloud fallback"), "Local first, cloud when needed"],
  ];

  for (const [num, name, icon, desc, note] of options) {
    console.log(`    ${xrBold(num)}  ${icon} ${xrBold(name)}`);
    console.log(`        ${desc}`);
    console.log(`        ${xrDim(note)}`);
    console.log();
  }

  const choice = await askO("Choose (1/2/3)", { default: "1" });

  setOnboardingAvatar("idle");

  if (choice === "2") return "cloud";
  if (choice === "3") return "hybrid";
  return "local";
}

// ── Local Model Recommendation ────────────────────────────────────────────────

async function recommendLocalModels(state: OnboardingState): Promise<void> {
  setOnboardingAvatar("thinking");
  console.log(`  ${renderCompactAvatar(onboardingAvatar, "XR")} Recommending models for your computer...`);
  console.log();

  const recommendations = recommendLocalModel({
    cpuCores: detectHardwareSpecs().cpuCores,
    memoryGb: detectHardwareSpecs().memoryGb,
    hasOllama: ollamaStatus().running,
  });

  for (let i = 0; i < recommendations.length; i++) {
    const model = recommendations[i];
    for (const line of modelCard(model, i)) {
      console.log(`  ${line}`);
    }
    console.log();
  }

  setOnboardingAvatar("idle");

  const useRecommended = await confirmO("Use the recommended model?", true);

  if (useRecommended) {
    state.localModel = recommendations[0].name;
    state.localEnabled = true;
    ok(`Selected: ${state.localModel}`);
  } else if (recommendations.length > 1) {
    const choice = await askO("Choose a model", { default: recommendations[0].name });
    const selected = recommendations.find(m => m.name === choice) ?? recommendations[0];
    state.localModel = selected.name;
    state.localEnabled = true;
    ok(`Selected: ${state.localModel}`);
  } else {
    state.localModel = recommendations[0].name;
    state.localEnabled = true;
    ok(`Selected: ${state.localModel}`);
  }
}

// ── Cloud Provider Selection ──────────────────────────────────────────────────

async function configureCloudProviders(state: OnboardingState, internet: boolean): Promise<void> {
  setOnboardingAvatar("listening");
  section("Connect Cloud Providers (optional)");
  console.log();
  console.log(`  ${renderCompactAvatar(onboardingAvatar, "XR")} XR validates keys instantly and stores them securely.`);
  console.log(`  ${xrDim("Supported providers will grow automatically — no code changes needed.")}`);
  console.log();

  const cloudProviders = knownProviders().filter(p => p !== "ollama");
  console.log(`  ${xrDim("Available:")} ${cloudProviders.join("  ")}`);
  console.log(`  ${xrDim("Press Enter to skip and stay 100% local.")}`);
  console.log();

  // Show provider cards
  for (const p of cloudProviders.slice(0, 6)) {
    const preset = PRESETS[p];
    if (preset) {
      for (const line of providerCard(p, preset, cloudProviders.indexOf(p))) {
        console.log(`  ${line}`);
      }
      console.log();
    }
  }

  const selected = await askO("Providers to configure (comma-separated)", { default: "" });
  if (!selected.trim()) {
    console.log(`  ${xrDim("Skipped — using local-only or hybrid mode.")}`);
    setOnboardingAvatar("idle");
    return;
  }

  for (const p of selected.split(",").map(s => s.trim()).filter(Boolean)) {
    if (!cloudProviders.includes(p)) {
      warn(`Unknown provider skipped: ${p}`);
      continue;
    }
    const preset = PRESETS[p];
    if (!preset?.apiKeyEnv) continue;

    setOnboardingAvatar("working");
    console.log(`  ${renderCompactAvatar(onboardingAvatar, "Connecting")} Connecting to ${p}...`);

    const key = await passwordO(`  API key for ${p}:`);
    if (key) {
      await setSecret(preset.apiKeyEnv, key);
      state.apiKeys[p] = key;
      state.providerId = p;
      state.model = preset.defaultModel;
      ok(`${p} configured`);

      // Test connection
      setOnboardingAvatar("thinking");
      console.log(`  ${renderCompactAvatar(onboardingAvatar, "Testing")} Testing connection...`);
      const healthy = await probeHealth(p);
      if (healthy) {
        setOnboardingAvatar("complete");
        console.log(`  ${renderCompactAvatar(onboardingAvatar, "✓")} ${p} is ready`);
        ok(`Connected to ${p}`);
      } else {
        setOnboardingAvatar("error");
        warn(`Could not verify ${p} — check your API key`);
      }
    }
    setOnboardingAvatar("idle");
  }
}

// ── Workspace + Theme + Accessibility ─────────────────────────────────────────

async function configureWorkspaceAndPreferences(state: OnboardingState): Promise<void> {
  section("Create Your Workspace");
  state.workspaceName = await askO("Workspace name", { default: "My First Workspace" });

  section("Theme & Accessibility");
  console.log();
  console.log(`  1  ${xrCyan("Dark (recommended)")} — calm professional experience`);
  console.log(`  2  High contrast`);
  console.log(`  3  Reduced motion`);
  console.log();

  const themeChoice = await askO("Choose theme", { default: "1" });
  state.theme = themeChoice === "2" ? "high-contrast" : themeChoice === "3" ? "reduced-motion" : "dark";

  state.accessibility.largeText = await confirmO("Enable larger text for readability?", false);
  state.accessibility.screenReader = await confirmO("Optimize for screen readers?", false);

  console.log();
  ok("Preferences saved. You can change these anytime in Settings.");
}

// ── Main Onboarding Flow ──────────────────────────────────────────────────────

export async function runOnboarding(yes = false): Promise<void> {
  assumeYes = yes;

  // Welcome
  setOnboardingAvatar("idle");
  showWelcome();

  // Privacy explanation
  showPrivacyLocalExplanation();

  // Provider mode
  const mode = await chooseProviderMode();

  // Check internet for cloud mode
  const internet = mode !== "local";
  if (internet) {
    const hasInternet = await checkInternet();
    if (!hasInternet) {
      warn("No internet connection detected.");
      if (!(await confirmO("Continue in local-only mode?", true))) {
        return;
      }
      // Fall back to local
      await recommendLocalModels({ mode: "local", providerId: "ollama", model: "", localModel: "", localEnabled: false, apiKeys: {}, workspaceName: "", theme: "dark", accessibility: { largeText: false, screenReader: false }, dependenciesInstalled: [] });
      return;
    }
  }

  // Configure based on mode
  const state: OnboardingState = {
    mode,
    providerId: "ollama",
    model: PRESETS.ollama?.defaultModel ?? "qwen2.5:7b",
    localModel: "",
    localEnabled: false,
    apiKeys: {},
    workspaceName: "",
    theme: "dark",
    accessibility: { largeText: false, screenReader: false },
    dependenciesInstalled: [],
  };

  if (mode === "local" || mode === "hybrid") {
    await recommendLocalModels(state);
  }

  if (mode === "cloud" || mode === "hybrid") {
    await configureCloudProviders(state, internet);
  }

  // Workspace & preferences
  await configureWorkspaceAndPreferences(state);

  // Save configuration
  saveConfig({
    defaults: {
      provider: state.providerId,
      model: state.model,
      mode: "agent",
    },
    budget: {
      perTaskUsd: 0,
    },
  });

  // Welcome complete
  setOnboardingAvatar("complete");
  console.log();
  console.log(`  ${renderCompactAvatar(onboardingAvatar, "✓")} ${xrBold("XR is ready!")}`);
  console.log();
  console.log(`  ${xrDim("Workspace:")} ${state.workspaceName}`);
  console.log(`  ${xrDim("Provider:")} ${state.providerId} / ${state.model}`);
  if (state.localEnabled) {
    console.log(`  ${xrDim("Local model:")} ${state.localModel}`);
  }
  console.log();
  console.log(`  ${xrCyan("›")} ${xrDim("Start chatting: xr \"hello\" or just run xr")}`);
  console.log();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function checkInternet(): Promise<boolean> {
  try {
    const res = await fetch("https://registry.npmjs.org/", { method: "HEAD", signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

function detectStorageGb(): number | null {
  try {
    if (process.platform === "win32") return null;
    const out = spawnSync("df", ["-k", process.cwd()], { encoding: "utf8" });
    if (out.status !== 0) return null;
    const line = out.stdout.trim().split("\n")[1];
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    const kb = Number.parseInt(parts[3] ?? "0", 10);
    return Math.round((kb / 1024 / 1024) * 10) / 10;
  } catch { return null; }
}

function defaultCloudModel(p: string): string {
  return PRESETS[p]?.defaultModel ?? "gpt-4o-mini";
}

// ── Record keyed provider ─────────────────────────────────────────────────────

export function recordKeyedProvider(state: OnboardingState, providerId: string): void {
  if (state.providerId !== "ollama") return; // first keyed provider wins
  state.providerId = providerId;
  state.model = defaultCloudModel(providerId);
}
