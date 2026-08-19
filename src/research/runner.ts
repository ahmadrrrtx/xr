/**
 * XR Phase 10 — research operation runner.
 *
 * Executes a ResearchRequest through the provider pool with:
 *   · capability-aware provider selection + deterministic fallback
 *   · retry classification (retryable → next provider; non-retryable → stop)
 *   · per-run budget (pages/requests/bytes/duration) — truthful exhaustion
 *   · cooperative cancellation (AbortController → provider cancelJob)
 *   · domain policy + canonical dedupe on every source set
 *   · formal citations + provenance (sources → citations → job)
 *   · streaming progress events (canonical ResearchStreamEvent)
 *
 * No secret ever leaves the provider adapter; the runner never touches keys.
 */

import { ResearchRunBudget } from "./budget.ts";
import { buildCitations } from "./citations.ts";
import { researchMetrics } from "./observability.ts";
import { guardResearchContent } from "./content-guard.ts";
import { ResearchProviderError, type ResearchJob, type ResearchJobState, type ResearchLimits, type ResearchRequest, type ResearchSource, type ResearchStreamEvent } from "./provider-types.ts";
import { assertResearchSafeUrl, filterSourcesByDomainPolicy, hostnameOf } from "./url-guard.ts";
import { defaultResearchLimits, type ResearchJobRegistry } from "./jobs.ts";
import { safeProviderError, type ProviderPool, type ResearchProvider, type ResearchProviderContext } from "./providers/types.ts";

export interface RunnerDeps {
  pool: ProviderPool;
  registry: ResearchJobRegistry;
  egressAllowlist: string[];
  allowedHosts?: readonly string[];
  /** Workspace id recorded on jobs (overrides the registry default). */
  workspaceId?: string;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  onProgress?: (event: ResearchStreamEvent) => void;
  /** Poll interval for async provider jobs (crawl). */
  pollIntervalMs?: number;
  /** Injectable DNS resolver (tests); defaults to the egress proxy's resolver. */
  resolve?: (host: string) => Promise<string[]>;
  /**
   * When true, the operation is started in the background and the job is
   * returned immediately (state `queued`). Used by the daemon API so a crawl
   * never blocks the HTTP request; progress is observable via job polling or
   * the SSE stream.
   */
  async?: boolean;
}

const TERMINAL: ResearchJobState[] = ["completed", "partial", "cancelled", "failed", "budget_exhausted"];

function makeContext(
  deps: RunnerDeps,
  limits: ResearchLimits,
  budget: ResearchRunBudget,
  jobId: string,
  signal?: AbortSignal,
): ResearchProviderContext {
  return {
    signal,
    audit: deps.audit ?? (() => {}),
    egressAllowlist: deps.egressAllowlist,
    allowedHosts: deps.allowedHosts,
    limits,
    consume: (kind, amount) => budget.consume(kind, amount),
    budget: () => ({ exhausted: budget.exhausted(), reason: budget.reason() }),
    assertUrl: async (url, opts) => {
      const check = await assertResearchSafeUrl(
        url,
        { allowedDomains: limits.allowedDomains, blockedDomains: limits.blockedDomains, sameDomainOnly: limits.sameDomainOnly, includeSubdomains: limits.includeSubdomains, resolve: deps.resolve },
        opts,
      );
      if (!check.ok) {
        researchMetrics.ssrfBlocked();
        deps.audit?.("research.ssrf_blocked", { url, reason: check.reason });
        deps.onProgress?.({ type: "ssrf_blocked", jobId, url, reason: check.reason ?? "blocked" });
      }
      return check;
    },
  };
}

/** Assign stable ids + apply domain policy + dedupe + cap to limits. */
function normalizeSources(raw: ResearchSource[], limits: ResearchLimits, rootDomain?: string): ResearchSource[] {
  const { kept } = filterSourcesByDomainPolicy(raw, limits, rootDomain);
  return kept.slice(0, limits.maxPages).map((s, i) => ({ ...s, sourceId: `s${i + 1}` }));
}

/** Merge crawl pages across polls, deduped by canonical URL. */
function mergePages(acc: ResearchSource[], incoming: ResearchSource[]): ResearchSource[] {
  const seen = new Set(acc.map((s) => s.url));
  const out = [...acc];
  for (const s of incoming) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

function countBytes(sources: ResearchSource[]): number {
  return sources.reduce((sum, s) => sum + (s.markdown?.length ?? s.text?.length ?? 0), 0);
}

export async function runResearchOperation(deps: RunnerDeps, request: ResearchRequest): Promise<ResearchJob> {
  const limits = defaultResearchLimits(request.limits);
  const job = deps.registry.create(request, limits, deps.workspaceId);
  if (deps.async) {
    void runJob(deps, job, limits, request).catch((err) => {
      job.error = err instanceof Error ? err.message : String(err);
      job.state = "failed";
      deps.registry.update(job.id, { error: job.error, state: "failed" });
      deps.registry.finish(job.id);
    });
    return job;
  }
  return runJob(deps, job, limits, request);
}

async function runJob(deps: RunnerDeps, job: ResearchJob, limits: ResearchLimits, request: ResearchRequest): Promise<ResearchJob> {
  const signal = deps.registry.signal(job.id);
  const budget = new ResearchRunBudget({
    maxPages: limits.maxPages,
    maxRequests: limits.maxRequests,
    maxBytes: limits.maxBytes,
    maxDurationMs: limits.maxDurationMs,
    signal,
  });
  const ctx = makeContext(deps, limits, budget, job.id, signal);
  deps.onProgress?.({ type: "research_started", jobId: job.id, kind: request.intent });

  const setState = (state: ResearchJobState, message?: string) => {
    job.state = state;
    job.progress = { ...job.progress, state, message, elapsedMs: budget.elapsedMs(), updatedAt: Date.now() };
    deps.registry.update(job.id, { state, progress: job.progress });
  };

  try {
    switch (request.intent) {
      case "search":
        await runSearch(deps, job, budget, ctx, setState);
        break;
      case "scrape":
        await runScrape(deps, job, budget, ctx, setState);
        break;
      case "map":
        await runMap(deps, job, budget, ctx, setState);
        break;
      case "crawl":
        await runCrawl(deps, job, budget, ctx, setState);
        break;
      case "extract":
        await runExtract(deps, job, budget, ctx, setState);
        break;
    }
  } catch (err) {
    const e = err instanceof ResearchProviderError ? err : new ResearchProviderError("unknown", "runner", safeProviderError(err));
    if (signal?.aborted) {
      setState("cancelled", "cancelled by user");
    } else if (e.kind === "budget_exhausted") {
      researchMetrics.budgetExhausted(budget.reason());
      setState("budget_exhausted", budget.reason());
      deps.onProgress?.({ type: "budget_exhausted", jobId: job.id, reason: budget.reason() });
    } else {
      job.error = e.message;
      deps.registry.update(job.id, { error: e.message });
      setState("failed", e.message);
      deps.onProgress?.({ type: "research_error", jobId: job.id, code: e.kind, message: e.message });
    }
  }

  // Finalize: citations + progress + persistence + terminal event.
  job.citations = buildCitations(job.sources);
  job.budget = budget.state();
  deps.registry.update(job.id, { citations: job.citations, budget: job.budget, progress: job.progress });
  deps.registry.finish(job.id);
  deps.onProgress?.({ type: "research_completed", jobId: job.id, state: job.state, sources: job.sources.length, citations: job.citations.length });
  return job;
}

async function withFallback<T>(
  deps: RunnerDeps,
  job: ResearchJob,
  capability: ResearchRequest["intent"],
  budget: ResearchRunBudget,
  ctx: ResearchProviderContext,
  setState: (s: ResearchJobState, m?: string) => void,
  run: (provider: ResearchProvider) => Promise<T>,
): Promise<T> {
  const providers = deps.pool.forCapability(capability);
  if (providers.length === 0) {
    throw new ResearchProviderError("unsupported_capability", "none", `no configured provider supports ${capability} (Firecrawl off / SearXNG not allowlisted?)`);
  }
  let last: ResearchProviderError | undefined;
  for (const provider of providers) {
    if (budget.exhausted()) throw new ResearchProviderError("budget_exhausted", provider.id, budget.reason());
    job.provider = provider.id;
    deps.registry.update(job.id, { provider: provider.id });
    deps.onProgress?.({ type: "provider_selected", jobId: job.id, provider: provider.id, capability });
    try {
      const started = Date.now();
      const result = await run(provider);
      researchMetrics.providerLatency(provider.id, capability, Date.now() - started);
      deps.pool.recordSuccess(provider.id);
      return result;
    } catch (err) {
      const e = err instanceof ResearchProviderError ? err : new ResearchProviderError("unknown", provider.id, safeProviderError(err));
      deps.pool.recordFailure(provider.id, e.kind);
      last = e;
      if (!e.retryable) break; // never retry security/auth/schema failures
      deps.audit?.("research.provider_fallback", { capability, from: provider.id, reason: e.kind });
    }
  }
  throw last ?? new ResearchProviderError("unknown", "runner", "provider run failed");
}

async function runSearch(deps: RunnerDeps, job: ResearchJob, budget: ResearchRunBudget, ctx: ResearchProviderContext, setState: (s: ResearchJobState, m?: string) => void): Promise<void> {
  const query = (job.request.query ?? "").trim();
  if (!query) throw new ResearchProviderError("invalid_request", "runner", "search requires a query");
  setState("searching");
  deps.onProgress?.({ type: "search_started", jobId: job.id, query, provider: job.provider ?? "" });
  const result = await withFallback(deps, job, "search", budget, ctx, setState, (p) => p.search(query, { maxResults: job.limits.maxPages }, ctx));
  const sources = normalizeSources(result.sources, job.limits);
  budget.consume("page", sources.length);
  for (const s of sources) deps.onProgress?.({ type: "source_found", jobId: job.id, sourceId: s.sourceId, url: s.url, title: s.title });
  deps.registry.update(job.id, { sources, result: { query, sources, provider: result.provider } });
  job.sources = sources;
  setState("completed");
}

async function runScrape(deps: RunnerDeps, job: ResearchJob, budget: ResearchRunBudget, ctx: ResearchProviderContext, setState: (s: ResearchJobState, m?: string) => void): Promise<void> {
  const url = (job.request.urls?.[0] ?? "").trim();
  if (!url) throw new ResearchProviderError("invalid_request", "runner", "scrape requires a url");
  setState("scraping");
  // Validate once up front so a blocked target fails fast (never handed to a provider).
  const check = await ctx.assertUrl(url);
  if (!check.ok) throw new ResearchProviderError("ssrf_blocked", "runner", check.reason ?? "URL refused");
  const result = await withFallback(deps, job, "scrape", budget, ctx, setState, (p) => p.scrape(url, {}, ctx));
  const source: ResearchSource = { ...result.source, sourceId: "s1" };
  budget.consume("page", 1);
  budget.consume("bytes", countBytes([source]));
  if (source.markdown ?? source.text) {
    const scan = guardResearchContent("research.scrape", source.markdown ?? source.text ?? "");
    if (scan.flagged) {
      researchMetrics.injectionDetected("scrape");
      deps.audit?.("research.injection_detected", { url, signatures: scan.signatures });
    }
  }
  deps.registry.update(job.id, { sources: [source], result: { source, provider: result.provider } });
  job.sources = [source];
  deps.onProgress?.({ type: "page_scraped", jobId: job.id, sourceId: source.sourceId, url: source.url });
  setState("completed");
}

async function runMap(deps: RunnerDeps, job: ResearchJob, budget: ResearchRunBudget, ctx: ResearchProviderContext, setState: (s: ResearchJobState, m?: string) => void): Promise<void> {
  const url = (job.request.urls?.[0] ?? "").trim();
  if (!url) throw new ResearchProviderError("invalid_request", "runner", "map requires a url");
  setState("searching");
  const check = await ctx.assertUrl(url);
  if (!check.ok) throw new ResearchProviderError("ssrf_blocked", "runner", check.reason ?? "URL refused");
  const result = await withFallback(deps, job, "map", budget, ctx, setState, (p) => p.map(url, { limit: job.limits.maxPages }, ctx));
  const sources = normalizeSources(result.sources, job.limits, hostnameOf(url));
  budget.consume("page", sources.length);
  for (const s of sources) deps.onProgress?.({ type: "source_found", jobId: job.id, sourceId: s.sourceId, url: s.url });
  deps.registry.update(job.id, { sources, result: { root: url, sources, provider: result.provider } });
  job.sources = sources;
  setState("completed");
}

async function runCrawl(deps: RunnerDeps, job: ResearchJob, budget: ResearchRunBudget, ctx: ResearchProviderContext, setState: (s: ResearchJobState, m?: string) => void): Promise<void> {
  const url = (job.request.urls?.[0] ?? "").trim();
  if (!url) throw new ResearchProviderError("invalid_request", "runner", "crawl requires a url");
  setState("crawling");
  const check = await ctx.assertUrl(url);
  if (!check.ok) throw new ResearchProviderError("ssrf_blocked", "runner", check.reason ?? "URL refused");
  const rootDomain = hostnameOf(url);

  const handle = await withFallback(deps, job, "crawl", budget, ctx, setState, (p) => p.crawl(url, { maxPages: job.limits.maxPages, maxDepth: job.limits.maxDepth }, ctx));
  const provider = deps.pool.forCapability("crawl").find((p) => p.id === job.provider);
  if (!provider) throw new ResearchProviderError("unknown", "runner", "crawl provider lost");

  deps.registry.update(job.id, { result: { providerJobId: handle.jobId } });
  const pollMs = Math.max(250, deps.pollIntervalMs ?? 1000);
  let acc: ResearchSource[] = [];

  for (;;) {
    if (ctx.signal?.aborted) {
      await safeCancel(provider, handle.jobId, ctx);
      setState("cancelled", "cancelled by user");
      return;
    }
    if (budget.exhausted()) {
      await safeCancel(provider, handle.jobId, ctx);
      if (acc.length) {
        job.sources = acc.slice(0, job.limits.maxPages);
        deps.registry.update(job.id, { sources: job.sources });
        setState("budget_exhausted", budget.reason());
      } else {
        setState("budget_exhausted", budget.reason());
      }
      return;
    }

    const status = await provider.getJob(handle.jobId, ctx);
    const pages = normalizeSources(status.sources ?? [], job.limits, rootDomain);
    acc = mergePages(acc, pages);
    budget.consume("page", pages.length);
    budget.consume("bytes", countBytes(pages));
    job.progress = {
      ...job.progress,
      state: "crawling",
      discovered: status.discovered ?? acc.length,
      completed: status.completed ?? acc.length,
      failed: status.failed ?? 0,
      elapsedMs: budget.elapsedMs(),
      updatedAt: Date.now(),
    };
    deps.registry.update(job.id, { progress: job.progress });
    deps.onProgress?.({ type: "crawl_status", jobId: job.id, status: status.state, discovered: job.progress.discovered, completed: job.progress.completed, failed: job.progress.failed });

    if (status.state === "completed") {
      break;
    }
    if (status.state === "failed" || status.state === "cancelled") {
      if (acc.length) {
        job.sources = acc;
        deps.registry.update(job.id, { sources: job.sources });
        setState("partial", status.error ?? `crawl ${status.state} with partial results`);
      } else {
        setState("failed", status.error ?? `crawl ${status.state}`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  job.sources = acc.slice(0, job.limits.maxPages);
  // Content framing: crawled pages are untrusted data.
  let flagged = 0;
  for (const s of job.sources) {
    if (s.markdown ?? s.text) {
      const scan = guardResearchContent("research.crawl", s.markdown ?? s.text ?? "");
      if (scan.flagged) flagged++;
    }
  }
  if (flagged) {
    researchMetrics.injectionDetected("crawl");
    deps.audit?.("research.injection_detected", { url, count: flagged });
  }
  deps.registry.update(job.id, { sources: job.sources });
  setState("completed");
}

async function runExtract(deps: RunnerDeps, job: ResearchJob, budget: ResearchRunBudget, ctx: ResearchProviderContext, setState: (s: ResearchJobState, m?: string) => void): Promise<void> {
  const urls = (job.request.urls ?? []).map((u) => u.trim()).filter(Boolean);
  if (!urls.length) throw new ResearchProviderError("invalid_request", "runner", "extract requires at least one url");
  const schema = job.request.schema ?? {};
  setState("extracting");
  const result = await withFallback(deps, job, "extract", budget, ctx, setState, (p) => p.extract(urls, { schema }, ctx));
  deps.registry.update(job.id, { result: { data: result.data, provider: result.provider } });
  setState("completed");
}

async function safeCancel(provider: ResearchProvider, jobId: string, ctx: ResearchProviderContext): Promise<void> {
  try {
    await provider.cancelJob(jobId, ctx);
  } catch {
    /* best-effort cancel; the local job is already terminal */
  }
}
