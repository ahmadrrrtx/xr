/**
 * XR 6.1 — Capability supply-chain response.
 *
 * Builds on Phase 9 provenance/signing/certification. Adds the RESPONSE side:
 *   - revoke a publisher (all their capabilities, at once)
 *   - revoke a capability, or a specific version range
 *   - quarantine and preserve evidence BEFORE mutating anything
 *   - block installation/update while a revocation is active
 *   - notify affected deployments
 *   - restore a known-safe version
 *   - record the incident
 *
 * Organization capability catalogs (allowlist/denylist) are also evaluated here
 * so an org can constrain which capabilities may run at all.
 */

import { randomUUID } from "node:crypto";
import {
  ENTERPRISE_BOUNDS,
  type AffectedDeploymentNotice,
  type AlertSeverity,
  type CapabilityCatalog,
  type CatalogDecision,
  type InstallDecision,
  type RevocationEntry,
  type RevocationReason,
  type RevocationScope,
  type SupplyChainResponseResult,
} from "../types.ts";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Minimal semver comparison (no dependency)
// ═══════════════════════════════════════════════════════════════════════════

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export function parseSemver(version: string): Semver | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4],
  };
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // A prerelease sorts BEFORE its release.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) return a.prerelease.localeCompare(b.prerelease);
  return 0;
}

/**
 * Evaluate a space-separated range such as `>=1.2.0 <1.4.1`, or an exact
 * version, or `*`. Comparators: `>=`, `>`, `<=`, `<`, `=`.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part);
    if (!m) return false;
    const op = m[1] ?? "=";
    const target = parseSemver(m[2]!);
    if (!target) return false;
    const cmp = compareSemver(v, target);
    const ok =
      op === ">=" ? cmp >= 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : op === "<" ? cmp < 0 : cmp === 0;
    if (!ok) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Capability snapshot (for evidence preservation)
// ═══════════════════════════════════════════════════════════════════════════

export interface CapabilitySnapshot {
  readonly capabilityId: string;
  readonly version?: string;
  readonly publisherId?: string;
  readonly signatureStatus?: string;
  readonly certificationStatus?: string;
  readonly lifecycleState?: string;
  readonly installedInWorkspaces: readonly string[];
  readonly capturedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Response service
// ═══════════════════════════════════════════════════════════════════════════

export interface SupplyChainDeps {
  readonly audit?: (event: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** Snapshot a capability before mutating it — evidence preservation. */
  readonly snapshot?: (capabilityId: string) => CapabilitySnapshot | undefined;
  /** Bridge to Phase 9 CapabilityService.quarantine. */
  readonly quarantineCapability?: (capabilityId: string, reason: string) => { ok: boolean; detail?: string };
  /** Bridge to Phase 9 CapabilityService.rollback. */
  readonly rollbackCapability?: (capabilityId: string, version?: string) => { ok: boolean; detail?: string };
  /** Which capabilities a publisher owns. */
  readonly capabilitiesOfPublisher?: (publisherId: string) => readonly string[];
  /** Which workspaces have a capability installed — drives notifications. */
  readonly affectedWorkspaces?: (capabilityId: string) => readonly string[];
  /** Record an incident for this response. */
  readonly declareIncident?: (params: {
    capabilityId: string;
    reason: RevocationReason;
    detail: string;
    actorId: string;
  }) => string | undefined;
}

export class SupplyChainResponseService {
  private readonly entries = new Map<string, RevocationEntry>();
  private readonly notices = new Map<string, AffectedDeploymentNotice>();
  private readonly catalogs = new Map<string, CapabilityCatalog>();
  private readonly snapshots = new Map<string, CapabilitySnapshot>();
  private readonly deps: SupplyChainDeps;

  constructor(deps: SupplyChainDeps = {}) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ── Revocation ───────────────────────────────────────────────────────────

  /**
   * Revoke a capability, version range, or publisher.
   *
   * Order of operations matters: evidence is preserved BEFORE quarantine, so a
   * malicious capability cannot erase its own trail by being disabled.
   */
  revoke(params: {
    scope: RevocationScope;
    targetId: string;
    reason: RevocationReason;
    detail: string;
    issuedBy: string;
    versionRange?: string;
    organizationId?: string;
    expiresAt?: number;
    blockInstall?: boolean;
    declareIncident?: boolean;
  }): SupplyChainResponseResult {
    const now = this.now();

    if (this.entries.size >= ENTERPRISE_BOUNDS.MAX_REVOCATION_ENTRIES) {
      return { ok: false, notices: [], error: "Revocation list is full." };
    }

    if (params.scope === "capability_version" && !params.versionRange) {
      return { ok: false, notices: [], error: "versionRange is required for capability_version scope." };
    }

    // ── 1. Preserve evidence FIRST ─────────────────────────────────────────
    const targets =
      params.scope === "publisher"
        ? (this.deps.capabilitiesOfPublisher?.(params.targetId) ?? [])
        : [params.targetId];

    let evidenceId: string | undefined;
    for (const capId of targets) {
      const snap = this.deps.snapshot?.(capId);
      if (snap) {
        const sid = id("snap");
        this.snapshots.set(sid, snap);
        evidenceId ??= sid;
        this.deps.audit?.("enterprise.supplychain.evidence_preserved", {
          snapshotId: sid,
          capabilityId: capId,
          version: snap.version,
          lifecycleState: snap.lifecycleState,
        });
      }
    }

    // ── 2. Record the revocation entry ─────────────────────────────────────
    const entry: RevocationEntry = {
      entryId: id("rev"),
      scope: params.scope,
      targetId: params.targetId,
      versionRange: params.versionRange,
      reason: params.reason,
      detail: params.detail,
      issuedBy: params.issuedBy,
      issuedAt: now,
      organizationId: params.organizationId,
      expiresAt: params.expiresAt,
      blockInstall: params.blockInstall ?? true,
      active: true,
    };
    this.entries.set(entry.entryId, entry);

    // ── 3. Quarantine affected capabilities ────────────────────────────────
    for (const capId of targets) {
      const r = this.deps.quarantineCapability?.(capId, `${params.reason}: ${params.detail}`);
      this.deps.audit?.("enterprise.supplychain.quarantined", {
        entryId: entry.entryId,
        capabilityId: capId,
        ok: r?.ok ?? false,
        detail: r?.detail,
      });
    }

    // ── 4. Notify affected deployments ─────────────────────────────────────
    const notices: AffectedDeploymentNotice[] = [];
    for (const capId of targets) {
      const workspaces = this.deps.affectedWorkspaces?.(capId) ?? [];
      const notice: AffectedDeploymentNotice = {
        noticeId: id("not"),
        entryId: entry.entryId,
        capabilityId: capId,
        organizationId: params.organizationId,
        workspaceIds: workspaces,
        createdAt: now,
        severity: severityFor(params.reason),
        message: `Capability '${capId}' has been revoked (${params.reason}). ${params.detail}`,
        acknowledged: false,
        recommendedAction: recommendedActionFor(params.reason),
      };
      this.notices.set(notice.noticeId, notice);
      notices.push(notice);
    }

    // ── 5. Record an incident ──────────────────────────────────────────────
    let incidentId: string | undefined;
    if (params.declareIncident !== false && (params.reason === "malicious" || params.reason === "compromised_publisher")) {
      incidentId = this.deps.declareIncident?.({
        capabilityId: params.targetId,
        reason: params.reason,
        detail: params.detail,
        actorId: params.issuedBy,
      });
    }

    this.deps.audit?.("enterprise.supplychain.revoked", {
      entryId: entry.entryId,
      scope: entry.scope,
      targetId: entry.targetId,
      versionRange: entry.versionRange,
      reason: entry.reason,
      issuedBy: entry.issuedBy,
      affectedCapabilities: targets.length,
      noticesCreated: notices.length,
      incidentId,
    });

    return { ok: true, entry, evidenceId, notices, incidentId };
  }

  /** Convenience wrappers. */
  revokePublisher(publisherId: string, reason: RevocationReason, detail: string, issuedBy: string): SupplyChainResponseResult {
    return this.revoke({ scope: "publisher", targetId: publisherId, reason, detail, issuedBy });
  }

  revokeVersionRange(
    capabilityId: string,
    versionRange: string,
    reason: RevocationReason,
    detail: string,
    issuedBy: string,
  ): SupplyChainResponseResult {
    return this.revoke({ scope: "capability_version", targetId: capabilityId, versionRange, reason, detail, issuedBy });
  }

  /** Lift a revocation (e.g. a false positive, or a fixed version shipped). */
  lift(entryId: string, actorId: string, reason: string): { ok: boolean; error?: string } {
    const entry = this.entries.get(entryId);
    if (!entry) return { ok: false, error: `Revocation entry not found: ${entryId}` };
    if (!entry.active) return { ok: false, error: "Revocation is already inactive." };
    const now = this.now();
    this.entries.set(entryId, { ...entry, active: false, revokedAt: now });
    this.deps.audit?.("enterprise.supplychain.revocation_lifted", { entryId, actorId, reason });
    return { ok: true };
  }

  /** Restore a known-safe version after a revocation. */
  restoreSafeVersion(params: {
    capabilityId: string;
    version: string;
    actorId: string;
    reason: string;
  }): { ok: boolean; detail: string } {
    // Refuse to restore a version that is itself revoked.
    const decision = this.checkInstall(params.capabilityId, params.version);
    if (!decision.allowed) {
      this.deps.audit?.("enterprise.supplychain.restore_blocked", {
        capabilityId: params.capabilityId,
        version: params.version,
        actorId: params.actorId,
        reason: decision.reason,
      });
      return { ok: false, detail: `Restore blocked: ${decision.reason}` };
    }

    const r = this.deps.rollbackCapability?.(params.capabilityId, params.version);
    this.deps.audit?.("enterprise.supplychain.restored", {
      capabilityId: params.capabilityId,
      version: params.version,
      actorId: params.actorId,
      ok: r?.ok ?? false,
      reason: params.reason,
    });
    return { ok: r?.ok ?? false, detail: r?.detail ?? (r?.ok ? "Restored." : "No rollback handler available.") };
  }

  // ── Install/update gating ────────────────────────────────────────────────

  /**
   * Decide whether a capability version may be installed or updated.
   * Called by the install path; a matching active revocation blocks it.
   */
  checkInstall(capabilityId: string, version?: string, publisherId?: string): InstallDecision {
    const now = this.now();

    for (const entry of this.entries.values()) {
      if (!entry.active) continue;
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) continue;
      if (!entry.blockInstall) continue;

      if (entry.scope === "publisher" && publisherId && entry.targetId === publisherId) {
        return {
          allowed: false,
          capabilityId,
          version,
          reason: `Publisher '${publisherId}' is revoked (${entry.reason}): ${entry.detail}`,
          matchedEntryId: entry.entryId,
          matchedScope: entry.scope,
        };
      }

      if (entry.scope === "capability" && entry.targetId === capabilityId) {
        return {
          allowed: false,
          capabilityId,
          version,
          reason: `Capability '${capabilityId}' is revoked (${entry.reason}): ${entry.detail}`,
          matchedEntryId: entry.entryId,
          matchedScope: entry.scope,
        };
      }

      if (entry.scope === "capability_version" && entry.targetId === capabilityId) {
        if (!version) {
          return {
            allowed: false,
            capabilityId,
            reason: `Capability '${capabilityId}' has revoked versions (${entry.versionRange}) and no version was specified.`,
            matchedEntryId: entry.entryId,
            matchedScope: entry.scope,
          };
        }
        if (entry.versionRange && satisfiesRange(version, entry.versionRange)) {
          return {
            allowed: false,
            capabilityId,
            version,
            reason: `Version ${version} falls in revoked range '${entry.versionRange}' (${entry.reason}): ${entry.detail}`,
            matchedEntryId: entry.entryId,
            matchedScope: entry.scope,
          };
        }
      }
    }

    return { allowed: true, capabilityId, version, reason: "No active revocation matches." };
  }

  activeRevocations(organizationId?: string): readonly RevocationEntry[] {
    const now = this.now();
    return [...this.entries.values()]
      .filter((e) => e.active && (e.expiresAt === undefined || e.expiresAt > now))
      .filter((e) => organizationId === undefined || e.organizationId === undefined || e.organizationId === organizationId)
      .sort((a, b) => b.issuedAt - a.issuedAt);
  }

  allRevocations(): readonly RevocationEntry[] {
    return [...this.entries.values()].sort((a, b) => b.issuedAt - a.issuedAt);
  }

  snapshot(snapshotId: string): CapabilitySnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  // ── Notices ──────────────────────────────────────────────────────────────

  pendingNotices(organizationId?: string): readonly AffectedDeploymentNotice[] {
    return [...this.notices.values()]
      .filter((n) => !n.acknowledged)
      .filter((n) => organizationId === undefined || n.organizationId === organizationId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  acknowledgeNotice(noticeId: string, actorId: string): { ok: boolean; error?: string } {
    const n = this.notices.get(noticeId);
    if (!n) return { ok: false, error: `Notice not found: ${noticeId}` };
    this.notices.set(noticeId, { ...n, acknowledged: true, acknowledgedAt: this.now(), acknowledgedBy: actorId });
    this.deps.audit?.("enterprise.supplychain.notice_acknowledged", { noticeId, actorId });
    return { ok: true };
  }

  // ── Organization capability catalogs ─────────────────────────────────────

  setCatalog(catalog: CapabilityCatalog): CapabilityCatalog {
    const existing = this.catalogs.get(catalog.organizationId);
    const next: CapabilityCatalog = existing ? { ...catalog, version: existing.version + 1 } : catalog;
    this.catalogs.set(catalog.organizationId, next);
    this.deps.audit?.("enterprise.supplychain.catalog_set", {
      catalogId: next.catalogId,
      organizationId: next.organizationId,
      mode: next.mode,
      entries: next.entries.length,
      version: next.version,
      updatedBy: next.updatedBy,
    });
    return next;
  }

  catalog(organizationId: string): CapabilityCatalog | undefined {
    return this.catalogs.get(organizationId);
  }

  /**
   * Evaluate a capability against the organization catalog.
   * Revocation is checked first — a revoked capability is never allowed by a
   * catalog entry.
   */
  checkCatalog(params: {
    organizationId: string;
    capabilityId: string;
    version?: string;
    publisherId?: string;
    signed?: boolean;
    certified?: boolean;
  }): CatalogDecision {
    const install = this.checkInstall(params.capabilityId, params.version, params.publisherId);
    if (!install.allowed) {
      return { allowed: false, capabilityId: params.capabilityId, reason: install.reason };
    }

    const catalog = this.catalogs.get(params.organizationId);
    if (!catalog) {
      return {
        allowed: true,
        capabilityId: params.capabilityId,
        reason: "No organization catalog configured — default open.",
      };
    }

    if (catalog.requireSigned && params.signed === false) {
      return {
        allowed: false,
        capabilityId: params.capabilityId,
        reason: "Organization catalog requires signed packages.",
        catalogId: catalog.catalogId,
        mode: catalog.mode,
      };
    }

    if (catalog.requireCertified && params.certified === false) {
      return {
        allowed: false,
        capabilityId: params.capabilityId,
        reason: "Organization catalog requires certified capabilities.",
        catalogId: catalog.catalogId,
        mode: catalog.mode,
      };
    }

    const match = catalog.entries.find((e) => e.capabilityId === params.capabilityId);

    if (catalog.mode === "allowlist") {
      if (!match) {
        return {
          allowed: false,
          capabilityId: params.capabilityId,
          reason: "Not present in the organization allowlist.",
          catalogId: catalog.catalogId,
          mode: catalog.mode,
        };
      }
      if (params.version && match.minVersion && !satisfiesRange(params.version, `>=${match.minVersion}`)) {
        return {
          allowed: false,
          capabilityId: params.capabilityId,
          reason: `Version ${params.version} is below the catalog minimum ${match.minVersion}.`,
          catalogId: catalog.catalogId,
          mode: catalog.mode,
        };
      }
      if (params.version && match.maxVersion && !satisfiesRange(params.version, `<=${match.maxVersion}`)) {
        return {
          allowed: false,
          capabilityId: params.capabilityId,
          reason: `Version ${params.version} is above the catalog maximum ${match.maxVersion}.`,
          catalogId: catalog.catalogId,
          mode: catalog.mode,
        };
      }
      return {
        allowed: true,
        capabilityId: params.capabilityId,
        reason: "Present in the organization allowlist.",
        catalogId: catalog.catalogId,
        mode: catalog.mode,
      };
    }

    if (catalog.mode === "denylist") {
      if (match) {
        return {
          allowed: false,
          capabilityId: params.capabilityId,
          reason: `Denied by organization catalog${match.note ? `: ${match.note}` : "."}`,
          catalogId: catalog.catalogId,
          mode: catalog.mode,
        };
      }
      return {
        allowed: true,
        capabilityId: params.capabilityId,
        reason: "Not present in the organization denylist.",
        catalogId: catalog.catalogId,
        mode: catalog.mode,
      };
    }

    return {
      allowed: true,
      capabilityId: params.capabilityId,
      reason: "Organization catalog is open.",
      catalogId: catalog.catalogId,
      mode: catalog.mode,
    };
  }
}

function severityFor(reason: RevocationReason): AlertSeverity {
  switch (reason) {
    case "malicious":
    case "compromised_publisher":
      return "critical";
    case "vulnerable":
      return "error";
    case "policy_violation":
    case "unverified":
      return "warning";
    case "abandoned":
      return "info";
  }
}

function recommendedActionFor(reason: RevocationReason): string {
  switch (reason) {
    case "malicious":
      return "Remove immediately, rotate any credentials the capability could access, and review its audit trail.";
    case "compromised_publisher":
      return "Remove all capabilities from this publisher and rotate related credentials.";
    case "vulnerable":
      return "Update to a fixed version, or disable until a fix is published.";
    case "abandoned":
      return "Plan migration to a maintained alternative.";
    case "policy_violation":
      return "Review organization policy and remove or request an exception.";
    case "unverified":
      return "Obtain a signed, certified build before re-enabling.";
  }
}
