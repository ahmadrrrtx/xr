/**
 * XR Stage 7 — live source discovery and safe fetching.
 *
 * Default network posture stays fail-closed through XR's egress allow-list. For
 * real research runs the user can explicitly pass --allow-public-web, which only
 * permits http(s) public web hosts and blocks localhost/private/link-local IPs.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ToolContext } from "../core/types.ts";
import { webSearchTool, fetchUrlTool } from "../tools/web.ts";
import { htmlToText, hostAllowed } from "../tools/egress.ts";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  unavailableReason?: string;
}

export interface FetchResponse {
  ok: boolean;
  text?: string;
  status?: number;
  contentType?: string;
  lastModified?: string;
  canonicalUrl?: string;
  bytes?: number;
  reason?: string;
}

export interface SearchCapability {
  available(): boolean;
  search(query: string, maxResults: number): Promise<SearchResponse>;
  fetch(url: string): Promise<FetchResponse>;
}

export interface WebSearchOptions {
  allowPublicWeb?: boolean;
  timeoutMs?: number;
  maxChars?: number;
}

function searxHost(): string {
  const raw = process.env.XR_SEARXNG ?? "https://searx.be";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/[:/].*$/, "").toLowerCase();
  }
}

export class WebSearchCapability implements SearchCapability {
  private timeoutMs: number;
  private maxChars: number;
  private allowPublicWeb: boolean;

  constructor(private ctx: ToolContext, opts: WebSearchOptions = {}) {
    this.allowPublicWeb = Boolean(opts.allowPublicWeb || process.env.XR_RESEARCH_ALLOW_PUBLIC_WEB === "1");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxChars = opts.maxChars ?? 24_000;
  }

  available(): boolean {
    const allow = this.ctx.egressAllowlist ?? [];
    if (allow.length === 0) return false;
    const host = searxHost();
    return allow.some((d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()));
  }

  async search(query: string, maxResults: number): Promise<SearchResponse> {
    const q = sanitizeQuery(query);
    if (!q) return { hits: [], unavailableReason: "empty query" };
    if (!this.available()) return { hits: [], unavailableReason: `search host "${searxHost()}" not in egress allow-list` };
    const res = await webSearchTool.run({ query: q, max_results: Math.max(1, Math.min(20, maxResults)) }, this.ctx);
    if (!res.ok) return { hits: [], unavailableReason: res.output };
    const hits = parseSearxOutput(res.output).filter((h) => isHttpUrl(h.url));
    if (hits.length === 0) return { hits: [], unavailableReason: "no results returned" };
    return { hits };
  }

  async fetch(url: string): Promise<FetchResponse> {
    if (!isHttpUrl(url)) return { ok: false, reason: "only http(s) urls are allowed" };

    // Normal XR tool path: egress allow-list only.
    if (hostAllowed(url, this.ctx.egressAllowlist ?? [])) {
      const res = await fetchUrlTool.run({ url }, this.ctx);
      if (!res.ok) return { ok: false, reason: res.output };
      return { ok: true, text: String(res.output), bytes: String(res.output).length, lastModified: undefined };
    }

    // Explicit research-only public web path.
    if (!this.allowPublicWeb) {
      return { ok: false, reason: "blocked by egress allow-list (rerun with --allow-public-web to fetch public web pages)" };
    }
    return directPublicFetch(url, this.timeoutMs, this.maxChars, this.ctx.audit);
  }
}

export function parseSearxOutput(output: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = output.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const title = lines[0].replace(/^\d+\.\s*/, "").trim();
    const url = lines.find((l) => /^https?:\/\//i.test(l)) ?? "";
    if (!url || !title) continue;
    const snippet = lines.slice(1).filter((l) => !/^https?:\/\//i.test(l)).join(" ").trim();
    hits.push({ title, url, snippet });
  }
  return dedupeHits(hits);
}

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)\]}>'"]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (isHttpUrl(url) && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export function sanitizeQuery(q: string): string {
  return q.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    const key = normalizeUrl(h.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...h, snippet: (h.snippet ?? "").slice(0, 700) });
  }
  return out;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function directPublicFetch(
  url: string,
  timeoutMs: number,
  maxChars: number,
  audit?: (event: string, detail: Record<string, unknown>) => void,
): Promise<FetchResponse> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "invalid url" };
  }
  const hostCheck = await assertPublicHostname(u.hostname);
  if (!hostCheck.ok) return { ok: false, reason: hostCheck.reason };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "XR-Research/1.0 (+https://github.com/ahmadrrrtx/xr)",
        Accept: "text/html,text/plain,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
      },
    });
    const finalUrl = new URL(res.url);
    const finalHostCheck = await assertPublicHostname(finalUrl.hostname);
    if (!finalHostCheck.ok) return { ok: false, status: res.status, reason: `blocked redirect: ${finalHostCheck.reason}` };
    const contentType = res.headers.get("content-type") ?? "";
    const lastModified = res.headers.get("last-modified") ?? undefined;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > maxChars * 8) {
      return { ok: false, status: res.status, contentType, lastModified, reason: `content too large (${len} bytes)` };
    }
    if (!res.ok) return { ok: false, status: res.status, contentType, lastModified, reason: `http ${res.status}` };
    const raw = await res.text();
    const text = contentType.includes("html") ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim();
    const clipped = text.slice(0, maxChars);
    audit?.("research.public_fetch", { host: u.hostname, status: res.status, bytes: clipped.length });
    return { ok: true, text: clipped, status: res.status, contentType, lastModified, canonicalUrl: res.url, bytes: clipped.length };
  } catch (e) {
    return { ok: false, reason: `fetch failed: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function assertPublicHostname(hostname: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return { ok: false, reason: "blocked local hostname" };
  const directIp = isIP(h);
  if (directIp) return isPublicIp(h) ? { ok: true } : { ok: false, reason: "blocked private/local IP" };

  try {
    const records = await lookup(h, { all: true, verbatim: true });
    if (!records.length) return { ok: false, reason: "DNS lookup returned no addresses" };
    for (const r of records) {
      if (!isPublicIp(r.address)) return { ok: false, reason: `DNS resolves to private/local IP (${r.address})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed: ${(e as Error).message}` };
  }
}

function isPublicIp(ip: string): boolean {
  return isIP(ip) === 4 ? isPublicIPv4(ip) : isPublicIPv6(ip);
}

function isPublicIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false; // carrier-grade NAT
  if (p[0] === 169 && p[1] === 254) return false;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
  if (p[0] === 192 && p[1] === 168) return false;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return false;
  if (p[0] >= 224) return false;
  return true;
}

function isPublicIPv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return false;
  if (h.startsWith("fc") || h.startsWith("fd")) return false; // unique local
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return false; // link-local
  if (h.startsWith("ff")) return false; // multicast
  return true;
}
