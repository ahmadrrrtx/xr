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
import { liteSource, type RunEventSink } from "./run-events.ts";

export interface ResearchBudgetGuard { allow(): boolean; record(inTokens: number, outTokens: number): void; meter(): string; reason(): string; }
export interface ResearchEngineDeps {
  provider: Provider; store: Store; search: SearchCapability; budget: ResearchBudgetGuard; say(line: string): void; audit?(event: string, detail: Record<string, unknown>): void;
  /** Phase 18: structured progress beside the `say()` lines (desktop SSE). */
  onEvent?: RunEventSink;
  /** Phase 18: cooperative cancellation — checked before every step and forwarded to model + fetch sockets. */
  signal?: AbortSignal;
}
/** Phase 18: a user-supplied document (PDF text, local note) that joins the run as a fetched `local` source. */
export interface RunDocument { name: string; text: string; kind: "pdf" | "local"; }
export interface RunOptions { topic: string; depth?: ResearchDepth; mode?: ResearchMode; liveSourcesOnly?: boolean; tags?: string[]; projectId?: string; documents?: RunDocument[]; /** Phase 18: caller-minted session id (so a stream can be announced before the first persist). */ sessionId?: string; }

/** Thrown internally when `deps.signal` fires between steps. */
class RunCancelled extends Error { constructor() { super("research cancelled"); this.name = "RunCancelled"; } }
function emit(deps: ResearchEngineDeps, event: Parameters<RunEventSink>[0]): void { try { deps.onEvent?.(event); } catch { /* a slow listener never stops the run */ } }
function setStatus(deps: ResearchEngineDeps, s: ResearchSession, status: ResearchSession["status"]): void { s.status = status; emit(deps, { type: "status", status }); }
function checkCancelled(deps: ResearchEngineDeps): void { if (deps.signal?.aborted) throw new RunCancelled(); }

export function newSessionId(): string { return `r_${randomUUID().slice(0, 8)}`; }
export function newSession(topic: string, depth: ResearchDepth = "quick", mode: ResearchMode = depth, id = newSessionId()): ResearchSession {
  const now = Date.now();
  return { id, topic: topic.trim(), query: topic.trim(), mode, depth, status: "planning", sources: [], sourceSets: [], evidence: [], notes: [], claims: [], contradictions: [], reportVersions: [], refreshHistory: [], tags: [], liveSourcesOnly: false, createdAt: now, updatedAt: now };
}

function persist(deps: ResearchEngineDeps, s: ResearchSession): void { s.updatedAt = Date.now(); deps.store.saveResearch(s.id, s.topic, s.depth, s.status, JSON.stringify(s)); }

export async function runResearch(deps: ResearchEngineDeps, opts: RunOptions): Promise<ResearchSession> {
  const depth = opts.depth ?? (opts.mode === "deep" ? "deep" : opts.mode === "thorough" ? "thorough" : "quick");
  const mode = opts.mode ?? depth;
  const session = newSession(opts.topic, depth, mode, opts.sessionId && /^r_[a-z0-9]{8}$/.test(opts.sessionId) ? opts.sessionId : undefined);
  try {
    return await runResearchSteps(deps, opts, session, depth, mode);
  } catch (e) {
    if (deps.signal?.aborted || e instanceof RunCancelled) {
      // Cancelled between steps or mid-call (the abort reaches the model /
      // fetch sockets). Whatever was gathered stays in the persisted session.
      session.status = "stopped"; session.stopReason = "cancelled"; session.meter = deps.budget.meter();
      deps.say("⏹ cancelled");
      emit(deps, { type: "status", status: "stopped" });
      deps.audit?.("research.cancelled", { id: session.id, sources: session.sources.length });
      persist(deps, session);
      return session;
    }
    throw e;
  }
}

async function runResearchSteps(deps: ResearchEngineDeps, opts: RunOptions, session: ResearchSession, depth: ResearchDepth, mode: ResearchMode): Promise<ResearchSession> {
  const budgetCfg = DEPTH_BUDGETS[depth];
  session.liveSourcesOnly = Boolean(opts.liveSourcesOnly);
  session.tags = opts.tags ?? [];
  session.projectId = opts.projectId;
  deps.audit?.("research.start", { id: session.id, topic: session.topic, mode, depth });
  persist(deps, session);

  const llm: StructuredCallDeps = { provider: deps.provider, onUsage: (i, o) => deps.budget.record(i, o), signal: deps.signal };
  const searchReady = deps.search.available();
  if (!searchReady) deps.say(`⚠ Web search is unavailable. Add XR_SEARXNG host to egress allow-list.`);

  checkCancelled(deps);
  if (!deps.budget.allow()) return stop(deps, session);
  setStatus(deps, session, "planning");
  deps.say(`▸ planning (${mode}/${depth}) · ${deps.budget.meter()}`);
  session.plan = await makePlan(llm, session.topic, budgetCfg, mode);
  emit(deps, { type: "plan", objective: session.plan.objective, questions: session.plan.questions.map((q) => q.text), queries: queriesFromPlan(session.plan, budgetCfg.maxQueries).length });
  persist(deps, session);

  setStatus(deps, session, "discovering");
  const hitsByQuery: Array<{ query: string; hits: { title: string; url: string; snippet: string }[] }> = [];
  if (searchReady) {
    for (const query of queriesFromPlan(session.plan, budgetCfg.maxQueries)) {
      checkCancelled(deps);
      if (!deps.budget.allow()) return stop(deps, session);
      deps.say(`▸ searching "${query}"`);
      emit(deps, { type: "search", query, phase: "start" });
      const resp = await deps.search.search(query, budgetCfg.resultsPerQuery);
      if (resp.unavailableReason) deps.say(`  ⚠ ${resp.unavailableReason}`); else deps.say(`  ✓ ${resp.hits.length} hit(s)`);
      emit(deps, { type: "search", query, phase: "done", hits: resp.hits.length, unavailableReason: resp.unavailableReason });
      hitsByQuery.push({ query, hits: resp.hits });
      deps.audit?.("research.search", { id: session.id, query, hits: resp.hits.length });
    }
  }

  const directUrls = extractUrls(session.topic);
  for (const url of directUrls) hitsByQuery.unshift({ query: "direct-url", hits: [{ title: domainOf(url) || url, url, snippet: `User supplied URL: ${url}` }] });

  setStatus(deps, session, "ranking");
  const documents = documentSources(opts.documents ?? []);
  session.sources = [...documents, ...rankSources(hitsByQuery, budgetCfg.maxSources, documents.length + 1, session.topic)];
  session.sourceSets = [{ id: `set_${randomUUID().slice(0, 6)}`, name: "ranked", sourceIds: session.sources.map((s) => s.id), createdAt: Date.now() }];
  deps.say(`▸ ranked ${session.sources.length} source(s)`);
  emit(deps, { type: "sources", sources: session.sources.map(liteSource) });
  persist(deps, session);

  setStatus(deps, session, "fetching");
  await fetchTopSources(deps, session, budgetCfg.maxFetched);
  persist(deps, session);

  setStatus(deps, session, "extracting");
  const notes: Note[] = [];
  for (const src of session.sources) {
    checkCancelled(deps);
    if (!deps.budget.allow()) break;
    if (session.liveSourcesOnly && !src.fetched) continue;
    if (!src.fetched && session.sources.indexOf(src) >= budgetCfg.maxFetched + 2) continue;
    deps.say(`▸ extracting evidence from [${src.id}] ${src.domain}`);
    emit(deps, { type: "extract", sourceId: src.id, phase: "start" });
    let got = await extractFromSource(llm, session.topic, src, budgetCfg.maxEvidencePerSource);
    checkCancelled(deps);
    if (!got.length) got = deterministicExtract(session.topic, src, Math.min(3, budgetCfg.maxEvidencePerSource));
    notes.push(...got);
    deps.say(`  ✓ ${got.length} evidence block(s)`);
    emit(deps, { type: "extract", sourceId: src.id, phase: "done", notes: got.length });
  }
  session.notes = notes;
  session.evidence = notes;
  deps.say(`▸ evidence ledger: ${notes.length} block(s), ${notes.filter((n) => n.verified).length} verified`);
  persist(deps, session);

  setStatus(deps, session, "checking");
  setStatus(deps, session, "synthesizing");
  checkCancelled(deps);
  if (deps.budget.allow()) {
    const { synthesis, contradictions, claims } = await synthesize(llm, session.topic, session.plan.objective, session.sources, session.notes);
    checkCancelled(deps); // an aborted model call falls back to a deterministic synthesis — never present that as "done"
    session.synthesis = synthesis;
    session.summary = synthesis;
    session.finalReport = synthesis.report;
    session.contradictions = contradictions;
    session.claims = claims;
    if (session.mode === "compare") session.comparison = buildComparison(session);
    if (contradictions.length) deps.say(`  ⚠ ${contradictions.length} contradiction(s) detected`);
    emit(deps, { type: "contradictions", count: contradictions.length });
  } else {
    deps.say(`  ⏸ budget reached before synthesis — partial results saved.`);
    session.stopReason = deps.budget.reason();
    emit(deps, { type: "budget", meter: deps.budget.meter(), reason: session.stopReason });
  }

  session.status = session.synthesis ? "done" : "stopped";
  session.meter = deps.budget.meter();
  session.lastRefreshedAt = Date.now();
  deps.audit?.("research.done", { id: session.id, sources: session.sources.length, evidence: session.evidence.length, contradictions: session.contradictions.length });
  persist(deps, session);
  emit(deps, { type: "status", status: session.status });
  return session;
}

/** Phase 18: user documents enter the ledger already "fetched" — their text is the content. */
function documentSources(docs: RunDocument[]): Source[] {
  const now = Date.now();
  return docs
    .filter((d) => d.text?.trim())
    .slice(0, 20)
    .map((d, i) => {
      const id = `s${i + 1}`; // ranked web sources continue after the documents
      const name = d.name.trim().slice(0, 120) || `document ${i + 1}`;
      const domain = d.kind === "pdf" ? "local-pdf" : "local-file";
      const url = `local://${encodeURIComponent(name)}`;
      const text = d.text.slice(0, 60_000);
      const snippet = text.replace(/\s+/g, " ").slice(0, 200);
      return {
        id, title: name, url, domain, snippet, foundVia: d.kind === "pdf" ? "pdf-upload" : "local-file", type: "local" as const,
        trust: 0.7, relevance: 1, freshness: freshnessFromText(text.slice(0, 4000)), quality: 0.7,
        trustReason: d.kind === "pdf" ? "user-supplied PDF" : "user-supplied local file", rankingReason: "attached by the user",
        fetched: true, verified: true, content: text,
        metadata: { title: name, url, domain, type: "local" as const, snippet, foundVia: d.kind, discoveredAt: now, fetchedAt: now, contentLength: text.length },
        collectedAt: now,
      };
    });
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
  const documents = session.sources.filter((s) => s.type === "local").length;
  for (const src of session.sources.slice(0, maxFetched + documents)) {
    if (src.type === "local") continue; // user documents arrive with their text
    checkCancelled(deps);
    if (!deps.budget.allow()) break;
    deps.say(`▸ fetching [${src.id}] ${src.domain}`);
    emit(deps, { type: "fetch", sourceId: src.id, phase: "start" });
    const r = await deps.search.fetch(src.url);
    if (r.ok && r.text?.trim()) {
      src.fetched = true; src.verified = true; src.content = r.text; src.fetchError = undefined;
      const fresh = freshnessFromHeaders(r.lastModified, `${src.title} ${src.snippet} ${r.text}`);
      src.freshness = fresh; src.quality = Number(Math.max(src.quality, src.trust * 0.45 + src.relevance * 0.3 + fresh.score * 0.25).toFixed(3));
      src.metadata = { ...src.metadata, canonicalUrl: r.canonicalUrl, fetchedAt: Date.now(), lastVerifiedAt: Date.now(), httpStatus: r.status, contentType: r.contentType, contentLength: r.bytes ?? r.text.length, lastModified: r.lastModified } as any;
      deps.say(`  ✓ fetched ${r.text.length} chars · freshness ${fresh.label}`);
      emit(deps, { type: "fetch", sourceId: src.id, phase: "ok", chars: r.text.length, freshness: fresh.label });
    } else {
      src.fetched = false; src.verified = false; src.fetchError = r.reason ?? "unknown"; src.freshness = freshnessFromText(`${src.title} ${src.snippet}`); deps.say(`  ⚠ ${src.fetchError}`);
      emit(deps, { type: "fetch", sourceId: src.id, phase: "fail", error: src.fetchError });
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

function stop(deps: ResearchEngineDeps, s: ResearchSession): ResearchSession {
  const reason = deps.budget.reason();
  deps.say(`⏸ stopped — ${reason}`);
  s.status = "stopped"; s.stopReason = reason; s.meter = deps.budget.meter();
  emit(deps, { type: "budget", meter: s.meter, reason });
  emit(deps, { type: "status", status: "stopped" });
  persist(deps, s);
  return s;
}
