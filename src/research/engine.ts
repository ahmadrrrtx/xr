/** XR Stage 7 — Research Engine orchestrator. */
import { randomUUID } from "node:crypto";
import type { Provider } from "../core/types.ts";
import type { Store } from "../state/workspace-store.ts";
import type { StructuredCallDeps } from "./llm.ts";
import type { SearchCapability } from "./search.ts";
import { extractUrls } from "./search.ts";
import type { ResearchSession, ResearchDepth, ResearchMode, Note, Source, RefreshRecord, ComparisonOutput } from "./types.ts";
import { DEPTH_BUDGETS } from "./types.ts";
import { makePlan, queriesFromPlan } from "./plan.ts";
import { rankSources, domainOf, freshnessFromHeaders, freshnessFromText, scoreDomain } from "./ranking.ts";
import { deterministicExtract, extractFromSource } from "./extract.ts";
import { synthesize } from "./synthesize.ts";

export interface ResearchBudgetGuard { allow(): boolean; record(inTokens: number, outTokens: number): void; meter(): string; reason(): string; }
export interface ResearchEngineDeps { provider: Provider; store: Store; search: SearchCapability; budget: ResearchBudgetGuard; say(line: string): void; audit?(event: string, detail: Record<string, unknown>): void; }
export interface RunOptions { topic: string; depth?: ResearchDepth; mode?: ResearchMode; liveSourcesOnly?: boolean; tags?: string[]; projectId?: string; }

export function newSession(topic: string, depth: ResearchDepth = "quick", mode: ResearchMode = depth): ResearchSession {
  const now = Date.now();
  return { id: `r_${randomUUID().slice(0, 8)}`, topic: topic.trim(), query: topic.trim(), mode, depth, status: "planning", sources: [], sourceSets: [], evidence: [], notes: [], claims: [], contradictions: [], reportVersions: [], refreshHistory: [], tags: [], liveSourcesOnly: false, createdAt: now, updatedAt: now };
}

function persist(deps: ResearchEngineDeps, s: ResearchSession): void { s.updatedAt = Date.now(); deps.store.saveResearch(s.id, s.topic, s.depth, s.status, JSON.stringify(s)); }

export async function runResearch(deps: ResearchEngineDeps, opts: RunOptions): Promise<ResearchSession> {
  const depth = opts.depth ?? (opts.mode === "deep" ? "deep" : "quick");
  const mode = opts.mode ?? depth;
  const budgetCfg = DEPTH_BUDGETS[depth];
  const session = newSession(opts.topic, depth, mode);
  session.liveSourcesOnly = Boolean(opts.liveSourcesOnly);
  session.tags = opts.tags ?? [];
  session.projectId = opts.projectId;
  deps.audit?.("research.start", { id: session.id, topic: session.topic, mode, depth });
  persist(deps, session);

  const llm: StructuredCallDeps = { provider: deps.provider, onUsage: (i, o) => deps.budget.record(i, o) };
  const searchReady = deps.search.available();
  if (!searchReady) deps.say(`⚠ Web search is unavailable. Add XR_SEARXNG host to egress allow-list.`);

  if (!deps.budget.allow()) return stop(deps, session);
  session.status = "planning";
  deps.say(`▸ planning (${mode}/${depth}) · ${deps.budget.meter()}`);
  session.plan = await makePlan(llm, session.topic, budgetCfg, mode);
  persist(deps, session);

  session.status = "discovering";
  const hitsByQuery: Array<{ query: string; hits: { title: string; url: string; snippet: string }[] }> = [];
  if (searchReady) {
    for (const query of queriesFromPlan(session.plan, budgetCfg.maxQueries)) {
      if (!deps.budget.allow()) return stop(deps, session);
      deps.say(`▸ searching "${query}"`);
      const resp = await deps.search.search(query, budgetCfg.resultsPerQuery);
      if (resp.unavailableReason) deps.say(`  ⚠ ${resp.unavailableReason}`); else deps.say(`  ✓ ${resp.hits.length} hit(s)`);
      hitsByQuery.push({ query, hits: resp.hits });
      deps.audit?.("research.search", { id: session.id, query, hits: resp.hits.length });
    }
  }

  const directUrls = extractUrls(session.topic);
  for (const url of directUrls) hitsByQuery.unshift({ query: "direct-url", hits: [{ title: domainOf(url) || url, url, snippet: `User supplied URL: ${url}` }] });

  session.status = "ranking";
  session.sources = rankSources(hitsByQuery, budgetCfg.maxSources, 1, session.topic);
  session.sourceSets = [{ id: `set_${randomUUID().slice(0, 6)}`, name: "ranked", sourceIds: session.sources.map((s) => s.id), createdAt: Date.now() }];
  deps.say(`▸ ranked ${session.sources.length} source(s)`);
  persist(deps, session);

  session.status = "fetching";
  await fetchTopSources(deps, session, budgetCfg.maxFetched);
  persist(deps, session);

  session.status = "extracting";
  const notes: Note[] = [];
  for (const src of session.sources) {
    if (!deps.budget.allow()) break;
    if (session.liveSourcesOnly && !src.fetched) continue;
    if (!src.fetched && session.sources.indexOf(src) >= budgetCfg.maxFetched + 2) continue;
    deps.say(`▸ extracting evidence from [${src.id}] ${src.domain}`);
    let got = await extractFromSource(llm, session.topic, src, budgetCfg.maxEvidencePerSource);
    if (!got.length) got = deterministicExtract(session.topic, src, Math.min(3, budgetCfg.maxEvidencePerSource));
    notes.push(...got);
    deps.say(`  ✓ ${got.length} evidence block(s)`);
  }
  session.notes = notes;
  session.evidence = notes;
  deps.say(`▸ evidence ledger: ${notes.length} block(s), ${notes.filter((n) => n.verified).length} verified`);
  persist(deps, session);

  session.status = "checking";
  session.status = "synthesizing";
  if (deps.budget.allow()) {
    const { synthesis, contradictions, claims } = await synthesize(llm, session.topic, session.plan.objective, session.sources, session.notes);
    session.synthesis = synthesis;
    session.summary = synthesis;
    session.finalReport = synthesis.report;
    session.contradictions = contradictions;
    session.claims = claims;
    if (session.mode === "compare") session.comparison = buildComparison(session);
    if (contradictions.length) deps.say(`  ⚠ ${contradictions.length} contradiction(s) detected`);
  } else deps.say(`  ⏸ budget reached before synthesis — partial results saved.`);

  session.status = session.synthesis ? "done" : "stopped";
  session.meter = deps.budget.meter();
  session.lastRefreshedAt = Date.now();
  deps.audit?.("research.done", { id: session.id, sources: session.sources.length, evidence: session.evidence.length, contradictions: session.contradictions.length });
  persist(deps, session);
  return session;
}

export async function summarizeExisting(deps: ResearchEngineDeps, session: ResearchSession): Promise<ResearchSession> {
  const llm: StructuredCallDeps = { provider: deps.provider, onUsage: (i, o) => deps.budget.record(i, o) };
  deps.say(`▸ re-synthesizing from ${session.notes.length} evidence block(s)…`);
  const { synthesis, contradictions, claims } = await synthesize(llm, session.topic, session.plan?.objective ?? session.topic, session.sources, session.notes);
  session.synthesis = synthesis; session.summary = synthesis; session.finalReport = synthesis.report; session.contradictions = contradictions; session.claims = claims; session.status = "done"; session.meter = deps.budget.meter();
  persist(deps, session);
  return session;
}

export async function refreshResearch(deps: ResearchEngineDeps, session: ResearchSession): Promise<ResearchSession> {
  const previousUpdatedAt = session.updatedAt;
  session.status = "refreshing";
  persist(deps, session);

  const llm: StructuredCallDeps = { provider: deps.provider, onUsage: (i, o) => deps.budget.record(i, o) };
  const before = new Map(session.sources.map((s) => [s.id, `${s.metadata.lastModified ?? ""}:${s.metadata.contentLength ?? 0}:${s.fetchError ?? ""}:${s.fetched}`]));
  await fetchTopSources(deps, session, session.sources.length);
  const changedSources = session.sources
    .filter((s) => before.get(s.id) !== `${s.metadata.lastModified ?? ""}:${s.metadata.contentLength ?? 0}:${s.fetchError ?? ""}:${s.fetched}`)
    .map((s) => s.id);

  let notesAdded = 0;
  if (changedSources.length) {
    const keep = session.notes.filter((n) => !changedSources.includes(n.sourceId));
    const refreshed: Note[] = [];
    for (const src of session.sources.filter((s) => changedSources.includes(s.id))) {
      if (!deps.budget.allow()) break;
      let got = await extractFromSource(llm, session.topic, src, DEPTH_BUDGETS[session.depth].maxEvidencePerSource);
      if (!got.length) got = deterministicExtract(session.topic, src, 3);
      refreshed.push(...got);
    }
    notesAdded = refreshed.length;
    session.notes = [...keep, ...refreshed];
    session.evidence = session.notes;
    if (session.notes.length && deps.budget.allow()) {
      const { synthesis, contradictions, claims } = await synthesize(llm, session.topic, session.plan?.objective ?? session.topic, session.sources, session.notes);
      session.synthesis = synthesis;
      session.summary = synthesis;
      session.finalReport = synthesis.report;
      session.contradictions = contradictions;
      session.claims = claims;
      if (session.mode === "compare") session.comparison = buildComparison(session);
    }
  }

  const record: RefreshRecord = {
    id: `ref_${randomUUID().slice(0, 8)}`,
    refreshedAt: Date.now(),
    previousUpdatedAt,
    sourcesChecked: session.sources.length,
    changedSources,
    notesAdded,
    status: "done",
    message: changedSources.length ? `${changedSources.length} source(s) changed; ${notesAdded} evidence block(s) refreshed` : "sources reverified; no material changes detected",
  };
  session.refreshHistory.push(record);
  session.lastRefreshedAt = record.refreshedAt;
  session.status = "done";
  persist(deps, session);
  return session;
}

async function fetchTopSources(deps: ResearchEngineDeps, session: ResearchSession, maxFetched: number): Promise<void> {
  for (const src of session.sources.slice(0, maxFetched)) {
    if (!deps.budget.allow()) break;
    deps.say(`▸ fetching [${src.id}] ${src.domain}`);
    const r = await deps.search.fetch(src.url);
    if (r.ok && r.text?.trim()) {
      src.fetched = true; src.verified = true; src.content = r.text; src.fetchError = undefined;
      const fresh = freshnessFromHeaders(r.lastModified, `${src.title} ${src.snippet} ${r.text}`);
      src.freshness = fresh; src.quality = Number(Math.max(src.quality, src.trust * 0.45 + src.relevance * 0.3 + fresh.score * 0.25).toFixed(3));
      src.metadata = { ...src.metadata, canonicalUrl: r.canonicalUrl, fetchedAt: Date.now(), lastVerifiedAt: Date.now(), httpStatus: r.status, contentType: r.contentType, contentLength: r.bytes ?? r.text.length, lastModified: r.lastModified } as any;
      deps.say(`  ✓ fetched ${r.text.length} chars · freshness ${fresh.label}`);
    } else {
      src.fetched = false; src.verified = false; src.fetchError = r.reason ?? "unknown"; src.freshness = freshnessFromText(`${src.title} ${src.snippet}`); deps.say(`  ⚠ ${src.fetchError}`);
    }
    deps.audit?.("research.fetch", { id: session.id, source: src.id, ok: src.fetched });
  }
}

export function sourceFromUrl(url: string, foundVia = "direct-url"): Source | null {
  const domain = domainOf(url); if (!domain) return null;
  const scored = scoreDomain(domain);
  const now = Date.now();
  return { id: "s0", title: domain, url, domain, snippet: `Direct URL: ${url}`, foundVia, type: scored.type, trust: scored.trust, relevance: 1, freshness: freshnessFromText(url), quality: scored.trust, trustReason: scored.reason, rankingReason: "direct user-supplied URL", fetched: false, verified: false, metadata: { title: domain, url, domain, type: scored.type, snippet: "direct", foundVia, discoveredAt: now }, collectedAt: now };
}

function buildComparison(session: ResearchSession): ComparisonOutput {
  const subjects = parseSubjects(session.topic);
  const criteria = session.plan?.questions.map((q) => q.text).slice(0, 6) ?? ["Evidence", "Risks", "Freshness"];
  const matrix = criteria.map((criterion) => {
    const row: Record<string, string> = { criterion };
    for (const subject of subjects) {
      const hits = session.notes
        .filter((n) => n.text.toLowerCase().includes(subject.toLowerCase()))
        .slice(0, 3)
        .map((n) => `${n.text} [${n.sourceId}]`);
      row[subject] = hits.length ? hits.join(" ") : "No direct evidence found.";
    }
    return row;
  });
  return {
    id: `cmp_${randomUUID().slice(0, 8)}`,
    subjects,
    criteria,
    matrix,
    verdict: session.synthesis?.shortAnswer ?? "Comparison generated from evidence ledger; inspect source citations for confidence.",
    createdAt: Date.now(),
  };
}

function parseSubjects(topic: string): string[] {
  const parts = topic.split(/\s+vs\.?\s+|\s+versus\s+|\s+compared\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 4);
  return ["Option A", "Option B"];
}

function stop(deps: ResearchEngineDeps, s: ResearchSession): ResearchSession { deps.say(`⏸ stopped — ${deps.budget.reason()}`); s.status = "stopped"; s.meter = deps.budget.meter(); persist(deps, s); return s; }
