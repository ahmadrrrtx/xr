/**
 * XR Stage 5 — Onboarding UI
 *
 * Redesigned for Stage 5:
 *  - Full welcome screen with brand identity
 *  - Step-by-step progress indicator (StepTracker)
 *  - Cleaner hardware detection display
 *  - Better empty-state handling (no Ollama, no keys, etc.)
 *  - Explicit local-first privacy framing
 *  - Post-setup "next steps" surface with concrete commands
 *  - Typo fixed: "onbaord.ts" is the OLD file; this is the canonical one
 */

import { mkdirSync } from "node:fs";
import { loadConfig, XR_HOME, configPath, saveConfig } from "../config/config.ts";
import { knownProviders, PRESETS } from "../providers/factory.ts";
import { banner, info, ok, warn, ask, confirm, password, colors as C } from "./cli.ts";
import { StepTracker } from "../ui/spinner.ts";
import { section, kv, divider, notify, box } from "../ui/layout.ts";
import { xrCyan, xrGreen, xrAmber, xrDim, xrBold, SYM } from "../ui/theme.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../local/hardware.ts";
import { recommendLocalModel } from "../local/recommend.ts";
import { ollamaStatus, pullOllamaModel, testOllamaModel } from "../local/ollama.ts";
import { setSecret, preferredSecretBackend } from "../security/secrets.ts";

function defaultCloudModel(provider: string): string {
  return PRESETS[provider]?.defaultModel ?? "gpt-4o-mini";
}

// ── Local Model Setup ─────────────────────────────────────────────────────────

async function configureLocal(
  downloadPrompt = true,
): Promise<{ model: string; reason: string; installed: boolean }> {
  console.log();
  section("Local Model Setup");

  const tracker = new StepTracker()
    .addStep("hw",    "Detecting hardware")
    .addStep("model", "Selecting recommended model")
    .addStep("check", "Checking Ollama status")
    .start();

  const specs  = detectHardwareSpecs();
  tracker.setStatus("hw", "done", formatHardwareSummary(specs).slice(0, 60));

  const rec    = recommendLocalModel(specs);
  tracker.setStatus("model", "done", rec.model.id);

  const status = await ollamaStatus(rec.model.id);
  tracker.setStatus("check", status.installed ? "done" : "warn",
    status.installed ? (status.running ? "running" : "not running") : "not installed");

  tracker.finish();
  console.log();

  // Hardware summary
  kv("RAM",       specs.totalRamGb + "GB");
  kv("CPU cores", String(specs.cpuCores));
  const maxGpuVram = Math.max(0, ...specs.gpus.map((g) => g.vramGb ?? 0));
  if (maxGpuVram) kv("GPU VRAM", maxGpuVram + "GB");
  kv("Suitability", `${specs.tier} — ${specs.suitability.reason}`, specs.tier === "heavy" || specs.tier === "medium" ? "ok" : "warn");

  console.log();
  console.log(`  ${xrBold("Recommended model:")} ${xrCyan(rec.model.id)} ${xrDim("(" + rec.model.label + ")")}`);
  console.log(`  ${xrDim("Why:")}          ${xrDim(rec.reason)}`);
  console.log(`  ${xrDim("Requirements:")} ${xrDim(rec.model.minRamGb + "GB RAM min / ~" + rec.model.estimatedDiskGb + "GB disk")}`);

  let model = rec.model.id;
  if (!await confirm(`\n  Use ${xrCyan(model)} as your local model?`, true)) {
    model = await ask("  Enter Ollama model id", { default: model });
  }

  let installed = status.models.includes(model);

  if (!status.installed) {
    warn("Ollama is not installed.");
    console.log(`  ${xrDim("Install from")} ${xrCyan("https://ollama.com")} ${xrDim("then run")} ${xrCyan("xr models install")}`);
  } else if (!status.running) {
    warn("Ollama is installed but not running.");
    console.log(`  ${xrDim("Start it:")} ${xrCyan("ollama serve")}`);
  } else if (!installed && downloadPrompt && await confirm(`  Download ${xrCyan(model)} now via ollama pull?`, true)) {
    installed = await pullOllamaModel(model);
    if (!installed) warn(`Could not download ${model}. Retry with: xr models install ${model}`);
  } else if (installed) {
    ok(`${model} is already downloaded.`);
  }

  if (installed && await confirm("  Test the local model now?", true)) {
    const res = await testOllamaModel(model);
    if (res.ok) ok(`Local model responded in ${res.latencyMs}ms.`);
    else warn(`Local model test failed: ${res.detail}`);
  }

  return { model, reason: rec.reason, installed };
}

// ── Welcome Screen ────────────────────────────────────────────────────────────

function showWelcome(): void {
  banner();
  console.log(`  ${xrBold("Welcome to XR.")} Let's set up your AI agent in a few steps.\n`);
  console.log(`  ${SYM.local} ${xrGreen("Local-first")}  — your data stays on your machine`);
  console.log(`  ${SYM.secure} ${xrGreen("Zero cloud required")} — run 100% free with Ollama`);
  console.log(`  ${SYM.budget} ${xrGreen("Spend-capped")} — hard budget ceiling, enforced in code`);
  console.log(`  ${SYM.secure} ${xrGreen("BYOK")} — bring your own API key, no vendor lock-in`);
  console.log();
}

// ── Main Onboarding ───────────────────────────────────────────────────────────

export async function runOnboarding(): Promise<void> {
  showWelcome();

  // ── Step 1: Mode ──────────────────────────────────────────────────────────
  section("Step 1 of 4  —  Operating Mode");
  console.log();
  console.log(`  ${xrBold("1")} ${xrCyan("Local-only")}   ${xrDim("Free · private · no API keys · Ollama required")}`);
  console.log(`  ${xrBold("2")} ${xrCyan("BYOK Cloud")}   ${xrDim("Your provider keys · no local required")}`);
  console.log(`  ${xrBold("3")} ${xrCyan("Hybrid")}       ${xrDim("Cloud primary + local fallback · recommended")}`);
  console.log();

  const modeChoice    = await ask("Select mode", { default: "3" });
  const isLocalOnly   = modeChoice === "1";
  const isCloudOnly   = modeChoice === "2";
  const isHybrid      = !isLocalOnly && !isCloudOnly;

  let providerId  = "ollama";
  let model       = "qwen2.5:7b";
  let localModel  = "qwen2.5:7b";
  let localReason = "Default local model.";
  let localEnabled = false;

  // ── Step 2: Local Model ───────────────────────────────────────────────────
  if (isLocalOnly || isHybrid || await confirm(`\n  Configure a local fallback model?`, true)) {
    const local = await configureLocal(true);
    localModel   = local.model;
    localReason  = local.reason;
    localEnabled = true;
    if (isLocalOnly) {
      providerId = "ollama";
      model      = localModel;
    }
  }

  // ── Step 3: Cloud Providers ───────────────────────────────────────────────
  section("Step 2 of 4  —  Cloud Providers (BYOK)");
  console.log();

  const apiKeys: Record<string, string> = {};

  if (!isLocalOnly) {
    const cloudProviders = knownProviders().filter(p => p !== "ollama");
    console.log(`  ${xrDim("Supported:")} ${cloudProviders.join("  ")}`);
    console.log(`  ${xrDim("Leave blank to skip cloud and use local only.")}`);
    console.log();

    const selected = await ask("Providers to configure (comma-separated)", { default: isHybrid ? "" : "openai" });

    for (const p of selected.split(",").map(s => s.trim()).filter(Boolean)) {
      if (!knownProviders().includes(p) || p === "ollama") {
        warn(`Unknown or non-cloud provider skipped: ${p}`);
        continue;
      }
      const preset = PRESETS[p];
      if (!preset.apiKeyEnv) continue;
      const key = await password(`  API key for ${xrBold(p)}:`);
      if (key) {
        apiKeys[preset.apiKeyEnv] = key;
        if (providerId === "ollama" && !isLocalOnly) {
          providerId = p;
          model      = defaultCloudModel(p);
        }
        ok(`${p} key saved.`);
      }
    }

    if (!Object.keys(apiKeys).length && !localEnabled) {
      warn("No cloud keys and no local model configured — defaulting to Ollama.");
      providerId   = "ollama";
      model        = localModel;
      localEnabled = true;
    }
  } else {
    console.log(`  ${xrDim("Skipped — local-only mode needs no API keys.")}`);
  }

  // ── Step 4: Security & Budget ─────────────────────────────────────────────
  section("Step 3 of 4  —  Security & Budget");
  console.log();

  console.log(`  ${xrDim("The budget ceiling is code-enforced — the agent cannot exceed it.")}`);
  const spendCap    = await ask("Hard spend cap per cloud task (USD)", { default: isLocalOnly ? "0" : "0.25" });
  const approvalMode = await confirm("  Require manual approval for file writes / shell / send?", true);

  console.log();
  console.log(`  ${xrDim("Approval mode:")} ${approvalMode ? xrGreen("on — you approve every risky action") : xrAmber("off — auto-approve (not recommended)")}`);

  // Stage 6 — memory preferences. Always explicit, local-first by default.
  console.log();
  console.log(`  ${xrDim("Memory:")} ${xrGreen("XR only remembers what you explicitly ask.")} ${xrDim("Nothing is auto-saved.")}`);
  const memOn = await confirm("  Enable durable memory (remember preferences/projects on request)?", true);
  const memSuggest = memOn
    ? await confirm("  Offer to remember things found in chat/voice (asks each time)?", true)
    : false;
  const memInject = memOn
    ? await confirm("  Inject relevant memory into prompts when useful (conservative)?", true)
    : false;

  // Stage 8 — optional voice pack. Push-to-talk is the safe default; always-listen is never silently enabled.
  console.log();
  console.log(`  ${xrDim("Voice:")} ${xrGreen("optional, local-first, push-to-talk by default.")} ${xrDim("You can skip and set up later.")}`);
  const voiceOn = await confirm("  Enable voice interface now?", false);
  const voiceWake = voiceOn ? await confirm("  Use wake-word mode instead of push-to-talk?", false) : false;

  // ── Save ──────────────────────────────────────────────────────────────────
  section("Step 4 of 4  —  Saving Configuration");
  console.log();

  mkdirSync(XR_HOME, { recursive: true });

  const { config } = loadConfig();
  config.defaults.provider = providerId;
  config.defaults.model    = model;
  config.budget.perTaskUsd = Number.isFinite(parseFloat(spendCap)) ? parseFloat(spendCap) : 0.25;
  config.security.requireApproval = approvalMode
    ? ["write_file", "delete", "shell", "send"]
    : ["delete", "shell", "send"];

  // Stage 6 — durable memory preferences from onboarding.
  config.memory.enabled = memOn;
  config.memory.autoSuggest = memSuggest;
  config.memory.injectInChat = memInject;

  // Stage 8 — voice preferences from onboarding. Cloud audio and always-listen remain off.
  config.voice.enabled = voiceOn;
  config.voice.mode = voiceOn ? (voiceWake ? "wake-word" : "push-to-talk") : "push-to-talk";
  config.voice.alwaysListen = false;
  config.voice.allowCloudStt = false;
  config.voice.allowCloudTts = false;
  config.voice.microphonePermission = voiceOn ? "granted" : "unknown";
  config.voice.speakerPermission = voiceOn ? "granted" : "unknown";

  config.localModels.enabled            = localEnabled;
  config.localModels.runtime            = "ollama";
  config.localModels.selected           = localModel;
  config.localModels.recommended        = localModel;
  config.localModels.recommendationReason = localReason;
  config.localModels.routing            = isLocalOnly ? "local-only"
    : localEnabled ? (isHybrid ? "hybrid" : "cloud-first")
    : "cloud-first";

  if (isLocalOnly) {
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel    = undefined;
  } else if (localEnabled) {
    config.defaults.fallbackProvider = "ollama";
    config.defaults.fallbackModel    = localModel;
  }

  // Store API keys
  let secretBackend = preferredSecretBackend();
  for (const [envName, key] of Object.entries(apiKeys)) {
    secretBackend = setSecret(envName, key);
    process.env[envName] = key;
  }
  if (Object.keys(apiKeys).length) {
    if (secretBackend === "file") {
      warn(`Secure OS keychain not available — keys saved to ${XR_HOME}/.env (chmod 600).`);
    } else {
      ok(`API keys saved in ${secretBackend}.`);
    }
  }

  saveConfig(config);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${xrBold(xrGreen("✓ Setup complete!"))}`);
  console.log();
  kv("Primary provider", config.defaults.provider, "ok");
  kv("Model",            config.defaults.model,     "cyan");
  if (config.defaults.fallbackProvider) {
    kv("Fallback", config.defaults.fallbackProvider + " / " + (config.defaults.fallbackModel ?? localModel), "dim");
  }
  kv("Budget ceiling",   `$${config.budget.perTaskUsd}`, "warn");
  kv("Config saved to",  configPath(),                    "dim");

  console.log();
  section("Next Steps");
  console.log();
  console.log(`  ${xrCyan("xr doctor")}           ${xrDim("verify providers, audit chain, local runtime")}`);
  console.log(`  ${xrCyan("xr models")}           ${xrDim("check local model status")}`);
  console.log(`  ${xrCyan("xr \"hello, XR\"")}     ${xrDim("run your first task")}`);
  console.log(`  ${xrCyan("xr --tui")}            ${xrDim("open the interactive terminal UI")}`);
  console.log(`  ${xrCyan("xr serve")}            ${xrDim("start the dashboard + chat server")}`);
  console.log();
  console.log(`  ${xrDim("Docs:")} ${xrCyan("https://github.com/ahmadrrrtx/xr")}`);
  console.log();
}
