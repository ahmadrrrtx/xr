/**
 * XR Stage 6 — the Memory Engine (store facade).
 *
 * ── Phase 2 · T5: this module now lives under `context/` ────────────────────
 *
 * `src/memory/` was a SECOND durable-context authority alongside `src/context/`
 * — two stores, two CLIs, overlapping concerns. The Constitution names this
 * exact consolidation as the compliant design (Art. V, "Compliant Designs":
 * *"A `context/` module that owns all durable context, with `memory/` retired
 * on a dated schedule."*).
 *
 * `src/memory/` is retired: this engine is now an implementation detail OWNED
 * by the context layer, and the legacy `user_memory` rows are projected into
 * the canonical `context_items` store by the reversible migration
 * `memory_to_context_projection` (src/state/migrations.ts, version 2).
 *
 * The engine itself is unchanged. It continues to serve the `user_memory`
 * table because that is where the data lives and a lossless migration must not
 * delete it (Art. XXIII: every migration reversible; a downgrade must remain
 * readable). New durable-context work belongs in `ContextService`.
 *
 * A clean abstraction that sits ON TOP of the SQLite Store. It owns the WRITE
 * RULES, the RECALL layer (now EXPLAINABLE), scope handling, retention/expiry,
 * access tracking, the live "remember this?" capture flow, session summaries,
 * and import/export. Nothing in here knows about providers, budgets, voice or
 * control — by design.
 *
 * Design principles (unchanged from v0.9, extended for Stage 6):
 *   • Explicit by default — entries are only created when the user asks.
 *   • Deterministic & testable — the synchronous `recall()` uses a lexical
 *     vector + a conservative relevance floor (no model call required).
 *   • Optional semantics — `recallSemantic()` upgrades retrieval to embeddings
 *     (Ollama nomic-embed-text) with an automatic, dimension-safe fallback to
 *     lexical scoring, so it ALWAYS works — even fully offline.
 *   • Privacy first — `exclusion` rules block matching content from being
 *     stored, and exclusions are never surfaced as recall.
 *   • Retention — entries may carry an `expiresAt`; expired entries are
 *     excluded from recall/list and can be pruned. Deletion is real.
 *   • Explainable — `recallExplain`/`recallSemanticExplain` return scores +
 *     a human reason so retrieval is never a black box.
 *   • Fail soft — bad input is validated and rejected with a clear reason,
 *     never a crash.
 */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { MemoryRow } from "../../state/workspace-store.ts";
import type { WorkspaceStore as Store } from "../../state/workspace-store.ts";
import { lexicalVector, cosine, embed, sameSpace } from "./embed.ts";
import { compact, totalChars } from "./compact.ts";
import type { Message } from "../../core/types.ts";
import {
  GLOBAL_SCOPE,
  RECALL_FLOOR,
  clampImportance,
  isCategory,
  isExpired,
  ttlToExpiresAt,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryEntryWithContext,
  type MemoryExport,
  type MemorySource,
  type RecallHit,
} from "./types.ts";
import { parseMemoryIntent } from "./intent.ts";
import { admitContextWrite } from "../poison.ts";
import type {
  ActorKind,
  ConsentState,
  ProvenanceKind,
  TrustStatus,
} from "../types.ts";

/**
 * XR 4.5 — honest mapping from the legacy `source` enum to context metadata.
 * Identical to the migration mapping in `src/context/memory-adapter.ts`, so a
 * row written now and a row migrated from 4.4 are described the same way.
 */
const SOURCE_TRUST: Record<string, TrustStatus> = {
  user: "approved_memory",
  chat: "approved_memory",
  voice: "approved_memory",
  research: "generated_synthesis",
  import: "unknown",
};
const SOURCE_PROVENANCE: Record<string, ProvenanceKind> = {
  user: "user_input",
  chat: "user_input",
  voice: "user_input",
  research: "research",
  import: "import",
};
const SOURCE_ACTOR: Record<string, ActorKind> = {
  user: "user",
  chat: "user",
  voice: "user",
  research: "system",
  import: "system",
};

const MAX_CONTENT = 2000;

export interface AddResult {
  ok: boolean;
  entry?: MemoryEntry;
  /** True when an identical entry already existed (no duplicate created). */
  duplicate?: boolean;
  reason?: string;
}

export interface AddInput {
  content: string;
  category?: MemoryCategory;
  scope?: string;
  source?: MemorySource;
  tags?: string[];
  importance?: number;
  /**
   * Stage 6 — time-to-live in milliseconds. When set, the entry gets an
   * absolute `expiresAt` and becomes eligible for pruning after it elapses.
   */
  ttlMs?: number | null;

  // ── XR 4.5 — optional context metadata ────────────────────────────────
  /**
   * Consent to record. Defaults to `approved` for a direct add (an explicit
   * user action). The admission gate downgrades this to `proposed` for actors
   * that cannot self-approve, so a caller cannot escalate by passing it.
   */
  consentState?: ConsentState;
  /** Who performed the action (recorded as the consent actor). */
  actor?: string;
  /** Typed provenance kind. Defaults to the mapping for `source`. */
  provenanceKind?: ProvenanceKind;
  /** A URL, path, run id, or claim id. Never invented. */
  provenanceRef?: string | null;
  /** When the underlying source was observed in the world. */
  sourceObservedAt?: number | null;
}

function rowToEntry(r: MemoryRow): MemoryEntryWithContext {
  return {
    id: r.id,
    category: r.category as MemoryCategory,
    content: r.content,
    scope: r.scope,
    source: r.source as MemorySource,
    tags: r.tags ? r.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    importance: r.importance,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at ?? null,
    accessCount: r.access_count ?? 0,
    expiresAt: r.expires_at ?? null,
    // XR 4.5 — additive context metadata. Undefined on a pre-migration read.
    consentState: (r.consent_state as MemoryEntryWithContext["consentState"]) ?? "legacy_unknown",
    consentActor: r.consent_actor ?? null,
    consentAt: r.consent_at ?? null,
    trustStatus: (r.trust_status as MemoryEntryWithContext["trustStatus"]) ?? undefined,
    confidence: (r.confidence as MemoryEntryWithContext["confidence"]) ?? "unknown",
    sensitivity: (r.sensitivity as MemoryEntryWithContext["sensitivity"]) ?? "unknown",
    provenanceKind: (r.provenance_kind as MemoryEntryWithContext["provenanceKind"]) ?? undefined,
    provenanceRef: r.provenance_ref ?? null,
    actorKind: r.actor_kind ?? null,
    actorName: r.actor_name ?? null,
    sourceObservedAt: r.source_observed_at ?? null,
    staleAfter: r.stale_after ?? null,
    revokedAt: r.revoked_at ?? null,
    revokedReason: r.revoked_reason ?? null,
    supersededBy: r.superseded_by ?? null,
    retentionPolicy: r.retention_policy ?? "durable",
    indexState: r.index_state ?? "none",
    embeddingModel: r.embedding_model ?? null,
    embeddingDim: r.embedding_dim ?? null,
    workspaceId: r.workspace_id ?? null,
  };
}

/** Derive a stable project scope key from a working directory. */
export function projectScopeFromCwd(cwd: string): string {
  const b = basename(cwd).trim();
  return b ? b.toLowerCase().replace(/[^a-z0-9._-]/g, "-") : GLOBAL_SCOPE;
}

/** Build a human-readable reason string for a recall hit. */
function reasonFor(sim: number, e: MemoryEntry, mode: "lexical" | "semantic"): string {
  const pct = Math.round(sim * 100);
  const impLabel = e.importance >= 4 ? " · high-importance" : e.importance <= 2 ? " · low-importance" : "";
  return `${mode} match ${pct}%${impLabel}`;
}

export class MemoryStore {
  constructor(private store: Store) {}

  // ── write ─────────────────────────────────────────────────────────────

  /**
   * Add a memory entry, applying all write rules:
   *   1. validate + normalize input (fail soft)
   *   2. honour do-not-remember (exclusion) rules
   *   3. dedupe by (scope, category, content)
   *   4. Stage 6: attach retention/expiry if a TTL was given
   */
  add(input: AddInput): AddResult {
    const content = (input.content ?? "").trim();
    if (!content) return { ok: false, reason: "empty content" };
    if (content.length > MAX_CONTENT) {
      return { ok: false, reason: `content too long (>${MAX_CONTENT} chars)` };
    }

    const category: MemoryCategory =
      input.category && isCategory(input.category) ? input.category : "fact";
    const scope = (input.scope ?? GLOBAL_SCOPE).trim() || GLOBAL_SCOPE;
    const source: MemorySource = input.source ?? "user";
    const importance = clampImportance(input.importance ?? 3);
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const expiresAt = ttlToExpiresAt(input.ttlMs);

    // Rule: a do-not-remember rule blocks matching content (unless we are
    // recording the exclusion rule itself).
    if (category !== "exclusion") {
      const blocked = this.matchesExclusion(content);
      if (blocked) {
        return {
          ok: false,
          reason: `blocked by do-not-remember rule: "${blocked}"`,
        };
      }
    }

    // Rule: dedupe identical (scope, category, content).
    const existing = this.store.findMemoryByContent(scope, category, content);
    if (existing) {
      return { ok: true, duplicate: true, entry: rowToEntry(existing) };
    }

    const id = `mem_${randomUUID().slice(0, 8)}`;
    this.store.insertMemory({
      id,
      category,
      content,
      scope,
      source,
      tags: tags.join(","),
      importance,
      expiresAt,
    });

    // ── XR 4.5 — stamp real consent, trust, and provenance on a NEW entry ──
    //
    // The `legacy_unknown` column default exists for rows that predate 4.5.
    // Anything written NOW has a knowable origin, so recording it as unknown
    // would be just as dishonest as fabricating approval.
    //
    // Deterministic policy decides; the caller cannot assert trust directly.
    try {
      const admission = admitContextWrite({
        content,
        type: category === "exclusion" ? "knowledge" : "memory",
        requestedTrust: SOURCE_TRUST[source] ?? "unknown",
        provenanceKind: SOURCE_PROVENANCE[source] ?? "unknown",
        actorKind: SOURCE_ACTOR[source] ?? "unknown",
        // A direct `add()` is an explicit user/system act; plugin and model
        // paths are downgraded to `proposed` inside the admission gate.
        requestedConsent: input.consentState ?? "approved",
      });

      // An exclusion rule is a user POLICY, not a memory — it is the one write
      // that legitimately carries instruction trust, and it only ever reduces
      // what XR retains.
      const trust =
        category === "exclusion" ? "trusted_instruction" : admission.trustStatus;
      const consent = admission.consentState;

      this.store.setMemoryConsent(
        id,
        consent,
        consent === "approved" ? (input.actor ?? "user") : (input.actor ?? source),
      );
      this.store.setMemoryProvenance(id, {
        provenanceKind: input.provenanceKind ?? SOURCE_PROVENANCE[source] ?? "unknown",
        provenanceRef: input.provenanceRef ?? null,
        actorKind: SOURCE_ACTOR[source] ?? "unknown",
        actorName: input.actor ?? null,
        trustStatus: trust,
        confidence: importance >= 4 ? "high" : importance <= 2 ? "low" : "medium",
        sourceObservedAt: input.sourceObservedAt ?? null,
      });

      if (admission.scan.flagged) {
        this.store.audit("memory.add.scanned", {
          id,
          severity: admission.scan.severity,
          signatures: admission.scan.signatures,
          consent,
          trust,
        });
      }
    } catch {
      // Never fail a write because metadata stamping failed — the conservative
      // column defaults (legacy_unknown / unknown) already apply.
    }
    this.store.audit("memory.add", {
      id,
      category,
      scope,
      source,
      // content length only — never the raw content, keeps logs private.
      contentLen: content.length,
      ttlMs: input.ttlMs ?? null,
    });
    const row = this.store.getMemory(id)!;
    return { ok: true, entry: rowToEntry(row) };
  }

  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, "content" | "category" | "scope" | "importance" | "expiresAt">> & {
      tags?: string[];
    },
  ): { ok: boolean; reason?: string; entry?: MemoryEntry } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const realId = resolved.id!;

    const dbPatch: Record<string, unknown> = {};
    if (patch.content !== undefined) {
      const c = patch.content.trim();
      if (!c) return { ok: false, reason: "empty content" };
      if (c.length > MAX_CONTENT)
        return { ok: false, reason: `content too long (>${MAX_CONTENT})` };
      dbPatch.content = c;
    }
    if (patch.category !== undefined) {
      if (!isCategory(patch.category))
        return { ok: false, reason: `unknown category: ${patch.category}` };
      dbPatch.category = patch.category;
    }
    if (patch.scope !== undefined) dbPatch.scope = patch.scope.trim() || GLOBAL_SCOPE;
    if (patch.importance !== undefined)
      dbPatch.importance = clampImportance(patch.importance);
    if (patch.tags !== undefined)
      dbPatch.tags = patch.tags.map((t) => t.trim()).filter(Boolean).join(",");
    if (patch.expiresAt !== undefined) dbPatch.expiresAt = patch.expiresAt;

    const okUpdate = this.store.updateMemory(realId, dbPatch);
    if (!okUpdate) return { ok: false, reason: "not found" };
    this.store.audit("memory.edit", { id: realId, fields: Object.keys(dbPatch) });
    return { ok: true, entry: rowToEntry(this.store.getMemory(realId)!) };
  }

  remove(id: string): { ok: boolean; reason?: string } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const ok = this.store.deleteMemory(resolved.id!);
    if (ok) this.store.audit("memory.remove", { id: resolved.id });
    return ok ? { ok: true } : { ok: false, reason: "not found" };
  }

  clear(scope?: string): number {
    const n = this.store.clearMemory(scope);
    this.store.audit("memory.clear", { scope: scope ?? "all", removed: n });
    return n;
  }

  /**
   * Stage 6 — permanently delete every entry whose `expiresAt` has passed.
   * Returns the number removed and audits the action.
   */
  pruneExpired(now: number = Date.now()): number {
    const n = this.store.pruneExpiredMemory(now);
    if (n > 0) this.store.audit("memory.prune", { removed: n });
    return n;
  }

  // ── read ──────────────────────────────────────────────────────────────

  list(
    opts: {
      scope?: string;
      category?: MemoryCategory;
      includeExclusions?: boolean;
      includeExpired?: boolean;
      /** XR 4.5 — include revoked/quarantined/proposed rows (inspection only). */
      includeRevoked?: boolean;
    } = {},
  ): MemoryEntryWithContext[] {
    return this.store.listMemory(opts).map(rowToEntry);
  }

  get(id: string): MemoryEntryWithContext | null {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return null;
    const row = this.store.getMemory(resolved.id!);
    return row ? rowToEntry(row) : null;
  }

  /** Plain substring/keyword search (deterministic). Excludes expired + revoked. */
  search(query: string, opts: { scope?: string } = {}): MemoryEntryWithContext[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const all = this.list({ scope: opts.scope });
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter((e) => {
      const hay = (e.content + " " + e.tags.join(" ") + " " + e.category).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  /**
   * RECALL LAYER — relevant, conservative retrieval for prompt injection.
   *
   * Returns at most `k` entries whose lexical similarity to the query clears
   * the relevance floor. Exclusions + expired entries are never returned.
   * Importance is folded in as a gentle tiebreaker so critical preferences win
   * close calls. Access is recorded (lastAccessedAt + accessCount).
   */
  recall(
    query: string,
    opts: { scope?: string; k?: number; floor?: number } = {},
  ): MemoryEntryWithContext[] {
    return this.recallExplain(query, opts).map((h) => h.entry);
  }

  /** Explainable lexical recall — returns hits with scores + reasons. */
  recallExplain(
    query: string,
    opts: { scope?: string; k?: number; floor?: number } = {},
  ): RecallHit[] {
    const k = opts.k ?? 5;
    const floor = opts.floor ?? RECALL_FLOOR;
    const q = (query ?? "").trim();
    if (!q) return [];

    const candidates = this.list({ scope: opts.scope }); // exclusions + expired filtered
    if (candidates.length === 0) return [];

    const qv = lexicalVector(q);
    const scored = candidates.map((e) => {
      const sim = cosine(qv, lexicalVector(`${e.content} ${e.tags.join(" ")}`));
      const score = sim + (e.importance - 3) * 0.0125;
      return { e, sim, score };
    });

    const hits = scored
      .filter((s) => s.sim >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => ({
        entry: s.e,
        sim: s.sim,
        score: s.score,
        reason: reasonFor(s.sim, s.e, "lexical"),
      }));

    this.touchAccess(hits);
    return hits;
  }

  /**
   * SEMANTIC RECALL (v0.9 #4) — embeddings-based retrieval with safe fallback.
   * Stage 6: excludes expired entries, records access, and (via the Explain
   * variant) is fully explainable.
   *
   * Behaviour:
   *   1. Embed the query once (Ollama nomic-embed-text; lexical fallback if no
   *      embedding model is reachable).
   *   2. For each candidate, use its CACHED embedding. If an entry has none yet
   *      (older row, or never embedded), embed it now and cache it — so the cost
   *      is paid once, lazily.
   *   3. Score by cosine. If a candidate's stored vector lives in a DIFFERENT
   *      space than the query, fall back to lexical-on-both-sides for THAT pair
   *      so cosine stays meaningful — never a crash, never a garbage score.
   *
   * Same conservative contract as `recall()`: exclusions + expired excluded,
   * relevance floor enforced, importance tiebreaker, capped at `k`.
   *
   * This never throws: any embedding failure degrades to lexical scoring.
   */
  async recallSemantic(
    query: string,
    opts: { scope?: string; k?: number; floor?: number } = {},
  ): Promise<MemoryEntryWithContext[]> {
    return (await this.recallSemanticExplain(query, opts)).map((h) => h.entry);
  }

  /** Explainable semantic recall — returns hits with scores + reasons. */
  async recallSemanticExplain(
    query: string,
    opts: { scope?: string; k?: number; floor?: number } = {},
  ): Promise<RecallHit[]> {
    const k = opts.k ?? 5;
    const floor = opts.floor ?? RECALL_FLOOR;
    const q = (query ?? "").trim();
    if (!q) return [];

    // Raw rows so we can read + write the cached embedding column.
    const rows = this.store
      .listMemory({ scope: opts.scope }) // exclusions + expired already filtered
      .filter((r) => r.category !== "exclusion");
    if (rows.length === 0) return [];

    let qvec: number[];
    try {
      qvec = await embed(q);
    } catch {
      // Total embedding failure → behave exactly like lexical recall.
      return this.recallExplain(q, opts);
    }

    const scored: Array<{ row: MemoryRow; sim: number; score: number; mode: "lexical" | "semantic" }> = [];
    for (const row of rows) {
      const text = `${row.content} ${(row.tags || "").split(",").join(" ")}`.trim();

      // Resolve (and lazily cache) this entry's embedding.
      let stored: number[] | null = null;
      if (row.embedding) {
        try {
          stored = JSON.parse(row.embedding);
        } catch {
          stored = null;
        }
      }
      if (!stored || !stored.length) {
        try {
          stored = await embed(text);
          this.store.setMemoryEmbedding(row.id, stored);
        } catch {
          stored = null;
        }
      }

      let sim: number;
      let mode: "lexical" | "semantic" = "semantic";
      if (stored && stored.length && sameSpace(stored, qvec)) {
        sim = cosine(qvec, stored);
      } else {
        // Mixed spaces or no vector → lexical on both sides (meaningful + safe).
        sim = cosine(lexicalVector(q), lexicalVector(text));
        mode = "lexical";
      }

      const score = sim + (row.importance - 3) * 0.0125;
      scored.push({ row, sim, score, mode });
    }

    const hits = scored
      .filter((s) => s.sim >= floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => ({
        entry: rowToEntry(s.row),
        sim: s.sim,
        score: s.score,
        reason: reasonFor(s.sim, rowToEntry(s.row), s.mode),
      }));

    this.touchAccess(hits);
    return hits;
  }

  // ── exclusions (do-not-remember) ──────────────────────────────────────

  /** Returns the matching exclusion phrase, or null if content is allowed. */
  matchesExclusion(content: string): string | null {
    const lc = content.toLowerCase();
    const rules = this.store
      .listMemory({ category: "exclusion", includeExclusions: true, includeExpired: true })
      .map(rowToEntry)
      .filter((e) => !isExpired(e));
    for (const r of rules) {
      const phrase = r.content.toLowerCase().trim();
      if (phrase && lc.includes(phrase)) return r.content;
    }
    return null;
  }

  // ── XR 4.5: consent, revocation, correction (§9.2 / §9.8) ─────────────

  /**
   * Grant explicit consent for an entry. This is the ONLY way an entry reaches
   * `approved` — nothing self-approves (§9.2 consent-first retention).
   */
  approveConsent(id: string, actor = "user"): { ok: boolean; reason?: string } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const realId = resolved.id!;
    const row = this.store.getMemory(realId);
    if (!row) return { ok: false, reason: "not found" };
    if (row.revoked_at) return { ok: false, reason: "entry was revoked; add a new one instead" };
    if (row.consent_state === "quarantined") {
      return { ok: false, reason: "entry is quarantined pending safety review" };
    }
    const ok = this.store.setMemoryConsent(realId, "approved", actor);
    if (ok) this.store.audit("memory.consent.approve", { id: realId, actor });
    return ok ? { ok: true } : { ok: false, reason: "not found" };
  }

  /**
   * Revoke consent. The entry is excluded from ALL future retrieval and its
   * cached embedding is destroyed so no index path can resurrect it.
   * The row itself is retained so the user can still see and export it.
   */
  revoke(
    id: string,
    reason = "user_revoked",
    actor = "user",
  ): { ok: boolean; reason?: string; indexInvalidated: boolean } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason, indexInvalidated: false };
    const realId = resolved.id!;
    const ok = this.store.revokeMemory(realId, reason, actor);
    if (ok) {
      this.store.audit("memory.revoke", { id: realId, reason, actor, indexInvalidated: true });
    }
    return ok
      ? { ok: true, indexInvalidated: true }
      : { ok: false, reason: "not found", indexInvalidated: false };
  }

  /**
   * Correct an entry. Creates a NEW entry and marks the old one superseded so
   * the correction lineage survives (§9.6) instead of overwriting history.
   * A user correction must never be silently outranked by the stale original.
   */
  correct(
    id: string,
    newContent: string,
    actor = "user",
  ): { ok: boolean; newId?: string; reason?: string } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const realId = resolved.id!;
    const old = this.get(realId);
    if (!old) return { ok: false, reason: "not found" };

    const added = this.add({
      content: newContent,
      category: old.category,
      scope: old.scope,
      source: "user",
      tags: [...old.tags, "correction"],
      importance: old.importance,
    });
    if (!added.ok || !added.entry) {
      return { ok: false, reason: added.reason ?? "could not store the correction" };
    }

    // Approve the correction (an explicit user action) and mark the original.
    this.store.setMemoryConsent(added.entry.id, "approved", actor);
    this.store.setMemoryProvenance(added.entry.id, {
      provenanceKind: "user_input",
      provenanceRef: `correction-of:${realId}`,
      actorKind: "user",
      actorName: actor,
    });
    this.store.supersedeMemory(realId, added.entry.id);
    this.store.audit("memory.correct", { oldId: realId, newId: added.entry.id, actor });
    return { ok: true, newId: added.entry.id };
  }

  /** Mark an entry stale from a given moment. Stale is shown, never hidden. */
  markStale(id: string, at: number = Date.now()): { ok: boolean; reason?: string } {
    const resolved = this.resolveId(id);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const ok = this.store.setMemoryStaleAfter(resolved.id!, at);
    if (ok) this.store.audit("memory.mark_stale", { id: resolved.id, at });
    return ok ? { ok: true } : { ok: false, reason: "not found" };
  }

  /**
   * Entries the user has not yet decided on (`proposed`) plus quarantined
   * items awaiting review. Surfaced by `xr memory pending`.
   */
  pending(): { proposed: MemoryEntryWithContext[]; quarantined: MemoryEntryWithContext[] } {
    const all = this.store
      .listMemory({ includeExclusions: true, includeExpired: true, includeRevoked: true })
      .map(rowToEntry);
    return {
      proposed: all.filter((e) => e.consentState === "proposed"),
      quarantined: all.filter((e) => e.consentState === "quarantined"),
    };
  }

  /** Every entry whose consent could not be reconstructed at migration time. */
  legacyUnknown(): MemoryEntryWithContext[] {
    return this.store
      .listMemory({ includeExclusions: true, includeExpired: true, includeRevoked: true })
      .map(rowToEntry)
      .filter((e) => e.consentState === "legacy_unknown");
  }

  /**
   * Consent breakdown for `xr memory status` / doctor / dashboard.
   *
   * This is an INSPECTION surface, so it deliberately includes revoked and
   * quarantined rows. Hiding them here would conceal exactly the information
   * the user opened the view to see.
   */
  consentSummary(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.store.listMemory({
      includeExclusions: true,
      includeExpired: true,
      includeRevoked: true,
    })) {
      const k = r.consent_state ?? "legacy_unknown";
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  /** Entries superseded by a correction (kept for lineage, never retrieved as current). */
  superseded(): MemoryEntryWithContext[] {
    return this.store
      .listMemory({ includeExclusions: true, includeExpired: true, includeRevoked: true })
      .map(rowToEntry)
      .filter((e) => Boolean(e.supersededBy));
  }

  // ── import / export ───────────────────────────────────────────────────

  export(): MemoryExport {
    const entries = this.store
      .listMemory({ includeExclusions: true, includeExpired: true })
      .map(rowToEntry);
    return {
      format: "xr-memory",
      version: 1,
      exportedAt: Date.now(),
      entries,
    };
  }

  /**
   * Import a previously-exported bundle. Existing identical entries are skipped
   * (dedupe). Returns counts. Malformed entries are skipped, never fatal.
   * Stage 6: carries expiresAt through (expired imports are dropped — a stale
   * memory shouldn't be resurrected silently).
   */
  import(bundle: unknown): { added: number; skipped: number; errors: number } {
    let added = 0,
      skipped = 0,
      errors = 0;
    const b = bundle as Partial<MemoryExport>;
    if (!b || b.format !== "xr-memory" || !Array.isArray(b.entries)) {
      return { added: 0, skipped: 0, errors: 1 };
    }
    const now = Date.now();
    for (const raw of b.entries) {
      try {
        // Don't silently resurrect already-expired entries.
        if (isExpired({ expiresAt: raw.expiresAt }, now)) {
          skipped++;
          continue;
        }
        const res = this.add({
          content: raw.content,
          category: isCategory(raw.category as string)
            ? (raw.category as MemoryCategory)
            : "fact",
          scope: raw.scope,
          source: "import",
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          importance: raw.importance,
        });
        // Carry expiry over (add() doesn't take an absolute expiresAt directly).
        if (res.ok && !res.duplicate && typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt)) {
          this.store.updateMemory(res.entry!.id, { expiresAt: raw.expiresAt });
        }
        if (!res.ok) errors++;
        else if (res.duplicate) skipped++;
        else added++;
      } catch {
        errors++;
      }
    }
    this.store.audit("memory.import", { added, skipped, errors });
    return { added, skipped, errors };
  }

  // ── semantic index maintenance ────────────────────────────────────────

  /**
   * (Re)compute and cache embeddings for every entry (incl. exclusions, so
   * dedupe/scope are consistent). Returns counts. Fail-soft: an entry whose
   * embedding call fails is left for lazy embedding on next recall.
   */
  async reindexEmbeddings(): Promise<{ total: number; embedded: number; fallback: number }> {
    const rows = this.store.listMemory({ includeExclusions: true, includeExpired: true });
    let embedded = 0;
    let fallback = 0;
    for (const row of rows) {
      const text = `${row.content} ${(row.tags || "").split(",").join(" ")}`.trim();
      try {
        const vec = await embed(text);
        // A lexical-fallback vector has the fixed fallback dimensionality; we
        // still cache it (recall handles mixed spaces), but report it so users
        // know whether a real embedding model was used.
        if (vec.length === 256) fallback++;
        this.store.setMemoryEmbedding(row.id, vec);
        embedded++;
      } catch {
        /* leave for lazy embedding */
      }
    }
    return { total: rows.length, embedded, fallback };
  }

  // ── live capture ("remember this?" flow) ──────────────────────────────

  /**
   * Stage 6 — the live capture flow used by chat, TUI and voice so memory is a
   * first-class part of conversation, not a dead CLI.
   *
   * Parses ONE user utterance for a memory intent and acts on it:
   *   • "remember I prefer X"   → asks `confirm()` (if autoSuggest), then stores
   *   • "don't remember Y"      → stores an exclusion (no confirm needed; this
   *                              REDUCES what XR stores, so it's always honoured)
   *   • "forget Z"               → removes matching entries (no confirm needed;
   *                              forgetting is the safe direction)
   *   • "what do you remember"   → returns recalled entries (read-only)
   *
   * Returns a structured outcome describing what happened. The caller decides
   * how to render/speak it. NEVER throws, NEVER silently auto-saves durable
   * facts without consent.
   */
  captureIntent(
    text: string,
    opts: {
      scope?: string;
      source?: MemorySource;
      /** Offer to remember (ask confirm) vs. remember immediately. */
      autoSuggest?: boolean;
      /** Consent hook. Defaults to "yes" when omitted (explicit caller). */
      confirm?: (prompt: string) => Promise<boolean> | boolean;
    } = {},
  ): CaptureOutcome {
    const scope = opts.scope ?? GLOBAL_SCOPE;
    const source = opts.source ?? "chat";
    const intent = parseMemoryIntent((text ?? "").trim());

    if (intent.kind === "none") return { handled: false };

    if (intent.kind === "recall") {
      const results = this.recall(intent.query || "preferences", { scope });
      return { handled: true, kind: "recall", entries: results };
    }

    if (intent.kind === "forget") {
      const matches = this.search(intent.query, { scope });
      let removed = 0;
      for (const m of matches) if (this.remove(m.id).ok) removed++;
      return { handled: true, kind: "forget", removed, matched: matches.length };
    }

    // ── XR 4.5 verbs ────────────────────────────────────────────────────
    // Revoke ≠ forget. Revoking withdraws consent (the entry stops being used
    // but stays inspectable/exportable); forgetting erases it.
    if (intent.kind === "revoke") {
      const matches = this.search(intent.query, { scope });
      let revoked = 0;
      for (const m of matches) if (this.revoke(m.id, "user_revoked", "user").ok) revoked++;
      return { handled: true, kind: "revoke", removed: revoked, matched: matches.length };
    }

    if (intent.kind === "correct") {
      const matches = this.search(intent.query, { scope });
      if (matches.length === 0) {
        return { handled: true, kind: "correct", ok: false, matched: 0, reason: "no matching entry to correct" };
      }
      // Correct only an unambiguous single match — never guess which fact the
      // user meant. Ambiguity is reported, not resolved silently.
      if (matches.length > 1) {
        return {
          handled: true,
          kind: "correct",
          ok: false,
          matched: matches.length,
          reason: `ambiguous — ${matches.length} entries match; correct one explicitly by id`,
        };
      }
      const res = this.correct(matches[0]!.id, intent.replacement, "user");
      return {
        handled: true,
        kind: "correct",
        ok: res.ok,
        matched: 1,
        reason: res.reason,
        content: intent.replacement,
        entry: res.newId ? this.get(res.newId) ?? undefined : undefined,
      };
    }

    if (intent.kind === "export") {
      return { handled: true, kind: "export", ok: true, content: intent.target };
    }

    if (intent.kind === "inspect") {
      const results = this.search(intent.query, { scope });
      return { handled: true, kind: "inspect", entries: results, matched: results.length };
    }

    // intent.kind === "add"
    // Exclusions reduce stored data → always honour immediately, no prompt.
    if (intent.category === "exclusion") {
      const res = this.add({
        content: intent.content,
        category: "exclusion",
        scope: GLOBAL_SCOPE,
        source,
      });
      return {
        handled: true,
        kind: "exclusion",
        ok: res.ok,
        duplicate: res.duplicate,
        reason: res.reason,
        content: intent.content,
      };
    }

    // A durable add: require consent unless the caller disabled the prompt.
    const wantConfirm = opts.autoSuggest !== false;
    if (wantConfirm) {
      const prompt = `Remember this? "${intent.content}" (${intent.category})`;
      const yes = opts.confirm ? opts.confirm(prompt) : true;
      // Support both sync and async confirm — but keep captureIntent sync by
      // resolving a Promise only when given one. Callers that need async should
      // use captureIntentAsync.
      if (yes instanceof Promise) {
        // Defer: return a pending marker; async callers must use captureIntentAsync.
        return { handled: true, kind: "add-pending", content: intent.content, category: intent.category };
      }
      if (!yes) return { handled: true, kind: "add", ok: false, declined: true, content: intent.content };
    }

    const res = this.add({
      content: intent.content,
      category: intent.category,
      scope: intent.category === "project" ? scope : GLOBAL_SCOPE,
      source,
    });
    return {
      handled: true,
      kind: "add",
      ok: res.ok,
      duplicate: res.duplicate,
      declined: false,
      reason: res.reason,
      entry: res.entry,
    };
  }

  /** Async variant of captureIntent for callers with an async confirm hook. */
  async captureIntentAsync(
    text: string,
    opts: {
      scope?: string;
      source?: MemorySource;
      autoSuggest?: boolean;
      confirm?: (prompt: string) => Promise<boolean> | boolean;
    } = {},
  ): Promise<CaptureOutcome> {
    const scope = opts.scope ?? GLOBAL_SCOPE;
    const source = opts.source ?? "chat";
    const intent = parseMemoryIntent((text ?? "").trim());
    if (intent.kind === "none") return { handled: false };

    if (intent.kind === "recall") {
      return { handled: true, kind: "recall", entries: this.recall(intent.query || "preferences", { scope }) };
    }
    if (intent.kind === "forget") {
      const matches = this.search(intent.query, { scope });
      let removed = 0;
      for (const m of matches) if (this.remove(m.id).ok) removed++;
      return { handled: true, kind: "forget", removed, matched: matches.length };
    }

    // XR 4.5 consent verbs (async path — mirrors the sync `captureIntent`).
    if (intent.kind === "revoke") {
      const matches = this.search(intent.query, { scope });
      let revoked = 0;
      for (const m of matches) if (this.revoke(m.id, "user_revoked", "user").ok) revoked++;
      return { handled: true, kind: "revoke", removed: revoked, matched: matches.length };
    }
    if (intent.kind === "correct") {
      const matches = this.search(intent.query, { scope });
      if (matches.length === 0) {
        return { handled: true, kind: "correct", ok: false, matched: 0, reason: "no matching entry to correct" };
      }
      if (matches.length > 1) {
        return {
          handled: true,
          kind: "correct",
          ok: false,
          matched: matches.length,
          reason: `ambiguous — ${matches.length} entries match; correct one explicitly by id`,
        };
      }
      const res = this.correct(matches[0]!.id, intent.replacement, "user");
      return {
        handled: true,
        kind: "correct",
        ok: res.ok,
        matched: 1,
        reason: res.reason,
        content: intent.replacement,
        entry: res.newId ? this.get(res.newId) ?? undefined : undefined,
      };
    }
    if (intent.kind === "export") {
      return { handled: true, kind: "export", ok: true, content: intent.target };
    }
    if (intent.kind === "inspect") {
      const results = this.search(intent.query, { scope });
      return { handled: true, kind: "inspect", entries: results, matched: results.length };
    }

    if (intent.category === "exclusion") {
      const res = this.add({ content: intent.content, category: "exclusion", scope: GLOBAL_SCOPE, source });
      return { handled: true, kind: "exclusion", ok: res.ok, duplicate: res.duplicate, reason: res.reason, content: intent.content };
    }

    if (opts.autoSuggest !== false) {
      const prompt = `Remember this? "${intent.content}" (${intent.category})`;
      const yes = opts.confirm ? await opts.confirm(prompt) : true;
      if (!yes) return { handled: true, kind: "add", ok: false, declined: true, content: intent.content };
    }
    const res = this.add({
      content: intent.content,
      category: intent.category,
      scope: intent.category === "project" ? scope : GLOBAL_SCOPE,
      source,
    });
    return { handled: true, kind: "add", ok: res.ok, duplicate: res.duplicate, declined: false, reason: res.reason, entry: res.entry };
  }

  // ── session summaries (separate from long-term memory) ───────────────

  /**
   * Stage 6 — fold a finished conversation into a compact, durable SESSION
   * SUMMARY (kept in its own table, never confused with long-term facts).
   * Deterministic (reuses the compaction summarizer — no model call).
   *
   * Returns the saved summary id, or null if the conversation was too short.
   * Best-effort: never throws.
   */
  saveSessionSummary(
    scope: string,
    messages: Message[],
    opts: { minTurns?: number; now?: number } = {},
  ): string | null {
    const minTurns = opts.minTurns ?? 4;
    // Count user/assistant turns (ignore system/tool scaffolding).
    const turns = messages.filter((m) => m.role === "user" || m.role === "assistant").length;
    if (turns < minTurns) return null;
    try {
      const id = `sum_${randomUUID().slice(0, 8)}`;
      const summary = summarizeConversation(messages);
      this.store.insertSessionSummary(id, scope || GLOBAL_SCOPE, summary);
      this.store.audit("memory.session_summary", { id, scope, turns, chars: summary.length });
      return id;
    } catch {
      return null;
    }
  }

  // ── health (for `xr doctor` + dashboard) ──────────────────────────────

  /** Stage 6 — memory health diagnostics. Never throws. */
  health(): MemoryHealth {
    try {
      const all = this.store.listMemory({ includeExclusions: true, includeExpired: true });
      const now = Date.now();
      const expired = all.filter((r) => r.expires_at !== null && r.expires_at <= now).length;
      const neverAccessed = all.filter((r) => r.last_accessed_at === null && r.category !== "exclusion").length;
      let oldest: number | null = null;
      for (const r of all) if (oldest === null || r.created_at < oldest) oldest = r.created_at;
      return {
        ok: true,
        total: all.length,
        expired,
        neverAccessed,
        oldestCreatedAt: oldest,
        byCategory: this.store.userMemoryStats(),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message, total: 0, expired: 0, neverAccessed: 0, oldestCreatedAt: null, byCategory: [] };
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────

  count(): number {
    return this.store.userMemoryCount();
  }

  stats(): Array<{ category: string; c: number }> {
    return this.store.userMemoryStats();
  }

  /** Record access (lastAccessedAt + accessCount) for a set of recall hits. */
  private touchAccess(hits: RecallHit[]): void {
    if (!hits.length) return;
    try {
      this.store.touchMemoryAccess(hits.map((h) => h.entry.id));
    } catch {
      /* best-effort: recall must never fail because tracking failed */
    }
  }

  /** Resolve a full id or unambiguous prefix to a single id. */
  private resolveId(id: string): { ok: boolean; id?: string; reason?: string } {
    const trimmed = id.trim();
    if (!trimmed) return { ok: false, reason: "no id given" };
    if (this.store.getMemory(trimmed)) return { ok: true, id: trimmed };
    const matches = this.store.findMemoryByPrefix(trimmed);
    if (matches.length === 1) return { ok: true, id: matches[0].id };
    if (matches.length === 0) return { ok: false, reason: `no entry: ${trimmed}` };
    return {
      ok: false,
      reason: `ambiguous id "${trimmed}" (${matches.length} matches) — use the full id`,
    };
  }
}

// ── shared types ──────────────────────────────────────────────────────────

/** Outcome of a live capture flow (chat/TUI/voice). */
export interface CaptureOutcome {
  handled: boolean;
  kind?:
    | "add"
    | "add-pending"
    | "exclusion"
    | "forget"
    | "recall"
    // XR 4.5 — consent verbs are distinct outcomes so a caller can never
    // confuse "stopped using it" with "erased it".
    | "revoke"
    | "correct"
    | "export"
    | "inspect";
  ok?: boolean;
  duplicate?: boolean;
  declined?: boolean;
  reason?: string;
  content?: string;
  category?: MemoryCategory;
  entry?: MemoryEntry;
  entries?: MemoryEntry[];
  removed?: number;
  matched?: number;
}

/** Memory health snapshot. */
export interface MemoryHealth {
  ok: boolean;
  error?: string;
  total: number;
  expired: number;
  neverAccessed: number;
  oldestCreatedAt: number | null;
  byCategory: Array<{ category: string; c: number }>;
}

/**
 * Deterministic conversation summarizer (reused from the compaction layer).
 * Produces a compact, capped bullet recap of the user/assistant turns — the
 * basis for a SESSION SUMMARY, kept separate from long-term memory.
 */
export function summarizeConversation(messages: Message[], maxBullets = 24): string {
  const convo = totalChars(messages) > 16000 ? compact(messages, { maxChars: 16000, keepRecent: 8 }) : messages;
  const bullets: string[] = [];
  for (const m of convo) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const oneLine = m.content.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!oneLine) continue;
    const tag = m.role === "assistant" ? "xr" : "user";
    bullets.push(`• ${tag}: ${oneLine}`);
  }
  return bullets.slice(0, maxBullets).join("\n");
}
