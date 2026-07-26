/**
 * XR 4.5 — Knowledge and Context OS: the shared context vocabulary.
 *
 * This file is intentionally dependency-free (no store, no provider, no UI) so
 * every layer speaks one context language.
 *
 * THE CENTRAL RULE
 * ────────────────
 *   Memory is context, not authority.
 *
 * A retrieved item NEVER becomes an instruction merely because it was stored or
 * ranked highly. Authority lives in exactly one place: `ContextType.instruction`
 * items whose `trustStatus` is `trusted_instruction`, and those can only be
 * created by XR code or an explicit user policy action — never by retrieval.
 *
 * Design rules applied here (§7.2):
 *   • Unknown is a distinct value, never a synonym for approved/true/false.
 *   • No field exists that cannot be populated and enforced.
 *   • Every durable item is typed, scoped, sourced, dated, and revocable.
 */

// ── 1. Taxonomy (§7.1) ─────────────────────────────────────────────────────

/**
 * The seven context classes. These are NOT interchangeable and must never be
 * collapsed into one generic "memory" bucket.
 */
export const CONTEXT_TYPES = [
  /** System/user/policy directive that MAY influence behavior. Authority lives here. */
  "instruction",
  /** User- or system-approved durable information, with consent + revocation. */
  "memory",
  /** Organized project/domain/workspace information. Retrievable, never authoritative. */
  "knowledge",
  /** Source-linked material supporting a claim, decision, or research result. */
  "evidence",
  /** A generated or observed durable output (file, report, dataset, record ref). */
  "artifact",
  /** Transient or checkpointed context for the current task/session. */
  "task_context",
  /** External/tool/model text not yet trusted or approved. Always quarantined. */
  "untrusted",
] as const;

export type ContextType = (typeof CONTEXT_TYPES)[number];

export function isContextType(v: string): v is ContextType {
  return (CONTEXT_TYPES as readonly string[]).includes(v);
}

/**
 * Types that may EVER carry authority. Deterministic, not heuristic.
 * Used by the injection layer to decide instruction-channel eligibility.
 */
const AUTHORITY_ELIGIBLE_TYPES: ReadonlySet<ContextType> = new Set<ContextType>(["instruction"]);

export function typeMayCarryAuthority(t: ContextType): boolean {
  return AUTHORITY_ELIGIBLE_TYPES.has(t);
}

// ── 2. Trust (§9.3) ────────────────────────────────────────────────────────

/**
 * Trust status affects injection formatting AND authority — not just a UI label.
 * Ordered from most to least privileged.
 */
export const TRUST_STATUSES = [
  /** XR-owned or explicit user policy. The only status that may direct behavior. */
  "trusted_instruction",
  /** User consented to retain this. Data, not a command. */
  "approved_memory",
  /** Source-linked evidence with a provenance reference. Data + citation. */
  "source_evidence",
  /** Produced by a model. Never a user fact. */
  "generated_synthesis",
  /** External document, web, tool, MCP, or plugin content. Hard-quarantined. */
  "untrusted_external",
  /** Trust could not be established. Treated as untrusted for authority purposes. */
  "unknown",
] as const;

export type TrustStatus = (typeof TRUST_STATUSES)[number];

export function isTrustStatus(v: string): v is TrustStatus {
  return (TRUST_STATUSES as readonly string[]).includes(v);
}

/**
 * DETERMINISTIC authority gate. The single function that decides whether an
 * item may occupy the instruction channel of a prompt.
 *
 * Both conditions must hold — the type must be authority-eligible AND the trust
 * status must be `trusted_instruction`. No score, no similarity, no model
 * classification can widen this.
 */
export function mayActAsInstruction(type: ContextType, trust: TrustStatus): boolean {
  return typeMayCarryAuthority(type) && trust === "trusted_instruction";
}

/** Content that must always be delimited and never presented as a directive. */
export function requiresQuarantine(trust: TrustStatus): boolean {
  return trust === "untrusted_external" || trust === "unknown";
}

// ── 3. Consent (§7.6) ──────────────────────────────────────────────────────

export const CONSENT_STATES = [
  /** Explicitly excluded from retention (a do-not-remember rule matched). */
  "not_eligible",
  /** Retention proposed; awaiting an explicit user decision. Not yet durable memory. */
  "proposed",
  /** User approved retention. */
  "approved",
  /** Approved, but only within a narrower scope than requested. */
  "limited",
  /** Consent had a validity window that has passed. */
  "expired",
  /** User withdrew consent. Excluded from all future retrieval. */
  "revoked",
  /** Hard-deleted; row retained only as a tombstone where required for audit. */
  "deleted",
  /** Held pending review (e.g. poisoning signature detected). Never retrieved. */
  "quarantined",
  /**
   * Pre-4.5 record whose real consent history cannot be reconstructed.
   * NEVER upgrade this to `approved` during migration (§10.1).
   */
  "legacy_unknown",
] as const;

export type ConsentState = (typeof CONSENT_STATES)[number];

export function isConsentState(v: string): v is ConsentState {
  return (CONSENT_STATES as readonly string[]).includes(v);
}

/**
 * Consent states that permit an item to be retrieved for injection.
 * `legacy_unknown` IS retrievable (§10.1/§10.4: never silently delete user
 * data) but is flagged as legacy in every explanation.
 */
const RETRIEVABLE_CONSENT: ReadonlySet<ConsentState> = new Set<ConsentState>([
  "approved",
  "limited",
  "legacy_unknown",
]);

export function consentAllowsRetrieval(c: ConsentState): boolean {
  return RETRIEVABLE_CONSENT.has(c);
}

/** Is this consent state terminal (no further retrieval, ever)? */
export function consentIsTerminal(c: ConsentState): boolean {
  return c === "revoked" || c === "deleted";
}

// ── 4. Provenance (§7.7) ───────────────────────────────────────────────────

export const PROVENANCE_KINDS = [
  "user_input",
  "file",
  "web",
  "search_result",
  "tool_output",
  "mcp_output",
  "plugin_output",
  "skill_output",
  "model_synthesis",
  "research",
  "business_record",
  "execution_record",
  "artifact",
  "import",
  "system",
  "unknown",
] as const;

export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export function isProvenanceKind(v: string): v is ProvenanceKind {
  return (PROVENANCE_KINDS as readonly string[]).includes(v);
}

/** Who produced/asserted this item. */
export const ACTOR_KINDS = ["user", "agent", "system", "plugin", "mcp", "model", "unknown"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * A typed, verifiable pointer back to where an item came from.
 * This is a bounded relationship model — deliberately NOT a knowledge graph
 * (§7.7 / §4 non-goals).
 */
export interface ProvenanceRef {
  /** What kind of thing is referenced. */
  kind: ProvenanceKind;
  /**
   * The reference itself: a URL, absolute/relative file path, run id,
   * checkpoint id, research claim id, artifact id, or business record id.
   * Never a secret and never raw content.
   */
  ref: string;
  /** Optional human label for display (e.g. page title, file basename). */
  label?: string;
  /** When the SOURCE was observed (world time), not when the row was written. */
  observedAt?: number;
  /**
   * Optional content digest of the referenced material at observation time,
   * so a later change can be detected honestly.
   */
  contentHash?: string;
}

/**
 * Trust that a provenance kind confers BY DEFAULT. Deterministic policy — this
 * is the anti-spoofing anchor. A caller can never claim a higher trust than its
 * provenance kind allows (see `clampTrustToProvenance`).
 */
const PROVENANCE_MAX_TRUST: Record<ProvenanceKind, TrustStatus> = {
  user_input: "approved_memory",
  file: "source_evidence",
  web: "untrusted_external",
  search_result: "untrusted_external",
  tool_output: "untrusted_external",
  mcp_output: "untrusted_external",
  plugin_output: "untrusted_external",
  skill_output: "untrusted_external",
  model_synthesis: "generated_synthesis",
  research: "source_evidence",
  business_record: "source_evidence",
  execution_record: "source_evidence",
  artifact: "source_evidence",
  import: "unknown",
  system: "trusted_instruction",
  unknown: "unknown",
};

const TRUST_RANK: Record<TrustStatus, number> = {
  trusted_instruction: 5,
  approved_memory: 4,
  source_evidence: 3,
  generated_synthesis: 2,
  untrusted_external: 1,
  unknown: 0,
};

export function trustRank(t: TrustStatus): number {
  return TRUST_RANK[t] ?? 0;
}

/** The highest trust a given provenance kind may ever confer. */
export function maxTrustForProvenance(kind: ProvenanceKind): TrustStatus {
  return PROVENANCE_MAX_TRUST[kind] ?? "unknown";
}

/**
 * ANTI-SPOOFING: clamp a requested trust status down to what the provenance
 * kind actually supports. Web content asking to be `trusted_instruction`
 * becomes `untrusted_external`. Deterministic; no model involved.
 */
export function clampTrustToProvenance(requested: TrustStatus, kind: ProvenanceKind): TrustStatus {
  const ceiling = maxTrustForProvenance(kind);
  return trustRank(requested) > trustRank(ceiling) ? ceiling : requested;
}

// ── 5. Freshness (§9.4) ────────────────────────────────────────────────────

export const FRESHNESS_LABELS = ["fresh", "recent", "aging", "stale", "expired", "unknown"] as const;
export type FreshnessLabel = (typeof FRESHNESS_LABELS)[number];

export interface FreshnessState {
  label: FreshnessLabel;
  /** When the row was created. */
  createdAt: number;
  /** When the row last changed. */
  updatedAt: number;
  /** When the underlying SOURCE was observed in the world (if known). */
  sourceObservedAt?: number | null;
  /** Soft staleness boundary — after this the item is labelled stale, not deleted. */
  staleAfter?: number | null;
  /** Hard expiry — after this the item is not retrievable and may be pruned. */
  expiresAt?: number | null;
  /** Item id that replaced this one (correction lineage). */
  supersededBy?: string | null;
  /** Human-readable reason for the label. */
  reason: string;
}

const DAY_MS = 86_400_000;

/**
 * Deterministic freshness computation. No model, no heuristic tuning knobs
 * beyond the documented day thresholds.
 */
export function computeFreshness(
  input: {
    createdAt: number;
    updatedAt: number;
    sourceObservedAt?: number | null;
    staleAfter?: number | null;
    expiresAt?: number | null;
    supersededBy?: string | null;
  },
  now: number = Date.now(),
): FreshnessState {
  const base: Omit<FreshnessState, "label" | "reason"> = {
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    sourceObservedAt: input.sourceObservedAt ?? null,
    staleAfter: input.staleAfter ?? null,
    expiresAt: input.expiresAt ?? null,
    supersededBy: input.supersededBy ?? null,
  };

  if (typeof input.expiresAt === "number" && input.expiresAt <= now) {
    return { ...base, label: "expired", reason: "past hard expiry" };
  }
  if (input.supersededBy) {
    return { ...base, label: "stale", reason: `superseded by ${input.supersededBy}` };
  }
  if (typeof input.staleAfter === "number" && input.staleAfter <= now) {
    return { ...base, label: "stale", reason: "past declared staleness boundary" };
  }

  // Age is measured from the SOURCE observation when known — that is when the
  // world was actually sampled — otherwise from the last row update.
  const anchor = input.sourceObservedAt ?? input.updatedAt;
  const ageDays = Math.max(0, (now - anchor) / DAY_MS);
  const via = input.sourceObservedAt ? "source observed" : "last updated";

  if (ageDays <= 7) return { ...base, label: "fresh", reason: `${via} ${Math.round(ageDays)}d ago` };
  if (ageDays <= 30) return { ...base, label: "recent", reason: `${via} ${Math.round(ageDays)}d ago` };
  if (ageDays <= 180) return { ...base, label: "aging", reason: `${via} ${Math.round(ageDays)}d ago` };
  return { ...base, label: "stale", reason: `${via} ${Math.round(ageDays)}d ago` };
}

/** Freshness labels that block automatic retrieval entirely. */
export function freshnessBlocksRetrieval(label: FreshnessLabel): boolean {
  return label === "expired";
}

// ── 6. Confidence (§9.5) ───────────────────────────────────────────────────

/**
 * Confidence is NOT truth. It describes how much support an item has — never
 * whether it is correct. Kept as a coarse enum on purpose so a float score can
 * never be mistaken for factual authority.
 */
export const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export function isConfidenceLevel(v: string): v is ConfidenceLevel {
  return (CONFIDENCE_LEVELS as readonly string[]).includes(v);
}

export interface UncertaintyState {
  /** Confidence in the item's own content. */
  confidence: ConfidenceLevel;
  /** Item ids that contradict this one. Presence forces honest reporting. */
  contradictedBy: string[];
  /** True when a human explicitly confirmed the content. */
  userConfirmed: boolean;
  /** Open questions attached to the item (preserved through compression). */
  openQuestions: string[];
}

export function emptyUncertainty(confidence: ConfidenceLevel = "unknown"): UncertaintyState {
  return { confidence, contradictedBy: [], userConfirmed: false, openQuestions: [] };
}

// ── 7. Sensitivity ─────────────────────────────────────────────────────────

export const SENSITIVITY_LEVELS = ["public", "internal", "private", "secret", "unknown"] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

/** Sensitivity levels that must be redacted from shared explanations (§9.7). */
export function requiresRedaction(s: SensitivityLevel): boolean {
  return s === "secret" || s === "private";
}

// ── 8. Scope (§9.1) ────────────────────────────────────────────────────────

/**
 * The authorization dimensions applied BEFORE semantic ranking. A highly
 * similar unauthorized item must never be considered at all.
 */
export interface ContextScope {
  /** Hard fence. Cross-workspace access is always denied. */
  workspaceId: string;
  /** Project key (e.g. directory basename) or "global". */
  projectScope: string;
  /** Optional owning user identity (single-user local installs use "local"). */
  userId?: string;
  /** Optional task/run binding — context granted only for this unit of work. */
  taskId?: string;
  /** Optional agent binding — context granted only to this agent role. */
  agentId?: string;
}

export const GLOBAL_PROJECT_SCOPE = "global";
export const DEFAULT_USER_ID = "local";

// ── 9. Retention ───────────────────────────────────────────────────────────

export const RETENTION_POLICIES = [
  /** Kept until the user deletes it. */
  "durable",
  /** Kept for the current session only. */
  "session",
  /** Kept until the bound task completes. */
  "task",
  /** Kept until the hard expiry, then pruned. */
  "ttl",
  /** Never persisted. */
  "ephemeral",
] as const;

export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];

// ── 10. Index state ────────────────────────────────────────────────────────

export const INDEX_STATES = [
  "none",
  "pending",
  "indexed",
  /** Content changed or consent was revoked — the cached vector must not be used. */
  "invalidated",
  "failed",
] as const;

export type IndexState = (typeof INDEX_STATES)[number];

/** Identity of the embedding space a cached vector belongs to. */
export interface EmbeddingSpace {
  /** Provider+model key, or "lexical" for the deterministic fallback. */
  model: string;
  dim: number;
}

// ── 11. The durable context item (§7.2) ────────────────────────────────────

/**
 * Every durable context item. Fields are required unless genuinely optional in
 * the domain — "unknown" is expressed by an explicit enum value, not by
 * omission (§8.1: avoid making all fields optional).
 */
export interface ContextItem {
  id: string;
  /** Monotonic version; bumped on every content-affecting change. */
  version: number;
  type: ContextType;
  /** The item body. Bounded by CONTEXT_BOUNDS.maxItemChars. */
  content: string;
  /** Short display title (derived when not supplied). */
  title: string;

  scope: ContextScope;

  trustStatus: TrustStatus;
  consentState: ConsentState;
  consentActor?: string | null;
  consentAt?: number | null;

  provenanceKind: ProvenanceKind;
  /** Primary reference; richer refs live in the provenance table. */
  provenanceRef?: string | null;
  actorKind: ActorKind;
  actorName?: string | null;

  freshness: FreshnessState;
  uncertainty: UncertaintyState;
  sensitivity: SensitivityLevel;
  retention: RetentionPolicy;

  /** Relationships to other durable objects (§7.2). */
  links: ContextLinks;

  indexState: IndexState;
  embeddingSpace?: EmbeddingSpace | null;

  revokedAt?: number | null;
  revokedReason?: string | null;
  deletedAt?: number | null;
  supersededBy?: string | null;

  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastAccessedAt?: number | null;
  accessCount: number;
}

/** Bounded relationship set. Not a graph — a fixed list of typed pointers. */
export interface ContextLinks {
  runId?: string | null;
  workflowId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  checkpointId?: string | null;
  researchSessionId?: string | null;
  claimId?: string | null;
  artifactId?: string | null;
  businessRecordId?: string | null;
  /** Item this one was derived from (summary lineage / correction lineage). */
  derivedFrom?: string | null;
}

export function emptyLinks(): ContextLinks {
  return {};
}

// ── 12. Context tiers (§7.3) ───────────────────────────────────────────────

/**
 * The eight tiers, ordered from most immediate to most durable.
 * Each tier declares its own inclusion, trust, and compression rules.
 */
export const CONTEXT_TIERS = [
  "immediate",        // 1. current step context
  "recent",           // 2. recent interaction history
  "task_summary",     // 3. task/workflow summaries
  "project_knowledge",// 4. project knowledge
  "long_term_memory", // 5. user-approved long-term memory
  "evidence",         // 6. external evidence
  "artifacts",        // 7. artifacts / references
  "instructions",     // 8. system instructions and policies
] as const;

export type ContextTier = (typeof CONTEXT_TIERS)[number];

export function isContextTier(v: string): v is ContextTier {
  return (CONTEXT_TIERS as readonly string[]).includes(v);
}

/** The governing rules for a tier. Static, inspectable, testable. */
export interface TierPolicy {
  tier: ContextTier;
  /** Which context types may populate this tier. */
  allowedTypes: readonly ContextType[];
  /** Maximum trust an item in this tier may present with. */
  maxTrust: TrustStatus;
  /**
   * Whether items in this tier may influence instructions.
   * True for exactly one tier: `instructions`.
   */
  mayInstruct: boolean;
  /** Retrieval excludes items whose freshness label is in this list. */
  excludeFreshness: readonly FreshnessLabel[];
  /** Hard cap on items included from this tier in one package. */
  maxItems: number;
  /** Hard cap on characters contributed by this tier. */
  maxChars: number;
  /** Whether this tier's content may be compressed. */
  compressible: boolean;
  /** Whether the tier is shown to the user by default (progressive disclosure). */
  userVisibleByDefault: boolean;
  /** What happens to this tier's items on revocation. */
  revocationBehavior: "drop" | "tombstone";
}

/**
 * THE tier policy table. This is the single source of truth for tier semantics
 * and is asserted directly by tests.
 */
export const TIER_POLICIES: Readonly<Record<ContextTier, TierPolicy>> = Object.freeze({
  immediate: {
    tier: "immediate",
    allowedTypes: ["task_context", "untrusted"],
    maxTrust: "source_evidence",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 12,
    maxChars: 8_000,
    compressible: false,
    userVisibleByDefault: true,
    revocationBehavior: "drop",
  },
  recent: {
    tier: "recent",
    allowedTypes: ["task_context"],
    maxTrust: "approved_memory",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 10,
    maxChars: 6_000,
    compressible: true,
    userVisibleByDefault: true,
    revocationBehavior: "drop",
  },
  task_summary: {
    tier: "task_summary",
    allowedTypes: ["task_context"],
    maxTrust: "generated_synthesis",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 6,
    maxChars: 4_000,
    compressible: true,
    userVisibleByDefault: false,
    revocationBehavior: "drop",
  },
  project_knowledge: {
    tier: "project_knowledge",
    allowedTypes: ["knowledge"],
    maxTrust: "source_evidence",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 8,
    maxChars: 6_000,
    compressible: true,
    userVisibleByDefault: false,
    revocationBehavior: "drop",
  },
  long_term_memory: {
    tier: "long_term_memory",
    allowedTypes: ["memory"],
    maxTrust: "approved_memory",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 8,
    maxChars: 4_000,
    compressible: false, // user-approved facts are never auto-compressed
    userVisibleByDefault: true,
    revocationBehavior: "tombstone",
  },
  evidence: {
    tier: "evidence",
    allowedTypes: ["evidence"],
    maxTrust: "source_evidence",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 10,
    maxChars: 8_000,
    compressible: true,
    userVisibleByDefault: true,
    revocationBehavior: "tombstone",
  },
  artifacts: {
    tier: "artifacts",
    allowedTypes: ["artifact"],
    maxTrust: "source_evidence",
    mayInstruct: false,
    excludeFreshness: ["expired"],
    maxItems: 8,
    maxChars: 3_000,
    compressible: false, // references are already minimal
    userVisibleByDefault: false,
    revocationBehavior: "tombstone",
  },
  instructions: {
    tier: "instructions",
    allowedTypes: ["instruction"],
    maxTrust: "trusted_instruction",
    mayInstruct: true,
    excludeFreshness: ["expired"],
    maxItems: 8,
    maxChars: 6_000,
    compressible: false, // never compress a directive
    userVisibleByDefault: true,
    revocationBehavior: "drop",
  },
});

/** Default tier for a context type when the caller does not specify one. */
export function defaultTierForType(t: ContextType): ContextTier {
  switch (t) {
    case "instruction": return "instructions";
    case "memory": return "long_term_memory";
    case "knowledge": return "project_knowledge";
    case "evidence": return "evidence";
    case "artifact": return "artifacts";
    case "task_context": return "task_summary";
    case "untrusted": return "immediate";
  }
}

// ── 13. Retrieval + explanation (§9.7) ─────────────────────────────────────

/** Why an item was retrieved. Every field is populated for every hit. */
export interface RetrievalExplanation {
  /** The intent/query the retrieval served. */
  queryIntent: string;
  /** How the item's scope matched the request. */
  scopeMatch: string;
  /** Semantic/lexical similarity in 0..1. */
  similarity: number;
  /** Which matching mode produced `similarity`. */
  matchMode: "semantic" | "lexical" | "hybrid";
  /** Rerank position change, when a reranker ran. */
  rerank?: { before: number; after: number; reason: string };
  /** Freshness label + reason at retrieval time. */
  freshness: string;
  trustStatus: TrustStatus;
  consentState: ConsentState;
  /** Provenance summary safe for display. */
  provenance: string;
  /** The deterministic policy rule that admitted this item. */
  policyReason: string;
  /** Final ranking score after all adjustments. */
  score: number;
  /** True when the item is legacy (pre-4.5) with unreconstructable consent. */
  legacy: boolean;
}

export interface RetrievedItem {
  item: ContextItem;
  tier: ContextTier;
  explanation: RetrievalExplanation;
}

/** An item that was considered and deliberately excluded. */
export interface RejectedItem {
  itemId: string;
  /** Never includes the item content — a rejection must not leak data (§9.7). */
  reason: RejectionReason;
  detail: string;
}

export const REJECTION_REASONS = [
  "workspace_mismatch",
  "project_scope_mismatch",
  "user_mismatch",
  "task_scope_mismatch",
  "agent_not_permitted",
  "tier_not_granted",
  "type_not_allowed_in_tier",
  "consent_not_granted",
  "revoked",
  "deleted",
  "quarantined",
  "expired",
  "below_relevance_floor",
  "trust_not_permitted_in_tier",
  "poisoning_signature",
  "budget_exhausted",
  "memory_disabled",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

// ── 14. Context packages (§9.9) ────────────────────────────────────────────

/**
 * A grant describing exactly what a requester may see. Constructed by policy,
 * never by the requester itself.
 */
export interface ContextGrant {
  /** Who is asking. */
  requester: {
    kind: ActorKind;
    id: string;
    /** Agent role name when kind === "agent". */
    role?: string;
  };
  scope: ContextScope;
  /** Tiers this requester may receive. Empty = no context at all. */
  allowedTiers: readonly ContextTier[];
  /** Whether the requester may write durable memory. */
  allowMemoryWrite: boolean;
  /** Hard cap on total items. */
  maxItems: number;
  /** Hard cap on total characters. */
  maxChars: number;
  /** Redaction rules applied to every item body. */
  redact: RedactionPolicy;
  /** Absolute expiry of this grant (epoch ms). */
  expiresAt: number;
  /** Audit reference so a grant can be traced. */
  auditRef: string;
}

export interface RedactionPolicy {
  /** Sensitivity levels that must be removed entirely. */
  dropSensitivity: readonly SensitivityLevel[];
  /** Mask secret-looking substrings (keys, tokens, passwords). */
  maskSecrets: boolean;
  /** Replace file paths outside the workspace with a placeholder. */
  maskExternalPaths: boolean;
}

export function defaultRedaction(): RedactionPolicy {
  return { dropSensitivity: ["secret"], maskSecrets: true, maskExternalPaths: true };
}

/**
 * The assembled, bounded, explainable context handed to a consumer.
 * A package NEVER grants authority — it carries data plus the metadata needed
 * to render it safely.
 */
export interface ContextPackage {
  /** Stable identity, checkpointable. */
  packageId: string;
  /** Bumped when the package is rebuilt or revalidated. */
  version: number;
  /** Schema version for durable records. */
  schemaVersion: 1;
  createdAt: number;
  /** The grant this package was built under. */
  grant: ContextGrant;
  /** The query/intent that produced it. */
  queryIntent: string;
  /** Items grouped by tier, already scope-filtered and bounded. */
  tiers: ContextTierContent[];
  /** Items considered and rejected, for inspection (bounded, content-free). */
  rejected: RejectedItem[];
  /** Total characters across all included items. */
  totalChars: number;
  totalItems: number;
  /** True when some tier could not be built (retrieval failure). */
  degraded: boolean;
  /** Which tiers are missing and why, when degraded. */
  degradedReasons: string[];
  /** Content hash over item ids + versions — detects drift across resume. */
  contentHash: string;
  /** Set when the package was revalidated after a resume. */
  revalidation?: PackageRevalidation;
}

export interface ContextTierContent {
  tier: ContextTier;
  items: RetrievedItem[];
  /** True when this tier's content was compressed to fit. */
  compressed: boolean;
  /** Characters contributed by this tier. */
  chars: number;
}

export interface PackageRevalidation {
  at: number;
  /** Ids dropped because consent/scope/freshness changed. */
  droppedItemIds: string[];
  /** Why each id was dropped, parallel to droppedItemIds. */
  reasons: RejectionReason[];
  /** True when the package still satisfies its original grant. */
  stillValid: boolean;
  note: string;
}

// ── 15. Injection (§7.5) ───────────────────────────────────────────────────

/** How a block is rendered into a prompt. */
export const INJECTION_CHANNELS = [
  /** May direct behavior. Only `instructions` tier reaches this. */
  "instruction",
  /** Reference data. The default for memory/knowledge/evidence/artifacts. */
  "data",
  /** Hard-quarantined external content, explicitly delimited. */
  "quarantine",
] as const;

export type InjectionChannel = (typeof INJECTION_CHANNELS)[number];

export interface InjectionBlock {
  channel: InjectionChannel;
  tier: ContextTier;
  /** The role the block should occupy in the message array. */
  role: "system" | "user";
  /** Fully-rendered text, including headers and delimiters. */
  text: string;
  /** Item ids contained, for audit and revocation checks. */
  itemIds: string[];
  chars: number;
}

export interface InjectionPackage {
  packageId: string;
  packageVersion: number;
  blocks: InjectionBlock[];
  totalChars: number;
  /** Item ids across all blocks — used to verify no revoked item leaked. */
  allItemIds: string[];
  /** Machine-readable why-included map for `xr context explain`. */
  explanations: Record<string, RetrievalExplanation>;
}

// ── 16. Compression (§7.8 / §9.6) ──────────────────────────────────────────

/**
 * The invariants a summary MUST preserve. When one cannot be preserved,
 * compression fails safe rather than silently dropping it.
 */
export const PRESERVED_INVARIANTS = [
  "decisions",
  "sources",
  "dates",
  "actors",
  "unresolved_questions",
  "uncertainty",
  "user_corrections",
  "permissions_scope",
  "task_identity",
  "artifact_references",
] as const;

export type PreservedInvariant = (typeof PRESERVED_INVARIANTS)[number];

export interface CompressionResult {
  ok: boolean;
  /** The compressed text, when ok. */
  summary?: string;
  /** Invariants successfully preserved. */
  preserved: PreservedInvariant[];
  /** Invariants that could NOT be preserved — non-empty means ok === false. */
  lost: PreservedInvariant[];
  /** Ids of the items folded in. */
  sourceItemIds: string[];
  /** Lineage generation (0 = original, 1 = first summary, …). */
  generation: number;
  /** Parent summary id when this is a re-summary. */
  lineageParent?: string | null;
  originalChars: number;
  compressedChars: number;
  /** Why compression failed, when !ok. */
  reason?: string;
}

// ── 17. Bounds (§7.11) ─────────────────────────────────────────────────────

/** Hard system bounds. Storage, retrieval, and injection are all bounded. */
export const CONTEXT_BOUNDS = {
  /** Maximum characters of a single item body. */
  maxItemChars: 8_000,
  /** Maximum characters in any assembled package. */
  maxPackageChars: 24_000,
  /** Maximum items in any assembled package. */
  maxPackageItems: 48,
  /** Maximum provenance references per item. */
  maxProvenancePerItem: 32,
  /** Maximum tags per item. */
  maxTagsPerItem: 16,
  /** Maximum rejected entries recorded on a package. */
  maxRejectedRecorded: 64,
  /** Maximum candidates scored in one retrieval pass. */
  maxCandidates: 500,
  /** How long a context grant stays valid. */
  grantTtlMs: 15 * 60 * 1000,
  /** How long a durable package row is retained. */
  packageRetentionMs: 7 * 86_400_000,
  /** Maximum summary lineage depth before refusing to re-compress. */
  maxSummaryGeneration: 5,
  /** Relevance floor below which nothing is retrieved. */
  relevanceFloor: 0.12,
  /** Maximum length of a stored explanation string. */
  maxExplanationChars: 512,
} as const;

/** Schema/policy version stamped onto durable context records. */
export const CONTEXT_SCHEMA_VERSION = 1;
export const CONTEXT_POLICY_VERSION = "xr-4.5.0/context-v1";

// ── 18. Helpers ────────────────────────────────────────────────────────────

/** Clamp text to a bound, marking truncation honestly. */
export function boundText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

/** Derive a short display title from content. */
export function deriveTitle(content: string, max = 72): string {
  const one = content.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1) + "…";
}

/**
 * Deterministic, dependency-free content hash (FNV-1a, hex).
 * Used for package drift detection — not for security.
 */
export function contentHash(parts: readonly string[]): string {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x1f;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Is this item retrievable at all right now? Deterministic, no ranking. */
export function itemIsRetrievable(item: ContextItem, now: number = Date.now()): boolean {
  if (item.deletedAt) return false;
  if (item.revokedAt) return false;
  if (consentIsTerminal(item.consentState)) return false;
  if (!consentAllowsRetrieval(item.consentState)) return false;
  if (typeof item.freshness.expiresAt === "number" && item.freshness.expiresAt <= now) return false;
  return true;
}
