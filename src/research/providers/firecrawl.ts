/**
 * XR Phase 10 — Firecrawl provider adapter.
 *
 * Firecrawl is a PROVIDER, not a security boundary. This adapter:
 *   · calls the Firecrawl API only through `guardedFetch` (egress allowlist +
 *     SSRF + redirect revalidation + byte cap), so the API endpoint itself is
 *     protected exactly like every other XR egress target;
 *   · validates every TARGET url it is asked to scrape/crawl/map/extract
 *     through `ctx.assertUrl` (centralized research URL guard) BEFORE sending;
 *   · never logs or returns the API key;
 *   · normalizes responses into XR's internal types (no Firecrawl types leak).
 *
 * Target: Firecrawl v1 REST (https://api.firecrawl.dev/v1/...). Verified
 * against the current public API reference (2026): /scrape, /search, /crawl
 * (async job + status), /map, /extract. Response parsing is defensive — the
 * adapter tolerates field-level differences and reports malformed responses
 * truthfully instead of guessing.
 */

import { guardedFetch } from "../../security/egress-proxy.ts";
import { hostAllowed } from "../../tools/egress.ts";
import { redactSecrets } from "../../platform/environment/privacy.ts";
import { type ResearchProvider, type ResearchProviderContext, type ResearchCrawlOptions, type ResearchExtractOptions, type ResearchMapOptions, type ResearchScrapeOptions, type ResearchSearchOptions } from "./types.ts";
import { ResearchProviderError, type ResearchCapabilityId, type ResearchCrawlHandle, type ResearchExtractResult, type ResearchMapResult, type ResearchProviderJobStatus, type ResearchScrapeResult, type ResearchSearchResult, type ResearchSource } from "../provider-types.ts";
import { assertResearchUrlShallow, hostnameOf } from "../url-guard.ts";
import { contentHash, wordCount } from "../citations.ts";

export interface FirecrawlConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  maxPages: number;
  maxDepth: number;
  maxConcurrency: number;
}

const DEFAULT_BASE_URL = "https://api.firecrawl.dev";

function classifyHttpError(providerId: string, status: number, body: string): ResearchProviderError {
  const snippet = redactSecrets(body.slice(0, 300));
  if (status === 401 || status === 403) return new ResearchProviderError("authentication_failure", providerId, "Firecrawl authentication failed — check FIRECRAWL_API_KEY", { statusCode: status });
  if (status === 429) return new ResearchProviderError("rate_limit", providerId, "Firecrawl rate limit reached", { statusCode: status });
  if (status === 408) return new ResearchProviderError("timeout", providerId, "Firecrawl request timed out", { statusCode: status });
  if (status >= 500) return new ResearchProviderError("unavailable", providerId, `Firecrawl unavailable (http ${status})`, { statusCode: status });
  if (status === 400 || status === 422) return new ResearchProviderError("invalid_request", providerId, `Firecrawl rejected the request: ${snippet || `http ${status}`}`, { statusCode: status });
  return new ResearchProviderError("unknown", providerId, `Firecrawl error (http ${status}): ${snippet}`, { statusCode: status });
}

function classifyConnError(providerId: string, message: string): ResearchProviderError {
  if (/timed out|timeout/i.test(message)) return new ResearchProviderError("timeout", providerId, message);
  return new ResearchProviderError("network_failure", providerId, redactSecrets(message));
}

/**
 * Shallow schema check for structured extraction. Does not silently accept
 * output that violates the requested schema: required keys must exist and
 * primitive types must roughly match. (Full JSON-Schema semantics are the
 * caller's business; this is the fail-closed provider-output gate.)
 */
export function shallowValidate(data: unknown, schema: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object") return { ok: true, errors };
  if (schema.type === "object") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, errors: ["extracted data is not an object"] };
    }
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in (data as Record<string, unknown>))) errors.push(`missing required field "${key}"`);
    }
    const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
    for (const [key, spec] of Object.entries(props)) {
      const value = (data as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const t = spec?.type;
      if (t === "string" && typeof value !== "string") errors.push(`field "${key}" should be a string`);
      else if (t === "number" && typeof value !== "number") errors.push(`field "${key}" should be a number`);
      else if (t === "boolean" && typeof value !== "boolean") errors.push(`field "${key}" should be a boolean`);
      else if (t === "array" && !Array.isArray(value)) errors.push(`field "${key}" should be an array`);
      else if (t === "object" && (value === null || typeof value !== "object" || Array.isArray(value))) errors.push(`field "${key}" should be an object`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function sourceIdFor(index: number): string {
  return `f${index + 1}`;
}

export class FirecrawlProvider implements ResearchProvider {
  readonly id = "firecrawl";
  readonly label = "Firecrawl";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly maxDepth: number;
  private readonly maxConcurrency: number;

  constructor(cfg: FirecrawlConfig) {
    this.baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs;
    this.maxPages = cfg.maxPages;
    this.maxDepth = cfg.maxDepth;
    this.maxConcurrency = cfg.maxConcurrency;
  }

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  capabilities(): ResearchCapabilityId[] {
    return ["search", "scrape", "crawl", "map", "extract"];
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return this.apiKey
      ? { ok: true, detail: `configured at ${this.baseUrl}` }
      : { ok: false, detail: "no API key configured (set FIRECRAWL_API_KEY)" };
  }

  private host(): string {
    return hostnameOf(this.baseUrl);
  }

  private async call(ctx: ResearchProviderContext, path: string, body: unknown): Promise<any> {
    const host = this.host();
    if (!hostAllowed(this.baseUrl, [...ctx.egressAllowlist])) {
      throw new ResearchProviderError("policy_denied", this.id, `Firecrawl host "${host}" is not in the egress allowlist`);
    }
    if (!this.apiKey) {
      throw new ResearchProviderError("authentication_failure", this.id, "Firecrawl API key not configured");
    }
    if (ctx.budget().exhausted) {
      throw new ResearchProviderError("budget_exhausted", this.id, ctx.budget().reason ?? "budget exhausted");
    }
    ctx.consume("request", 1);
    const res = await guardedFetch(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}`, "User-Agent": "XR-Agent/4.0" },
        body: JSON.stringify(body),
      },
      {
        allowlist: [host],
        allowedHosts: ctx.allowedHosts ?? [],
        timeoutMs: this.timeoutMs,
        maxBytes: ctx.limits.maxBytes,
        audit: (event, detail) => ctx.audit(`research.firecrawl.${event}`, detail),
      },
    );
    if (res.blocked) {
      throw new ResearchProviderError("policy_denied", this.id, res.reason ?? "Firecrawl egress blocked");
    }
    if (!res.ok || res.body == null) {
      throw classifyHttpError(this.id, res.status ?? 0, res.body ?? "");
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new ResearchProviderError("malformed_response", this.id, "Firecrawl returned non-JSON");
    }
  }

  private async callGet(ctx: ResearchProviderContext, path: string): Promise<any> {
    const host = this.host();
    if (!hostAllowed(this.baseUrl, [...ctx.egressAllowlist])) {
      throw new ResearchProviderError("policy_denied", this.id, `Firecrawl host "${host}" is not in the egress allowlist`);
    }
    if (!this.apiKey) throw new ResearchProviderError("authentication_failure", this.id, "Firecrawl API key not configured");
    ctx.consume("request", 1);
    const res = await guardedFetch(
      `${this.baseUrl}${path}`,
      { method: "GET", headers: { Authorization: `Bearer ${this.apiKey}`, "User-Agent": "XR-Agent/4.0" } },
      {
        allowlist: [host],
        allowedHosts: ctx.allowedHosts ?? [],
        timeoutMs: this.timeoutMs,
        maxBytes: ctx.limits.maxBytes,
        audit: (event, detail) => ctx.audit(`research.firecrawl.${event}`, detail),
      },
    );
    if (res.blocked) throw new ResearchProviderError("policy_denied", this.id, res.reason ?? "Firecrawl egress blocked");
    if (!res.ok || res.body == null) throw classifyHttpError(this.id, res.status ?? 0, res.body ?? "");
    try {
      return JSON.parse(res.body);
    } catch {
      throw new ResearchProviderError("malformed_response", this.id, "Firecrawl returned non-JSON");
    }
  }

  async search(query: string, opts: ResearchSearchOptions, ctx: ResearchProviderContext): Promise<ResearchSearchResult> {
    const json = await this.call(ctx, "/v1/search", { query: query.slice(0, 300), limit: Math.max(1, Math.min(20, opts.maxResults ?? 8)) });
    const data = Array.isArray(json?.data) ? json.data : [];
    const sources: ResearchSource[] = [];
    let i = 0;
    for (const r of data) {
      const url = typeof r?.url === "string" ? r.url : "";
      const check = assertResearchUrlShallow(url);
      if (!url || !check.ok) {
        ctx.audit("research.ssrf_blocked", { provider: this.id, url: url || "(empty)", reason: check.reason });
        continue;
      }
      sources.push({
        sourceId: sourceIdFor(i++),
        url: check.canonical ?? url,
        domain: check.host ?? hostnameOf(url),
        title: typeof r?.title === "string" ? r.title.slice(0, 400) : undefined,
        description: typeof r?.description === "string" ? r.description.slice(0, 700) : undefined,
        publishedAt: typeof r?.publishedDate === "string" ? r.publishedDate : undefined,
        retrievedAt: Date.now(),
        provider: this.id,
        verification: "unverified",
      });
    }
    return { query, sources, provider: this.id };
  }

  async scrape(url: string, opts: ResearchScrapeOptions, ctx: ResearchProviderContext): Promise<ResearchScrapeResult> {
    const check = await ctx.assertUrl(url);
    if (!check.ok) {
      ctx.audit("research.ssrf_blocked", { provider: this.id, url, reason: check.reason });
      throw new ResearchProviderError("ssrf_blocked", this.id, check.reason ?? "URL refused");
    }
    const json = await this.call(ctx, "/v1/scrape", {
      url,
      formats: opts.formats ?? ["markdown"],
      onlyMainContent: opts.onlyMainContent ?? true,
    });
    const data = json?.data ?? {};
    const markdown = typeof data.markdown === "string" ? data.markdown : typeof data.content === "string" ? data.content : "";
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const sourceUrl = typeof meta.sourceURL === "string" ? meta.sourceURL : typeof data.url === "string" ? data.url : url;
    const source: ResearchSource = {
      sourceId: "f1",
      url: sourceUrl,
      canonicalUrl: check.canonical,
      domain: check.host ?? hostnameOf(url),
      title: typeof meta.title === "string" ? meta.title : undefined,
      description: typeof meta.description === "string" ? meta.description : undefined,
      author: typeof meta.author === "string" ? meta.author : undefined,
      publishedAt: typeof meta.publishedDate === "string" ? meta.publishedDate : undefined,
      retrievedAt: Date.now(),
      provider: this.id,
      contentType: "text/markdown",
      contentHash: contentHash(markdown),
      wordCount: wordCount(markdown),
      language: typeof meta.language === "string" ? meta.language : undefined,
      verification: markdown ? "retrieved" : "failed",
      markdown: markdown.slice(0, ctx.limits.maxBytes),
      text: markdown.slice(0, ctx.limits.maxBytes),
      links: Array.isArray(data.links) ? (data.links as string[]).slice(0, 500) : undefined,
      failed: !markdown,
      error: markdown ? undefined : "no markdown content returned",
    };
    return { source, provider: this.id };
  }

  async map(url: string, opts: ResearchMapOptions, ctx: ResearchProviderContext): Promise<ResearchMapResult> {
    const check = await ctx.assertUrl(url);
    if (!check.ok) {
      ctx.audit("research.ssrf_blocked", { provider: this.id, url, reason: check.reason });
      throw new ResearchProviderError("ssrf_blocked", this.id, check.reason ?? "URL refused");
    }
    const json = await this.call(ctx, "/v1/map", { url, limit: Math.max(1, Math.min(5000, opts.limit ?? 100)) });
    const links = Array.isArray(json?.links) ? (json.links as string[]) : [];
    const sources: ResearchSource[] = [];
    let i = 0;
    for (const link of links) {
      const c = assertResearchUrlShallow(link);
      if (!link || !c.ok) continue;
      sources.push({
        sourceId: sourceIdFor(i++),
        url: c.canonical ?? link,
        domain: c.host ?? hostnameOf(link),
        retrievedAt: Date.now(),
        provider: this.id,
        verification: "unverified",
      });
    }
    return { root: url, sources, provider: this.id };
  }

  async crawl(url: string, opts: ResearchCrawlOptions, ctx: ResearchProviderContext): Promise<ResearchCrawlHandle> {
    const check = await ctx.assertUrl(url);
    if (!check.ok) {
      ctx.audit("research.ssrf_blocked", { provider: this.id, url, reason: check.reason });
      throw new ResearchProviderError("ssrf_blocked", this.id, check.reason ?? "URL refused");
    }
    const json = await this.call(ctx, "/v1/crawl", {
      url,
      limit: Math.max(1, Math.min(this.maxPages, ctx.limits.maxPages, opts.maxPages ?? this.maxPages)),
      maxDepth: Math.max(0, Math.min(this.maxDepth, ctx.limits.maxDepth, opts.maxDepth ?? this.maxDepth)),
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });
    const id = typeof json?.id === "string" ? json.id : "";
    if (!id) throw new ResearchProviderError("malformed_response", this.id, "Firecrawl crawl did not return a job id");
    return { jobId: id, state: "crawling" };
  }

  async getJob(jobId: string, ctx: ResearchProviderContext): Promise<ResearchProviderJobStatus> {
    const json = await this.callGet(ctx, `/v1/crawl/${encodeURIComponent(jobId)}`);
    const status = typeof json?.status === "string" ? json.status : "unknown";
    const state = status === "completed" ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "scraping";
    const data = Array.isArray(json?.data) ? json.data : [];
    const sources: ResearchSource[] = [];
    let i = 0;
    for (const item of data) {
      const meta = (item?.metadata ?? {}) as Record<string, unknown>;
      const markdown = typeof item?.markdown === "string" ? item.markdown : typeof item?.content === "string" ? item.content : "";
      const pageUrl = typeof meta.sourceURL === "string" ? meta.sourceURL : typeof item?.url === "string" ? item.url : "";
      const c = assertResearchUrlShallow(pageUrl);
      if (!pageUrl || !c.ok) continue;
      sources.push({
        sourceId: sourceIdFor(i++),
        url: c.canonical ?? pageUrl,
        domain: c.host ?? hostnameOf(pageUrl),
        title: typeof meta.title === "string" ? meta.title : undefined,
        description: typeof meta.description === "string" ? meta.description : undefined,
        publishedAt: typeof meta.publishedDate === "string" ? meta.publishedDate : undefined,
        retrievedAt: Date.now(),
        provider: this.id,
        contentType: "text/markdown",
        contentHash: contentHash(markdown),
        wordCount: wordCount(markdown),
        language: typeof meta.language === "string" ? meta.language : undefined,
        verification: markdown ? "retrieved" : "failed",
        markdown: markdown.slice(0, ctx.limits.maxBytes),
        text: markdown.slice(0, ctx.limits.maxBytes),
        links: Array.isArray(item?.links) ? (item.links as string[]).slice(0, 500) : undefined,
        failed: !markdown,
        error: markdown ? undefined : "no markdown content returned",
      });
    }
    return {
      jobId,
      state,
      discovered: Number.isFinite(Number(json?.total)) ? Number(json.total) : undefined,
      completed: Number.isFinite(Number(json?.completed)) ? Number(json.completed) : sources.length,
      failed: Number.isFinite(Number(json?.failed)) ? Number(json.failed) : undefined,
      sources,
      error: state === "failed" ? (typeof json?.error === "string" ? json.error : "crawl failed") : undefined,
    };
  }

  async cancelJob(jobId: string, ctx: ResearchProviderContext): Promise<void> {
    const host = this.host();
    if (!hostAllowed(this.baseUrl, [...ctx.egressAllowlist])) {
      throw new ResearchProviderError("policy_denied", this.id, `Firecrawl host "${host}" is not in the egress allowlist`);
    }
    if (!this.apiKey) throw new ResearchProviderError("authentication_failure", this.id, "Firecrawl API key not configured");
    ctx.consume("request", 1);
    const res = await guardedFetch(
      `${this.baseUrl}/v1/crawl/${encodeURIComponent(jobId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${this.apiKey}`, "User-Agent": "XR-Agent/4.0" } },
      { allowlist: [host], allowedHosts: ctx.allowedHosts ?? [], timeoutMs: this.timeoutMs, maxBytes: 64 * 1024, audit: (e, d) => ctx.audit(`research.firecrawl.${e}`, d) },
    );
    if (res.blocked) throw new ResearchProviderError("policy_denied", this.id, res.reason ?? "egress blocked");
    if (!res.ok) throw classifyHttpError(this.id, res.status ?? 0, res.body ?? "");
  }

  async extract(urls: string[], opts: ResearchExtractOptions, ctx: ResearchProviderContext): Promise<ResearchExtractResult> {
    const valid: string[] = [];
    for (const u of urls.slice(0, ctx.limits.maxPages)) {
      const check = await ctx.assertUrl(u);
      if (!check.ok) {
        ctx.audit("research.ssrf_blocked", { provider: this.id, url: u, reason: check.reason });
        continue;
      }
      valid.push(u);
    }
    if (!valid.length) throw new ResearchProviderError("invalid_request", this.id, "no valid URLs to extract from");
    const json = await this.call(ctx, "/v1/extract", { urls: valid, schema: opts.schema });
    const data = json?.data;
    const validation = shallowValidate(data, opts.schema);
    if (!validation.ok) {
      throw new ResearchProviderError("invalid_schema", this.id, `Firecrawl extraction violated the requested schema: ${validation.errors.join("; ")}`);
    }
    return { data, sources: [], provider: this.id };
  }
}
