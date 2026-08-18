/**
 * XR Phase 08 — UnifiedCapabilityService.
 *
 * Owns ToolRegistryService + provides unified discovery, policy evaluation,
 * lifecycle management, provenance recording, inventory generation.
 *
 * This is NOT a duplicate registry: it wraps ToolRegistryService (canonical
 * execution boundary) and adds lifecycle/trust maps + policy.
 *
 * It also integrates with CapabilityService (platform) inventory plane for
 * dashboard/API compatibility — but the execution remains through ToolRegistry.
 */

import { ToolRegistryService } from "../tools/registry-service.ts";
import type { CapabilityLifecycleState, CapabilityTrustLevel, CapabilityScope, CapabilityPermission } from "../tools/registry-types.ts";
import type { CapabilityMetadata } from "../tools/registry-types.ts";
import type { Mode, Tool } from "../core/types.ts";
import { evaluatePolicy, type PolicyContext } from "./policy.ts";
import { createCapabilityRequest } from "./request.ts";
import type {
  CapabilityDiscoveryQuery,
  CapabilityRequest,
} from "./types.ts";
import { discoverCapabilities, type DiscoveryContext } from "./discovery.ts";
import { CapabilityProvenanceStore } from "../platform/capabilities/provenance.ts";
import { CapabilityMetadataStore } from "../platform/capabilities/store.ts";

export interface UnifiedCapabilityServiceOptions {
  registry: ToolRegistryService;
  cwd?: string;
  deniedPermissions?: string[];
  egressAllowlist?: string[];
  allowedHosts?: string[];
}

export class UnifiedCapabilityService {
  readonly registry: ToolRegistryService;
  private readonly cwd: string;
  private readonly deniedPermissions: string[];
  private readonly egressAllowlist: string[];
  private readonly allowedHosts: string[];
  private readonly provenance: CapabilityProvenanceStore;
  private readonly metadataStore: CapabilityMetadataStore;

  constructor(opts: UnifiedCapabilityServiceOptions) {
    this.registry = opts.registry;
    this.cwd = opts.cwd ?? process.cwd();
    this.deniedPermissions = opts.deniedPermissions ?? [];
    this.egressAllowlist = opts.egressAllowlist ?? [];
    this.allowedHosts = opts.allowedHosts ?? [];
    this.provenance = new CapabilityProvenanceStore();
    this.metadataStore = new CapabilityMetadataStore();
  }

  // ── Discovery ───────────────────────────────────────────────────────────

  discover(query: CapabilityDiscoveryQuery): Tool[] {
    const ctx: DiscoveryContext = {
      registry: this.registry,
      cwd: this.cwd,
      deniedPermissions: this.deniedPermissions,
      egressAllowlist: this.egressAllowlist,
    };
    return discoverCapabilities(query, ctx);
  }

  list(): ReturnType<ToolRegistryService["list"]> {
    return this.registry.list();
  }

  listEnabled(): ReturnType<ToolRegistryService["list"]> {
    return this.registry.listEnabled();
  }

  resolve(nameOrId: string) {
    return this.registry.resolve(nameOrId);
  }

  // ── Policy ──────────────────────────────────────────────────────────────

  evaluate(request: CapabilityRequest) {
    const policyCtx: PolicyContext = {
      registry: this.registry,
      deniedPermissions: this.deniedPermissions,
      egressAllowlist: this.egressAllowlist,
      allowedHosts: this.allowedHosts,
      cwd: this.cwd,
    };
    return evaluatePolicy(request, policyCtx);
  }

  request(opts: {
    capabilityId: string;
    requestedBy?: string;
    runId?: string;
    sessionId?: string;
    scope?: any;
    workspaceId?: string;
    arguments?: Record<string, unknown>;
    reason?: string;
    mode?: Mode;
  }) {
    return this.evaluate(createCapabilityRequest(opts));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  setLifecycle(id: string, state: CapabilityLifecycleState, reason?: string, actor = "user"): boolean {
    const entry = this.registry.resolve(id) ?? this.registry.list().find((e) => e.id === id);
    const prev = entry?.lifecycle ?? "unknown";
    const ok = this.registry.setLifecycle(id, state, reason);
    if (ok && entry) {
      this.metadataStore.setState(entry.id, state as any, reason);
      this.metadataStore.record(entry.id, state, reason, actor);
      this.provenance.recordEvent(entry.id, state === "enabled" ? "enable" : state === "disabled" ? "disable" : state === "quarantined" ? "quarantine" : state === "rolled_back" ? "rollback" : "update", {
        actor,
        detail: reason ?? `${prev} → ${state}`,
      });
    }
    return ok;
  }

  enable(id: string, reason = "enabled via unified capability service", actor = "user") {
    return this.setLifecycle(id, "enabled", reason, actor);
  }

  disable(id: string, reason = "disabled via unified capability service", actor = "user") {
    return this.setLifecycle(id, "disabled", reason, actor);
  }

  quarantine(id: string, reason = "manual quarantine", actor = "user") {
    return this.setLifecycle(id, "quarantined", reason, actor);
  }

  // ── Trust ───────────────────────────────────────────────────────────────

  trustOf(id: string) {
    const entry = this.registry.resolve(id) ?? this.registry.list().find((e) => e.id === id);
    return entry ? { level: entry.trustLevel, scope: entry.scope, permissions: entry.permissions } : undefined;
  }

  // ── Provenance ──────────────────────────────────────────────────────────

  provenanceOf(id: string) {
    const resolved = this.resolve(id)?.id ?? id;
    return this.provenance.provenanceOf(resolved);
  }

  recordUse(capabilityId: string, opts: { runId?: string; outcome?: "success" | "failure" | "unknown"; detail?: string; actor?: string } = {}) {
    const resolved = this.resolve(capabilityId)?.id ?? capabilityId;
    this.provenance.recordUse(resolved, {
      actor: opts.actor,
      runId: opts.runId,
      outcome: opts.outcome ? { status: opts.outcome } : undefined,
      detail: opts.detail,
    });
  }

  // ── Inventory ───────────────────────────────────────────────────────────

  inventory() {
    const entries = this.registry.list().sort((a, b) => a.id.localeCompare(b.id));
    return entries.map((e) => ({
      id: e.id,
      name: e.name,
      exposedName: e.exposedName,
      kind: e.kind,
      source: e.source,
      provider: e.providerId,
      version: e.version,
      lifecycle: e.lifecycle,
      trust: e.trustLevel,
      scope: e.scope,
      permissions: e.permissions,
      riskTier: e.riskTier,
      sourceHash: e.sourceHash,
      provenance: e.provenance,
      shadowed: e.shadowed,
    }));
  }

  health() {
    const all = this.registry.list();
    const enabled = this.registry.listEnabled();
    const byKind = all.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {});
    const byLifecycle = all.reduce<Record<string, number>>((acc, e) => {
      const lc = e.lifecycle ?? "unknown";
      acc[lc] = (acc[lc] ?? 0) + 1;
      return acc;
    }, {});
    const quarantined = all.filter((e) => e.lifecycle === "quarantined" || e.trustLevel === "quarantined").length;
    return {
      total: all.length,
      enabled: enabled.length,
      byKind,
      byLifecycle,
      quarantined,
      certified: 0, // placeholder, real cert from platform CapabilityService
    };
  }
}
