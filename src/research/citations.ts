/**
 * XR Phase 10 — formal citation + source provenance.
 *
 * Replaces "title + url + snippet" with a structured, checkable citation.
 * Rules (never fabricate):
 *  - A citation is only built for a source XR actually saw (retrieved or
 *    verified); discovered-but-unfetched sources are NOT citable.
 *  - `retrievedAt` is XR's clock; `publishedAt` only when the source reports it.
 *  - The final report must answer "where did this claim come from?" by
 *    mapping sourceId → citation → source.
 */

import { createHash } from "node:crypto";
import type { ResearchCitation, ResearchSource, VerificationState } from "./provider-types.ts";

/** SHA-256 over the retrieved content (hex). Empty input => empty string. */
export function contentHash(text: string): string {
  const t = text ?? "";
  if (!t.trim()) return "";
  return createHash("sha256").update(t).digest("hex");
}

/** Rough word count of a text blob (whitespace tokens). */
export function wordCount(text: string): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** True when a source is citable (actually retrieved, not failed). */
export function isCitable(s: ResearchSource): boolean {
  return s.verification !== "unverified" && s.verification !== "failed";
}

/**
 * Build one citation from a source. Returns null when the source is not
 * citable — we never cite a source we did not retrieve.
 */
export function buildCitation(source: ResearchSource, opts: { index?: number; locator?: string } = {}): ResearchCitation | null {
  if (!source || !source.url || !isCitable(source)) return null;
  const citation: ResearchCitation = {
    id: `c${opts.index ?? 0}`,
    sourceId: source.sourceId,
    url: source.url,
    title: source.title,
    publishedAt: source.publishedAt,
    retrievedAt: source.retrievedAt,
    locator: opts.locator,
    excerpt: source.description?.slice(0, 300),
    contentHash: source.contentHash,
  };
  return citation;
}

/** Build the citation list for a run (indexed c1..cN, retrieved sources only). */
export function buildCitations(sources: ResearchSource[]): ResearchCitation[] {
  const out: ResearchCitation[] = [];
  let i = 1;
  for (const s of sources) {
    const c = buildCitation(s, { index: i });
    if (c) {
      out.push(c);
      i++;
    }
  }
  return out;
}

/**
 * Deterministic verification assignment. Honest about its limits:
 *  - retrieved → stays "retrieved" (fetched once, not yet cross-checked)
 *  - explicit conflicting pairs → "conflicting"
 *  - content-hash change on re-check → "stale"
 * It does NOT pretend to perform semantic fact-checking; cross-source
 * corroboration is the synthesizer's job and is surfaced there.
 */
export function markConflicting(sources: ResearchSource[], conflictingSourceIds: Array<[string, string]>): void {
  const ids = new Set(conflictingSourceIds.flat());
  for (const s of sources) {
    if (ids.has(s.sourceId) && s.verification !== "unverified" && s.verification !== "failed") {
      s.verification = "conflicting";
    }
  }
}

/** Mark a previously-retrieved source stale when its content changed. */
export function markStale(source: ResearchSource, previousHash?: string): void {
  if (!source.contentHash) return;
  if (previousHash && previousHash !== source.contentHash && source.verification !== "failed") {
    source.verification = "stale";
  }
}

/** Collapse a source's verification into a human label (never throws). */
export function verificationLabel(v: VerificationState | undefined): string {
  switch (v) {
    case "consistent":
      return "consistent";
    case "conflicting":
      return "conflicting";
    case "retrieved":
      return "retrieved";
    case "stale":
      return "stale";
    case "failed":
      return "failed";
    default:
      return "unverified";
  }
}
