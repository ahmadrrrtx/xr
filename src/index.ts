#!/usr/bin/env bun
/**
 * XR — The AI Agent You Can Actually Trust
 * by @ahmadrrrtx
 * 
 * Usage:
 *   xr "your task"           run a task (default: agent mode)
 *   xr --mode plan "task"    plan-only mode (read-only)
 *   xr --mode ask "task"     Q&A mode (read-only)
 *   xr --onboard             interactive setup wizard (5 min → ready)
 *   xr --tui                 interactive terminal UI (Claude Code-style)
 *   xr --computer "task"     JARVIS GUI control (screenshots + actions)
 *   xr doctor                system health + audit chain check
 *   xr test --attacks        injection benchmark (block-rate report)
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
    else if (a === "--onboard") args.onboard = true;
    else if (a === "--tui") args.tui = true;
    else if (a === "--computer") args.computer = true;
    else if (a === "--voice") args.voice = true;
    else if (["doctor", "verify-log", "test", "skills", "index", "memory", "serve", "telegram", "voice", "mcp", "cron", "export", "sandbox"].includes(a)) {
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
  xr --mode plan "task"     plan-only mode (read-only)
  xr --mode ask "task"      Q&A mode (read-only)
  xr onboarding             interactive setup wizard (5 min → ready)
  xr --tui                  interactive terminal UI (Claude Code-style)
  xr --computer "task"      JARVIS GUI control (screenshots + actions)
  xr --voice                voice stack check (STT/TTS/wake word)

${C.bold("Model & Provider")}
  xr --provider groq --model llama-3.3-70b "task"
  xr --budget 0.50 "task"      hard USD ceiling for this task
  xr --max-tokens 50000 "task" hard token ceiling
  xr --max-steps 30 "task"     max agent steps (default: 12)
  xr --dry-run "task"          simulate everything, touch nothing

${C.bold("Commands")}
  xr onboarding                start the onboarding wizard
  xr config                    view current configuration
  xr providers                 list all supported AI providers
  xr models                    view current model defaults
  xr doctor                    system health + audit chain check
  xr reset                     factory reset (deletes config & db)
  xr test --attacks            injection benchmark (block-rate report)
  xr verify-log               verify tamper-evident audit log
  xr skills                   list all available skills
  xr index                    index project for local RAG memory
  xr memory                   project memory + RAG status
  xr cost                     lifetime cost by model
  xr serve                    local dashboard (127.0.0.1:7842)
  xr telegram                 secure phone remote (Telegram bot)
  xr cron "every mon 9am: audit" natural-language scheduler
  xr export                   signed audit report
  xr sandbox                  check Docker sandbox status

${C.bold("Providers")}  ${knownProviders().join(", ")}

${C.dim("config:")} ${configPath()}
${C.dim("home: ")} ${XR_HOME}
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
  console.log(`  models ........... ${C.dim}${knownProviders().join(", ")}${C.reset}`);
  
  // Sandbox check
  try {
    const { sandboxStatus } = await import("./computer/sandbox.ts");
    const sb = sandboxStatus();
    console.log(`  sandbox .......... ${sb.available ? C.green + "✓ Docker available" : C.yellow + "⚠ no Docker (local exec)"}${sb.imagePulled ? " (image pulled)" : ""}${C.reset}`);
  } catch { /* skip */ }
  
  // Voice check
  try {
    const { checkVoiceStack } = await import("./voice/index.ts");
    const vc = checkVoiceStack();
    for (const d of vc.details) {
      const icon = d.startsWith("✓") ? C.green + "✓" : C.yellow + "⚠";
      console.log(`  ${icon} ${C.dim}${d.replace(/^[✓✗]\s*/, "")}${C.reset}`);
    }
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
    // ── First-run Auto Onboarding ──────────────────────────────────────────
    const { existsSync } = await import("node:fs");
    if (!existsSync(configPath()) && !args.onboard && !args.help && args.command !== "onboard") {
      const { runOnboarding } = await import("./interfaces/onboard.ts");
      await runOnboarding();
      // After onboarding, we might want to continue with the task or just stop.
      // For a better UX, if they provided a task, we'll continue after setup.
      if (!args.task && !args.command) return; 
    }
    // ── Special Commands ────────────────────────────────────────────────────
    if (args.attacks || args.command === "test") {
      const report = runLab({ egressAllowlist: loadConfig().config.security.egressAllowlist });
      
      if (args.json) {
        const payload = {
          tool: "xr",
          kind: "injection-benchmark",
          generated_at: new Date().toISOString(),
          total: report.total,
          blocked: report.blocked,
          rate: report.rate,
          outcomes: report.outcomes,
        };
        const sig = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        console.log(JSON.stringify({ ...payload, sha256: sig }, null, 2));
        return;
      }
      
      banner();
      console.log(`${C.bold}${C.yellow}🔒 Injection Test Lab${C.reset}`);
      for (const o of report.outcomes) {
        const tag = o.blocked ? C.green + "✓ blocked" : C.red + "✗ ALLOWED";
        console.log(`  ${tag} ${C.dim + o.category.padEnd(22)} ${o.description}${o.blocked ? C.dim + " (" + o.by + ")" : ""}${C.reset}`);
      }
      const pct = Math.round(report.rate * 100);
      const line = `\nblock-rate: ${report.blocked}/${report.total} (${pct}%)`;
      console.log(pct >= 90 ? C.green + line + C.reset : C.yellow + line + C.reset);
      return;
    }
    
    if (args.onboard || args.command === "onboard" || args.command === "onboarding") {
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
        console.log("XR has been reset.");
      }
      return;
    }

    if (args.command === "config") {
      console.log(`Config path: ${configPath()}`);
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
      console.log(`  Provider: ${config.defaults.provider}`);
      console.log(`  Model:    ${config.defaults.model}`);
      if (config.defaults.provider === "ollama") {
        console.log(`\n${C.dim("Use 'ollama list' to see all pulled local models.")}`);
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
        console.log(`${C.yellow}Usage: xr --computer "open Safari and search for AI agents"${C.reset}`);
        return;
      }
      const { runComputerUse } = await import("./computer/index.ts");
      const { config } = loadConfig();
      const provider = buildProvider(config, {});
      console.log(`${C.cyan}🔍 Starting JARVIS computer control mode…${C.reset}`);
      console.log(`${C.dim}Task: ${args.task}${C.reset}\n`);
      const result = await runComputerUse({
        provider,
        store,
        task: args.task,
        maxSteps: args.maxSteps ?? 20,
        onStep: (step, action, res) => {
          const icon = res.success ? C.green + "✓" : C.red + "✗";
          console.log(`  ${C.dim}step ${step}${C.reset} ${icon} ${C.cyan}${action.type}${C.reset} ${C.dim}${(res.output ?? "").slice(0, 80)}${C.reset}`);
        },
      });
      console.log();
      console.log(`${C.green}✓ ${result}${C.reset}`);
      return;
    }
    
    if (args.command === "doctor" || args.task === "doctor") {
      await cmdDoctor(store, args);
      return;
    }
    
    if (args.voice || args.command === "voice") {
      const { checkVoiceStack } = await import("./voice/index.ts");
      banner();
      console.log(`${C.bold("🎙️ Voice Stack Status")}`);
      const vc = checkVoiceStack();
      for (const d of vc.details) {
        const icon = d.startsWith("✓") ? C.green + "✓" : C.yellow + "⚠";
        console.log(`  ${icon} ${C.dim}${d.replace(/^[✓✗]\s*/, "")}${C.reset}`);
      }
      return;
    }
    
    if (args.command === "sandbox") {
      const { sandboxStatus, ensureSandboxImage } = await import("./computer/sandbox.ts");
      banner();
      const sb = sandboxStatus();
      console.log(`${C.bold("🐳 Docker Sandbox Status")}`);
      console.log(`  Docker available ... ${sb.available ? C.green + "✓" : C.red + "✗"}${C.reset}`);
      if (sb.version) console.log(`  Docker version .... ${C.dim}${sb.version}${C.reset}`);
      console.log(`  Sandbox image ...... ${sb.imagePulled ? C.green + "✓ pulled" : C.yellow + "⚠ not pulled"}${C.reset}`);
      if (!sb.imagePulled && sb.available) {
        info("Run 'xr sandbox --pull' to pull the sandbox image");
      }
      return;
    }
    
    if (args.command === "verify-log") {
      const chain = store.verifyChain();
      if (chain.valid) {
        console.log(`${C.green}✓ Audit chain intact (${store.auditCount()} entries)${C.reset}`);
      } else {
        console.log(`${C.red}✗ Audit chain BROKEN at entry #${chain.brokenAt}${C.reset}`);
      }
      return;
    }
    
    if (args.command === "skills") {
      banner();
      const candidates = [join(import.meta.dir, "..", "skills"), join(process.cwd(), "skills")];
      let skills: ReturnType<typeof loadSkills> = [];
      for (const dir of candidates) { skills = loadSkills(dir); if (skills.length) break; }
      console.log(`${C.bold}🧠 Skills (${skills.length})${C.reset}`);
      for (const s of skills) {
        console.log(`  ${C.cyan + s.id.padEnd(20)} ${C.dim}v${s.version} · ${s.source} tools: ${C.dim + (s.tools.join(", ") || "—")}${C.reset}`);
      }
      return;
    }
    
    if (args.command === "index") {
      const project = basename(process.cwd());
      info(`Indexing project "${project}"…`);
      const count = await indexProject(store, process.cwd(), project);
      ok(`Indexed ${count} chunks. Use "xr memory" to check.`);
      return;
    }
    
    if (args.command === "memory") {
      const project = basename(process.cwd());
      const fp = fingerprint(process.cwd());
      console.log(`${C.bold}🧠 Project: ${project}${C.reset}`);
      console.log(`  files indexed ... ${C.dim}${fp.files}${C.reset}`);
      console.log(`  languages ....... ${C.dim}${Object.keys(fp.languages).join(", ")}${C.reset}`);
      console.log(`  RAG chunks ...... ${C.dim}${store.ragCount(project)}${C.reset}`);
      console.log(`  memories ........ ${C.dim}${store.memoryCount(project)}${C.reset}`);
      return;
    }
    
    if (args.command === "cost") {
      const c = store.costSummary();
      console.log(`${C.bold}💰 Cost Summary${C.reset}`);
      console.log(`  total USD ....... ${C.green}$${c.totalUsd.toFixed(6)}${C.reset}`);
      console.log(`  total tokens .... ${C.dim}${c.totalTokens.toLocaleString()}${C.reset}`);
      for (const m of c.byModel) {
        console.log(`    ${C.cyan + m.model.padEnd(20)} ${C.dim}$${m.usd.toFixed(6)} · ${m.tokens.toLocaleString()} tok${C.reset}`);
      }
      return;
    }
    
    if (args.command === "export") {
      info("Building audit report…");
      const { buildAuditReport } = await import("./export/report.ts");
      const report = await buildAuditReport(store);
      const { randomUUID } = await import("node:crypto");
      const { writeFileSync } = await import("node:fs");
      const outPath = join(process.cwd(), `xr-audit-${randomUUID().slice(0, 8)}.json`);
      writeFileSync(outPath, JSON.stringify(report, null, 2));
      ok(`Report saved: ${outPath}`);
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
    
    // Memory injection (RAG context)
    let augmentedTask = args.task;
    try {
      const project = basename(process.cwd());
      const chunks = await retrieve(store, project, args.task, 3);
      if (chunks.length) {
        const ctxParts = chunks.map(c => `📄 ${c.path}:\n${c.text.slice(0, 500)}`);
        augmentedTask = [...ctxParts, "", `TASK: ${args.task}`].join("\n\n");
        info(`🧠 injected ${chunks.length} relevant chunk(s) from local index`);
      }
    } catch { /* memory is best-effort */ }
    
    // Self-improvement: get nudges
    try {
      const { AutoLearner } = await import("./skills/autolearn.ts");
      const learner = new AutoLearner(store, process.cwd());
      const nudges = learner.getSessionNudges();
      if (nudges.length) {
        info(`🧠 nudge: ${nudges[0].slice(0, 100)}`);
      }
    } catch { /* skip */ }
    
    const budget = {
      maxUsd: isLocal(providerId) ? undefined : (args.budget ?? config.budget.perTaskUsd),
      maxTokens: args.maxTokens ?? config.budget.perTaskTokens,
    };
    
    const result = await runAgent(augmentedTask, args.mode, {
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
    
    // Post-run: try to learn from this task
    if (result.stopped === "done" && args.mode === "agent") {
      try {
        const { AutoLearner } = await import("./skills/autolearn.ts");
        const learner = new AutoLearner(store, process.cwd());
        const outcome = learner.analyzeAndLearn(args.task, result.finalMessage ?? "", [], true);
        if (outcome.learned) {
          ok(`✨ Learned: ${outcome.skillId}`);
        }
      } catch { /* learning is best-effort */ }
    }
    
    console.log();
    if (result.stopped === "done") ok(`done in ${result.steps} step(s) · ${result.meter ?? ""}`);
    else if (result.stopped === "budget") warn(`stopped to respect your budget`);
    else if (result.stopped === "max_steps") warn(`stopped at step limit (${result.steps} steps)`);
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
