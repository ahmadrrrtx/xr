/**
 * XR Phase 30 — team memory, the local half.
 *
 * ## What this module is, and what it is not
 *
 * It is a **bridge**, not a store. Team facts live on the cloud service; the
 * daemon's memory store is unchanged and unaware of them. This file does three
 * things and refuses to do a fourth:
 *
 *   1. **Vets before upload.** Every fact passes the Phase 21 sensitivity scanner
 *      here, on this machine, before a request is made. The server scans again —
 *      it does not trust this verdict — but a blocked fact is refused *here*, which
 *      is what keeps it out of our own logs as a rejected upload as well.
 *   2. **Namespaces by workspace.** A fact carries its workspace id, and the
 *      ciphertext key on the server is derived from it. Nothing here derives a key;
 *      this side never sees plaintext keys.
 *   3. **Degrades to local.** With no team, no session, or no entitlement, every
 *      function answers a typed `unavailable` — never a throw — so a caller can
 *      keep working with local memory and mention the team in one line.
 *
 * The fourth thing it does not do: it never copies a local fact into a team
 * workspace on its own. Promotion is always an explicit act by a person, because
 * "XR decided to share this with your colleagues" is the sentence that ends a
 * product's trust, and it would only take one convenience flag to write it.
 */

import { scanSensitive, type SensitiveMatch } from "./sensitivity.ts";
import type { MemoryCategory } from "./types.ts";

/** A fact as it travels. Mirrors `cloud/src/services/memory.ts`. */
export interface TeamFact {
  id: string;
  workspaceId: string;
  category: MemoryCategory;
  body: string;
  visibility: "team" | "review" | "private";
  version: number;
  tags: string[];
  updatedAt: string;
  authorEmail?: string | null;
}

export type TeamResult<T> =
  | { ok: true; value: T }
  /** The team is not available. `reason` is user-facing; `repair` says what to do. */
  | { ok: false; reason: string; repair: string; blocked?: SensitiveMatch[] };

/** Where a fact came from. Mirrors the server's provenance enum. */
export type TeamProvenance = "human" | "agent-suggested" | "import";

export interface PromoteInput {
  workspaceId: string;
  category: MemoryCategory;
  body: string;
  tags?: string[];
  provenance?: TeamProvenance;
  /**
   * Set when a person is looking at the fact and has accepted the scanner's
   * warning. Never set by an agent path — an agent that could wave the scanner
   * away would be the whole hole.
   */
  acknowledgeSensitive?: boolean;
}

export interface TeamMemoryClient {
  /** Read the team's facts for a workspace. */
  list(workspaceId: string): Promise<TeamResult<{ facts: TeamFact[]; serverTime: string }>>;
  /** Promote a fact to a team workspace. Runs the scanner first. */
  promote(input: PromoteInput): Promise<TeamResult<{ fact: TeamFact; pendingReview: boolean }>>;
  /** Delete a team fact. Administrative on the server; refused for members. */
  remove(workspaceId: string, factId: string): Promise<TeamResult<{ ok: true }>>;
  /**
   * Whether this installation can use team memory at all, and why not.
   * Cheap, local, and answerable while offline.
   */
  availability(): Promise<{ available: boolean; reason: string | null; localUnaffected: true }>;
}

export interface TeamMemoryDeps {
  /**
   * The cloud call. Injected so that this module has no opinion about HTTP,
   * retries or transport — and so tests can exercise the scanner without a
   * server, which is where most of the interesting behaviour lives.
   */
  call: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<TeamResult<T>>;
}

export function createTeamMemory(deps: TeamMemoryDeps): TeamMemoryClient {
  return {
    async availability() {
      const result = await deps.call<{ available: boolean; reason?: string }>("/api/cloud/license/feature/memory-sync");
      if (result.ok && result.value.available === false) {
        return {
          available: false,
          reason: result.value.reason ?? "This organization does not have the Business tier active.",
          // The sentence every refusal in this file carries. It is a field rather
          // than a string the caller has to remember to add.
          localUnaffected: true,
        };
      }
      if (!result.ok) return { available: false, reason: result.reason, localUnaffected: true };
      return { available: true, reason: null, localUnaffected: true };
    },

    async list(workspaceId) {
      return deps.call<{ facts: TeamFact[]; serverTime: string }>(
        `/api/cloud/team-memory?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
    },

    async promote(input) {
      // ── 1. the scanner, before anything leaves the machine ────────────────
      const matches = scanSensitive(input.body);
      if (matches.length > 0 && !input.acknowledgeSensitive) {
        const kinds = [...new Set(matches.map((m) => m.kind))];
        return {
          ok: false,
          blocked: matches,
          reason:
            `This fact looks like it contains ${kinds.join(", ")}. It was not sent anywhere — ` +
            "the check runs on this machine, before upload.",
          repair:
            "Remove the sensitive value, or share it anyway from the desktop review dialog, where you can " +
            "see exactly what matched. An agent can never accept this on your behalf.",
        };
      }

      // ── 2. the write ─────────────────────────────────────────────────────
      // `provenance` is classified here; the daemon route is what maps it to the
      // wire's `direct` flag (`agent-suggested` → a review-queue proposal). One
      // place decides the rule, and it is the place that faces the service.
      const provenance = input.provenance ?? "human";
      const result = await deps.call<{ fact: TeamFact; pendingReview: boolean }>("/api/cloud/team-memory", {
        method: "POST",
        body: {
          workspaceId: input.workspaceId,
          category: input.category,
          body: input.body,
          tags: input.tags ?? [],
          provenance,
          // Sent so the server can apply the same policy with the same knowledge,
          // and can record in the audit entry that a human accepted a flagged
          // fact rather than implying the fact was clean.
          sensitivityTags: matches.map((m) => m.kind),
          acknowledgeSensitive: input.acknowledgeSensitive === true,
        },
      });

      if (!result.ok) return result;
      // An agent-suggested fact lands in the review queue: visible to nobody
      // until a person accepts it. The flag is passed through rather than
      // recomputed, so the UI states what the server did.
      return { ok: true, value: { fact: result.value.fact, pendingReview: result.value.pendingReview } };
    },

    async remove(workspaceId, factId) {
      return deps.call<{ ok: true }>(
        `/api/cloud/team-memory/${encodeURIComponent(factId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      );
    },
  };
}

/**
 * A team fact as a local recall candidate.
 *
 * Team facts are read-only on the client by construction: there is no writer in
 * this module that accepts a fetched fact and stores it as a local one. A cache
 * that can be written to from the network is a cache that can overwrite what
 * someone typed, and last-writer-wins across two people is a server-side decision
 * (see docs/business/TEAM-MEMORY.md §4) rather than something to re-litigate on
 * every machine.
 */
export interface TeamRecallEntry {
  id: string;
  content: string;
  category: MemoryCategory;
  workspaceId: string;
  /** Always true. Present so a call site cannot forget that it is a copy. */
  readOnly: true;
  version: number;
  updatedAt: string;
}

export function toRecallEntries(facts: readonly TeamFact[]): TeamRecallEntry[] {
  return facts
    // A fact awaiting review is not part of the team's memory yet, and neither is
    // one marked private to its author. Both are excluded here as well as on the
    // server: recall is the moment a mistake becomes visible to the wrong person.
    .filter((fact) => fact.visibility === "team")
    .map((fact) => ({
      id: fact.id,
      content: fact.body,
      category: fact.category,
      workspaceId: fact.workspaceId,
      readOnly: true as const,
      version: fact.version,
      updatedAt: fact.updatedAt,
    }));
}
