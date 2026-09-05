/**
 * XR v0.9 — durable memory: shared vocabulary.
 *
 * This file is intentionally dependency-free so every layer (CLI, agent,
 * voice, research, dashboard later) speaks the same memory language without
 * importing the store, a provider, or any UI code.
 */

/** The fixed set of memory categories (namespaces). */
export const MEMORY_CATEGORIES = [
  "preference", // durable user preferences (coding style, provider, tools)
  "project", // long-running project context
  "workflow", // repeated procedures / how-the-user-likes-things-done
  "fact", // stable long-term facts about the user / their world
  "exclusion", // do-not-remember rules (never surfaced as recall)
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** Where a memory was created from (provenance). */
export const MEMORY_SOURCES = [
  "user", // typed/explicit via `xr memory add`
  "chat", // confirmed in an agent chat ("remember …")
  "voice", // confirmed via voice
  "research", // saved from a research output
  "import", // bulk imported
  // Phase 7 (F-21) — provenance-mandatory write channels. Never user-trusted.
  "tool", // a tool result (`provenanceRef` = tool:<name>) — data, quarantined at recall
  "agent", // a workflow role (`provenanceRef` = agent:<role>) — proposed until the user approves
  "schedule", // a maintenance job (consolidation) — derived synthesis, never instruction
] as const;

export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** Phase 7 — what KIND of memory a row is (orthogonal to the legacy category). */
export const MEMORY_KINDS = ["fact", "preference", "episode", "procedure", "summary"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Phase 7 — the provenance a write MUST declare (`WriteProvenance.source`). */
export interface WriteProvenance {
  source: "user" | "tool" | "agent" | "schedule";
  /** tool:<name> · agent:<role> · a run/plan id. Never invented. */
  ref?: string;
}

/** Legacy category → Phase 7 kind (the migration-9 backfill uses the same table). */
export function kindForCategory(c: MemoryCategory, tags: readonly string[] = []): MemoryKind | null {
  if (tags.includes("summary")) return "summary";
  if (c === "preference") return "preference";
  if (c === "workflow") return "procedure";
  if (c === "project" || c === "fact") return "fact";
  return null; // exclusion = user policy, not a memory
}

/** A fully-formed memory entry (mirrors the user_memory table). */
export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  /** "global" or a project key (e.g. a directory basename). */
  scope: string;
  source: MemorySource;
  /** Free-form tags for filtering. */
  tags: string[];
  /** 1 (minor) … 5 (critical). Higher importance recalls first. */
  importance: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Stage 6 — when this entry was last surfaced by recall (null = never).
   * Powers recency-based hygiene ("show stale memory", "prune untouched").
   */
  lastAccessedAt?: number | null;
  /** Stage 6 — how many times recall has surfaced this entry. */
  accessCount?: number;
  /**
   * Stage 6 — retention/expiry. Epoch-ms after which the entry is eligible for
   * pruning and excluded from recall. null/undefined = never expires.
   */
  expiresAt?: number | null;
}

/**
 * Stage 6 — an explainable recall hit. Lets XR (and the user) see WHY a memory
 * was surfaced: the raw similarity, the importance-adjusted score, and a
 * human-readable reason. Retrieval is never a black box.
 */
export interface RecallHit {
  /** XR 4.5: carries context metadata (consent/trust/provenance) when present. */
  entry: MemoryEntryWithContext;
  /** Raw similarity to the query (0..1, lexical or embedding cosine). */
  sim: number;
  /** Importance-adjusted score used for ranking. */
  score: number;
  /** Human-readable reason this entry was surfaced. */
  reason: string;
  /**
   * Phase 7 — which prompt channel the hit may occupy. `quarantine` = untrusted
   * or unknown trust: shown only delimited (never in the legacy system block,
   * never as an instruction). Recall can never produce an instruction-channel hit.
   */
  channel: "data" | "quarantine";
}

/** The portable export format (stable across versions). */
export interface MemoryExport {
  format: "xr-memory";
  /** 2 = Phase 7 (entries carry ACL/kind/quarantine labels; v1 bundles still import). */
  version: 1 | 2;
  exportedAt: number;
  entries: MemoryEntry[];
}

export const GLOBAL_SCOPE = "global";

export function isCategory(v: string): v is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(v);
}

export function isSource(v: string): v is MemorySource {
  return (MEMORY_SOURCES as readonly string[]).includes(v);
}

/** Clamp an importance value into the 1..5 range. */
export function clampImportance(n: unknown): number {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 3;
  return Math.min(5, Math.max(1, x));
}

/**
 * Stage 6 — convert a time-to-live in ms to an absolute `expiresAt` epoch-ms.
 * Returns null when there is no TTL (entry never expires). `now` is overridable
 * for deterministic tests.
 */
export function ttlToExpiresAt(ttlMs?: number | null, now: number = Date.now()): number | null {
  if (ttlMs === null || ttlMs === undefined) return null;
  const ms = Number(ttlMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return now + ms;
}

/**
 * Stage 6 — is an entry expired at `now`? Entries with no `expiresAt` never
 * expire. `now` is overridable for deterministic tests.
 */
export function isExpired(entry: { expiresAt?: number | null }, now: number = Date.now()): boolean {
  const e = entry.expiresAt;
  return typeof e === "number" && Number.isFinite(e) && e <= now;
}

/** Default relevance floor for recall (conservative: weak hits are dropped). */
export const RECALL_FLOOR = 0.12;

/**
 * Phase 7 — WHO is recalling. `"user"` is the human owner (CLI, voice, shell);
 * anything else is role-bearing identity data (an `AgentIdentity` satisfies
 * this structurally). The ACL in `acl.ts` decides visibility from the role.
 */
export type MemoryPrincipal = "user" | { readonly role: string; readonly agentId: string };

/** Options shared by every recall* entry point. `principal` defaults to `"user"`. */
export interface RecallOpts {
  scope?: string;
  k?: number;
  floor?: number;
  principal?: MemoryPrincipal;
}

// ── XR 4.5 (Knowledge and Context OS) — additive context metadata ──────────
//
// These fields extend `MemoryEntry` WITHOUT breaking the 4.4 contract: every
// one is optional, and code that ignores them behaves exactly as before.
// The canonical vocabulary lives in `src/context/types.ts`; these are the
// projections the memory layer persists and returns.
//
// Honesty rule: `consentState` is `legacy_unknown` for pre-4.5 rows. XR does
// not fabricate consent it cannot verify.

/** Re-exported context vocabulary so memory callers need one import. */
export type {
  ConsentState,
  ConfidenceLevel,
  ProvenanceKind,
  SensitivityLevel,
  TrustStatus,
} from "../types.ts";

/**
 * Context metadata attached to a memory entry (XR 4.5).
 * Present on rows written by 4.5+; absent/`legacy_unknown` on older rows.
 */
export interface MemoryContextMeta {
  /** Consent lifecycle. `legacy_unknown` for pre-4.5 entries. */
  consentState?: import("../types.ts").ConsentState;
  consentActor?: string | null;
  consentAt?: number | null;
  /** Trust status. Derived from `source` for legacy rows. */
  trustStatus?: import("../types.ts").TrustStatus;
  /** Confidence in the content — NOT a truth claim. */
  confidence?: import("../types.ts").ConfidenceLevel;
  sensitivity?: import("../types.ts").SensitivityLevel;
  /** Typed provenance. Mapped from `source` for legacy rows. */
  provenanceKind?: import("../types.ts").ProvenanceKind;
  /** A URL, path, run id, or claim id. Never invented during migration. */
  provenanceRef?: string | null;
  actorKind?: string | null;
  actorName?: string | null;
  /** When the underlying source was observed in the world. */
  sourceObservedAt?: number | null;
  /** Soft staleness boundary (distinct from the hard `expiresAt`). */
  staleAfter?: number | null;
  revokedAt?: number | null;
  revokedReason?: string | null;
  /** Id of the entry that corrected this one. */
  supersededBy?: string | null;
  retentionPolicy?: string | null;
  indexState?: string | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
  workspaceId?: string | null;
  // ── Phase 7 (F-21) — memory policy columns (migration 9) ──────────────
  /** Role ACL. `["*"]` = every principal (the pre-Phase-7 default). No "*" = sequestered. */
  agentVisibility?: string[];
  kind?: MemoryKind | null;
  /** Numeric projection of `confidence`; NOT a truth claim. */
  confidenceScore?: number | null;
  /** Audit-chain hash of the write event that created this row. */
  provenanceEventId?: string | null;
}

/** A memory entry with its XR 4.5 context metadata. */
export interface MemoryEntryWithContext extends MemoryEntry, MemoryContextMeta {}

/**
 * Memory categories that are actually POLICY INSTRUCTIONS, not memories.
 * `exclusion` is a do-not-remember rule: the audit flagged storing it in the
 * memory table as a taxonomy error. It keeps its storage location for
 * compatibility, but the context layer types it as `instruction`.
 */
export function categoryIsInstruction(c: MemoryCategory): boolean {
  return c === "exclusion";
}
