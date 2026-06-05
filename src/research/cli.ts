/**
 * XR — research CLI command handler (v0.7).
 *
 * Implements:
 *   xr research "topic"            run (default depth from config, else quick)
 *   xr research quick "topic"      fast: fewer sources, faster summary
 *   xr research deep "topic"       deeper: more sources, richer synthesis
 *   xr research plan "topic"       only generate + show the research plan
 *   xr research status             show the current/most-recent session
 *   xr research sources [id]       show collected sources for a session
 *   xr research summarize [id]     (re)synthesize a report from collected notes
 *   xr research export [id] [path] write the report to a markdown file (+ .json)
 *   xr research list               list recent research sessions
 *
 * Integration: reuses provider routing (incl. budget-aware fallback to local),
 * spend caps, the egress allow-list, and the tamper-evident audit log — all of
 * the existing XR systems, not a parallel stack.
 */
import { join } from "node:path";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import type { Store } from "../state/db.ts";
import { loadConfig, XR_HOME } from "../config/config.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { BudgetManager } from "../cost/manager.ts";
import { banner, ok, warn, info, colors as C } from "../interfaces/cli.ts";
import type { ResearchDepth, ResearchSession } from "./types.ts";
import { WebSearchCapability } from "./search.ts";
import { GovernedResearchBudget, LocalResearchBudget } from "./budget.ts";
import { runResearch, summarizeExisting, type ResearchEngineDeps } from "./engine.ts";
import { makePlan } from "./plan.ts";
import { DEPTH_BUDGETS } from "./types.ts";
import { renderReport, renderSourcesList, renderTerminalSummary } from "./report.ts";

/** Build engine deps with the same routing/budget logic the agent uses. */
function buildEngine(
  store: Store,
  override: { provider?: string; model?: string },
  perTaskBudgetUsd?: number,
): { deps: ResearchEngineDeps; providerId: string; model: string } {
  const { config } = loadConfig();

  let providerId = override.provider ?? config.defaults.provider;
  const model = override.model ?? config.defaults.model;

  // Budget-aware fallback to local (mirrors src/index.ts default-task routing).
  if (!isLocal(providerId)) {
    const bm = new BudgetManager(store);
    const status = bm.getStatus();
    const cfg = bm.getConfig();
    if (status.isOverBudget && cfg.auto_fallback) {
      const localModel = config.localModels.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
      warn(`Global budget exhausted ($${status.monthlySpend.toFixed(2)} / $${status.monthlyCap.toFixed(2)}).`);
      warn(`Falling back to local model: ${localModel}`);
      providerId = "ollama";
    }
  }

  const provider = buildProvider(config, { provider: providerId, model });

  // Egress-gated search capability built from the real allow-list.
  const toolCtx = {
    cwd: process.cwd(),
    approve: async () => false, // research never needs approval to read public web
    audit: (event: string, detail: Record<string, unknown>) => store.audit(event, detail),
    egressAllowlist: config.security.egressAllowlist,
    dryRun: false,
  };
  const search = new WebSearchCapability(toolCtx);

  // Spend cap: governed for cloud, soft-step cap for local/free.
  const budget = isLocal(providerId)
    ? new LocalResearchBudget()
    : new GovernedResearchBudget(
        store,
        { maxUsd: perTaskBudgetUsd ?? config.budget.perTaskUsd, maxTokens: config.budget.perTaskTokens },
        priceFor(providerId, model),
      );

  const deps: ResearchEngineDeps = {
    provider,
    store,
    search,
    budget,
    say: (line: string) => console.log(line.startsWith("⚠") ? C.yellow(line) : C.dim(line)),
    audit: (event, detail) => store.audit(event, detail),
  };

  return { deps, providerId, model };
}

function loadSession(store: Store, id?: string): ResearchSession | null {
  const row = id ? store.getResearch(id) : store.latestResearch();
  if (!row) return null;
  try {
    return JSON.parse(row.data) as ResearchSession;
  } catch {
    return null;
  }
}

async function doRun(store: Store, topic: string, depth: ResearchDepth, override: { provider?: string; model?: string; budget?: number }): Promise<void> {
  if (!topic.trim()) {
    warn(`Usage: xr research ${depth === "quick" ? "" : depth + " "}"your topic"`);
    return;
  }
  banner();
  const { deps, providerId, model } = buildEngine(store, override, override.budget);
  console.log(`${C.bold("🔬 Research")} ${C.cyan(`(${depth})`)} · ${C.dim(`${providerId}/${model}`)}`);
  console.log(`${C.dim("topic:")} ${topic}\n`);

  const session = await runResearch(deps, { topic, depth });

  console.log();
  if (session.status === "done") ok(`research complete · ${session.meter ?? ""}`);
  else warn(`research ${session.status} · ${session.meter ?? ""}`);
  console.log();
  console.log(renderTerminalSummary(session, C));
  console.log();
  info(`session ${session.id} — export with:  xr research export ${session.id}`);
}

async function doPlan(store: Store, topic: string, override: { provider?: string; model?: string }): Promise<void> {
  if (!topic.trim()) {
    warn(`Usage: xr research plan "your topic"`);
    return;
  }
  banner();
  const { deps } = buildEngine(store, override);
  console.log(`${C.bold("🗺  Research plan")} · ${C.dim("topic:")} ${topic}\n`);
  const plan = await makePlan(
    { provider: deps.provider, onUsage: (i, o) => deps.budget.record(i, o) },
    topic,
    DEPTH_BUDGETS.deep,
  );
  console.log(`${C.bold("Objective")}`);
  console.log(`  ${plan.objective}\n`);
  console.log(`${C.bold("Strategy")}`);
  console.log(`  ${C.dim(plan.strategy)}\n`);
  console.log(`${C.bold("Research questions")}`);
  for (const q of plan.questions) {
    console.log(`  ${C.cyan("•")} ${q.text}`);
    if (q.queries.length) console.log(`      ${C.dim("queries: " + q.queries.map((x) => `"${x}"`).join(", "))}`);
  }
  console.log(`\n${C.dim("Run it:")} xr research ${topic.includes(" ") ? `"${topic}"` : topic}`);
}

function doStatus(store: Store, id?: string): void {
  const session = loadSession(store, id);
  banner();
  if (!session) {
    info("No research sessions yet. Start one with:  xr research \"your topic\"");
    return;
  }
  console.log(`${C.bold("🔬 Research status")}`);
  console.log(`  session .......... ${C.cyan(session.id)}`);
  console.log(`  topic ............ ${session.topic}`);
  console.log(`  mode ............. ${session.depth}`);
  console.log(`  status ........... ${statusColor(session.status)}`);
  console.log(`  plan ............. ${session.plan ? C.green(`✓ ${session.plan.questions.length} questions`) : C.dim("—")}`);
  console.log(`  sources .......... ${C.cyan(String(session.sources.length))} ${C.dim(`(fetched ${session.sources.filter((s) => s.fetched).length})`)}`);
  console.log(`  notes ............ ${C.cyan(String(session.notes.length))} ${C.dim(`(verified ${session.notes.filter((n) => n.verified).length})`)}`);
  console.log(`  contradictions ... ${session.contradictions.length ? C.yellow(String(session.contradictions.length)) : C.dim("0")}`);
  console.log(`  synthesis ........ ${session.synthesis ? C.green("✓") : C.dim("—")}`);
  if (session.exportPath) console.log(`  exported ......... ${C.dim(session.exportPath)}`);
  if (session.meter) console.log(`  spend ............ ${C.dim(session.meter.replace(/\x1b\[[0-9;]*m/g, ""))}`);
}

function doSources(store: Store, id?: string): void {
  const session = loadSession(store, id);
  banner();
  if (!session) {
    info("No research session found.");
    return;
  }
  console.log(`${C.bold("📚 Sources")} ${C.dim(`(${session.sources.length}) · session ${session.id}`)}\n`);
  console.log(renderSourcesList(session.sources, C));
}

async function doSummarize(store: Store, id: string | undefined, override: { provider?: string; model?: string }): Promise<void> {
  const session = loadSession(store, id);
  banner();
  if (!session) {
    info("No research session found to summarize.");
    return;
  }
  if (session.notes.length === 0) {
    warn("This session has no evidence notes. Run a full research first.");
    return;
  }
  const { deps } = buildEngine(store, override);
  const updated = await summarizeExisting(deps, session);
  console.log();
  ok("synthesis regenerated");
  console.log();
  console.log(renderTerminalSummary(updated, C));
  console.log();
  info(`export with:  xr research export ${updated.id}`);
}

function doExport(store: Store, id: string | undefined, outPath: string | undefined): void {
  const session = loadSession(store, id);
  banner();
  if (!session) {
    info("No research session found to export.");
    return;
  }
  const { markdown, sha256 } = renderReport(session);

  // Default path: ~/.xr/research/<id>.md  (predictable, no surprise overwrites)
  const dir = join(XR_HOME, "research");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const safeTopic = session.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  const finalPath = outPath ?? join(dir, `${session.id}-${safeTopic || "report"}.md`);

  writeFileSync(finalPath, markdown, "utf8");
  // Machine-readable sidecar for future dashboard/citation-graph use.
  const jsonPath = finalPath.replace(/\.md$/i, "") + ".json";
  writeFileSync(jsonPath, JSON.stringify(session, null, 2), "utf8");

  session.exportPath = finalPath;
  store.saveResearch(session.id, session.topic, session.depth, session.status, JSON.stringify(session));

  ok(`report exported`);
  console.log(`  markdown ... ${C.cyan(finalPath)}`);
  console.log(`  json ....... ${C.dim(jsonPath)}`);
  console.log(`  signature .. ${C.dim(sha256.slice(0, 16) + "…")}`);
}

function doList(store: Store): void {
  banner();
  const rows = store.listResearch(20);
  console.log(`${C.bold("🔬 Research sessions")} ${C.dim(`(${rows.length})`)}\n`);
  if (!rows.length) {
    info("None yet. Start one with:  xr research \"your topic\"");
    return;
  }
  for (const r of rows) {
    const when = new Date(r.updated_at).toISOString().slice(0, 16).replace("T", " ");
    console.log(`  ${C.cyan(r.id)} ${C.dim(when)} ${statusColor(r.status)} ${C.dim(`[${r.depth}]`)} ${r.topic}`);
  }
}

function statusColor(s: string): string {
  if (s === "done") return C.green(s);
  if (s === "error" || s === "stopped") return C.yellow(s);
  return C.cyan(s);
}

/**
 * Entry point. `argv` is everything AFTER `research`.
 * `override` carries --provider/--model/--budget parsed by index.ts.
 */
export async function handleResearchCommand(
  argv: string[],
  store: Store,
  override: { provider?: string; model?: string; budget?: number } = {},
): Promise<void> {
  const sub = (argv[0] ?? "").toLowerCase();
  const rest = argv.slice(1).join(" ").trim();

  switch (sub) {
    case "":
      printResearchHelp();
      return;
    case "quick":
      return doRun(store, rest, "quick", override);
    case "deep":
      return doRun(store, rest, "deep", override);
    case "plan":
      return doPlan(store, rest, override);
    case "status":
      return doStatus(store, argv[1]);
    case "sources":
      return doSources(store, argv[1]);
    case "summarize":
      return doSummarize(store, argv[1], override);
    case "export":
      return doExport(store, argv[1], argv[2]);
    case "list":
      return doList(store);
    case "help":
    case "--help":
    case "-h":
      printResearchHelp();
      return;
    default: {
      // No subcommand keyword ⇒ treat the whole thing as a topic (default depth).
      const topic = argv.join(" ").trim();
      const defaultDepth: ResearchDepth = "quick";
      return doRun(store, topic, defaultDepth, override);
    }
  }
}

function printResearchHelp(): void {
  banner();
  console.log(`${C.bold("🔬 XR Research Mode")}  ${C.dim("source-first, citation-aware research")}\n`);
  console.log(`${C.bold("Usage")}`);
  console.log(`  xr research "topic"            quick research (default)`);
  console.log(`  xr research quick "topic"      fast: fewer sources, faster summary`);
  console.log(`  xr research deep "topic"       deeper: more sources, richer synthesis`);
  console.log(`  xr research plan "topic"       generate research questions + strategy`);
  console.log(`  xr research status [id]        show current/most-recent session`);
  console.log(`  xr research sources [id]       list collected sources + trust`);
  console.log(`  xr research summarize [id]     (re)synthesize a report from notes`);
  console.log(`  xr research export [id] [path] write report to markdown (+ json)`);
  console.log(`  xr research list               recent research sessions\n`);
  console.log(`${C.bold("Flags")}`);
  console.log(`  --provider [id]   override provider   --model [id]   override model`);
  console.log(`  --budget [usd]    per-research USD ceiling (cloud providers)\n`);
  console.log(C.dim("XR collects sources before forming conclusions, marks anything it did not"));
  console.log(C.dim("verify, and never fabricates a source or fakes certainty."));
}
