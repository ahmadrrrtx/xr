/**
 * XR — Interactive Onboarding Wizard
 * 
 * Gets users from zero to running in under 5 minutes — rivalling Claude Code's
 * 2-minute setup. This is what makes or breaks the first impression.
 * 
 * Flow:
 * 1. Detect environment (OS, installed tools, existing LLM providers)
 * 2. Provider selection (local Ollama vs cloud API key)
 * 3. Model selection (matched to hardware)
 * 4. Security defaults (egress allow-list, approval thresholds)
 * 5. Optional: Telegram, voice, MCP setup
 * 6. Quick sanity test
 * 7. First run
 * 
 * Philosophy: sensible defaults, never blocks, always succeeds.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, XR_HOME, configPath } from "../config/config.ts";
import { knownProviders, buildProvider } from "../providers/factory.ts";
import { Store } from "../state/db.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";

// ── Simple Readline (no heavy deps) ───────────────────────────────────────────
async function prompt(label: string, fallback = ""): Promise<string> {
  process.stdout.write(`${label}: `);
  const chunks: Uint8Array[] = [];
  for await (const chunk of (process.stdin as any)) {
    chunks.push(chunk);
    const bytes = new Uint8Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) bytes[i] = chunk[i];
    const text = new TextDecoder().decode(bytes);
    const trimmed = text.trim();
    if (trimmed) {
      console.log();
      return trimmed || fallback;
    }
  }
  return fallback;
}

async function confirm(label: string, defaultYes = true): Promise<boolean> {
  const def = defaultYes ? "[Y/n]" : "[y/N]";
  const input = await prompt(`${label} ${def}`, defaultYes ? "y" : "n");
  return input.toLowerCase().startsWith("y");
}

async function select<T>(label: string, options: Array<{ value: T; label: string }>, defaultIdx = 0): Promise<T> {
  console.log(`\n${label}`);
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? `${"[→]"}` : `[ ]`;
    console.log(`  ${i + 1}. ${options[i].label}`);
  }
  const input = await prompt(`Select (default ${defaultIdx + 1}): `, String(defaultIdx + 1));
  const idx = parseInt(input) - 1;
  if (idx >= 0 && idx < options.length) return options[idx].value;
  return options[defaultIdx].value;
}

// ── Environment Detection ─────────────────────────────────────────────────────
function detectEnvironment() {
  const os = (() => {
    const u = process.platform;
    if (u === "linux") return "linux";
    if (u === "darwin") return "macos";
    if (u.includes("win")) return "windows";
    return "unknown";
  })();
  
  const hasBun = existsSync(join(homedir(), ".bun"));
  const hasNpm = existsSync(join(homedir(), ".npm"));
  const hasGit = (() => { try { require("child_process").execSync("git --version"); return true; } catch { return false; } })();
  
  // Check for LLM providers
  const ollamaRunning = (() => {
    try {
      const { execSync } = require("child_process");
      execSync("curl -s http://localhost:11434/api/tags 2>/dev/null", { timeout: 3000 });
      return true;
    } catch { return false; }
  })();
  
  const groqKey = process.env.GROQ_API_KEY ? true : false;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ? true : false;
  const openaiKey = process.env.OPENAI_API_KEY ? true : false;
  
  return { os, hasBun, hasNpm, hasGit, ollamaRunning, groqKey, anthropicKey, openaiKey };
}

// ── Installer for Ollama ──────────────────────────────────────────────────────
async function installOllama(): Promise<boolean> {
  const os = process.platform;
  try {
    const { execSync } = require("child_process");
    if (os === "darwin") {
      execSync('brew install ollama 2>/dev/null || curl -fsSL https://ollama.ai/install.sh | bash', { stdio: "inherit", timeout: 120000 });
    } else if (os === "linux") {
      execSync('curl -fsSL https://ollama.ai/install.sh | bash', { stdio: "inherit", timeout: 120000 });
    } else {
      // Windows: download installer
      execSync('powershell -Command "Invoke-WebRequest -Uri \'https://ollama.ai/install.ps1\' -OutFile ollama-install.ps1; ./ollama-install.ps1; Remove-Item ollama-install.ps1"', { stdio: "inherit", timeout: 120000 });
    }
    return true;
  } catch (e) {
    console.log(`  Ollama install failed: ${(e as Error).message}`);
    console.log(`  Install manually: https://ollama.ai/download`);
    return false;
  }
}

// ── Model Recommendations ─────────────────────────────────────────────────────
function recommendModel(provider: string, os: string): string {
  if (provider === "ollama") {
    // Check available RAM (rough estimate)
    const ram = (() => {
      try {
        const { execSync } = require("child_process");
        if (os === "darwin") {
          const out = execSync("sysctl hw.memsize 2>/dev/null").toString();
          const m = out.match(/(\d+)/);
          return m ? parseInt(m[1]) / (1024 * 1024 * 1024) : 8;
        } else if (os === "linux") {
          const out = execSync("free -b 2>/dev/null | head -2").toString();
          const m = out.match(/Mem:\s+\d+\s+(\d+)/);
          return m ? parseInt(m[1]) / (1024 * 1024 * 1024) : 8;
        }
        return 8; // default
      } catch { return 8; }
    })();
    
    if (ram >= 16) return "qwen2.5:14b";
    if (ram >= 8) return "qwen2.5:7b";
    if (ram >= 4) return "qwen2.5:3b";
    return "qwen2.5:1.5b";
  }
  if (provider === "groq") return "llama-3.3-70b-versatile";
  if (provider === "openai") return "gpt-4o-mini";
  return "llama-3.3-70b";
}

// ── Pull Recommended Model ────────────────────────────────────────────────────
async function pullModel(model: string): Promise<boolean> {
  try {
    const { execSync } = require("child_process");
    console.log(`\n  Pulling ${model} (this may take a few minutes for large models)…`);
    execSync(`ollama pull ${model}`, { stdio: "inherit", timeout: 600000 });
    return true;
  } catch (e) {
    console.log(`  ⚠ Model pull failed: ${(e as Error).message}`);
    console.log(`  You can run 'ollama pull ${model}' manually later.`);
    return false;
  }
}

// ── Test Provider ─────────────────────────────────────────────────────────────
async function testProvider(providerId: string, model: string): Promise<boolean> {
  try {
    const config = loadConfig().config;
    config.defaults.provider = providerId;
    config.defaults.model = model;
    
    const { buildProvider } = await import("../providers/factory.ts");
    const provider = buildProvider(config, {});
    const health = await provider.health();
    
    if (health.ok) {
      console.log(`  ✓ Provider healthy (${health.latencyMs}ms)`);
      return true;
    } else {
      console.log(`  ✗ Provider error: ${health.detail}`);
      return false;
    }
  } catch (e) {
    console.log(`  ✗ Connection failed: ${(e as Error).message}`);
    return false;
  }
}

// ── Default Egress Allow-List ─────────────────────────────────────────────────
function getDefaultAllowList(providerId: string): string[] {
  const base = [
    "api.github.com",
    "registry.npmjs.org",
    "pypi.org",
    "raw.githubusercontent.com",
  ];
  
  if (providerId === "ollama") {
    return base; // local model, minimal network needs
  }
  
  // Cloud providers: add search and common utilities
  return [
    ...base,
    "searx.be",
    "searxng.site",
    "api.openai.com",
    "api.groq.com",
    "api.anthropic.com",
  ];
}

// ── Main Onboarding Flow ──────────────────────────────────────────────────────
export async function runOnboarding(): Promise<void> {
  console.log(`\n`);
  console.log(`  ${"▀▄▀ █▀█".replace(/\x1b\[\d+m/g, '')}  XR — Let's get you set up!`);
  console.log(`  ${"█░█ █▀▄".replace(/\x1b\[\d+m/g, '')}  This takes about 5 minutes.`);
  console.log(`\n`);
  
  // Step 1: Environment detection
  console.log(`  [1/5] Detecting environment…`);
  const env = detectEnvironment();
  console.log(`    OS: ${env.os}`);
  console.log(`    Ollama: ${env.ollamaRunning ? "✓ running" : "✗ not detected"}`);
  console.log(`    Groq key: ${env.groqKey ? "✓ found" : "✗ not set"}`);
  console.log(`    Anthropic key: ${env.anthropicKey ? "✓ found" : "✗ not set"}`);
  
  // Step 2: Provider selection
  console.log(`\n  [2/5] Choose your LLM provider:`);
  console.log(`    (1) Ollama — local, free, private (recommended for beginners)`);
  console.log(`    (2) Groq — fast cloud, cheap, $0.59/M input tokens`);
  console.log(`    (3) OpenAI — GPT-4o family`);
  console.log(`    (4) DeepSeek — affordable Chinese model`);
  console.log(`    (5) OpenRouter — 200+ models, single key`);
  console.log(`    (6) Anthropic — Claude 3.7/4 family`);
  
  let providerId = "ollama";
  let model = "qwen2.5:7b";
  
  const providerChoice = await prompt(`    Select [1-6] (default: 1): `, "1");
  
  const providerMap: Record<string, string> = {
    "1": "ollama", "2": "groq", "3": "openai",
    "4": "deepseek", "5": "openrouter", "6": "anthropic",
  };
  const modelMap: Record<string, string> = {
    "ollama": "qwen2.5:7b",
    "groq": "llama-3.3-70b-versatile",
    "openai": "gpt-4o-mini",
    "deepseek": "deepseek-chat",
    "openrouter": "anthropic/claude-sonnet-4.6",
    "anthropic": "claude-sonnet-4.6",
  };
  
  const chosen = providerMap[providerChoice];
  if (chosen) {
    providerId = chosen;
    model = modelMap[providerId] ?? recommendModel(providerId, env.os);
  }
  
  // Ollama special: install if not running
  if (providerId === "ollama" && !env.ollamaRunning) {
    const install = await confirm(`    Ollama not running. Install it now?`, true);
    if (install) {
      await installOllama();
      // Try to pull recommended model
      const recModel = recommendModel("ollama", env.os);
      const pull = await confirm(`    Pull ${recModel} now? (free, local, ~4GB)`, true);
      if (pull) {
        model = recModel;
        await pullModel(model);
      }
    }
  }
  
  // Cloud provider: prompt for API key if not set
  if (!isLocal(providerId) && !env.groqKey && !env.anthropicKey && !env.openaiKey) {
    console.log(`\n  ⚠ No API key detected for ${providerId}.`);
    const keyHint: Record<string, string> = {
      groq: "https://console.groq.com/keys",
      openai: "https://platform.openai.com/api-keys",
      anthropic: "https://console.anthropic.com/keys",
      deepseek: "https://platform.deepseek.com/api_keys",
      openrouter: "https://openrouter.ai/keys",
    };
    
    if (keyHint[providerId]) {
      console.log(`    Get a key at: ${keyHint[providerId]}`);
    }
    
    const key = await prompt(`    Enter API key (or press Enter to use Ollama instead): `, "");
    if (!key.trim()) {
      console.log(`    Falling back to Ollama (local, free).`);
      providerId = "ollama";
      model = recommendModel("ollama", env.os);
    } else {
      // Set the env var
      const envVarMap: Record<string, string> = {
        groq: "GROQ_API_KEY", openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY", deepseek: "DEEPSEEK_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
      };
      const envVar = envVarMap[providerId];
      if (envVar) process.env[envVar] = key.trim();
    }
  }
  
  // Step 3: Test provider
  console.log(`\n  [3/5] Testing connection…`);
  const works = await testProvider(providerId, model);
  if (!works && isLocal(providerId)) {
    console.log(`    ⚠ Ollama connection failed. Make sure 'ollama serve' is running.`);
    console.log(`    Tip: open a new terminal and run 'ollama serve', then re-run this setup.`);
  }
  
  // Step 4: Security defaults
  console.log(`\n  [4/5] Security configuration:`);
  
  const allowList = getDefaultAllowList(providerId);
  console.log(`    Egress allow-list: ${allowList.slice(0, 3).join(", ")} + ${allowList.length - 3} more`);
  
  const autoApprove = await confirm(`    Always approve file writes? (recommended: yes)`, true);
  const requireApproval = autoApprove
    ? ["shell", "delete", "send"]
    : ["write_file", "shell", "delete", "send"];
  
  // Step 5: Write config
  console.log(`\n  [5/5] Saving configuration…`);
  
  const config = {
    version: 1,
    defaults: { mode: "agent", provider: providerId, model },
    budget: { perTaskUsd: isLocal(providerId) ? 0 : 0.50, perTaskTokens: 250000 },
    security: { egressAllowlist: allowList, requireApproval },
    providers: providerId === "ollama" ? { ollama: { baseUrl: "http://localhost:11434/v1" } } : {},
  };
  
  ensureHome();
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  
  // Summary
  console.log(`\n`);
  console.log(`  ───────────────────────────────────────────`);
  console.log(`  ✓ Setup complete!`);
  console.log(`\n`);
  console.log(`  Provider: ${providerId} / ${model}`);
  console.log(`  Config: ${configPath()}`);
  console.log(`\n`);
  console.log(`  Next steps:`);
  console.log(`    xr doctor              # Verify everything works`);
  console.log(`    xr "hi, who are you"   # First task!`);
  console.log(`    xr serve               # Start the dashboard`);
  console.log(`\n`);
  
  // Optional Telegram setup
  const setupTelegram = await confirm(`  Set up Telegram now? (recommended for mobile control)`, false);
  if (setupTelegram) {
    console.log(`\n  Telegram setup guide: https://core.telegram.org/bots#creating-a-bot`);
    console.log(`  1. Open Telegram, search for @BotFather`);
    console.log(`  2. Send /newbot, name it "XR"`);
    console.log(`  3. Copy the bot token, paste here:`);
    const token = await prompt(`  Bot Token: `, "");
    if (token.trim()) {
      process.env.XR_TELEGRAM_TOKEN = token.trim();
      const allowed = await prompt(`  Your Telegram user ID (get it from @userinfobot): `, "");
      if (allowed.trim()) {
        process.env.XR_TELEGRAM_ALLOWED = allowed.trim();
        writeFileSync(configPath(), JSON.stringify({ ...config, telegram: { token: token.trim(), allowedUsers: [allowed.trim()] } }, null, 2));
        console.log(`\n  ✓ Telegram configured! Run: xr telegram`);
      }
    }
  }
  
  console.log(`\n  Happy building! 🚀\n`);
}

function ensureHome() {
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
}
