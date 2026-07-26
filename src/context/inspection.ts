/**
 * XR 4.5 — Context inspection: user control surface (§9.8 / §14).
 *
 * Everything a user needs to answer:
 *   What does XR know? · Where did it come from? · Who authorized it?
 *   How fresh is it? · How confident? · Why was it retrieved?
 *   Can I correct, revoke, export, or delete it?
 *
 * Honesty rules enforced here:
 *   • We never claim erasure we cannot perform. `deleteItem` reports exactly
 *     what was removed and what residue may remain (§9.8).
 *   • Explanations are redacted so inspecting one item cannot leak another.
 */

import {
  CONTEXT_BOUNDS,
  boundText,
  type ConsentState,
  type ContextItem,
  type ContextPackage,
  type ContextType,
  type ProvenanceRef,
  type RetrievalExplanation,
} from "./types.ts";
import { maskSecrets } from "./poison.ts";
import type { ContextRepository } from "./repository.ts";

// ── Views ──────────────────────────────────────────────────────────────────

/** The safe, user-facing view of one context item. */
export interface ItemInspection {
  id: string;
  version: number;
  type: ContextType;
  title: string;
  /** Redacted body. */
  content: string;
  scope: { workspace: string; project: string; user?: string; task?: string; agent?: string };
  trust: { status: string; label: string; mayInstruct: boolean };
  consent: { state: ConsentState; actor: string | null; at: number | null; explanation: string };
  provenance: { kind: string; primaryRef: string | null; actor: string; references: ProvenanceRef[] };
  freshness: { label: string; reason: string; createdAt: number; updatedAt: number; expiresAt: number | null };
  confidence: { level: string; contradictedBy: string[]; userConfirmed: boolean; openQuestions: string[] };
  sensitivity: string;
  retention: string;
  index: { state: string; model: string | null };
  lifecycle: { revokedAt: number | null; revokedReason: string | null; supersededBy: string | null };
  usage: { accessCount: number; lastAccessedAt: number | null };
  tags: string[];
}

const TRUST_LABELS: Record<string, string> = {
  trusted_instruction: "Trusted instruction — may direct behavior",
  approved_memory: "User-approved memory — reference data only",
  source_evidence: "Source-linked evidence — reference data only",
  generated_synthesis: "Model-generated — not a user fact",
  untrusted_external: "Untrusted external input — quarantined",
  unknown: "Trust unknown — treated as untrusted",
};

const CONSENT_EXPLANATIONS: Record<ConsentState, string> = {
  not_eligible: "Excluded from retention by a do-not-remember rule.",
  proposed: "Retention was proposed but you have not approved it. Not used for recall.",
  approved: "You explicitly approved retaining this.",
  limited: "You approved this within a narrower scope than requested.",
  expired: "The consent window for this item has passed.",
  revoked: "You withdrew consent. It is excluded from all future retrieval.",
  deleted: "This item was deleted.",
  quarantined: "Held for review after a safety signature matched. Never retrieved.",
  legacy_unknown:
    "Created before XR 4.5. XR cannot reconstruct how consent was given, so it is labelled unknown rather than assumed approved. It is still retrievable and you can approve or revoke it.",
};

// ── Inspection service ─────────────────────────────────────────────────────

export class ContextInspection {
  constructor(
    private readonly repo: ContextRepository,
    private readonly workspaceId: string,
  ) {}

  /** Full, redacted view of one item. */
  inspect(id: string): ItemInspection | null {
    const item = this.repo.getItem(id);
    if (!item) return null;
    return this.toView(item, this.repo.getProvenance(id));
  }

  /** List items for a browsing UI. */
  list(opts: {
    type?: ContextType;
    projectScope?: string;
    includeRevoked?: boolean;
    limit?: number;
  } = {}): ItemInspection[] {
    return this.repo
      .listForInspection({
        workspaceId: this.workspaceId,
        type: opts.type,
        projectScope: opts.projectScope,
        includeRevoked: opts.includeRevoked,
        limit: opts.limit,
      })
      .map((i) => this.toView(i, this.repo.getProvenance(i.id)));
  }

  /**
   * Why was this item retrieved into a package?
   * Returns only THIS item's explanation — never other items' data (§9.7).
   */
  explainRetrieval(pkg: ContextPackage, itemId: string): RetrievalExplanation | null {
    for (const tier of pkg.tiers) {
      for (const ri of tier.items) {
        if (ri.item.id === itemId) return ri.explanation;
      }
    }
    return null;
  }

  /** Package-level explanation: what was included, what was rejected and why. */
  explainPackage(pkg: ContextPackage): {
    packageId: string;
    version: number;
    intent: string;
    contentHash: string;
    degraded: boolean;
    degradedReasons: string[];
    grant: {
      requester: string;
      allowedTiers: readonly string[];
      maxItems: number;
      maxChars: number;
      expiresAt: number;
    };
    included: Array<{
      id: string;
      tier: string;
      title: string;
      type: string;
      trust: string;
      freshness: string;
      consent: string;
      score: number;
      why: string;
      legacy: boolean;
    }>;
    /** Rejections carry NO content — only ids and typed reasons. */
    rejected: Array<{ id: string; reason: string; detail: string }>;
    revalidation: ContextPackage["revalidation"];
  } {
    return {
      packageId: pkg.packageId,
      version: pkg.version,
      intent: pkg.queryIntent,
      contentHash: pkg.contentHash,
      degraded: pkg.degraded,
      degradedReasons: pkg.degradedReasons,
      grant: {
        requester: `${pkg.grant.requester.kind}:${pkg.grant.requester.id}${pkg.grant.requester.role ? ` (${pkg.grant.requester.role})` : ""}`,
        allowedTiers: pkg.grant.allowedTiers,
        maxItems: pkg.grant.maxItems,
        maxChars: pkg.grant.maxChars,
        expiresAt: pkg.grant.expiresAt,
      },
      included: pkg.tiers.flatMap((t) =>
        t.items.map((ri) => ({
          id: ri.item.id,
          tier: t.tier,
          title: ri.item.title,
          type: ri.item.type,
          trust: ri.item.trustStatus,
          freshness: `${ri.item.freshness.label} — ${ri.item.freshness.reason}`,
          consent: ri.item.consentState,
          score: ri.explanation.score,
          why: ri.explanation.policyReason,
          legacy: ri.explanation.legacy,
        })),
      ),
      rejected: pkg.rejected.map((r) => ({ id: r.itemId, reason: r.reason, detail: r.detail })),
      revalidation: pkg.revalidation,
    };
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  /** Approve retention of a proposed item. */
  approve(id: string, actor = "user"): { ok: boolean; reason: string } {
    const item = this.repo.getItem(id);
    if (!item) return { ok: false, reason: "not found" };
    if (item.consentState === "quarantined") {
      return {
        ok: false,
        reason: "item is quarantined pending safety review — release it explicitly before approving",
      };
    }
    if (item.revokedAt) return { ok: false, reason: "item was revoked; create a new item instead" };
    this.repo.setConsent(id, "approved", { actor });
    return { ok: true, reason: "consent approved" };
  }

  /**
   * Correct an item. Creates a NEW item and marks the old one superseded, so
   * the correction lineage is preserved (§9.6) rather than overwriting history.
   */
  correct(
    id: string,
    newContent: string,
    opts: { actor?: string; now?: number } = {},
  ): { ok: boolean; newId?: string; reason: string } {
    const item = this.repo.getItem(id);
    if (!item) return { ok: false, reason: "not found" };
    const now = opts.now ?? Date.now();

    const newId = this.repo.insertItem({
      type: item.type,
      content: newContent,
      scope: item.scope,
      // A user correction is user-authored and user-approved.
      trustStatus: item.type === "memory" ? "approved_memory" : item.trustStatus,
      consentState: "approved",
      consentActor: opts.actor ?? "user",
      consentAt: now,
      provenanceKind: "user_input",
      provenanceRef: `correction-of:${id}`,
      actorKind: "user",
      actorName: opts.actor ?? "user",
      sensitivity: item.sensitivity,
      retention: item.retention,
      links: { ...item.links, derivedFrom: id },
      tags: [...item.tags, "correction"],
      now,
    });

    this.repo.supersede(id, newId, { now });
    // Carry provenance forward so the correction keeps its citations.
    for (const ref of this.repo.getProvenance(id)) this.repo.addProvenance(newId, ref, now);

    return { ok: true, newId, reason: `corrected — ${id} superseded by ${newId}` };
  }

  /** Revoke consent: no future retrieval, cached vector invalidated. */
  revoke(id: string, reason = "user_revoked", actor = "user"): {
    ok: boolean;
    indexInvalidated: boolean;
    reason: string;
    residual: string[];
  } {
    const r = this.repo.revokeItem(id, reason, { actor });
    if (!r.ok) return { ok: false, indexInvalidated: false, reason: "not found", residual: [] };
    return {
      ok: true,
      indexInvalidated: r.indexInvalidated,
      reason: "consent revoked; excluded from all future retrieval",
      residual: residualDisclosure(),
    };
  }

  /** Permanently delete. Reports honestly what may remain. */
  delete(id: string, actor = "user"): { ok: boolean; reason: string; residual: string[] } {
    const ok = this.repo.deleteItem(id, { actor, reason: "user_delete" });
    return {
      ok,
      reason: ok ? "item and its provenance rows deleted" : "not found",
      residual: ok ? residualDisclosure() : [],
    };
  }

  /** Release a quarantined item after human review. */
  releaseQuarantine(id: string, actor = "user"): { ok: boolean; reason: string } {
    const item = this.repo.getItem(id);
    if (!item) return { ok: false, reason: "not found" };
    if (item.consentState !== "quarantined") return { ok: false, reason: "item is not quarantined" };
    // Released items become PROPOSED, never approved — a human must still opt in,
    // and trust stays untrusted_external.
    this.repo.setConsent(id, "proposed", { actor });
    return {
      ok: true,
      reason: "released from quarantine as 'proposed' — approve it separately to allow retrieval",
    };
  }

  /** Full export of everything XR holds in this workspace. */
  export(): ReturnType<ContextRepository["exportAll"]> {
    return this.repo.exportAll(this.workspaceId);
  }

  /** Health snapshot for `xr doctor` and the dashboard. */
  health(): {
    ok: boolean;
    total: number;
    byType: Array<{ type: string; c: number }>;
    consent: Record<string, number>;
    trust: Record<string, number>;
    revocations: number;
    quarantined: number;
    legacyUnknown: number;
    staleIndex: number;
  } {
    try {
      const items = this.repo.listForInspection({
        workspaceId: this.workspaceId,
        includeRevoked: true,
        limit: 1000,
      });
      const consent: Record<string, number> = {};
      const trust: Record<string, number> = {};
      let quarantined = 0;
      let legacyUnknown = 0;
      let staleIndex = 0;
      for (const i of items) {
        consent[i.consentState] = (consent[i.consentState] ?? 0) + 1;
        trust[i.trustStatus] = (trust[i.trustStatus] ?? 0) + 1;
        if (i.consentState === "quarantined") quarantined++;
        if (i.consentState === "legacy_unknown") legacyUnknown++;
        if (i.indexState === "invalidated") staleIndex++;
      }
      return {
        ok: true,
        total: this.repo.countItems(this.workspaceId),
        byType: this.repo.statsByType(this.workspaceId),
        consent,
        trust,
        revocations: this.repo.listRevocations(this.workspaceId, 500).length,
        quarantined,
        legacyUnknown,
        staleIndex,
      };
    } catch {
      return {
        ok: false,
        total: 0,
        byType: [],
        consent: {},
        trust: {},
        revocations: 0,
        quarantined: 0,
        legacyUnknown: 0,
        staleIndex: 0,
      };
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private toView(item: ContextItem, provenance: ProvenanceRef[]): ItemInspection {
    // Redact the body before it reaches any surface.
    const redacted = maskSecrets(item.content).text;
    return {
      id: item.id,
      version: item.version,
      type: item.type,
      title: item.title,
      content: boundText(redacted, CONTEXT_BOUNDS.maxItemChars),
      scope: {
        workspace: item.scope.workspaceId,
        project: item.scope.projectScope,
        ...(item.scope.userId ? { user: item.scope.userId } : {}),
        ...(item.scope.taskId ? { task: item.scope.taskId } : {}),
        ...(item.scope.agentId ? { agent: item.scope.agentId } : {}),
      },
      trust: {
        status: item.trustStatus,
        label: TRUST_LABELS[item.trustStatus] ?? "Trust unknown",
        mayInstruct: item.trustStatus === "trusted_instruction" && item.type === "instruction",
      },
      consent: {
        state: item.consentState,
        actor: item.consentActor ?? null,
        at: item.consentAt ?? null,
        explanation: CONSENT_EXPLANATIONS[item.consentState],
      },
      provenance: {
        kind: item.provenanceKind,
        primaryRef: item.provenanceRef ?? null,
        actor: item.actorName ? `${item.actorKind}:${item.actorName}` : item.actorKind,
        references: provenance,
      },
      freshness: {
        label: item.freshness.label,
        reason: item.freshness.reason,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        expiresAt: item.freshness.expiresAt ?? null,
      },
      confidence: {
        level: item.uncertainty.confidence,
        contradictedBy: item.uncertainty.contradictedBy,
        userConfirmed: item.uncertainty.userConfirmed,
        openQuestions: item.uncertainty.openQuestions,
      },
      sensitivity: item.sensitivity,
      retention: item.retention,
      index: { state: item.indexState, model: item.embeddingSpace?.model ?? null },
      lifecycle: {
        revokedAt: item.revokedAt ?? null,
        revokedReason: item.revokedReason ?? null,
        supersededBy: item.supersededBy ?? null,
      },
      usage: { accessCount: item.accessCount, lastAccessedAt: item.lastAccessedAt ?? null },
      tags: item.tags,
    };
  }
}

/**
 * The honest residual-data disclosure (§9.8: "Document any residual data
 * limitations honestly"). Shown on every revoke/delete.
 */
export function residualDisclosure(): string[] {
  return [
    "The item row and its cached embedding vector are removed or invalidated; it cannot be retrieved again.",
    "A revocation ledger entry is retained (id, reason, actor, timestamp) so deletion itself is auditable. It does not contain the item content.",
    "The tamper-evident audit log retains prior event metadata (ids and lengths, never content) because the hash chain cannot be rewritten.",
    "Text already sent to an external model provider in a previous run is outside XR's control and cannot be recalled.",
    "Existing conversation transcripts or exported files you saved earlier are not modified by this action.",
  ];
}

export { CONSENT_EXPLANATIONS, TRUST_LABELS };
