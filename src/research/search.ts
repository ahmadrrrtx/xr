/**
 * XR — research search capability.
 *
 * This is a thin, EGRESS-GATED adapter over the existing web tools. It is the
 * single seam research uses to touch the network, so:
 *   - all network access stays on the allow-list (exfiltration stays blocked)
 *   - we can swap/stub it in tests without a live network
 *
 * It NEVER fabricates results. If search is unavailable (host not allow-listed,
 * network down, SearXNG returns nothing) it returns an empty list and a reason,
 * and the caller degrades gracefully (UX rule: graceful fallback).
 */
import type { ToolContext } from "../core/types.ts";
import { webSearchTool, fetchUrlTool } from "../tools/web.ts";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Present when the search could not be performed (egress, network, empty). */
  unavailableReason?: string;
}

export interface FetchResponse {
  ok: boolean;
  /** Cleaned page text (truncated by the web tool). */
  text?: string;
  reason?: string;
}

/**
 * Capability interface so research can be tested with an in-memory fake.
 * The real implementation delegates to the egress-gated web tools.
 */
export interface SearchCapability {
  /** True when at least one search-capable host is on the egress allow-list. */
  available(): boolean;
  search(query: string, maxResults: number): Promise<SearchResponse>;
  fetch(url: string): Promise<FetchResponse>;
}

/** Hostname (no scheme, no port) of the configured SearXNG endpoint. */
function searxHost(): string {
  const raw = process.env.XR_SEARXNG ?? "https://searx.be";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // Best-effort fallback for bare hosts like "searx.be".
    return raw.replace(/^https?:\/\//, "").replace(/[:/].*$/, "").toLowerCase();
  }
}

/** Real search capability built on XR's existing egress-gated web tools. */
export class WebSearchCapability implements SearchCapability {
  constructor(private ctx: ToolContext) {}

  available(): boolean {
    const allow = this.ctx.egressAllowlist ?? [];
    if (allow.length === 0) return false;
    // The configured SearXNG host (or a subdomain) must be allow-listed.
    const host = searxHost();
    return allow.some(
      (d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()),
    );
  }

  async search(query: string, maxResults: number): Promise<SearchResponse> {
    if (!this.available()) {
      return { hits: [], unavailableReason: `search host "${searxHost()}" not in egress allow-list` };
    }
    const res = await webSearchTool.run({ query, max_results: maxResults }, this.ctx);
    if (!res.ok) return { hits: [], unavailableReason: res.output };

    // The web tool returns a formatted string; parse it back into structured hits.
    const hits = parseSearxOutput(res.output);
    if (hits.length === 0) return { hits: [], unavailableReason: "no results returned" };
    return { hits };
  }

  async fetch(url: string): Promise<FetchResponse> {
    const res = await fetchUrlTool.run({ url }, this.ctx);
    if (!res.ok) return { ok: false, reason: res.output };
    return { ok: true, text: String(res.output) };
  }
}

/**
 * Parse the human-formatted output of webSearchTool back into structured hits.
 * The tool emits blocks like:
 *   "1. Title\n   https://url\n   snippet"
 * separated by blank lines. We parse defensively.
 */
export function parseSearxOutput(output: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = output.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const title = lines[0].replace(/^\d+\.\s*/, "").trim();
    const url = lines.find((l) => /^https?:\/\//i.test(l)) ?? "";
    if (!url || !title) continue;
    const snippet = lines
      .slice(1)
      .filter((l) => !/^https?:\/\//i.test(l))
      .join(" ")
      .trim();
    hits.push({ title, url, snippet });
  }
  return hits;
}
