/**
 * XR Phase 10 — SearXNG research provider (search only).
 *
 * SearXNG is a self-hostable meta-search engine. This adapter queries its
 * JSON API through the CENTRALIZED egress proxy (guardedFetch), reusing the
 * existing allowlist + SSRF boundary. Search results are untrusted data:
 * their URLs are shallow-validated (scheme + literal private-IP block) before
 * they surface; full DNS-level validation happens before any fetch.
 */

import { guardedFetch } from "../../security/egress-proxy.ts";
import { hostAllowed } from "../../tools/egress.ts";
import { type ResearchProvider, type ResearchProviderContext, type ResearchSearchOptions } from "./types.ts";
import { ResearchProviderError, type ResearchSearchResult, type ResearchSource } from "../provider-types.ts";
import { assertResearchUrlShallow, hostnameOf } from "../url-guard.ts";

const DEFAULT_SEARXNG = process.env.XR_SEARXNG ?? "https://searx.be";
const SEARX_TIMEOUT_MS = 15_000;
const SEARX_MAX_BYTES = 1024 * 1024;

function searxBase(): string {
  const raw = DEFAULT_SEARXNG.replace(/\/$/, "");
  return raw.endsWith("/search") ? raw.slice(0, -"/search".length) : raw;
}

export class SearxngProvider implements ResearchProvider {
  readonly id = "searxng";
  readonly label = "SearXNG";
  constructor(private baseUrl: string = searxBase()) {}

  capabilities(): Array<"search"> {
    return ["search"];
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      return { ok: true, detail: `configured base ${this.baseUrl}` };
    } catch {
      return { ok: false, detail: "unavailable" };
    }
  }

  async search(query: string, opts: ResearchSearchOptions, ctx: ResearchProviderContext): Promise<ResearchSearchResult> {
    if (!query.trim()) throw new ResearchProviderError("invalid_request", this.id, "empty query");
    const host = hostnameOf(this.baseUrl);
    if (!hostAllowed(this.baseUrl, [...ctx.egressAllowlist])) {
      throw new ResearchProviderError("policy_denied", this.id, `SearXNG host "${host}" is not in the egress allowlist`);
    }
    if (ctx.budget().exhausted) {
      throw new ResearchProviderError("budget_exhausted", this.id, ctx.budget().reason ?? "budget exhausted");
    }
    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query.slice(0, 300))}&format=json`;
    ctx.consume("request", 1);

    const res = await guardedFetch(
      endpoint,
      { headers: { "User-Agent": "XR-Agent/4.0", Accept: "application/json" } },
      {
        allowlist: [host],
        allowedHosts: ctx.allowedHosts ?? [],
        timeoutMs: SEARX_TIMEOUT_MS,
        maxBytes: SEARX_MAX_BYTES,
        audit: (event, detail) => ctx.audit(`research.searxng.${event}`, detail),
      },
    );
    if (res.blocked || !res.ok) {
      throw new ResearchProviderError(
        res.blocked ? "policy_denied" : "unavailable",
        this.id,
        res.reason ?? `search failed (status ${res.status})`,
        { statusCode: res.status },
      );
    }

    let json: any;
    try {
      json = JSON.parse(res.body ?? "{}");
    } catch {
      throw new ResearchProviderError("malformed_response", this.id, "SearXNG returned non-JSON");
    }

    const max = Math.max(1, Math.min(20, opts.maxResults ?? 8));
    const sources: ResearchSource[] = [];
    for (const r of (Array.isArray(json.results) ? json.results : []).slice(0, max)) {
      const url = typeof r?.url === "string" ? r.url : "";
      const check = assertResearchUrlShallow(url);
      if (!check.ok || !url) {
        ctx.audit("research.ssrf_blocked", { provider: this.id, url: url || "(empty)", reason: check.reason });
        continue;
      }
      sources.push({
        sourceId: "",
        url: check.canonical ?? url,
        domain: check.host ?? hostnameOf(url),
        title: typeof r?.title === "string" ? r.title.slice(0, 400) : undefined,
        description: typeof r?.content === "string" ? r.content.slice(0, 700) : undefined,
        retrievedAt: Date.now(),
        provider: this.id,
        verification: "unverified",
      });
    }
    return { query, sources, provider: this.id };
  }

  scrape(): never {
    throw new ResearchProviderError("unsupported_capability", this.id, "SearXNG cannot scrape pages");
  }
  map(): never {
    throw new ResearchProviderError("unsupported_capability", this.id, "SearXNG cannot map sites");
  }
  async crawl(): Promise<never> {
    throw new ResearchProviderError("unsupported_capability", this.id, "SearXNG cannot crawl sites");
  }
  async getJob(): Promise<never> {
    throw new ResearchProviderError("unsupported_capability", this.id, "SearXNG has no crawl jobs");
  }
  async cancelJob(): Promise<never> {
    throw new ResearchProviderError("unsupported_capability", this.id, "SearXNG has no crawl jobs");
  }
  extract(): never {
    throw new ResearchProviderError("unsupported_capability", this.id, "SearXNG cannot extract structured data");
  }
}
