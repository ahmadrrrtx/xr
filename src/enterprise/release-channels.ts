/**
 * XR 6.1 — Release Channels, Compatibility, and Support Windows
 *
 * Manages release channels (stable, LTS, candidate, beta, edge),
 * compatibility matrices, migration checks, rollback validation,
 * SBOM/dependency evidence, and reproducible release artifacts.
 */

import { randomUUID } from "node:crypto";
import type {
  ReleaseChannel,
  ReleaseRecord,
  CompatibilityMatrix,
  SupportWindow,
} from "./types.ts";
import type { DeploymentProfileKind } from "../deployment/types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Default Support Windows
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_SUPPORT_WINDOWS: Record<ReleaseChannel, SupportWindow> = {
  stable: {
    channel: "stable",
    securityPatchesMonths: 12,
    bugFixesMonths: 6,
    technicalSupportMonths: 12,
    extendedSupportAvailable: true,
  },
  lts: {
    channel: "lts",
    securityPatchesMonths: 36,
    bugFixesMonths: 24,
    technicalSupportMonths: 36,
    extendedSupportAvailable: true,
  },
  candidate: {
    channel: "candidate",
    securityPatchesMonths: 3,
    bugFixesMonths: 1,
    technicalSupportMonths: 3,
    extendedSupportAvailable: false,
  },
  beta: {
    channel: "beta",
    securityPatchesMonths: 0,
    bugFixesMonths: 0,
    technicalSupportMonths: 0,
    extendedSupportAvailable: false,
  },
  edge: {
    channel: "edge",
    securityPatchesMonths: 0,
    bugFixesMonths: 0,
    technicalSupportMonths: 0,
    extendedSupportAvailable: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Release Channels Service
// ═══════════════════════════════════════════════════════════════════════════

export interface ReleaseChannelsDeps {
  /** Current XR version. */
  currentVersion: string;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class ReleaseChannelsService {
  private readonly releases = new Map<string, ReleaseRecord>();
  private readonly compatibilities = new Map<string, CompatibilityMatrix>();
  private supportWindows: Record<ReleaseChannel, SupportWindow>;
  private activeChannel: ReleaseChannel;
  private readonly deps: ReleaseChannelsDeps;

  constructor(deps: ReleaseChannelsDeps) {
    this.deps = deps;
    this.supportWindows = { ...DEFAULT_SUPPORT_WINDOWS };
    this.activeChannel = "stable";
  }

  // ── Release Records ──────────────────────────────────────────────────

  /** Register a release record. */
  registerRelease(release: ReleaseRecord): void {
    this.releases.set(release.version, release);
    this.deps.audit?.("release.registered", {
      version: release.version,
      channel: release.channel,
      breakingChanges: release.breakingChanges.length,
    });
  }

  /** Get a release by version. */
  getRelease(version: string): ReleaseRecord | undefined {
    return this.releases.get(version);
  }

  /** List all releases, optionally filtered by channel. */
  listReleases(channel?: ReleaseChannel): ReleaseRecord[] {
    const all = Array.from(this.releases.values());
    return (channel ? all.filter(r => r.channel === channel) : all)
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }

  /** Get the latest release in a channel. */
  getLatestInChannel(channel: ReleaseChannel): ReleaseRecord | undefined {
    const channelReleases = this.listReleases(channel);
    return channelReleases[0];
  }

  /** Check if a version is still supported. */
  isSupported(version: string): boolean {
    const release = this.releases.get(version);
    if (!release) return true; // Unknown versions are not blocked.

    const supportWindow = this.supportWindows[release.channel];
    if (!supportWindow) return false;
    if (supportWindow.securityPatchesMonths === 0) return false;

    const eolMs = (release.supportedUntil ?? release.publishedAt + supportWindow.securityPatchesMonths * 30 * 24 * 60 * 60 * 1000);
    return Date.now() < eolMs;
  }

  /** Check for EOL (end-of-life). */
  checkEOL(version: string): { eol: boolean; supportedUntil?: number; channel?: ReleaseChannel } {
    const release = this.releases.get(version);
    if (!release) return { eol: false };

    const supportWindow = this.supportWindows[release.channel];
    if (!supportWindow) return { eol: true };

    const supportedUntil = release.supportedUntil ??
      release.publishedAt + supportWindow.securityPatchesMonths * 30 * 24 * 60 * 60 * 1000;

    return {
      eol: Date.now() >= supportedUntil,
      supportedUntil,
      channel: release.channel,
    };
  }

  // ── Channel Management ───────────────────────────────────────────────

  /** Get the active channel. */
  getActiveChannel(): ReleaseChannel {
    return this.activeChannel;
  }

  /** Switch the active release channel. */
  setActiveChannel(channel: ReleaseChannel, changedBy: string): void {
    this.activeChannel = channel;
    this.deps.audit?.("release.channel_changed", { channel, by: changedBy });
  }

  /** Get support window for a channel. */
  getSupportWindow(channel: ReleaseChannel): SupportWindow {
    return this.supportWindows[channel];
  }

  /** Update a support window. */
  updateSupportWindow(channel: ReleaseChannel, updates: Partial<SupportWindow>): void {
    this.supportWindows[channel] = { ...this.supportWindows[channel], ...updates };
  }

  // ── Compatibility ────────────────────────────────────────────────────

  /** Register a compatibility matrix entry. */
  registerCompatibility(matrix: CompatibilityMatrix): void {
    this.compatibilities.set(matrix.version, matrix);
  }

  /** Get compatibility for a version. */
  getCompatibility(version: string): CompatibilityMatrix | undefined {
    return this.compatibilities.get(version);
  }

  /** Check if two versions are compatible for migration. */
  isCompatible(fromVersion: string, toVersion: string): { compatible: boolean; issues: string[] } {
    const from = this.compatibilities.get(fromVersion);
    const to = this.compatibilities.get(toVersion);
    const issues: string[] = [];

    if (!from || !to) return { compatible: true, issues };

    // API version compatibility.
    const fromApis = new Set(from.apiVersions);
    for (const api of to.apiVersions) {
      if (!fromApis.has(api)) {
        issues.push(`API ${api} added in ${toVersion}`);
      }
    }

    // Schema version checks.
    if (to.databaseSchemaVersion < from.databaseSchemaVersion) {
      issues.push(`Database schema downgrade from ${from.databaseSchemaVersion} to ${to.databaseSchemaVersion}`);
    }

    // Profile compatibility.
    for (const profile of from.supportedProfiles) {
      if (!to.supportedProfiles.includes(profile)) {
        issues.push(`Profile ${profile} dropped in ${toVersion}`);
      }
    }

    return { compatible: issues.length === 0, issues };
  }

  /** Check if a migration path exists between versions. */
  validateMigration(fromVersion: string, toVersion: string): {
    valid: boolean;
    requiresIntermediateVersion?: string;
    migrationGuide?: string;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const toRelease = this.releases.get(toVersion);

    if (!toRelease) {
      return { valid: false, warnings: [`Target version ${toVersion} not found`] };
    }

    // Check for breaking changes.
    if (toRelease.breakingChanges.length > 0) {
      warnings.push(`${toRelease.breakingChanges.length} breaking changes in ${toVersion}`);
    }

    // Check for migration guide.
    if (toRelease.migrationGuide) {
      return { valid: true, migrationGuide: toRelease.migrationGuide, warnings };
    }

    // Check compatibility.
    const compat = this.isCompatible(fromVersion, toVersion);
    if (!compat.compatible) {
      warnings.push(...compat.issues);
    }

    return { valid: true, warnings };
  }

  // ── Rollback ─────────────────────────────────────────────────────────

  /** Get the rollback target for a version. */
  getRollbackTarget(version: string): string | undefined {
    return this.releases.get(version)?.rollbackTarget;
  }

  /** Validate that a rollback is safe. */
  validateRollback(fromVersion: string, toVersion: string): { safe: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Rollback should not skip major version boundaries without explicit guide.
    const fromMajor = parseInt(fromVersion.split(".")[0], 10);
    const toMajor = parseInt(toVersion.split(".")[0], 10);
    if (Math.abs(fromMajor - toMajor) > 1) {
      warnings.push(`Rollback across major versions (${fromVersion} → ${toVersion})`);
    }

    const fromRelease = this.releases.get(fromVersion);
    if (fromRelease?.breakingChanges.length) {
      warnings.push(`Version ${fromVersion} has breaking changes that may have modified data`);
    }

    return {
      safe: warnings.length === 0 || warnings.every(w => !w.includes("data")),
      warnings,
    };
  }

  // ── SBOM ─────────────────────────────────────────────────────────────

  /** Generate a simple SBOM reference for a version. */
  getSBOM(version: string): { version: string; sbomUrl?: string } | undefined {
    const release = this.releases.get(version);
    if (!release) return undefined;
    return { version: release.version, sbomUrl: release.sbomUrl };
  }
}
