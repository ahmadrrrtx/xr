/**
 * XR 6.1 — Capability Supply-Chain Response
 *
 * Builds on Phase 9 capability provenance/signing/certification to add:
 * revoke publisher/capability, quarantine package/version,
 * notify affected deployments, block installation/update,
 * preserve evidence, restore safe version, record incident.
 */

import { randomUUID, createHash } from "node:crypto";
import type { SupplyChainAction, QuarantineRecord, SupplyChainStatus } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Supply-Chain Response Service
// ═══════════════════════════════════════════════════════════════════════════

export interface SupplyChainResponseDeps {
  /** Callback to notify affected deployments. */
  notifyDeployments?: (capabilityId: string, reason: string) => Promise<number>;
  /** Callback to block installation/updates of a capability. */
  blockInstallation?: (capabilityId: string, version?: string) => Promise<boolean>;
  /** Callback to unblock a previously blocked capability. */
  unblockInstallation?: (capabilityId: string) => Promise<boolean>;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class SupplyChainResponseService {
  private readonly actions = new Map<string, SupplyChainAction>();
  private readonly quarantines = new Map<string, QuarantineRecord>();
  private readonly blockedPublishers = new Set<string>();
  private readonly deps: SupplyChainResponseDeps;

  constructor(deps: SupplyChainResponseDeps = {}) {
    this.deps = deps;
  }

  // ── Quarantine ───────────────────────────────────────────────────────

  /** Quarantine a capability package or version. */
  async quarantine(params: {
    capabilityId: string;
    version?: string; // Specific version, or all if omitted.
    publisherId?: string;
    reason: string;
    incidentRef?: string;
    safeVersion?: string; // Known safe version to restore.
    executedBy: string;
  }): Promise<{ ok: boolean; action?: SupplyChainAction; error?: string }> {
    const quarantinedAt = Date.now();

    // Build evidence hash.
    const evidenceInput = `${params.capabilityId}:${params.version ?? "all"}:${params.reason}:${quarantinedAt}`;
    const evidenceHash = createHash("sha256").update(evidenceInput).digest("hex").slice(0, 16);

    const action: SupplyChainAction = {
      id: `sc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      kind: params.version ? "quarantine_version" : "quarantine_package",
      target: {
        capabilityId: params.capabilityId,
        version: params.version,
        publisher: params.publisherId,
      },
      reason: params.reason,
      incidentRef: params.incidentRef,
      executedAt: quarantinedAt,
      executedBy: params.executedBy,
      evidenceHash,
    };

    const record: QuarantineRecord = {
      id: `qr_${params.capabilityId}_${params.version ?? "all"}`,
      capabilityId: params.capabilityId,
      version: params.version,
      publisherId: params.publisherId,
      quarantinedAt,
      reason: params.reason,
      incidentRef: params.incidentRef,
      active: true,
      safeVersion: params.safeVersion,
    };

    this.actions.set(action.id, action);
    this.quarantines.set(record.id, record);

    // Execute blocking and notification.
    if (this.deps.blockInstallation) {
      await this.deps.blockInstallation(params.capabilityId, params.version);
    }

    let affectedDeployments = 0;
    if (this.deps.notifyDeployments) {
      affectedDeployments = await this.deps.notifyDeployments(params.capabilityId, params.reason);
    }

    this.deps.audit?.("supply_chain.quarantined", {
      actionId: action.id,
      capabilityId: params.capabilityId,
      version: params.version,
      reason: params.reason,
      affectedDeployments,
    });

    return { ok: true, action };
  }

  /** Revoke a publisher (all their capabilities). */
  async revokePublisher(params: {
    publisherId: string;
    reason: string;
    incidentRef?: string;
    executedBy: string;
  }): Promise<SupplyChainAction> {
    const action: SupplyChainAction = {
      id: `sc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      kind: "revoke_publisher",
      target: { publisher: params.publisherId },
      reason: params.reason,
      incidentRef: params.incidentRef,
      executedAt: Date.now(),
      executedBy: params.executedBy,
      evidenceHash: createHash("sha256").update(`${params.publisherId}:${Date.now()}`).digest("hex").slice(0, 16),
    };

    this.actions.set(action.id, action);
    this.blockedPublishers.add(params.publisherId);

    this.deps.audit?.("supply_chain.publisher_revoked", {
      actionId: action.id,
      publisherId: params.publisherId,
      reason: params.reason,
    });

    return action;
  }

  /** Lift a quarantine. */
  async liftQuarantine(
    capabilityId: string,
    version: string | undefined,
    executedBy: string,
    reason: string,
  ): Promise<boolean> {
    const recordId = `qr_${capabilityId}_${version ?? "all"}`;
    const record = this.quarantines.get(recordId);
    if (!record || !record.active) return false;

    this.quarantines.set(recordId, { ...record, active: false });

    if (this.deps.unblockInstallation) {
      await this.deps.unblockInstallation(capabilityId);
    }

    this.deps.audit?.("supply_chain.quarantine_lifted", {
      capabilityId,
      version,
      by: executedBy,
      reason,
    });

    return true;
  }

  /** Restore to a safe version of a quarantined capability. */
  async restoreSafeVersion(
    capabilityId: string,
    safeVersion: string,
    executedBy: string,
  ): Promise<SupplyChainAction> {
    const action: SupplyChainAction = {
      id: `sc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      kind: "restore_safe_version",
      target: { capabilityId, version: safeVersion },
      reason: `Restored safe version ${safeVersion} after quarantine`,
      executedAt: Date.now(),
      executedBy,
      evidenceHash: createHash("sha256").update(`${capabilityId}:${safeVersion}:${Date.now()}`).digest("hex").slice(0, 16),
    };

    this.actions.set(action.id, action);
    this.deps.audit?.("supply_chain.restored", {
      actionId: action.id,
      capabilityId,
      safeVersion,
      by: executedBy,
    });

    return action;
  }

  // ── Blocking ─────────────────────────────────────────────────────────

  /** Block installation of a specific capability. */
  async blockInstall(
    capabilityId: string,
    version: string | undefined,
    reason: string,
    executedBy: string,
  ): Promise<SupplyChainAction> {
    const action: SupplyChainAction = {
      id: `sc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      kind: "block_install",
      target: { capabilityId, version },
      reason,
      executedAt: Date.now(),
      executedBy,
      evidenceHash: createHash("sha256").update(`${capabilityId}:${Date.now()}`).digest("hex").slice(0, 16),
    };

    this.actions.set(action.id, action);

    if (this.deps.blockInstallation) {
      await this.deps.blockInstallation(capabilityId, version);
    }

    this.deps.audit?.("supply_chain.blocked", {
      actionId: action.id,
      capabilityId,
      version,
      by: executedBy,
    });

    return action;
  }

  /** Block an update to a capability. */
  async blockUpdate(
    capabilityId: string,
    fromVersion: string,
    toVersion: string,
    reason: string,
    executedBy: string,
  ): Promise<SupplyChainAction> {
    const action: SupplyChainAction = {
      id: `sc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      kind: "block_update",
      target: { capabilityId, version: toVersion },
      reason: `Blocked update ${fromVersion}→${toVersion}: ${reason}`,
      executedAt: Date.now(),
      executedBy,
      evidenceHash: createHash("sha256").update(`${capabilityId}:${fromVersion}:${toVersion}:${Date.now()}`).digest("hex").slice(0, 16),
    };
    this.actions.set(action.id, action);
    this.deps.audit?.("supply_chain.update_blocked", {
      actionId: action.id,
      capabilityId,
      fromVersion,
      toVersion,
    });
    return action;
  }

  // ── Notification ─────────────────────────────────────────────────────

  /** Notify all affected deployments about a supply-chain issue. */
  async notifyDeployments(capabilityId: string, reason: string): Promise<number> {
    if (!this.deps.notifyDeployments) return 0;
    const count = await this.deps.notifyDeployments(capabilityId, reason);
    this.deps.audit?.("supply_chain.notified", { capabilityId, reason, deploymentsNotified: count });
    return count;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /** Check if a capability or version is quarantined. */
  isQuarantined(capabilityId: string, version?: string): { quarantined: boolean; reason?: string } {
    for (const record of this.quarantines.values()) {
      if (!record.active) continue;
      if (record.capabilityId !== capabilityId) continue;
      if (record.version && version && record.version !== version) continue;
      return { quarantined: true, reason: record.reason };
    }
    return { quarantined: false };
  }

  /** Check if a publisher is blocked. */
  isPublisherBlocked(publisherId: string): boolean {
    return this.blockedPublishers.has(publisherId);
  }

  /** Get comprehensive supply-chain status. */
  getStatus(): SupplyChainStatus {
    const activeQuarantines = Array.from(this.quarantines.values()).filter(q => q.active);
    const recentActions = Array.from(this.actions.values())
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, 50);

    return {
      activeQuarantines,
      blockedPublishers: Array.from(this.blockedPublishers),
      recentActions,
      affectedDeployments: recentActions.length,
    };
  }

  /** List all supply-chain actions. */
  listActions(limit = 100): SupplyChainAction[] {
    return Array.from(this.actions.values())
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, limit);
  }

  /** Get a specific supply-chain action. */
  getAction(actionId: string): SupplyChainAction | undefined {
    return this.actions.get(actionId);
  }

  /** Preserve evidence for a supply-chain action (hash-based integrity). */
  preserveEvidence(actionId: string, evidence: string): string {
    const evidenceHash = createHash("sha256").update(evidence).digest("hex");
    this.deps.audit?.("supply_chain.evidence_preserved", {
      actionId,
      evidenceHash,
      evidenceLength: evidence.length,
    });
    return evidenceHash;
  }
}
