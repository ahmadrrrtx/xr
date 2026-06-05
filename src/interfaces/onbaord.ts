/**
 * XR — Professional Onboarding Experience
 * 
 * Secure, hardware-aware, and user-friendly.
 */

import { existsSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { totalmem, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, XR_HOME, configPath } from "../config/config.ts";
import { knownProviders } from "../providers/factory.ts";
import { isLocal } from "../cost/pricing.ts";
import { 
  banner, info, ok, warn, ask, confirm, password, colors as C 
} from "./cli.ts";

/**
 * Detect hardware and environment
 */
async function detectEnvironment() {
  const os = platform();
  const ramGb = Math.floor(totalmem() / (1024 * 1024 * 1024));
  
  const ollamaRunning = await (async () => {
    try {
      const res = await fetch("http://localhost:11434/api/tags");
      return res.ok;
    } catch {
      return false;
    }
  })();

  return { os, ramGb, ollamaRunning };
}

/**
 * Recommend a model based on RAM
 */
function recommendLocalModel(ramGb: number): string {
  if (ramGb >= 32) return "qwen2.5:32b";
  if (ramGb >= 16) return "qwen2.5:14b";
  if (ramGb >= 8) return "qwen2.5:7b";
  return "qwen2.5:3b";
}

/**
 * Pull a model via Ollama
 */
function pullModel(model: string) {
  console.log(`\n  ${C.cyan("Downloading " + model + "...")}`);
  console.log(`  ${C.dim("This may take a few minutes depending on your internet speed.")}`);
  
  const result = spawnSync("ollama", ["pull", model], { stdio: "inherit" });
  
  if (result.status === 0) {
    ok(`  Model ${model} is ready.`);
    return true;
  } else {
    warn(`  Failed to download model. You can run 'ollama pull ${model}' manually later.`);
    return false;
  }
}

/**
 * Main Onboarding Flow
 */
export async function runOnboarding(): Promise<void> {
  banner();
  console.log(`  ${C.bold("Welcome to XR.")} Let's get your AI operating system ready.`);
  console.log(`  This wizard will configure your providers, security, and models.\n`);

  const env = await detectEnvironment();
  
  // 1. Choose Mode
  console.log(`${C.bold("Step 1: Choose your Operating Mode")}`);
  console.log(`  [1] ${C.bold("Local-only")} (Private, free, uses your hardware)`);
  console.log(`  [2] ${C.bold("BYOK")} (Cloud-scale, bring your own API keys)`);
  console.log(`  [3] ${C.bold("Hybrid")} (Recommended: Local for simple tasks, Cloud for complex ones)`);
  
  const modeChoice = await ask("  Select mode", { default: "3" });
  const isHybrid = modeChoice === "3";
  const isLocalOnly = modeChoice === "1";
  const isBYOK = modeChoice === "2" || isHybrid;

  let providerId = "ollama";
  let model = "qwen2.5:7b";
  const apiKeys: Record<string, string> = {};

  // 2. Configure Providers
  console.log(`\n${C.bold("Step 2: Provider Configuration")}`);

  if (isLocalOnly || isHybrid) {
    info(`  Detecting local environment...`);
    if (env.ollamaRunning) {
      ok(`  Ollama is running on this machine.`);
    } else {
      warn(`  Ollama is not detected. XR uses Ollama for local models.`);
      console.log(`  Please install it first: ${C.cyan("https://ollama.ai")}`);
    }
    
    const recModel = recommendLocalModel(env.ramGb);
    console.log(`  Recommended model for your ${env.ramGb}GB RAM: ${C.green(recModel)}`);
    
    if (await confirm(`  Would you like to use ${recModel} as your local default?`, true)) {
      model = recModel;
      providerId = "ollama";
      
      if (env.ollamaRunning && await confirm(`  Download ${model} now?`, true)) {
        pullModel(model);
      }
    }
  }

  if (isBYOK) {
    console.log(`\n  Select cloud providers to enable (e.g., anthropic, openai):`);
    const selectedProviders = await ask("  Providers", { default: isHybrid ? "anthropic" : "openai" });
    
    for (const p of selectedProviders.split(",").map(s => s.trim())) {
      if (knownProviders().includes(p)) {
        const key = await password(`  Enter API key for ${C.bold(p)}:`);
        if (key) {
          apiKeys[p] = key;
          // Set as default if BYOK only
          if (!isLocalOnly && !isHybrid) {
            providerId = p;
            model = p === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o";
          }
        }
      }
    }
  }

  // 3. Spend Caps
  console.log(`\n${C.bold("Step 3: Security & Budget")}`);
  const spendCap = await ask("  Set a hard spend cap per task in USD", { default: "0.25" });
  const approvalMode = await confirm("  Require manual approval for all file writes?", true);

  // 4. Save Config
  info(`\n  Finalizing configuration...`);
  
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });

  const { config } = loadConfig();
  config.defaults.provider = providerId;
  config.defaults.model = model;
  config.budget.perTaskUsd = parseFloat(spendCap);
  config.security.requireApproval = approvalMode 
    ? ["write_file", "delete", "shell", "send"] 
    : ["delete", "shell", "send"];

  // Secure Key Storage Fallback
  const envPath = join(XR_HOME, ".env");
  let envContent = "";
  for (const [p, key] of Object.entries(apiKeys)) {
    const envVar = p.toUpperCase() + "_API_KEY";
    envContent += `${envVar}=${key}\n`;
    process.env[envVar] = key;
  }
  
  if (envContent) {
    writeFileSync(envPath, envContent);
    try {
      chmodSync(envPath, 0o600); // User read/write only
      ok(`  API keys stored securely in ${C.dim(envPath)} (chmod 600)`);
    } catch {
      warn(`  Stored keys in ${C.dim(envPath)}. Please ensure this file is protected.`);
    }
  }

  writeFileSync(configPath(), JSON.stringify(config, null, 2));

  // 5. Ready
  console.log(`\n  ${C.green(C.bold("✓ Setup Complete!"))}`);
  console.log(`  XR is now configured to use ${C.bold(providerId)} with ${C.bold(model)}.`);
  console.log(`\n  ${C.bold("Next steps:")}`);
  console.log(`  - Run ${C.cyan('xr "hello"')} to test your setup.`);
  console.log(`  - Run ${C.cyan('xr doctor')} to check system health.`);
  console.log(`\n  ${C.dim("Config saved to: " + configPath())}\n`);
}
