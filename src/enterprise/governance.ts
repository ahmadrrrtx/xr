/**
 * XR 6.1 — Governance and Contribution Procedures
 *
 * Transparent processes for release approval, security disclosure,
 * vulnerability response, capability certification, breaking changes,
 * deprecation, contribution review, architecture exceptions, and
 * incident publication.
 *
 * This is organizational/operational work supported by code; it does NOT
 * encode all governance as runtime logic.
 */

import { randomUUID } from "node:crypto";
import type {
  GovernanceProposal,
  GovernanceCategory,
  GovernanceVote,
  ArchitectureException,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Governance Service
// ═══════════════════════════════════════════════════════════════════════════

export interface GovernanceDeps {
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class GovernanceService {
  private readonly proposals = new Map<string, GovernanceProposal>();
  private readonly exceptions = new Map<string, ArchitectureException>();
  private readonly deps: GovernanceDeps;

  // Required approvers for each category.
  private readonly requiredApprovers: Record<GovernanceCategory, string[]> = {
    architecture: ["chief_architect"],
    security: ["security_admin", "chief_architect"],
    release: ["release_manager", "chief_architect"],
    dependency: ["chief_architect"],
    deprecation: ["chief_architect"],
    process: ["org_admin"],
    community: ["org_owner"],
  };

  // Minimum votes to pass per category.
  private readonly minimumApprovals: Record<GovernanceCategory, number> = {
    architecture: 2,
    security: 2,
    release: 2,
    dependency: 1,
    deprecation: 1,
    process: 1,
    community: 1,
  };

  constructor(deps: GovernanceDeps = {}) {
    this.deps = deps;
  }

  // ── Proposals ────────────────────────────────────────────────────────

  /** Create a governance proposal. */
  createProposal(params: {
    title: string;
    category: GovernanceCategory;
    description: string;
    proposedBy: string;
    architecturalImpact?: ArchitectureException["architecturalImpact"];
  }): GovernanceProposal {
    const proposal: GovernanceProposal = {
      id: `gp_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      title: params.title,
      category: params.category,
      description: params.description,
      proposedBy: params.proposedBy,
      proposedAt: Date.now(),
      status: "draft",
      votes: [],
      architecturalImpact: params.architecturalImpact ?? "none",
    };

    this.proposals.set(proposal.id, proposal);

    this.deps.audit?.("governance.proposal_created", {
      id: proposal.id,
      category: params.category,
      by: params.proposedBy,
    });

    return proposal;
  }

  /** Open a proposal for voting. */
  openProposal(proposalId: string, openedBy: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "draft") return false;

    this.proposals.set(proposalId, { ...proposal, status: "open" });

    this.deps.audit?.("governance.proposal_opened", { id: proposalId, by: openedBy });
    return true;
  }

  /** Cast a vote on a proposal. */
  vote(proposalId: string, vote: GovernanceVote): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "open") return false;

    // Check for duplicate votes.
    if (proposal.votes.some(v => v.voter === vote.voter)) return false;

    const votes = [...proposal.votes, vote];
    this.proposals.set(proposalId, { ...proposal, votes });

    this.deps.audit?.("governance.vote_cast", {
      proposalId,
      voter: vote.voter,
      decision: vote.decision,
    });

    // Check if proposal meets threshold.
    this.checkProposalResolution(proposalId);

    return true;
  }

  /** Withdraw a proposal. */
  withdrawProposal(proposalId: string, withdrawnBy: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return false;
    if (proposal.status === "implemented") return false;

    this.proposals.set(proposalId, { ...proposal, status: "withdrawn" });

    this.deps.audit?.("governance.proposal_withdrawn", { id: proposalId, by: withdrawnBy });
    return true;
  }

  /** Mark a proposal as implemented. */
  implementProposal(proposalId: string, version: string, implementedBy: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "accepted") return false;

    this.proposals.set(proposalId, {
      ...proposal,
      status: "implemented",
      implementedIn: version,
    });

    this.deps.audit?.("governance.proposal_implemented", {
      id: proposalId,
      version,
      by: implementedBy,
    });

    return true;
  }

  /** Get a proposal. */
  getProposal(id: string): GovernanceProposal | undefined {
    return this.proposals.get(id);
  }

  /** List proposals. */
  listProposals(filter?: { status?: GovernanceProposal["status"]; category?: GovernanceCategory }): GovernanceProposal[] {
    let results = Array.from(this.proposals.values());
    if (filter?.status) results = results.filter(p => p.status === filter.status);
    if (filter?.category) results = results.filter(p => p.category === filter.category);
    return results.sort((a, b) => b.proposedAt - a.proposedAt);
  }

  /** Get proposal status summary. */
  getProposalSummary(): { open: number; accepted: number; rejected: number; implemented: number } {
    let open = 0, accepted = 0, rejected = 0, implemented = 0;
    for (const p of this.proposals.values()) {
      switch (p.status) {
        case "open": case "draft": open++; break;
        case "accepted": accepted++; break;
        case "rejected": rejected++; break;
        case "implemented": implemented++; break;
      }
    }
    return { open, accepted, rejected, implemented };
  }

  // ── Architecture Exceptions ──────────────────────────────────────────

  /** Register an architecture exception. */
  registerException(params: {
    invariant: string;
    violation: string;
    justification: string;
    riskBoundedBy: string;
    migrationPath: string;
    owner: string;
    approvedBy: string[];
    reviewInDays?: number;
  }): ArchitectureException {
    const now = Date.now();
    const exception: ArchitectureException = {
      id: `ae_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      invariant: params.invariant,
      violation: params.violation,
      justification: params.justification,
      riskBoundedBy: params.riskBoundedBy,
      migrationPath: params.migrationPath,
      owner: params.owner,
      approvedBy: params.approvedBy,
      approvedAt: now,
      reviewDate: now + (params.reviewInDays ?? 90) * 24 * 60 * 60 * 1000,
      status: "active",
    };

    this.exceptions.set(exception.id, exception);

    this.deps.audit?.("governance.exception_registered", {
      id: exception.id,
      invariant: params.invariant,
      owner: params.owner,
    });

    return exception;
  }

  /** Resolve an architecture exception. */
  resolveException(id: string, resolvedBy: string): boolean {
    const exception = this.exceptions.get(id);
    if (!exception || exception.status !== "active") return false;

    this.exceptions.set(id, { ...exception, status: "resolved" });

    this.deps.audit?.("governance.exception_resolved", { id, by: resolvedBy });
    return true;
  }

  /** Get an exception. */
  getException(id: string): ArchitectureException | undefined {
    return this.exceptions.get(id);
  }

  /** List active exceptions. */
  listExceptions(activeOnly = true): ArchitectureException[] {
    const all = Array.from(this.exceptions.values());
    return activeOnly ? all.filter(e => e.status === "active") : all;
  }

  /** Get exceptions due for review. */
  getPendingReviews(): ArchitectureException[] {
    const now = Date.now();
    return Array.from(this.exceptions.values())
      .filter(e => e.status === "active" && e.reviewDate < now);
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private checkProposalResolution(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "open") return;

    const requiredApprovers = this.requiredApprovers[proposal.category] ?? [];
    const minApprovals = this.minimumApprovals[proposal.category] ?? 1;

    const approvals = proposal.votes.filter(v => v.decision === "approve").length;
    const rejections = proposal.votes.filter(v => v.decision === "reject").length;

    // Check if required approvers have voted.
    const approverVotes = proposal.votes
      .filter(v => v.decision === "approve" && requiredApprovers.includes(v.voter));

    if (approverVotes.length >= requiredApprovers.length && approvals >= minApprovals) {
      this.proposals.set(proposalId, { ...proposal, status: "accepted" });
      this.deps.audit?.("governance.proposal_accepted", { id: proposalId, approvals, rejections });
    } else if (rejections > approvals) {
      this.proposals.set(proposalId, { ...proposal, status: "rejected" });
      this.deps.audit?.("governance.proposal_rejected", { id: proposalId, approvals, rejections });
    }
  }

  /**
   * Get the governance contribution procedures.
   */
  getContributionProcedures(): string[] {
    return [
      "All architecture changes require a governance proposal (category: architecture)",
      "Security-sensitive changes require security_admin approval",
      "Breaking changes require deprecation notice with migration path",
      "New capabilities require capability certification review",
      "External contributions follow standard review process via pull requests",
      "Architecture exceptions must be documented with bounded risk, migration path, and review date",
      "Release decisions follow the release channels policy",
      "Vulnerability disclosures follow the coordinated disclosure policy",
      "Incident postmortems are published (with appropriate redaction) after resolution",
      "Governance proposals are open for at least 7 days before resolution",
    ];
  }
}
