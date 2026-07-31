/**
 * XR 4.5 — Adapter: legacy `user_memory` rows → typed context items (§10.1).
 *
 * MIGRATION HONESTY RULE
 * ──────────────────────
 * Existing 4.4 memory records remain fully readable, but XR cannot reconstruct
 * how consent was actually given for them. Therefore:
 *
 *   • consent becomes `legacy_unknown` — NEVER `approved`.
 *   • trust is derived from the existing, honest `source` column.
 *   • provenance kind is mapped from `source`; no reference is invented.
 *
 * `legacy_unknown` IS retrievable (§10.4: new filters must fail closed for
 * unauthorized data but must not silently delete user data), and every
 * explanation flags it so the user knows to re-affirm or revoke.
 */

import {
  computeFreshness,
  emptyLinks,
  type ActorKind,
  type ContextItem,
  type ProvenanceKind,
  type SensitivityLevel,
  type TrustStatus,
} from "./types.ts";
import type { MemoryEntry, MemorySource } from "./memory/types.ts";

/** Honest mapping from the legacy `source` enum. Documented in the audit §9.4. */
const SOURCE_MAP: Record<
  MemorySource,
  { provenance: ProvenanceKind; actor: ActorKind; trust: TrustStatus }
> = {
  user: { provenance: "user_input", actor: "user", trust: "approved_memory" },
  chat: { provenance: "user_input", actor: "user", trust: "approved_memory" },
  voice: { provenance: "user_input", actor: "user", trust: "approved_memory" },
  research: { provenance: "research", actor: "system", trust: "generated_synthesis" },
  import: { provenance: "import", actor: "system", trust: "unknown" },
};

const FALLBACK = { provenance: "unknown" as ProvenanceKind, actor: "unknown" as ActorKind, trust: "unknown" as TrustStatus };

/**
 * Adapt one legacy memory entry into a context item.
 *
 * `exclusion` entries are mapped to `instruction` type with
 * `trusted_instruction` trust — they ARE a user policy directive, which is why
 * the audit flagged storing them as "memory" as a taxonomy error. They are
 * still never surfaced as recall (the memory store already filters them), so
 * this only makes the existing semantics explicit.
 */
export function memoryEntryToContextItem(entry: MemoryEntry, workspaceId: string): ContextItem {
  const map = SOURCE_MAP[entry.source] ?? FALLBACK;
  const isExclusion = entry.category === "exclusion";

  const freshness = computeFreshness({
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    sourceObservedAt: null,
    staleAfter: null,
    expiresAt: entry.expiresAt ?? null,
    supersededBy: null,
  });

  return {
    id: entry.id,
    version: 1,
    type: isExclusion ? "instruction" : "memory",
    content: entry.content,
    title: entry.content.length > 72 ? entry.content.slice(0, 71) + "…" : entry.content,
    scope: {
      workspaceId,
      projectScope: entry.scope,
      userId: "local",
    },
    trustStatus: isExclusion ? "trusted_instruction" : map.trust,
    // The core honesty rule — never fabricate consent.
    consentState: "legacy_unknown",
    consentActor: null,
    consentAt: null,
    provenanceKind: map.provenance,
    provenanceRef: null,
    actorKind: map.actor,
    actorName: null,
    freshness,
    uncertainty: {
      // Importance is a user ranking, not a truth claim — map it conservatively.
      confidence: entry.importance >= 4 ? "high" : entry.importance <= 2 ? "low" : "medium",
      contradictedBy: [],
      // We do not know whether the user re-confirmed a legacy entry.
      userConfirmed: false,
      openQuestions: [],
    },
    sensitivity: inferSensitivity(entry),
    retention: entry.expiresAt ? "ttl" : "durable",
    links: emptyLinks(),
    // Legacy vectors live in `user_memory.embedding`; the context index does not
    // own them, so this item is "none" from the context layer's perspective.
    indexState: "none",
    embeddingSpace: null,
    revokedAt: null,
    revokedReason: null,
    deletedAt: null,
    supersededBy: null,
    tags: [...entry.tags, "legacy:4.4"],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastAccessedAt: entry.lastAccessedAt ?? null,
    accessCount: entry.accessCount ?? 0,
  };
}

/**
 * Conservative sensitivity inference. Returns "unknown" unless there is a clear
 * signal — we never claim an item is "public" without evidence.
 */
function inferSensitivity(entry: MemoryEntry): SensitivityLevel {
  const t = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
  if (/\b(password|secret|api[_ -]?key|token|credential|private key|ssn|passport)\b/.test(t)) {
    return "secret";
  }
  if (/\b(personal|private|home address|phone number|medical|salary|bank)\b/.test(t)) {
    return "private";
  }
  return "unknown";
}

/** Map a context type back onto a legacy memory category, for write-through. */
export function contextTypeToMemoryCategory(
  type: ContextItem["type"],
  fallback: MemoryEntry["category"] = "fact",
): MemoryEntry["category"] {
  switch (type) {
    case "instruction": return "exclusion";
    case "memory": return fallback;
    case "knowledge": return "project";
    default: return fallback;
  }
}

export { SOURCE_MAP as LEGACY_SOURCE_MAP };
