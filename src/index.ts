#!/usr/bin/env bun
/**
 * XR — The AI Agent You Can Actually Trust
 * by @ahmadrrrtx
 * 
 * Usage:
 *   xr "your task"           run a task (default: agent mode)
 *   xr onboarding             interactive setup wizard
 *   xr doctor                system health check
 *   xr --tui                 interactive terminal UI
 *   xr --computer "task"     JARVIS GUI control
 */

import type { Mode } from "./core/types.ts";
import { loadConfig, configPath, XR_HOME } from "./config/config.ts";
import { Store } from "./state/db.ts";
import { buildProvider, knownProviders } from "./providers/factory.ts";
import { runAgent } from "./core/agent.ts";
import { priceFor, isLocal } from "./cost/pricing.ts";
import { BudgetManager } from "./cost/manager.ts";
import { runLab } from "./security/lab.ts";
import { loadSkills } from "./skills/loader.ts";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { fingerprint, indexProject, retrieve } from "./memory/rag.ts";
import { approvePrompt, overBudgetPrompt, banner, info, ok, warn, colors as C } from "./interfaces/cli.ts";

// ── Argument Parser ─────────────────────────────────────────────────────────────
interface Args {
  mode: Mode;
  provider?: string;
  model?: string;
  command?: string;
  task: string;
  budget?: number;
  maxTokens?: number;
  maxSteps?: number;
  dryRun?: boolean;
  json?: boolean;
  attacks?: boolean;
  onboard?: boolean;
  tui?: boolean;
  computer?: boolean;
  voice?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "agent", task: "", help: false };
  const rest: string[] = [];
  
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--mode") args.mode = (argv[++i] as Mode) ?? "agent";
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--budget") args.budget = Number(argv[++i]);
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
    else if (a === "--max-steps") args.maxSteps = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
    else if (a === "--attacks") args.attacks = true;
    else if (a === "--onboard" || a === "onboarding" || a === "onboard") args.onboard = true;
    else if (a === "--tui") args.tui = true;
    else if (a === "--computer") args.computer = true;
    else if (a === "--voice") args.voice = true;
    else if (["doctor", "verify-log", "test", "skills", "index", "memory", "serve", "telegram", "voice", "speak", "listen", "mcp", "cron", "export", "sandbox", "reset", "config", "providers", "models", "budget", "cost"].includes(a)) {
      args.command = a;
    } else {
      rest.push(a);
    }
  }
  
  args.task = rest.join(" ").trim();
  return args;
}

function printHelp(): void {
  banner();
  console.log(`
${C.bold("Usage")}  xr "your task"           run a task (default: agent mode)
  xr onboarding             interactive setup wizard
  xr --tui                  interactive terminal UI
  xr --computer "task"      JARVIS GUI control

${C.bold("Commands")}
  xr doctor                 system health + audit chain check
  xr config                 view current configuration
  xr providers              list, add, or set AI providers
  xr models                 local model status
  xr models recommend       auto-detect hardware + recommend a model
  xr models install [id]    download/configure an Ollama model
  xr models test [id]       run local model smoke test
  xr budget                 view spend caps and usage
  xr budget set <amount>    set monthly spend cap (USD)
  xr budget reset           reset current monthly spending
  xr voice                  voice control (status, test, start, stop)
  xr speak "text"           make XR speak text
  xr listen                 capture a single voice command
  xr reset                  factory reset (deletes config & db)
  xr verify-log             verify tamper-evident audit log
  xr skills                 list all available skills
  xr index                  index project for local RAG memory
  xr memory                 project memory + RAG status
  xr cost                   lifetime cost summary
  xr serve                  local dashboard (127.0.0.1:7842)

${C.bold("Flags")}
  --mode [agent|plan|ask]   set operation mode
  --budget [usd]            hard USD ceiling for this task
  --provider [id]           override provider
  --model [id]              override model
  --dry-run                 simulate everything, touch nothing
`);
}

// ── Budget Command Handler ─────────────────────────────────────────────────────
async function cmdBudget(store: Store, argv: string[]): Promise<void> {
  const manager = new BudgetManager(store);
  const sub = argv[0];

  if (!sub || sub === "status") {
    const status = await manager.getStatus();
    const cfg = await manager.getConfig();
    banner();
    console.log(`${C.bold("💰 Budget Status")}`);
    console.log(`  Monthly Cap ...... ${C.green(`$${status.monthlyCap.toFixed(2)}`)}`);
    console.log(`  Monthly Spend .... ${C.dim(`$${status.monthlySpend.toFixed(4)}`)}`);
    console.log(`  Remaining ....... ${C.cyan(`$${status.remainingMonthly.toFixed(4)}`)}`);
    console.log(`  Usage ............ ${status.percentUsed > 90 ? C.red : status.percentUsed > 70 ? C.yellow : C.green}(${status.percentUsed.toFixed(1)}%)`);
    if (status.dailyCap !== null) {
      console.log(`  Daily Cap ........ ${C.green(`$${status.dailyCap.toFixed(2)}`)}`);
      console.log(`  Daily Spend ...... ${C.dim(`$${status.dailySpend.toFixed(4)}`)}`);
    }
    console.log(`\n  Auto-fallback .... ${cfg.auto_fallback ? C.green("enabled") : C.red("disabled")}`);
    console.log(`  Warnings ........ ${cfg.warnings_enabled ? C.green("enabled") : C.red("disabled")}`);
    return;
  }

  if (sub === "set") {
    const amount = Number(argv[1]);
    if (isNaN(amount)) {
      console.log(C.red(`Usage: xr budget set <amount>`));
      return;
    }
    await manager.setMonthlyCap(amount);
    ok(`Monthly cap updated to $${amount.toFixed(2)}`);
    return;
  }

  if (sub === "reset") {
    const { confirm } = await import("./interfaces/cli.ts");
    if (await confirm("Reset all recorded spending for the current period?", false)) {
      await manager.resetSpending();
      ok("Spending history reset.");
    }
    return;
  }

  if (sub === "history") {
    const summary = store.costSummary();
    banner();
    console.log(`${C.bold("📜 Spend History (by model)")}`);
    for (const m of summary.byModel) {
      console.log(`  ${C.cyan(m.model.padEnd(20))} ${C.green(`$${m.usd.toFixed(4)}`)} ${C.dim(`(${m.tokens.toLocaleString()} tokens)`)}`);
    }
    return;
  }

  console.log(C.yellow(`Unknown budget command: ${sub}. Use status, set, reset, or history.`));
}

// ── Doctor Command ─────────────────────────────────────────────────────────────
async function cmdDoctor(store: Store, args: Args): Promise<void> {
  banner();
  const { config, warnings } = loadConfig();
  
  console.log(`${C.bold("System Health Check")}`);
  console.log(`  config ........... ${warnings.length ? C.yellow(`⚠ ${warnings.length} warning(s)`) : C.green("✓ valid")}`);
  for (const w of warnings) console.log(`    ${C.dim(w)}`);
  
  const provider = buildProvider(config, { provider: args.provider, model: args.model });
  const h = await provider.health();
  const providerStatus = h.ok ? C.green(`✓ ${provider.label}`) : C.red(`✗ ${provider.label}`);
  console.log(`  provider ......... ${providerStatus} ${C.dim(`(${h.detail ?? ""}${h.latencyMs ? " " + h.latencyMs + "ms" : ""})`)}`);

  try {
    const { ollamaStatus } = await import("./local/ollama.ts");
    const localModel = config.localModels.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
    const ls = await ollamaStatus(localModel);
    const pulled = ls.models.includes(localModel);
    const localOk = ls.installed && ls.running && pulled;
    const localStatus = localOk ? C.green(`✓ ${localModel}`) : C.yellow(`⚠ ${localModel}`);
    console.log(`  local model ...... ${localStatus} ${C.dim(`(${ls.installed ? "ollama installed" : "ollama missing"}, ${ls.running ? "server running" : "server stopped"}, ${pulled ? "model pulled" : "model missing"})`)}`);
    console.log(`  local routing .... ${C.cyan(config.localModels.routing)} ${config.localModels.enabled ? C.green("enabled") : C.dim("disabled")}`);
  } catch { /* skip */ }
  
  const chain = store.verifyChain();
  console.log(`  audit chain ...... ${chain.valid ? C.green(`✓ intact (${store.auditCount()} entries)`) : C.red(`✗ BROKEN at #${chain.brokenAt}`)}`);
  console.log(`  skills ........... ${C.green(`✓ ${store.skillCount()} learned · ${store.frozenCount()} frozen baselines`)}`);

  const { checkVoiceStack } = await import("./voice/index.ts");
  const v = checkVoiceStack();
  console.log(`  voice stack ...... ${v.stt && v.tts ? C.green("✓ operational") : C.yellow("⚠ degraded")} ${C.dim(`(STT:${v.stt ? "✓" : "✗"}, TTS:${v.tts ? "✓" : "✗"})`)}`);

  const budgetManager = new BudgetManager(store);
  const status = await budgetManager.getStatus();
  const budgetStatus = status.isOverBudget ? C.red("✗ exhausted") : status.isNearCap ? C.yellow("⚠ near cap") : C.green("✓ healthy");
  console.log(`  global budget .... ${budgetStatus} ${C.dim(`($${status.monthlySpend.toFixed(2)} / $${status.monthlyCap.toFixed(2)})`)}`);
  
  // Sandbox check
  try {
    const { sandboxStatus } = await import("./computer/sandbox.ts");
    const sb = sandboxStatus();
    const sandbox = sb.available ? C.green("✓ Docker available") : C.yellow("⚠ no Docker (local exec)");
    console.log(`  sandbox .......... ${sandbox}${sb.imagePulled ? " (image pulled)" : ""}`);
  } catch { /* skip */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  
  if (args.help) {
    printHelp();
    return;
  }
  
  const store = new Store();
  
  try {
    const { existsSync } = await import("node:fs");

    // ── First-run Auto Onboarding ──────────────────────────────────────────
    if (!existsSync(configPath()) && !args.onboard && !args.command && args.task) {
      const { runOnboarding } = await import("./interfaces/onboard.ts");
      await runOnboarding();
    }

    // ── Special Commands ────────────────────────────────────────────────────
    if (args.onboard || args.command === "onboarding" || args.command === "onboard") {
      const { runOnboarding } = await import("./interfaces/onboard.ts");
      await runOnboarding();
      return;
    }

    if (args.command === "reset") {
      const { confirm } = await import("./interfaces/cli.ts");
      const { unlinkSync, existsSync } = await import("node:fs");
      const confirmed = await confirm("Are you sure you want to reset XR? This will delete your config and local database.", false);
      if (confirmed) {
        if (existsSync(configPath())) unlinkSync(configPath());
        const dbPath = join(XR_HOME, "xr.db");
        if (existsSync(dbPath)) unlinkSync(dbPath);
        const envPath = join(XR_HOME, ".env");
        if (existsSync(envPath)) unlinkSync(envPath);
        ok("XR has been reset.");
      }
      return;
    }

    if (args.command === "config") {
      console.log(`${C.bold("Config path:")} ${C.dim(configPath())}\n`);
      const { readFileSync } = await import("node:fs");
      console.log(readFileSync(configPath(), "utf8"));
      return;
    }

    if (args.command === "providers") {
      const { handleProvidersCommand } = await import("./interfaces/providers.ts");
      await handleProvidersCommand(argv.slice(1));
      return;
    }

    if (args.command === "models") {
      const { handleModelsCommand } = await import("./interfaces/models.ts");
      await handleModelsCommand(argv.slice(1));
      return;
    }

    if (args.attacks || args.command === "test") {
      const report = runLab({ egressAllowlist: loadConfig().config.security.egressAllowlist });
      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      banner();
      console.log(C.bold(C.yellow("🔒 Injection Test Lab")));
      for (const o of report.outcomes) {
        const tag = o.blocked ? C.green("✓ blocked") : C.red("✗ ALLOWED");
        console.log(`  ${tag} ${C.dim(o.category.padEnd(22))} ${o.description}`);
      }
      return;
    }
    
    if (args.tui) {
      const { startTui } = await import("./interfaces/tui.ts");
      await startTui(process.cwd());
      return;
    }
    
    if (args.computer) {
      if (!args.task) {
        console.log(C.yellow(`Usage: xr --computer "task"`));
        return;
      }
      const { runComputerUse } = await import("./computer/index.ts");
      const { config } = loadConfig();
      const provider = buildProvider(config, {});
      const result = await runComputerUse({
        provider,
        store,
        task: args.task,
        maxSteps: args.maxSteps ?? 20,
        onStep: (step, action, res) => {
          const icon = res.success ? C.green("✓") : C.red("✗");
          console.log(`  ${C.dim(`step ${step}`)} ${icon} ${C.cyan(action.type)}`);
        },
      });
      ok(result);
      return;
    }
    
    if (args.command === "doctor") {
      await cmdDoctor(store, args);
      return;
    }

    if (args.command === "verify-log") {
      const chain = store.verifyChain();
      if (chain.valid) ok(`Audit chain intact (${store.auditCount()} entries)`);
      else warn(`Audit chain BROKEN at entry #${chain.brokenAt}`);
      return;
    }
    
    if (args.command === "skills") {
      banner();
      const skills = loadSkills(join(XR_HOME, "skills"));
      console.log(C.bold(`🧠 Skills (${skills.length})`));
      for (const s of skills) {
        console.log(`  ${C.cyan(s.id.padEnd(20))} ${C.dim(`v${s.version}`)}`);
      }
      return;
    }

    if (args.command === "cost") {
      const c = store.costSummary();
      console.log(C.bold("💰 Cost Summary"));
      console.log(`  total USD ....... ${C.green(`$${c.totalUsd.toFixed(6)}`)}`);
      console.log(`  total tokens .... ${C.dim(c.totalTokens.toLocaleString())}`);
      return;
    }

    if (args.command === "budget") {
      await cmdBudget(store, argv.slice(1));
      return;
    }

    if (args.command === "voice") {
      const { handleVoiceCommand } = await import("./voice/cli.ts");
      await handleVoiceCommand(argv.slice(1), store);
      return;
    }

    if (args.command === "speak") {
      const { handleSpeak } = await import("./voice/cli.ts");
      const text = args.task || "Hello, I am XR.";
      await handleSpeak(text);
      return;
    }

    if (args.command === "listen") {
      const { handleListen } = await import("./voice/cli.ts");
      await handleListen();
      return;
    }

    // ── Default: Run Agent Task ────────────────────────────────────────────
    if (!args.task && !args.command) {
      printHelp();
      return;
    }
    
    const { config } = loadConfig();
    let providerId = args.provider ?? config.defaults.provider;
    const model = args.model ?? config.defaults.model;
    
    // ROUTING: Global budget check for cloud providers.
    if (!isLocal(providerId)) {
      const budgetManager = new BudgetManager(store);
      const status = await budgetManager.getStatus();
      const budgetCfg = await budgetManager.getConfig();
      
      if (status.isOverBudget && budgetCfg.auto_fallback) {
        const localModel = config.localModels.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
        warn(`Global budget exhausted ($${status.monthlySpend.toFixed(2)} / $${status.monthlyCap.toFixed(2)}).`);
        warn(`Automatically falling back to local model: ${localModel}`);
        providerId = "ollama";
      }
    }

    const provider = buildProvider(config, { provider: providerId, model });
    
    const budget = {
      maxUsd: isLocal(providerId) ? undefined : (args.budget ?? config.budget.perTaskUsd),
      maxTokens: args.maxTokens ?? config.budget.perTaskTokens,
    };
    
    const result = await runAgent(args.task, args.mode, {
      provider,
      store,
      cwd: process.cwd(),
      say: (line: string) => console.log(line),
      approve: approvePrompt,
      onOverBudget: overBudgetPrompt,
      budget,
      pricing: priceFor(providerId, model),
      egressAllowlist: config.security.egressAllowlist,
      dryRun: args.dryRun,
      maxSteps: args.maxSteps ?? 12,
    });
    
    console.log();
    if (result.stopped === "done") ok(`done in ${result.steps} step(s)`);
    else warn(`ended: ${result.finalMessage}`);
    if (result.finalMessage) console.log(C.cyan("\n" + result.finalMessage));
    
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error(C.red("fatal:"), e);
  process.exit(1);
});
