/**
 * XR Phase 10 — DirectFetch research provider (scrape only).
 *
 * Fetches public web pages directly, with the SAME SSRF posture as the
 * centralized egress proxy: `assertResearchSafeUrl` (which composes
 * `normalizeHost` + `isBlockedAddress` + all-addresses DNS) is applied to the
 * initial URL and re-applied to every redirect hop. No raw `fetch` reaches a
 * private/link-local/metadata address.
 *
 * This is the single public-web fetch implementation — the Stage-7 research
 * engine's `directPublicFetch` (which carried a duplicate SSRF check) now
 * delegates here, so there is exactly ONE public-fetch + SSRF path.
 */

import { htmlToText } from "../../tools/egress.ts";
import { type ResearchProvider, type ResearchProviderContext, type ResearchScrapeOptions } from "./types.ts";
import { ResearchProviderError, type ResearchScrapeResult, type ResearchSource } from "../provider-types.ts";
import { assertResearchSafeUrl, hostnameOf } from "../url-guard.ts";
import { contentHash, wordCount } from "../citations.ts";

export interface PublicFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  resolve?: (host: string) => Promise<string[]>;
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export interface PublicFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  lastModified?: string;
  finalUrl?: string;
  body?: string;
  bytes?: number;
  reason?: string;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Fetch a PUBLIC web page with redirect revalidation through XR's URL guard.
 * Every hop (including redirects) is validated before it is requested.
 */
export async function fetchPublicUrl(rawUrl: string, opts: PublicFetchOptions = {}): Promise<PublicFetchResult> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolve = opts.resolve;

  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const check = await assertResearchSafeUrl(current, { allowedDomains: [], blockedDomains: [], resolve });
    if (!check.ok) {
      opts.audit?.("research.ssrf_blocked", { url: current, reason: check.reason });
      return { ok: false, reason: check.reason };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { signal: ctrl.signal, redirect: "manual", headers: { "User-Agent": "XR-Research/1.0 (+https://github.com/ahmadrrrtx/xr)", Accept: "text/html,text/plain,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5" } });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, reason: `fetch failed: ${(e as Error).message}` };
    }
    clearTimeout(timer);

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) return { ok: false, status: res.status, reason: `redirect limit (${maxRedirects}) exceeded` };
      try {
        current = new URL(location, current).toString();
      } catch {
        return { ok: false, status: res.status, reason: "unparseable redirect target" };
      }
      continue; // revalidate next hop
    }

    const contentType = res.headers.get("content-type") ?? "";
    const lastModified = res.headers.get("last-modified") ?? undefined;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > maxBytes) {
      return { ok: false, status: res.status, contentType, reason: `content too large (${len} bytes)` };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, contentType, lastModified, reason: `http ${res.status}` };
    }
    const raw = await res.text();
    if (raw.length > maxBytes) {
      return { ok: false, status: res.status, contentType, reason: `content exceeded ${maxBytes} bytes` };
    }
    const text = contentType.includes("html") ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim();
    opts.audit?.("research.public_fetch", { host: hostnameOf(current), status: res.status, bytes: text.length });
    return { ok: true, status: res.status, contentType, lastModified, finalUrl: current, body: text, bytes: text.length };
  }
}

export class DirectFetchProvider implements ResearchProvider {
  readonly id = "direct-fetch";
  readonly label = "Direct fetch";
  constructor(private opts: { timeoutMs?: number; maxBytes?: number } = {}) {}

  capabilities(): Array<"scrape"> {
    return ["scrape"];
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: "no external service required" };
  }

  async scrape(url: string, opts: ResearchScrapeOptions, ctx: ResearchProviderContext): Promise<ResearchScrapeResult> {
    if (ctx.budget().exhausted) {
      throw new ResearchProviderError("budget_exhausted", this.id, ctx.budget().reason ?? "budget exhausted");
    }
    const check = await ctx.assertUrl(url);
    if (!check.ok) {
      ctx.audit("research.ssrf_blocked", { provider: this.id, url, reason: check.reason });
      throw new ResearchProviderError("ssrf_blocked", this.id, check.reason ?? "URL refused");
    }
    ctx.consume("request", 1);
    const res = await fetchPublicUrl(url, {
      timeoutMs: this.opts.timeoutMs,
      maxBytes: Math.min(this.opts.maxBytes ?? DEFAULT_MAX_BYTES, ctx.limits.maxBytes),
      signal: ctx.signal,
      audit: ctx.audit,
    });
    if (!res.ok || res.body == null) {
      throw new ResearchProviderError("network_failure", this.id, res.reason ?? "fetch failed", { statusCode: res.status });
    }
    const body = res.body.slice(0, ctx.limits.maxBytes);
    const source: ResearchSource = {
      sourceId: "",
      url: res.finalUrl ?? url,
      canonicalUrl: check.canonical,
      domain: check.host ?? hostnameOf(url),
      title: undefined,
      text: body,
      retrievedAt: Date.now(),
      provider: this.id,
      contentType: res.contentType,
      contentHash: contentHash(body),
      wordCount: wordCount(body),
      verification: "retrieved",
    };
    return { source, provider: this.id };
  }

  search(): never {
    throw new ResearchProviderError("unsupported_capability", this.id, "direct fetch cannot search");
  }
  map(): never {
    throw new ResearchProviderError("unsupported_capability", this.id, "direct fetch cannot map sites");
  }
  async crawl(): Promise<never> {
    throw new ResearchProviderError("unsupported_capability", this.id, "direct fetch cannot crawl sites");
  }
  async getJob(): Promise<never> {
    throw new ResearchProviderError("unsupported_capability", this.id, "direct fetch has no jobs");
  }
  async cancelJob(): Promise<never> {
    throw new ResearchProviderError("unsupported_capability", this.id, "direct fetch has no jobs");
  }
  extract(): never {
    throw new ResearchProviderError("unsupported_capability", this.id, "direct fetch cannot extract structured data");
  }
}
