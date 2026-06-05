/**
 * XR — research engine (orchestrator).
 *
 * Executes the deterministic research flow end to end:
 *   1. plan      → research questions + queries
 *   2. search    → collect raw hits (egress-gated)
 *   3. rank      → trust-score + dedupe → Source[]
 *   4. fetch     → pull full text for the top sources (best effort)
 *   5. extract   → notes per source (each cited + verified-flagged)
 *   6. synthesize→ short answer, summary, report, contradictions, open questions
 *
 * The engine is integration-aware but stays decoupled:
 *   - Provider is injected (routing/fallback happens in the caller).
 *   - Search capability is injected (egress allow-list enforced there).
 *   - Budget is enforced via an injected guard; the engine NEVER spends silently.
 *   - Progress is streamed via `say` (UX: visible progress).
 *
 * Every step persists the session, so `xr research status/sources/summarize`
 * always have something to show even if a later step fails.
 */
import { randomUUID } from "node:crypto";
import type { Provider } from "../core/types.ts";
import type { Store } from "../state/db.ts";
import type { StructuredCallDeps } from "./llm.ts";
import type { SearchCapability } from "./search.ts";
import type {
  ResearchSession,
  ResearchDepth,
  Source,
  Note,
} from "./types.ts";
import { DEPTH_BUDGETS } from "./types.ts";
import { makePlan, queriesFromPlan } from "./plan.ts";
import { rankSources } from "./ranking.ts";
import { extractFromSource } from "./extract.ts";
import { synthesize } from "./synthesize.ts";

export interface ResearchBudgetGuard {
  /** Called before each model/search step. Return false to stop gracefully. */
  allow(): boolean;
  /** Record token usage so the meter stays accurate. */
  record(inTokens: number, outTokens: number): void;
  /** Human-readable meter string for display + report. */
  meter(): string;
  /** Reason the last allow() returned false (for the user). */
  reason(): string;
}

export interface ResearchEngineDeps {
  provider: Provider;
  store: Store;
  search: SearchCapability;
  budget: ResearchBudgetGuard;
  /** Stream progress to the user. */
  say(line: string): void;
  /** Audit hook (tamper-evident log). */
  audit?(event: string, detail: Record<string, unknown>): void;
}

export interface RunOptions {
  topic: string;
  depth: ResearchDepth;
}

/** Create a fresh, empty session record. */
export function newSession(topic: string, depth: ResearchDepth): ResearchSession {
  const now = Date.now();
  return {
    id: `r_${randomUUID().slice(0, 8)}`,
    topic: topic.trim(),
    depth,
    status: "planning",
    sources: [],
    notes: [],
    contradictions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function persist(deps: ResearchEngineDeps, s: ResearchSession): void {
  s.updatedAt = Date.now();
  deps.store.saveResearch(s.id, s.topic, s.depth, s.status, JSON.stringify(s));
}

/** Run the full research pipeline. Returns the (persisted) session. */
export async function runResearch(deps: ResearchEngineDeps, opts: RunOptions): Promise<ResearchSession> {
  const { say } = deps;
  const budgetCfg = DEPTH_BUDGETS[opts.depth];
  const session = newSession(opts.topic, opts.depth);
  deps.audit?.("research.start", { id: session.id, topic: session.topic, depth: session.depth });
  persist(deps, session);

  const llm: StructuredCallDeps = {
    provider: deps.provider,
    onUsage: (i, o) => deps.budget.record(i, o),
  };

  // Warn early if search isn't available — research is source-first, so this matters.
  const searchReady = deps.search.available();
  if (!searchReady) {
    say(`⚠ Web search is not available (no search host on the egress allow-list).`);
    say(`  XR will still plan, but cannot collect live sources. Add a SearXNG host to fix this.`);
  }

  // ── 1. PLAN ────────────────────────────────────────────────────────────────
  if (!deps.budget.allow()) return stop(deps, session);
  session.status = "planning";
  say(`▸ planning (${opts.depth}) · ${deps.budget.meter()}`);
  session.plan = await makePlan(llm, session.topic, budgetCfg);
  say(`  ✓ ${session.plan.questions.length} research question(s)`);
  persist(deps, session);

  // ── 2. SEARCH ────────────────────────────────────────────────────────────
  session.status = "searching";
  const queries = queriesFromPlan(session.plan, budgetCfg.maxQueries);
  const hitsByQuery: Array<{ query: string; hits: { title: string; url: string; snippet: string }[] }> = [];

  if (searchReady) {
    for (const query of queries) {
      if (!deps.budget.allow()) return stop(deps, session);
      say(`▸ searching "${query}"`);
      const resp = await deps.search.search(query, budgetCfg.resultsPerQuery);
      if (resp.unavailableReason) {
        say(`  ⚠ ${resp.unavailableReason}`);
      } else {
        say(`  ✓ ${resp.hits.length} hit(s)`);
      }
      hitsByQuery.push({ query, hits: resp.hits });
      deps.audit?.("research.search", { id: session.id, query, hits: resp.hits.length });
    }
  }

  // ── 3. RANK ──────────────────────────────────────────────────────────────
  session.status = "ranking";
  session.sources = rankSources(hitsByQuery, budgetCfg.maxSources);
  say(`▸ ranked ${session.sources.length} source(s) by trust`);
  persist(deps, session);

  // ── 4. FETCH (best-effort, top sources only) ──────────────────────────────
  const toFetch = session.sources.slice(0, budgetCfg.maxFetched);
  for (const src of toFetch) {
    if (!deps.budget.allow()) break; // stop fetching but keep what we have
    say(`▸ fetching [${src.id}] ${src.domain}`);
    const r = await deps.search.fetch(src.url);
    if (r.ok && r.text && r.text.trim()) {
      src.fetched = true;
      src.content = r.text;
      say(`  ✓ fetched ${r.text.length} chars`);
    } else {
      say(`  ⚠ could not fetch (${r.reason ?? "unknown"}) — snippet only`);
    }
    deps.audit?.("research.fetch", { id: session.id, source: src.id, ok: src.fetched });
  }
  persist(deps, session);

  // ── 5. EXTRACT ────────────────────────────────────────────────────────────
  session.status = "extracting";
  const notes: Note[] = [];
  for (const src of session.sources) {
    if (!deps.budget.allow()) break;
    // Only spend extraction budget on fetched sources + the top snippet-only ones.
    if (!src.fetched && session.sources.indexOf(src) >= budgetCfg.maxFetched + 2) continue;
    say(`▸ extracting notes from [${src.id}] ${src.domain}`);
    const got = await extractFromSource(llm, session.topic, src);
    if (got.length) say(`  ✓ ${got.length} note(s)`);
    notes.push(...got);
  }
  session.notes = notes;
  say(`▸ collected ${notes.length} note(s) (${notes.filter((n) => n.verified).length} verified)`);
  persist(deps, session);

  // ── 6. SYNTHESIZE ─────────────────────────────────────────────────────────
  session.status = "synthesizing";
  say(`▸ synthesizing · ${deps.budget.meter()}`);
  if (deps.budget.allow()) {
    const { synthesis, contradictions } = await synthesize(
      llm,
      session.topic,
      session.plan.objective,
      session.sources,
      session.notes,
    );
    session.synthesis = synthesis;
    session.contradictions = contradictions;
    if (contradictions.length) say(`  ⚠ ${contradictions.length} contradiction(s) detected`);
  } else {
    say(`  ⏸ budget reached before synthesis — partial results saved.`);
  }

  session.status = session.synthesis ? "done" : "stopped";
  session.meter = deps.budget.meter();
  deps.audit?.("research.done", { id: session.id, sources: session.sources.length, notes: session.notes.length });
  persist(deps, session);
  return session;
}

/** Re-synthesize from already-collected sources/notes (the `summarize` command). */
export async function summarizeExisting(deps: ResearchEngineDeps, session: ResearchSession): Promise<ResearchSession> {
  const llm: StructuredCallDeps = {
    provider: deps.provider,
    onUsage: (i, o) => deps.budget.record(i, o),
  };
  deps.say(`▸ re-synthesizing from ${session.notes.length} note(s)…`);
  const { synthesis, contradictions } = await synthesize(
    llm,
    session.topic,
    session.plan?.objective ?? session.topic,
    session.sources,
    session.notes,
  );
  session.synthesis = synthesis;
  session.contradictions = contradictions;
  session.status = "done";
  session.meter = deps.budget.meter();
  persist(deps, session);
  return session;
}

function stop(deps: ResearchEngineDeps, s: ResearchSession): ResearchSession {
  deps.say(`⏸ stopped — ${deps.budget.reason()}`);
  s.status = "stopped";
  s.meter = deps.budget.meter();
  persist(deps, s);
  return s;
}
