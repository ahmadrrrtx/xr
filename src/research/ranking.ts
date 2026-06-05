/**
 * XR — deterministic source ranking + dedupe (v0.7).
 *
 * Ranking is PURE and DETERMINISTIC: given the same inputs it always produces
 * the same scores. We do NOT ask an LLM to rank sources — that would be neither
 * repeatable nor auditable. Instead we use transparent heuristics and expose a
 * human-readable reason for every score (UX rule: source transparency).
 *
 * Trust is a heuristic prior on source QUALITY, not a claim of correctness.
 * It is intentionally conservative: unknown domains get a neutral-low score,
 * never a high one.
 */
import type { Source } from "./types.ts";
import type { SearchHit } from "./search.ts";

/** High-trust domain families (suffix match). Curated + conservative. */
const HIGH_TRUST: Array<{ suffix: string; reason: string }> = [
  { suffix: ".gov", reason: "government source" },
  { suffix: ".edu", reason: "academic source" },
  { suffix: "wikipedia.org", reason: "encyclopedic, cited" },
  { suffix: "arxiv.org", reason: "preprint research" },
  { suffix: "nature.com", reason: "peer-reviewed journal" },
  { suffix: "ieee.org", reason: "standards body / journal" },
  { suffix: "acm.org", reason: "academic / standards body" },
  { suffix: "who.int", reason: "international institution" },
  { suffix: "nih.gov", reason: "medical institution" },
  { suffix: "github.com", reason: "primary source / code" },
  { suffix: "developer.mozilla.org", reason: "authoritative docs" },
];

/** Medium-trust domain families. */
const MEDIUM_TRUST: Array<{ suffix: string; reason: string }> = [
  { suffix: "stackoverflow.com", reason: "community Q&A, voted" },
  { suffix: "reuters.com", reason: "established news" },
  { suffix: "apnews.com", reason: "established news" },
  { suffix: "bbc.com", reason: "established news" },
  { suffix: "theverge.com", reason: "tech press" },
  { suffix: "arstechnica.com", reason: "tech press" },
  { suffix: "techcrunch.com", reason: "tech press" },
  { suffix: ".org", reason: "non-profit / org" },
  { suffix: "medium.com", reason: "blog platform (mixed quality)" },
];

/** Low-trust signals (suffix or substring). Penalized, never excluded outright. */
const LOW_TRUST: Array<{ needle: string; reason: string }> = [
  { needle: "pinterest.", reason: "low-information aggregator" },
  { needle: "quora.com", reason: "unverified user answers" },
  { needle: "reddit.com", reason: "user forum (anecdotal)" },
  { needle: "facebook.com", reason: "social media" },
  { needle: "twitter.com", reason: "social media" },
  { needle: "x.com", reason: "social media" },
  { needle: "blogspot.", reason: "personal blog" },
  { needle: "wordpress.com", reason: "personal blog" },
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Score a single domain. Returns 0..1 trust + a reason. Pure + deterministic. */
export function scoreDomain(domain: string): { trust: number; reason: string } {
  if (!domain) return { trust: 0.2, reason: "no/invalid domain" };

  for (const { suffix, reason } of HIGH_TRUST) {
    if (domain === suffix.replace(/^\./, "") || domain.endsWith(suffix)) {
      return { trust: 0.9, reason };
    }
  }
  for (const { needle, reason } of LOW_TRUST) {
    if (domain.includes(needle)) return { trust: 0.25, reason };
  }
  for (const { suffix, reason } of MEDIUM_TRUST) {
    if (domain.endsWith(suffix)) return { trust: 0.6, reason };
  }
  // Unknown domain: neutral-low. We never assume an unknown source is reliable.
  return { trust: 0.4, reason: "unrecognized domain (treat with caution)" };
}

/**
 * Build ranked, de-duplicated Source[] from raw search hits.
 *
 * - Dedupe by domain (keep the highest-snippet-length hit per domain) AND by url.
 * - Score by domain trust, with a small bonus for snippet richness.
 * - Sort by trust desc, stable.
 * - Truncate to maxSources.
 */
export function rankSources(
  hitsByQuery: Array<{ query: string; hits: SearchHit[] }>,
  maxSources: number,
  idStart = 1,
): Source[] {
  const seenUrls = new Set<string>();
  const byDomain = new Map<string, Source>();
  let idx = idStart;

  for (const { query, hits } of hitsByQuery) {
    for (const hit of hits) {
      const url = (hit.url ?? "").trim();
      if (!url || seenUrls.has(url)) continue;
      const domain = domainOf(url);
      if (!domain) continue;
      seenUrls.add(url);

      const { trust, reason } = scoreDomain(domain);
      // Snippet-richness bonus: longer, content-bearing snippets rank a touch higher.
      const richness = Math.min(0.08, (hit.snippet?.length ?? 0) / 2500);
      const finalTrust = Math.min(1, Number((trust + richness).toFixed(3)));

      const candidate: Source = {
        id: `s${idx}`,
        title: hit.title || domain,
        url,
        domain,
        snippet: (hit.snippet ?? "").slice(0, 500),
        foundVia: query,
        trust: finalTrust,
        trustReason: reason,
        fetched: false,
        collectedAt: Date.now(),
      };

      const existing = byDomain.get(domain);
      if (!existing) {
        byDomain.set(domain, candidate);
        idx++;
      } else if ((candidate.snippet?.length ?? 0) > (existing.snippet?.length ?? 0)) {
        // Prefer the richer snippet from the same domain, but keep the first id.
        byDomain.set(domain, { ...candidate, id: existing.id });
      }
    }
  }

  const ranked = Array.from(byDomain.values()).sort((a, b) => b.trust - a.trust);

  // Re-assign clean sequential ids after sorting so the source list reads s1..sN
  // in trust order — easier to reference in the report.
  return ranked.slice(0, maxSources).map((s, i) => ({ ...s, id: `s${idStart + i}` }));
}
