/** XR Stage 7 — deterministic source ranking, freshness and quality scoring. */
import type { Source, SourceFreshness, SourceType } from "./types.ts";
import type { SearchHit } from "./search.ts";

const HIGH_TRUST: Array<{ suffix: string; type: SourceType; reason: string }> = [
  { suffix: ".gov", type: "official", reason: "government / official domain" },
  { suffix: ".edu", type: "academic", reason: "academic institution" },
  { suffix: "who.int", type: "official", reason: "international institution" },
  { suffix: "nih.gov", type: "official", reason: "medical institution" },
  { suffix: "un.org", type: "official", reason: "international institution" },
  { suffix: "oecd.org", type: "official", reason: "international institution" },
  { suffix: "worldbank.org", type: "official", reason: "international institution" },
  { suffix: "sec.gov", type: "official", reason: "regulatory filing source" },
  { suffix: "github.com", type: "primary", reason: "primary code/release source" },
  { suffix: "docs.github.com", type: "docs", reason: "official docs" },
  { suffix: "developer.mozilla.org", type: "docs", reason: "authoritative developer docs" },
  { suffix: "arxiv.org", type: "academic", reason: "research/preprint repository" },
  { suffix: "nature.com", type: "academic", reason: "scientific journal" },
  { suffix: "science.org", type: "academic", reason: "scientific journal" },
  { suffix: "ieee.org", type: "academic", reason: "standards/research body" },
  { suffix: "acm.org", type: "academic", reason: "research/professional body" },
];

const MEDIUM_TRUST: Array<{ suffix: string; type: SourceType; reason: string }> = [
  { suffix: "wikipedia.org", type: "reference", reason: "secondary reference; verify with cited sources" },
  { suffix: "reuters.com", type: "news", reason: "established news wire" },
  { suffix: "apnews.com", type: "news", reason: "established news wire" },
  { suffix: "bbc.com", type: "news", reason: "established news organization" },
  { suffix: "theverge.com", type: "news", reason: "tech press" },
  { suffix: "arstechnica.com", type: "news", reason: "tech press" },
  { suffix: "techcrunch.com", type: "news", reason: "tech press" },
  { suffix: "stackoverflow.com", type: "community", reason: "community Q&A; verify details" },
  { suffix: ".org", type: "reference", reason: "organization domain; mixed authority" },
];

const LOW_TRUST: Array<{ needle: string; type: SourceType; reason: string }> = [
  { needle: "reddit.com", type: "community", reason: "user forum/anecdotal" },
  { needle: "quora.com", type: "community", reason: "unverified user answers" },
  { needle: "facebook.com", type: "community", reason: "social media" },
  { needle: "twitter.com", type: "community", reason: "social media" },
  { needle: "x.com", type: "community", reason: "social media" },
  { needle: "pinterest.", type: "unknown", reason: "low-information aggregator" },
  { needle: "medium.com", type: "blog", reason: "blog platform; mixed quality" },
  { needle: "blogspot.", type: "blog", reason: "personal blog" },
  { needle: "wordpress.com", type: "blog", reason: "personal blog" },
];

export function domainOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function scoreDomain(domain: string): { trust: number; type: SourceType; reason: string } {
  if (!domain) return { trust: 0.2, type: "unknown", reason: "no/invalid domain" };
  for (const x of HIGH_TRUST) if (domain === x.suffix.replace(/^\./, "") || domain.endsWith(x.suffix)) return { trust: 0.9, type: x.type, reason: x.reason };
  for (const x of LOW_TRUST) if (domain.includes(x.needle)) return { trust: 0.25, type: x.type, reason: x.reason };
  for (const x of MEDIUM_TRUST) if (domain === x.suffix.replace(/^\./, "") || domain.endsWith(x.suffix)) return { trust: 0.62, type: x.type, reason: x.reason };
  return { trust: 0.42, type: "unknown", reason: "unrecognized domain (treat with caution)" };
}

export function freshnessFromText(text: string, now = Date.now()): SourceFreshness {
  const found = [...text.matchAll(/\b(20[0-3]\d|19\d\d)\b/g)].map((m) => Number(m[1])).filter(Boolean);
  const year = found.length ? Math.max(...found) : undefined;
  if (!year) return { checkedAt: now, score: 0.45, label: "unknown", reason: "no publication/update date detected" };
  const ageDays = Math.max(0, (new Date().getUTCFullYear() - year) * 365);
  const score = ageDays <= 370 ? 0.95 : ageDays <= 1100 ? 0.7 : 0.35;
  const label = score >= 0.9 ? "fresh" : score >= 0.6 ? "recent" : "stale";
  return { checkedAt: now, apparentDate: String(year), ageDays, score, label, reason: `detected apparent year ${year}` };
}

export function freshnessFromHeaders(lastModified?: string, fallbackText = "", now = Date.now()): SourceFreshness {
  if (lastModified) {
    const t = Date.parse(lastModified);
    if (Number.isFinite(t)) {
      const ageDays = Math.max(0, Math.round((now - t) / 86_400_000));
      const score = ageDays <= 45 ? 1 : ageDays <= 365 ? 0.82 : ageDays <= 1095 ? 0.58 : 0.28;
      const label = score >= 0.9 ? "fresh" : score >= 0.6 ? "recent" : "stale";
      return { checkedAt: now, lastModified, ageDays, score, label, reason: `Last-Modified header ${lastModified}` };
    }
  }
  return freshnessFromText(fallbackText, now);
}

export function rankSources(hitsByQuery: Array<{ query: string; hits: SearchHit[] }>, maxSources: number, idStart = 1, topic = ""): Source[] {
  const seenUrls = new Set<string>();
  const byDomain = new Map<string, Source>();
  const topicTerms = terms(topic);
  let idx = idStart;

  for (const { query, hits } of hitsByQuery) {
    for (const hit of hits) {
      const url = (hit.url ?? "").trim();
      const domain = domainOf(url);
      if (!url || !domain) continue;
      const key = canonicalKey(url);
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);

      const scored = scoreDomain(domain);
      const rel = relevance(`${hit.title} ${hit.snippet} ${query}`, topicTerms, query);
      const fresh = freshnessFromText(`${hit.title} ${hit.snippet}`);
      const snippetBonus = Math.min(0.06, (hit.snippet?.length ?? 0) / 5000);
      const trust = clamp(scored.trust + snippetBonus);
      const quality = clamp(trust * 0.5 + rel * 0.3 + fresh.score * 0.2);
      const source: Source = {
        id: `s${idx}`,
        title: hit.title || domain,
        url,
        domain,
        snippet: (hit.snippet ?? "").slice(0, 700),
        foundVia: query,
        type: scored.type,
        trust,
        relevance: rel,
        freshness: fresh,
        quality,
        trustReason: scored.reason,
        rankingReason: `quality=${quality.toFixed(2)} = trust ${trust.toFixed(2)}, relevance ${rel.toFixed(2)}, freshness ${fresh.score.toFixed(2)}`,
        fetched: false,
        verified: false,
        metadata: { title: hit.title || domain, url, domain, type: scored.type, snippet: (hit.snippet ?? "").slice(0, 700), foundVia: query, discoveredAt: Date.now() },
        collectedAt: Date.now(),
      };

      // Keep one best source per domain for broad source diversity and to avoid
      // one high-SEO site dominating the evidence base. The richer candidate
      // wins, but the first stable id is retained until final re-numbering.
      const prior = byDomain.get(domain);
      if (!prior) {
        byDomain.set(domain, source);
        idx++;
      } else if (source.quality > prior.quality || (source.quality === prior.quality && source.snippet.length > prior.snippet.length)) {
        byDomain.set(domain, { ...source, id: prior.id });
      }
    }
  }

  const ranked = Array.from(byDomain.values()).sort((a, b) => b.quality - a.quality || b.trust - a.trust);
  return ranked.slice(0, maxSources).map((s, i) => ({ ...s, id: `s${idStart + i}` }));
}

function terms(s: string): string[] { return s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2).slice(0, 20); }
function relevance(text: string, topicTerms: string[], query: string): number {
  const t = text.toLowerCase();
  const base = topicTerms.length ? topicTerms.filter((x) => t.includes(x)).length / topicTerms.length : 0.5;
  const qterms = terms(query);
  const q = qterms.length ? qterms.filter((x) => t.includes(x)).length / qterms.length : 0.5;
  return clamp(base * 0.55 + q * 0.45);
}
function canonicalKey(url: string): string { try { const u = new URL(url); u.hash = ""; return `${u.hostname}${u.pathname}${u.search}`.toLowerCase(); } catch { return url.toLowerCase(); } }
function clamp(n: number): number { return Number(Math.max(0, Math.min(1, n)).toFixed(3)); }
