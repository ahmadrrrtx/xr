/**
 * XR Phase 7 (F-21) — write-side memory policy: mandatory provenance,
 * policy-column stamping, and contradiction arbitration on write.
 *
 * Provenance (plan §4.6: `source: user|tool|agent|schedule`, `ref`, `eventId`):
 *   · The legacy `source` enum (user|chat|voice|research|import) is a CHANNEL
 *     label. Phase 7 adds `tool|agent|schedule` and requires those three to
 *     declare a `provenance.ref` (tool:<name> / agent:<role> / job id) — a
 *     write from a non-human channel with no reference is REJECTED, not
 *     defaulted to "user". Human channels keep their default so existing
 *     callers and the 70+ test sites that omit `source` remain valid; every
 *     row still ends up with provenance_kind / actor_kind / event id stamped.
 *   · `provenance_event_id` is the audit-chain hash of the `memory.add` event,
 *     so a row can be traced to the exact ledger entry that created it.
 *
 * Contradiction arbitration (deterministic, offline): a new row is compared
 * against the retrievable rows of the same scope+category with the lexical
 * vector (no model). Similarity ≥ CONFLICT_SIMILARITY → an OPEN row in
 * `memory_conflicts` + a `memory.conflict.detected` audit. Nothing is
 * overwritten and nothing auto-wins: the user resolves with
 * `xr memory resolve <a> <b> --keep a|b|both`, which supersedes the loser
 * (kept for lineage, never deleted).
 */

import { randomUUID } from "node:crypto";
import type { WorkspaceStore as Store, MemoryRow } from "../../state/workspace-store.ts";
import { lexicalVector, cosine } from "./embed.ts";
import type { MemorySource, WriteProvenance } from "./types.ts";
import type { ActorKind, ProvenanceKind, TrustStatus } from "../types.ts";

/** Phase 7 columns (migration 9). Read from `SELECT *` rows; typed here so the waived store types stay untouched. */
export interface Phase7Cols {
  agent_visibility?: string | null;
  kind?: string | null;
  confidence_score?: number | null;
  provenance_event_id?: string | null;
}
export type MemoryRowP7 = MemoryRow & Phase7Cols;

/** Channels that MUST carry an explicit provenance reference. */
const REF_REQUIRED: ReadonlySet<string> = new Set(["tool", "agent", "schedule"]);

/**
 * XR 4.5 — honest mapping from the `source` channel to context metadata
 * (moved here from store.ts in Phase 7; the migration copy in
 * src/state/migrations.ts must stay identical so a row written now and a row
 * migrated from 4.4 are described the same way).
 */
const SOURCE_TRUST: Record<string, TrustStatus> = {
  user: "approved_memory", chat: "approved_memory", voice: "approved_memory",
  research: "generated_synthesis", import: "unknown",
  tool: "untrusted_external", agent: "generated_synthesis", schedule: "generated_synthesis",
};
const SOURCE_PROVENANCE: Record<string, ProvenanceKind> = {
  user: "user_input", chat: "user_input", voice: "user_input", research: "research", import: "import",
  tool: "tool_output", agent: "model_synthesis", schedule: "model_synthesis",
};
const SOURCE_ACTOR: Record<string, ActorKind> = {
  user: "user", chat: "user", voice: "user", research: "system", import: "system",
  tool: "agent", agent: "agent", schedule: "system",
};

export interface ResolvedProvenance {
  provenance: WriteProvenance;
  provenanceKind: ProvenanceKind;
  actorKind: ActorKind;
  requestedTrust: TrustStatus;
}

/** Legacy channel → Phase 7 provenance source. */
export function provenanceSourceFor(source: MemorySource): WriteProvenance["source"] {
  if (source === "tool" || source === "agent" || source === "schedule") return source;
  return "user"; // user|chat|voice are the human; research/import are user-initiated actions
}

/**
 * Resolve the provenance a write carries. Fails (never throws) when a
 * non-human channel omits its reference — the "no unsourced write" rule.
 */
export function resolveWriteProvenance(
  source: MemorySource,
  explicit: WriteProvenance | undefined,
  /** Caller-supplied provenance kind for human channels (e.g. research → "research"). */
  provenanceKindOverride?: ProvenanceKind,
): { ok: true; value: ResolvedProvenance } | { ok: false; reason: string } {
  const legacy = {
    provenanceKind: provenanceKindOverride ?? SOURCE_PROVENANCE[source] ?? ("unknown" as ProvenanceKind),
    actorKind: SOURCE_ACTOR[source] ?? ("unknown" as ActorKind),
    trust: SOURCE_TRUST[source] ?? ("unknown" as TrustStatus),
  };
  const provenance: WriteProvenance = explicit ?? { source: provenanceSourceFor(source) };
  if (explicit && explicit.source !== provenanceSourceFor(source) && !(REF_REQUIRED.has(source) === false && explicit.source === "user")) {
    return { ok: false, reason: `provenance.source "${explicit.source}" does not match write channel "${source}"` };
  }
  if (REF_REQUIRED.has(provenance.source) && !(provenance.ref ?? "").trim()) {
    return { ok: false, reason: `provenance required: "${provenance.source}" writes must declare provenance.ref (e.g. ${provenance.source}:<name>)` };
  }
  switch (provenance.source) {
    case "tool":
      return { ok: true, value: { provenance, provenanceKind: "tool_output", actorKind: "agent", requestedTrust: "untrusted_external" } };
    case "agent":
      return { ok: true, value: { provenance, provenanceKind: "model_synthesis", actorKind: "agent", requestedTrust: "generated_synthesis" } };
    case "schedule":
      return { ok: true, value: { provenance, provenanceKind: "model_synthesis", actorKind: "system", requestedTrust: "generated_synthesis" } };
    default:
      return { ok: true, value: { provenance, provenanceKind: legacy.provenanceKind, actorKind: legacy.actorKind, requestedTrust: legacy.trust } };
  }
}

/** Numeric projection of the textual confidence level. NOT a truth claim; `unknown` stays null. */
export function confidenceScoreFor(level: string | null | undefined): number | null {
  return level === "high" ? 0.8 : level === "medium" ? 0.5 : level === "low" ? 0.3 : null;
}

/** Stamp the Phase 7 policy columns on a row (single-writer gate applies; fail-soft). */
export function stampPolicyColumns(
  store: Store,
  id: string,
  cols: { agentVisibility?: readonly string[]; kind?: string | null; confidenceScore?: number | null; provenanceEventId?: string | null },
): boolean {
  try {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (cols.agentVisibility) { sets.push("agent_visibility=?"); params.push(JSON.stringify(cols.agentVisibility)); }
    if (cols.kind !== undefined) { sets.push("kind=?"); params.push(cols.kind); }
    if (cols.confidenceScore !== undefined) { sets.push("confidence_score=?"); params.push(cols.confidenceScore); }
    if (cols.provenanceEventId !== undefined) { sets.push("provenance_event_id=?"); params.push(cols.provenanceEventId); }
    if (!sets.length) return true;
    params.push(id);
    store.query(`UPDATE user_memory SET ${sets.join(", ")} WHERE id=?`).run(...(params as never[]));
    return true;
  } catch {
    return false; // pre-migration-9 database: columns absent → defaults apply
  }
}

// ── Contradiction arbitration ───────────────────────────────────────────────

/** Lexical cosine at/above which two rows of one scope+category are a possible contradiction. */
export const CONFLICT_SIMILARITY = 0.6;
const CONFLICT_SCAN_CAP = 2000;
/**
 * A write opens at most this many conflict rows (its MOST similar peers). Without
 * the cap, templated notes ("note #1…", "note #2…") are all mutually similar and a
 * scope of n such rows would grow the ledger by O(n²) — bounded work per write is
 * the same discipline the poison scanner and the recall floor follow.
 */
export const CONFLICT_MAX_PER_WRITE = 3;

export interface ConflictRow {
  id: string;
  workspace_id: string | null;
  item_a: string;
  item_b: string;
  similarity: number;
  detector: string;
  status: "open" | "resolved";
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
}

export interface ConflictFinding { conflictId: string; withId: string; similarity: number }

/**
 * Compare a freshly written row against its scope+category peers and record
 * an OPEN conflict per near-match. Deterministic; never blocks the write.
 */
export function detectWriteConflicts(
  store: Store,
  row: { id: string; scope: string; category: string; content: string; tags: string },
): ConflictFinding[] {
  const out: ConflictFinding[] = [];
  if (row.category === "exclusion") return out;
  let peers: MemoryRowP7[];
  try {
    peers = (store.listMemory({ scope: row.scope }) as MemoryRowP7[])
      .filter((p) => p.id !== row.id && p.category === row.category && !p.superseded_by)
      .slice(0, CONFLICT_SCAN_CAP);
  } catch {
    return out;
  }
  if (!peers.length) return out;
  const text = (r: { content: string; tags: string }) => `${r.content} ${(r.tags || "").split(",").join(" ")}`.trim();
  const v = lexicalVector(text(row));
  const now = Date.now();
  const near = peers
    .map((p) => ({ p, sim: cosine(v, lexicalVector(text(p))) }))
    .filter((x) => x.sim >= CONFLICT_SIMILARITY)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, CONFLICT_MAX_PER_WRITE);
  for (const { p, sim } of near) {
    if (openConflictBetween(store, row.id, p.id)) continue; // idempotent
    const id = `mc_${randomUUID().slice(0, 8)}`;
    try {
      store
        .query(`INSERT INTO memory_conflicts (id, workspace_id, item_a, item_b, similarity, detector, status, created_at) VALUES (?,?,?,?,?,?, 'open', ?)`)
        .run(id, store.workspaceId ?? null, row.id, p.id, Math.round(sim * 1000) / 1000, "lexical_similarity", now);
      out.push({ conflictId: id, withId: p.id, similarity: sim });
    } catch {
      /* pre-migration-9 database: no ledger table → arbitration unavailable (honest no-op) */
    }
  }
  if (out.length) {
    // One audit row per write (ids + similarity only, never content).
    store.audit("memory.conflict.detected", {
      newId: row.id,
      conflicts: out.map((c) => ({ conflictId: c.conflictId, withId: c.withId, similarity: Math.round(c.similarity * 100) / 100 })),
      detector: "lexical_similarity",
    });
  }
  return out;
}

function openConflictBetween(store: Store, a: string, b: string): boolean {
  try {
    return Boolean(
      store
        .query(`SELECT 1 FROM memory_conflicts WHERE status='open' AND ((item_a=? AND item_b=?) OR (item_a=? AND item_b=?)) LIMIT 1`)
        .get(a, b, b, a),
    );
  } catch {
    return false;
  }
}

export function listConflicts(store: Store, opts: { status?: "open" | "resolved" | "all"; limit?: number } = {}): ConflictRow[] {
  const status = opts.status ?? "open";
  try {
    const where = status === "all" ? "" : `WHERE status=?`;
    const stmt = store.query(`SELECT * FROM memory_conflicts ${where} ORDER BY created_at DESC LIMIT ?`);
    return (status === "all" ? stmt.all(opts.limit ?? 100) : stmt.all(status, opts.limit ?? 100)) as ConflictRow[];
  } catch {
    return [];
  }
}

export function getConflict(store: Store, id: string): ConflictRow | null {
  try {
    return (store.query(`SELECT * FROM memory_conflicts WHERE id=?`).get(id) as ConflictRow | null) ?? null;
  } catch {
    return null;
  }
}

/** Mark a conflict resolved (the supersede itself is done by the caller through the store facade). */
export function markConflictResolved(store: Store, id: string, resolution: string, actor: string): boolean {
  try {
    const r = store
      .query(`UPDATE memory_conflicts SET status='resolved', resolution=?, resolved_by=?, resolved_at=? WHERE id=? AND status='open'`)
      .run(resolution, actor, Date.now(), id);
    return ((r as { changes?: number }).changes ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Close every open conflict that references a forgotten row (no content is kept in the ledger). */
export function closeConflictsFor(store: Store, memoryId: string, resolution: string, actor: string): number {
  try {
    const r = store
      .query(`UPDATE memory_conflicts SET status='resolved', resolution=?, resolved_by=?, resolved_at=? WHERE status='open' AND (item_a=? OR item_b=?)`)
      .run(resolution, actor, Date.now(), memoryId, memoryId);
    return (r as { changes?: number }).changes ?? 0;
  } catch {
    return 0;
  }
}
