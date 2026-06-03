#!/usr/bin/env bun
/**
 * XR CLI entry point.  by rrrtx
 *
 * Usage:
 *   xr "your task"                 run a task in default (agent) mode
 *   xr --mode plan "your task"     plan only (read-only)
 *   xr --mode ask "your task"      ask/Q&A (read-only)
 *   xr --provider groq --model llama-3.3-70b "task"
 *   xr doctor                      show health & verify audit chain
 *   xr verify-log                  verify the tamper-evident audit log
 *   xr --help
 */
import type { Mode } from "./core/types.ts";
import { loadConfig, configPath, XR_HOME } from "./config/config.ts";
import { Store } from "./state/db.ts";
import { buildProvider, knownProviders } from "./providers/factory.ts";
import { runAgent } from "./core/agent.ts";
import { priceFor, isLocal } from "./cost/pricing.ts";
import { estimateTask } from "./cost/estimate.ts";
import { runLab } from "./security/lab.ts";
import { loadSkills } from "./skills/loader.ts";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { fingerprint, indexProject, retrieve } from "./memory/rag.ts";
import { serve } from "./daemon/server.ts";
import { TelegramBot } from "./telegram/bot.ts";
import { parseAllowedIds } from "./telegram/auth.ts";
import { SpeechToText } from "./voice/stt.ts";
import { TextToSpeech } from "./voice/tts.ts";
import { McpClient } from "./mcp/client.ts";
import { parseSchedule, describe, type Schedule } from "./automation/cron.ts";
import { buildAuditReport } from "./export/report.ts";
import { runLab as _runLabForExport } from "./security/lab.ts";
import { randomUUID } from "node:crypto";
import { writeFileSync as _writeFileSync } from "node:fs";
import {
  banner,
  say,
  info,
  warn,
  ok,
  approvePrompt,
  overBudgetPrompt,
  colors as C,
} from "./interfaces/cli.ts";

interface Args {
  mode: Mode;
  provider?: string;
  model?: string;
  command?: string; // "doctor" | "verify-log" | "test" | undefined
  task: string;
  help: boolean;
  budgetUsd?: number;
  maxTokens?: number;
  attacks?: boolean;
  dryRun?: boolean;
  json?: boolean;
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
    else if (a === "--budget") args.budgetUsd = Number(argv[++i]);
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
    else if (a === "--attacks") args.attacks = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--json") args.json = true;
    else if (["doctor", "verify-log", "test", "skills", "index", "memory", "serve", "telegram", "voice", "mcp", "cron", "export"].includes(a)) args.command = a;
    else rest.push(a);
  }
  args.task = rest.join(" ").trim();
  return args;
}

function printHelp(): void {
  banner();
  console.log(`${C.bold("Usage")}
  xr "your task"                      run a task (agent mode)
  xr --mode plan|ask|agent "task"     choose a mode
  xr --provider <id> --model <m> "task"
  xr --budget 0.50 "task"              hard USD spend ceiling for this task
  xr --max-tokens 100000 "task"        hard token ceiling for this task
  xr --dry-run "task"                  simulate everything, write/run nothing
  xr doctor                            health + audit-chain check
  xr verify-log                        verify tamper-evident audit log
  xr test --attacks                    run the injection test lab (block-rate)
  xr skills                            list the pre-built + learned skills
  xr index                             index this project for local RAG memory
  xr memory                            show project fingerprint + saved memory
  xr serve                             start the local dashboard (127.0.0.1)
  xr telegram                          start the secure Telegram remote control
  xr voice                             check the local voice stack (STT/TTS)
  xr mcp                               list configured MCP servers + their tools
  xr cron "every monday 9am: audit"    add a scheduled task
  xr cron list                         list scheduled tasks
  xr export                            write a signed, verifiable audit report

${C.bold("Providers")} (pure BYOK — set the key env var yourself)
  ${knownProviders().join(", ")}

${C.bold("Examples")}
  xr "summarize README.md"
  xr --provider groq --model llama-3.3-70b "list files and explain them"
  GROQ_API_KEY=... xr --provider groq "..."

${C.dim("config:")} ${configPath()}
${C.dim("home:  ")} ${XR_HOME}
`);
}

async function cmdDoctor(store: Store, args: Args): Promise<void> {
  banner();
  const { config, warnings } = loadConfig();
  console.log(C.bold("xr doctor"));
  console.log(`  config ........... ${warnings.length ? C.amber("⚠ " + warnings.length + " warning(s)") : C.green("✓ valid")}`);
  for (const w of warnings) console.log("      " + C.dim(w));

  const provider = buildProvider(config, { provider: args.provider, model: args.model });
  const h = await provider.health();
  console.log(
    `  provider ......... ${h.ok ? C.green("✓ " + provider.label) : C.red("✗ " + provider.label)} ${C.dim(`(${h.detail ?? ""}${h.latencyMs ? " " + h.latencyMs + "ms" : ""})`)}`,
  );

  const chain = store.verifyChain();
  console.log(
    `  audit chain ...... ${chain.valid ? C.green(`✓ intact (${store.auditCount()} entries)`) : C.red(`✗ BROKEN at #${chain.brokenAt}`)}`,
  );
  console.log(
    `  skills ........... ${C.green(`✓ ${store.skillCount()} learned · ${store.frozenCount()} frozen baseline(s)`)}`,
  );
  console.log(C.dim("\n  XR — feature-complete · BYOK · local-first · spend-capped · tamper-evident · by rrrtx"));
}

function cmdTestAttacks(asJson: boolean): void {
  const { config } = loadConfig();
  const report = runLab({ egressAllowlist: config.security.egressAllowlist });

  if (asJson) {
    // Signed, shareable JSON report — others can reproduce/verify.
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
  console.log(C.bold("🔒 xr injection test lab"));
  for (const o of report.outcomes) {
    const tag = o.blocked ? C.green("✓ blocked") : C.red("✗ ALLOWED");
    console.log(
      `  ${tag}  ${C.dim(o.category.padEnd(22))} ${o.description}${o.blocked ? C.dim("  (" + o.by + ")") : ""}`,
    );
  }
  const pct = Math.round(report.rate * 100);
  const line = `\n  block-rate: ${report.blocked}/${report.total}  (${pct}%)`;
  console.log(pct >= 90 ? C.green(line) : C.amber(line));
  console.log(
    C.dim(
      "\n  Honest note: prompt injection is unsolved industry-wide. We publish this\n  number every release rather than claim 'unhackable'. Architecture limits the\n  blast radius even when scanning misses.",
    ),
  );
}

function cmdSkills(): void {
  banner();
  // Look for skills next to the install, then in CWD.
  const candidates = [join(import.meta.dir, "..", "skills"), join(process.cwd(), "skills")];
  let skills: ReturnType<typeof loadSkills> = [];
  for (const dir of candidates) {
    skills = loadSkills(dir);
    if (skills.length) break;
  }
  console.log(C.bold(`🧠 xr skills (${skills.length})`));
  for (const s of skills) {
    console.log(
      `  ${C.cyan(s.id.padEnd(20))} ${C.dim("v" + s.version + " · " + s.source)}  tools: ${C.dim(s.tools.join(", ") || "—")}`,
    );
  }
  console.log(C.dim("\n  Skills are signed markdown SOPs. Learned skills are frozen & non-regressive."));
}

async function cmdIndex(store: Store): Promise<void> {
  banner();
  const root = process.cwd();
  const project = basename(root);
  info(`indexing project "${project}" (local, private)…`);
  const count = await indexProject(store, root, project);
  ok(`indexed ${count} chunks. XR now retrieves relevant code instead of dumping files.`);
}

function cmdMemory(store: Store): void {
  banner();
  const root = process.cwd();
  const project = basename(root);
  const fp = fingerprint(root);
  console.log(C.bold(`🧠 project: ${project}`));
  console.log(`  files ........ ${fp.files}`);
  console.log(`  languages .... ${Object.entries(fp.languages).map(([e, n]) => `${e}:${n}`).join("  ") || "—"}`);
  console.log(`  frameworks ... ${fp.frameworks.join(", ") || "—"}`);
  console.log(`  has tests .... ${fp.hasTests ? "yes" : "no"}`);
  console.log(`  RAG chunks ... ${store.ragCount(project)}`);
  const mem = store.recall(project);
  console.log(C.bold(`\n  saved memory (${mem.length})`));
  for (const m of mem.slice(0, 20)) console.log(`  • ${C.dim("[" + m.kind + "]")} ${m.content}`);
  if (mem.length === 0) console.log(C.dim("  (none yet — XR will remember facts & preferences across sessions)"));
}

async function cmdMcp(): Promise<void> {
  banner();
  const { config } = loadConfig();
  console.log(C.bold(`🔌 MCP servers (${config.mcpServers.length})`));
  if (config.mcpServers.length === 0) {
    console.log(C.dim("  none configured. Add to ~/.xr/config.json → mcpServers: [{id,url}]"));
    return;
  }
  for (const s of config.mcpServers) {
    try {
      const client = new McpClient(s as any);
      const tools = await client.listTools();
      console.log(`  ${C.cyan(s.id)} ${C.dim(s.url)}`);
      for (const t of tools) console.log(`    · mcp.${s.id}.${t.name} ${C.dim("— " + (t.description ?? ""))}`);
    } catch (e) {
      console.log(`  ${C.cyan(s.id)} ${C.red("✗ " + (e as Error).message)}`);
    }
  }
  console.log(C.dim("\n  MCP tools are untrusted → wrapped with approval + egress + audit."));
}

function cmdCron(store: Store, task: string): void {
  banner();
  if (!task || task === "list") {
    const rows = store.listSchedules();
    console.log(C.bold(`⏰ scheduled tasks (${rows.length})`));
    for (const r of rows) {
      const s = JSON.parse(r.spec) as Schedule;
      console.log(`  ${C.cyan(r.id)}  ${describe(s)}  ${C.dim("→ " + s.task)}`);
    }
    if (rows.length === 0) console.log(C.dim('  none. add: xr cron "every monday 9am: run security audit"'));
    return;
  }
  const id = `cr_${randomUUID().slice(0, 6)}`;
  const sched = parseSchedule(task, id);
  if (!sched) {
    warn('could not parse schedule. try: xr cron "every day at 9am: <task>"');
    return;
  }
  store.saveSchedule(id, JSON.stringify(sched));
  store.audit("cron.added", { id, schedule: describe(sched), task: sched.task });
  ok(`scheduled ${id}: ${describe(sched)} → ${sched.task}`);
  console.log(C.dim("  (runs when the daemon/scheduler is active; still budget+approval gated)"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.task && !args.command)) {
    printHelp();
    return;
  }

  const store = new Store();

  if (args.command === "doctor") {
    await cmdDoctor(store, args);
    store.close();
    return;
  }
  if (args.command === "verify-log") {
    const chain = store.verifyChain();
    if (chain.valid) ok(`audit log intact (${store.auditCount()} entries) — tamper-evident hash chain verified`);
    else warn(`audit log BROKEN at entry #${chain.brokenAt}`);
    store.close();
    return;
  }
  if (args.command === "test") {
    cmdTestAttacks(args.json ?? false);
    store.close();
    return;
  }
  if (args.command === "skills") {
    cmdSkills();
    store.close();
    return;
  }
  if (args.command === "index") {
    await cmdIndex(store);
    store.close();
    return;
  }
  if (args.command === "memory") {
    cmdMemory(store);
    store.close();
    return;
  }
  if (args.command === "serve") {
    banner();
    const h = serve({ store, port: 7842 });
    ok(`dashboard running (localhost only)`);
    console.log(`  ${C.cyan(`http://127.0.0.1:${h.port}/?token=${h.token}`)}`);
    console.log(C.dim(`  bound to 127.0.0.1 · token-authed · Ctrl-C to stop`));
    // keep process alive
    await new Promise(() => {});
    return;
  }
  if (args.command === "mcp") {
    await cmdMcp();
    store.close();
    return;
  }
  if (args.command === "export") {
    banner();
    const { config } = loadConfig();
    const sec = _runLabForExport({ egressAllowlist: config.security.egressAllowlist });
    const report = buildAuditReport({
      project: basename(process.cwd()),
      chainValid: store.verifyChain().valid,
      entries: store.recentAudit(200),
      blockRate: sec.rate,
      totalUsd: store.costSummary().totalUsd,
    });
    const out = `xr-audit-${Date.now()}.md`;
    _writeFileSync(out, report.markdown);
    ok(`wrote ${out}`);
    console.log(C.dim(`  signature: ${report.sha256.slice(0, 24)}…  ·  share it; anyone can verify integrity`));
    store.close();
    return;
  }
  if (args.command === "cron") {
    cmdCron(store, args.task);
    store.close();
    return;
  }
  if (args.command === "voice") {
    banner();
    console.log(C.bold("🎙️ xr voice — local voice stack"));
    const stt = new SpeechToText();
    const tts = new TextToSpeech();
    // Health-probe the local STT/TTS servers (they're device/host-level).
    const sttUp = await stt
      .transcribe(new Uint8Array([0]))
      .then((r) => r.ok || (r.detail ?? "").includes("HTTP"))
      .catch(() => false);
    const ttsR = await tts.speak("ready");
    console.log(`  STT (Whisper) .... ${sttUp ? C.green("✓ reachable") : C.amber("⚠ not running")} ${C.dim("(XR_STT_URL)")}`);
    console.log(`  TTS (Kokoro) ..... ${ttsR.ok ? C.green("✓ reachable") : C.amber("⚠ not running")} ${C.dim("(XR_TTS_URL)")}`);
    console.log(
      C.dim(
        "\n  Wake word: 'Hey XR' (OpenWakeWord, on-device).\n" +
          "  Risky actions require a spoken 'confirm'/'cancel' (fail-closed).\n" +
          "  Start local servers (whisper.cpp / Kokoro), then wire your mic capture\n" +
          "  to VoicePipeline.processUtterance(). Audio I/O is device-level.",
      ),
    );
    store.close();
    return;
  }
  if (args.command === "telegram") {
    banner();
    const token = process.env.XR_TELEGRAM_TOKEN;
    const allowedIds = parseAllowedIds(process.env.XR_TELEGRAM_ALLOWED);
    if (!token) {
      warn("set XR_TELEGRAM_TOKEN (from @BotFather) to use the Telegram remote.");
      store.close();
      process.exit(1);
    }
    if (allowedIds.length === 0) {
      warn("set XR_TELEGRAM_ALLOWED to your numeric Telegram user-id(s). Failing closed.");
      store.close();
      process.exit(1);
    }
    ok(`Telegram remote running · ${allowedIds.length} allowed user(s)`);
    console.log(C.dim(`  only allow-listed ids · approvals via buttons · Ctrl-C to stop`));
    const bot = new TelegramBot({ token, allowedIds, store });
    await bot.start();
    return;
  }

  // Run a task.
  banner();
  const { config, warnings } = loadConfig();
  for (const w of warnings) warn(w);

  let provider;
  try {
    provider = buildProvider(config, { provider: args.provider, model: args.model });
  } catch (e) {
    warn((e as Error).message);
    store.close();
    process.exit(1);
  }

  const providerId = args.provider ?? config.defaults.provider;
  const model = args.model ?? config.defaults.model;
  const pricing = priceFor(providerId, model);
  const budget = {
    maxUsd: isLocal(providerId) ? undefined : (args.budgetUsd ?? config.budget.perTaskUsd),
    maxTokens: args.maxTokens ?? config.budget.perTaskTokens,
  };

  info(`mode: ${args.mode} · provider: ${provider.label} · model: ${model}`);
  info(
    `budget: ${budget.maxUsd ? "$" + budget.maxUsd : "local/$0"} · ${budget.maxTokens ? budget.maxTokens + " tok" : "no token cap"}`,
  );
  if (args.dryRun) info(`🧪 DRY-RUN: no files will be written, no commands run`);
  info(`task: ${args.task}`);
  // Cost-estimate-before-commit (trust feature).
  const est = estimateTask(args.task, pricing);
  const estStr = pricing.inPerMTok + pricing.outPerMTok > 0 ? `≈ $${est.estUsd.toFixed(4)}` : "local · $0";
  info(`estimate: ${estStr} (${(est.estTokens / 1000).toFixed(1)}k tok · ${est.basis})\n`);

  // Inject local RAG context + saved memory (the "knows your codebase" superpower).
  const project = basename(process.cwd());
  let augmentedTask = args.task;
  try {
    const memNotes = store.recall(project).slice(0, 10).map((m) => `- [${m.kind}] ${m.content}`);
    const chunks = store.ragCount(project) > 0 ? await retrieve(store, project, args.task, 4) : [];
    const ctxParts: string[] = [];
    if (memNotes.length) ctxParts.push(`Known project memory:\n${memNotes.join("\n")}`);
    if (chunks.length) {
      ctxParts.push(
        `Relevant code (retrieved locally):\n` +
          chunks.map((c) => `--- ${c.path} ---\n${c.text.slice(0, 600)}`).join("\n\n"),
      );
      info(`🧠 injected ${chunks.length} relevant chunk(s) from local index`);
    }
    if (ctxParts.length) augmentedTask = `${ctxParts.join("\n\n")}\n\nTASK: ${args.task}`;
  } catch {
    /* memory is best-effort; never block a task */
  }

  const result = await runAgent(augmentedTask, args.mode, {
    provider,
    store,
    cwd: process.cwd(),
    say,
    approve: approvePrompt,
    onOverBudget: overBudgetPrompt,
    budget,
    pricing,
    egressAllowlist: config.security.egressAllowlist,
    dryRun: args.dryRun,
  });

  console.log("");
  if (result.stopped === "done") ok(`done in ${result.steps} step(s)`);
  else if (result.stopped === "budget") warn(`stopped to respect your budget`);
  else if (result.stopped === "max_steps") warn(`stopped at step limit`);
  else warn(`ended with error`);
  if (result.meter) info(result.meter);
  if (result.finalMessage) console.log(C.cyan("\n" + result.finalMessage));

  store.close();
}

main().catch((e) => {
  console.error("\x1b[31mfatal:\x1b[0m", e);
  process.exit(1);
});
