/**
 * XR v0.5 — Local-first onboarding.
 *
 * Configures local-only, BYOK cloud, or hybrid mode with deterministic local
 * model recommendation and optional Ollama model download.
 */
import { mkdirSync } from "node:fs";
import { loadConfig, XR_HOME, configPath, saveConfig } from "../config/config.ts";
import { knownProviders, PRESETS } from "../providers/factory.ts";
import { banner, info, ok, warn, ask, confirm, password, colors as C } from "./cli.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../local/hardware.ts";
import { recommendLocalModel } from "../local/recommend.ts";
import { ollamaStatus, pullOllamaModel, testOllamaModel } from "../local/ollama.ts";
import { setSecret, preferredSecretBackend } from "../security/secrets.ts";
import { Store } from "../state/db.ts";

function defaultCloudModel(provider: string): string {
  return PRESETS[provider]?.defaultModel ?? "gpt-4o-mini";
}

async function configureLocal(downloadPrompt = true): Promise<{ model: string; reason: string; installed: boolean }> {
  info("  Inspecting this machine for local model support...");
  const specs = detectHardwareSpecs();
  const rec = recommendLocalModel(specs);
  const status = await ollamaStatus(rec.model.id);

  console.log(`  Hardware: ${C.dim(formatHardwareSummary(specs))}`);
  console.log(`  Recommended: ${C.green(rec.model.id)} ${C.dim(`(${rec.model.label})`)}`);
  console.log(`  Requirements: ${C.dim(`${rec.model.minRamGb}GB RAM min / ${rec.model.recommendedRamGb}GB recommended, ~${rec.model.estimatedDiskGb}GB disk`)}`);
  console.log(`  Why: ${C.dim(rec.reason)}`);

  let model = rec.model.id;
  if (!await confirm(`  Use ${model} as your local model?`, true)) {
    model = await ask("  Enter Ollama model id", { default: model });
  }

  let installed = status.models.includes(model);
  if (!status.installed) {
    warn("  Ollama is not installed. XR will not run installer scripts automatically.");
    console.log(`  Install it from ${C.cyan("https://ollama.com")}, then run ${C.cyan("xr models install")}.`);
  } else if (!status.running) {
    warn("  Ollama CLI exists, but the local server is not running.");
    console.log(`  Start it with ${C.cyan("ollama serve")}, then run ${C.cyan("xr models install")}.`);
  } else if (!installed && downloadPrompt && await confirm(`  Download ${model} now with 'ollama pull'?`, true)) {
    installed = await pullOllamaModel(model);
    if (!installed) warn(`  Could not download ${model}. You can retry later with 'xr models install ${model}'.`);
  } else if (installed) {
    ok(`  ${model} is already downloaded.`);
  }

  if (installed && await confirm("  Test the local model now?", true)) {
    const res = await testOllamaModel(model);
    if (res.ok) ok(`  Local model responded in ${res.latencyMs}ms.`);
    else warn(`  Local model test failed: ${res.detail}`);
  }

  return { model, reason: rec.reason, installed };
}

/** Main Onboarding Flow */
export async function runOnboarding(): Promise<void> {
  banner();
  console.log(`  ${C.bold("Welcome to XR v0.5.")} Let's configure local-first intelligence.\n`);

  console.log(`${C.bold("Step 1: Choose your Operating Mode")}`);
  console.log(`  [1] ${C.bold("Local-only")}  private, free, no cloud API keys required`);
  console.log(`  [2] ${C.bold("BYOK cloud")}  use your provider keys, local optional`);
  console.log(`  [3] ${C.bold("Hybrid")}      cloud when configured, local fallback when needed`);

  const modeChoice = await ask("  Select mode", { default: "3" });
  const isLocalOnly = modeChoice === "1";
  const isCloudOnly = modeChoice === "2";
  const isHybrid = !isLocalOnly && !isCloudOnly;

  let providerId = "ollama";
  let model = "qwen2.5:7b";
  let localModel = "qwen2.5:7b";
  let localReason = "Default local model.";
  let localEnabled = false;

  console.log(`\n${C.bold("Step 2: Local Model")}`);
  if (isLocalOnly || isHybrid || await confirm("  Configure a local fallback model too?", true)) {
    const local = await configureLocal(true);
    localModel = local.model;
    localReason = local.reason;
    localEnabled = true;
    if (isLocalOnly) {
      providerId = "ollama";
      model = localModel;
    }
  }

  console.log(`\n${C.bold("Step 3: Cloud Providers (BYOK)")}`);
  const apiKeys: Record<string, string> = {};
  if (!isLocalOnly) {
    console.log(`  Supported: ${knownProviders().filter((p) => p !== "ollama").join(", ")}`);
    const selectedProviders = await ask("  Providers to configure (comma-separated, blank to skip)", { default: isHybrid ? "" : "openai" });

    for (const p of selectedProviders.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!knownProviders().includes(p) || p === "ollama") {
        warn(`  Unknown or non-cloud provider skipped: ${p}`);
        continue;
      }
      const preset = PRESETS[p];
      if (!preset.apiKeyEnv) continue;
      const key = await password(`  Enter API key for ${C.bold(p)}:`);
      if (key) {
        apiKeys[preset.apiKeyEnv] = key;
        if (providerId === "ollama" && !isLocalOnly) {
          providerId = p;
          model = defaultCloudModel(p);
        }
      }
    }

    if (!Object.keys(apiKeys).length && !localEnabled) {
      warn("  No cloud keys and no local model were configured. XR will default to local Ollama.");
      providerId = "ollama";
      model = localModel;
      localEnabled = true;
    }
  } else {
    console.log(`  ${C.dim("Skipped. Local-only mode needs no API keys.")}`);
  }

  console.log(`\n${C.bold("Step 4: Security & Budget")}`);
  const spendCap = await ask("  Hard spend cap per cloud task in USD", { default: isLocalOnly ? "0" : "0.25" });
  
  // v0.6 Global Budget additions
  const monthlyCap = await ask("  Global monthly spend cap in USD", { default: isLocalOnly ? "0" : "10.0" });
  const autoFallback = await confirm("  Automatically switch to local model when budget is exhausted?", true);
  const warningsEnabled = await confirm("  Enable budget warnings (50%, 80%, 95%)?", true);
  
  const approvalMode = await confirm("  Require manual approval for file writes/shell/send?", true);

  info(`\n  Saving configuration...`);
  mkdirSync(XR_HOME, { recursive: true });

  const { config } = loadConfig();
  config.defaults.provider = providerId;
  config.defaults.model = model;
  config.budget.perTaskUsd = Number.isFinite(parseFloat(spendCap)) ? parseFloat(spendCap) : 0.25;
  config.security.requireApproval = approvalMode ? ["write_file", "delete", "shell", "send"] : ["delete", "shell", "send"];

  config.localModels.enabled = localEnabled;
  config.localModels.runtime = "ollama";
  config.localModels.selected = localModel;
  config.localModels.recommended = localModel;
  config.localModels.recommendationReason = localReason;
  config.localModels.routing = isLocalOnly ? "local-only" : localEnabled ? (isHybrid ? "hybrid" : "cloud-first") : "cloud-first";

  if (isLocalOnly) {
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel = undefined;
  } else if (localEnabled) {
    config.defaults.fallbackProvider = "ollama";
    config.defaults.fallbackModel = localModel;
  }

  let secretBackend = preferredSecretBackend();
  for (const [envName, key] of Object.entries(apiKeys)) {
    secretBackend = setSecret(envName, key);
    process.env[envName] = key;
  }
  if (Object.keys(apiKeys).length) {
    if (secretBackend === "file") warn(`  Secure OS secret store not available; keys saved to ${XR_HOME}/.env with chmod 600.`);
    else ok(`  API keys saved in ${secretBackend}.`);
  }

  saveConfig(config);
  
  // Initialize global budget in DB
  const store = new Store();
  store.setBudgetConfig({
    monthly_cap: Number.isFinite(parseFloat(monthlyCap)) ? parseFloat(monthlyCap) : 10.0,
    auto_fallback: autoFallback,
    warnings_enabled: warningsEnabled,
  });

  console.log(`\n  ${C.green(C.bold("✓ Setup Complete!"))}`);
  console.log(`  Primary: ${C.bold(config.defaults.provider)} / ${C.bold(config.defaults.model)}`);
  if (config.defaults.fallbackProvider) console.log(`  Fallback: ${C.bold(config.defaults.fallbackProvider)} / ${C.bold(config.defaults.fallbackModel ?? localModel)}`);
  console.log(`\n  ${C.bold("Next steps:")}`);
  console.log(`  - ${C.cyan("xr models")} to see local model health.`);
  console.log(`  - ${C.cyan("xr doctor")} to verify providers and local runtime.`);
  console.log(`  - ${C.cyan('xr "hello"')} to test your setup.`);
  console.log(`\n  ${C.dim("Config saved to: " + configPath())}\n`);
}
