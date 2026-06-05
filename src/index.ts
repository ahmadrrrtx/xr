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
    else if (["doctor", "verify-log", "test", "skills", "index", "memory", "serve", "telegram", "voice", "mcp", "cron", "export", "sandbox", "reset", "config", "providers", "models"].includes(a)) {
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
  xr providers              list all supported AI providers
  xr models                 view current model defaults
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

// ── Doctor Command ─────────────────────────────────────────────────────────────
async function cmdDoctor(store: Store, args: Args): Promise<void> {
  banner();
  const { config, warnings } = loadConfig();
  
  console.log(`${C.bold("System Health Check")}`);
  console.log(`  config ........... ${warnings.length ? C.yellow + "⚠ " + warnings.length + " warning(s)" : C.green + "✓ valid"}${C.reset}`);
  for (const w of warnings) console.log(`    ${C.dim}${w}${C.reset}`);
  
  const provider = buildProvider(config, { provider: args.provider, model: args.model });
  const h = await provider.health();
  console.log(`  provider ......... ${h.ok ? C.green + "✓ " + provider.label : C.red + "✗ " + provider.label} ${C.dim}(${h.detail ?? ""}${h.latencyMs ? " " + h.latencyMs + "ms" : ""})${C.reset}`);
  
  const chain = store.verifyChain();
  console.log(`  audit chain ...... ${chain.valid ? C.green + "✓ intact (" + store.auditCount() + " entries)" : C.red + "✗ BROKEN at #" + chain.brokenAt}${C.reset}`);
  console.log(`  skills ........... ${C.green}✓ ${store.skillCount()} learned · ${store.frozenCount()} frozen baselines${C.reset}`);
  
  // Sandbox check
  try {
    const { sandboxStatus } = await import("./computer/sandbox.ts");
    const sb = sandboxStatus();
    console.log(`  sandbox .......... ${sb.available ? C.green + "✓ Docker available" : C.yellow + "⚠ no Docker (local exec)"}${sb.imagePulled ? " (image pulled)" : ""}${C.reset}`);
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
    if (!existsSync(configPath()) && !args.onboard && args.command !== "onboarding" && args.command !== "onboard") {
      const { runOnboarding } = await import("./interfaces/onboard.ts");
      await runOnboarding();
      if (!args.task && !args.command) return; 
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
      banner();
      console.log(`${C.bold("Available Providers")}`);
      for (const p of knownProviders()) {
        const status = isLocal(p) ? C.green("local") : C.cyan("cloud");
        console.log(`  - ${p.padEnd(15)} [${status}]`);
      }
      return;
    }

    if (args.command === "models") {
      banner();
      const { config } = loadConfig();
      console.log(`${C.bold("Current Default Model")}`);
      console.log(`  Provider: ${C.cyan(config.defaults.provider)}`);
      console.log(`  Model:    ${C.green(config.defaults.model)}`);
      if (config.defaults.provider === "ollama") {
        console.log(`\n${C.dim("Use 'ollama list' to see all pulled local models.")}`);
      }
      return;
    }

    if (args.attacks || args.command === "test") {
      const report = runLab({ egressAllowlist: loadConfig().config.security.egressAllowlist });
      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      banner();
      console.log(`${C.bold}${C.yellow}🔒 Injection Test Lab${C.reset}`);
      for (const o of report.outcomes) {
        const tag = o.blocked ? C.green + "✓ blocked" : C.red + "✗ ALLOWED";
        console.log(`  ${tag} ${C.dim + o.category.padEnd(22)} ${o.description}${C.reset}`);
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
        console.log(`${C.yellow}Usage: xr --computer "task"${C.reset}`);
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
          const icon = res.success ? C.green + "✓" : C.red + "✗";
          console.log(`  ${C.dim}step ${step}${C.reset} ${icon} ${C.cyan}${action.type}${C.reset}`);
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
      console.log(`${C.bold}🧠 Skills (${skills.length})${C.reset}`);
      for (const s of skills) {
        console.log(`  ${C.cyan + s.id.padEnd(20)} ${C.dim}v${s.version}${C.reset}`);
      }
      return;
    }

    if (args.command === "cost") {
      const c = store.costSummary();
      console.log(`${C.bold}💰 Cost Summary${C.reset}`);
      console.log(`  total USD ....... ${C.green}$${c.totalUsd.toFixed(6)}${C.reset}`);
      console.log(`  total tokens .... ${C.dim}${c.totalTokens.toLocaleString()}${C.reset}`);
      return;
    }

    // ── Default: Run Agent Task ────────────────────────────────────────────
    if (!args.task && !args.command) {
      printHelp();
      return;
    }
    
    const { config } = loadConfig();
    const providerId = args.provider ?? config.defaults.provider;
    const model = args.model ?? config.defaults.model;
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
  console.error(`${C.red}fatal:${C.reset}`, e);
  process.exit(1);
});
