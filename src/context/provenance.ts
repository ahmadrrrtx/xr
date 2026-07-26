/**
 * XR 4.5 — Provenance and evidence linkage (§7.7 / §8.6).
 *
 * A bounded, typed relationship model — deliberately NOT a knowledge graph.
 * The audit concluded a fixed set of typed pointers is sufficient: research
 * already models claims and contradictions, and a general graph would add
 * complexity without user value (§4 non-goals).
 */

import {
  boundText,
  clampTrustToProvenance,
  maxTrustForProvenance,
  type ContextItem,
  type ProvenanceKind,
  type ProvenanceRef,
  type TrustStatus,
} from "./types.ts";
import type { ContextRepository } from "./repository.ts";

/** A claim linked to the evidence that supports it. */
export interface EvidenceLink {
  claimId: string;
  claimText: string;
  /** Context item ids holding the supporting evidence. */
  evidenceItemIds: string[];
  /** Source references behind those items. */
  sources: ProvenanceRef[];
  /** Ids of items that contradict the claim. */
  contradictedBy: string[];
  /** Deterministic support assessment. */
  support: "supported" | "contested" | "weak" | "unverified";
}

export class ProvenanceService {
  constructor(private readonly repo: ContextRepository) {}

  /** Attach a typed reference to an item. Bounded per item. */
  link(itemId: string, ref: ProvenanceRef): boolean {
    return this.repo.addProvenance(itemId, ref) !== null;
  }

  /** Attach several references at once, respecting the per-item bound. */
  linkMany(itemId: string, refs: readonly ProvenanceRef[]): number {
    let n = 0;
    for (const r of refs) if (this.link(itemId, r)) n++;
    return n;
  }

  references(itemId: string): ProvenanceRef[] {
    return this.repo.getProvenance(itemId);
  }

  /** Everything that cites a given source (e.g. every use of a URL). */
  citedBy(kind: ProvenanceKind, ref: string): string[] {
    return this.repo.findByProvenanceRef(kind, ref);
  }

  /**
   * Build the evidence view for a research claim.
   * Deterministic support assessment:
   *   • contested — has contradicting items
   *   • supported — ≥2 source-linked evidence items
   *   • weak      — exactly 1
   *   • unverified — none
   */
  evidenceForClaim(claimId: string, claimText: string): EvidenceLink {
    const itemIds = this.repo.findByProvenanceRef("research", `claim:${claimId}`);
    const items = itemIds.map((id) => this.repo.getItem(id)).filter((x): x is ContextItem => x !== null);

    const sources: ProvenanceRef[] = [];
    const contradictedBy = new Set<string>();
    let sourceLinked = 0;

    for (const item of items) {
      if (item.trustStatus === "source_evidence") sourceLinked++;
      for (const c of item.uncertainty.contradictedBy) contradictedBy.add(c);
      for (const r of this.repo.getProvenance(item.id)) {
        if (!sources.some((s) => s.kind === r.kind && s.ref === r.ref)) sources.push(r);
      }
    }

    const support: EvidenceLink["support"] =
      contradictedBy.size > 0 ? "contested" : sourceLinked >= 2 ? "supported" : sourceLinked === 1 ? "weak" : "unverified";

    return {
      claimId,
      claimText: boundText(claimText, 512),
      evidenceItemIds: itemIds,
      sources,
      contradictedBy: [...contradictedBy],
      support,
    };
  }

  /**
   * Determine the honest trust status for content arriving from a given
   * provenance kind. Callers must use this rather than asserting trust
   * themselves — it is the anti-spoofing entry point.
   */
  trustFor(kind: ProvenanceKind, requested: TrustStatus = "unknown"): {
    trust: TrustStatus;
    ceiling: TrustStatus;
    clamped: boolean;
  } {
    const ceiling = maxTrustForProvenance(kind);
    const trust = clampTrustToProvenance(requested, kind);
    return { trust, ceiling, clamped: trust !== requested };
  }

  /**
   * A compact citation string for an item, safe to render in a prompt or UI.
   * Returns null when there is nothing citable — never fabricates a source.
   */
  citation(itemId: string): string | null {
    const item = this.repo.getItem(itemId);
    if (!item) return null;
    const refs = this.repo.getProvenance(itemId);
    if (refs.length === 0) {
      if (!item.provenanceRef) return null;
      return `${item.provenanceKind}: ${boundText(item.provenanceRef, 160)}`;
    }
    const parts = refs.slice(0, 3).map((r) => r.label ?? boundText(r.ref, 80));
    const more = refs.length > 3 ? ` (+${refs.length - 3} more)` : "";
    return `${parts.join("; ")}${more}`;
  }

  /**
   * Verify that a claimed provenance reference has not silently changed.
   * Returns "unknown" when no hash was recorded — never a false "verified".
   */
  verifyRef(
    ref: ProvenanceRef,
    currentContentHash: string | undefined,
  ): { status: "verified" | "changed" | "unknown"; detail: string } {
    if (!ref.contentHash) {
      return { status: "unknown", detail: "no content hash was recorded at capture time" };
    }
    if (!currentContentHash) {
      return { status: "unknown", detail: "current content is unavailable for comparison" };
    }
    return ref.contentHash === currentContentHash
      ? { status: "verified", detail: "content matches the hash recorded at capture" }
      : { status: "changed", detail: "source content changed since capture — treat as stale" };
  }
}

/**
 * Map an XR research `Source` onto a provenance reference.
 * Kept as a pure function so the research engine needs no new dependency.
 */
export function provenanceFromResearchSource(src: {
  id: string;
  url: string;
  title?: string;
  domain?: string;
  freshness?: { checkedAt: number };
}): ProvenanceRef {
  return {
    kind: "web",
    ref: src.url,
    label: src.title ?? src.domain ?? src.url,
    ...(src.freshness?.checkedAt ? { observedAt: src.freshness.checkedAt } : {}),
  };
}

/** Map an execution record onto a provenance reference. */
export function provenanceFromExecution(runId: string, capability?: string): ProvenanceRef {
  return {
    kind: "execution_record",
    ref: runId,
    ...(capability ? { label: capability } : {}),
  };
}

/** Map a file read onto a provenance reference. */
export function provenanceFromFile(path: string, mtime?: number, hash?: string): ProvenanceRef {
  return {
    kind: "file",
    ref: path,
    label: path.split("/").pop() ?? path,
    ...(mtime ? { observedAt: mtime } : {}),
    ...(hash ? { contentHash: hash } : {}),
  };
}
