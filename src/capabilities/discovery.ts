/**
 * XR Phase 08 — Safe Capability Discovery Pipeline.
 *
 * Implements:
 *   registered → trust filter → lifecycle filter → scope filter → permission filter → mode filter → policy filter → model-visible
 *
 * Reuses ToolRegistryService as source of truth, enhanced with lifecycle/trust/scope maps.
 */

import type { Mode, Tool } from "../core/types.ts";
import type { ToolRegistryService } from "../tools/registry-service.ts";
import type {
  CapabilityDiscoveryQuery,
  CapabilityScope,
  CapabilityPermission,
  TrustLevel,
} from "./types.ts";

const RISK_RANK: Record<string, number> = {
  tier0: 0,
  tier1: 1,
  tier2: 2,
  unknown: 99,
  blocked: 99,
};

export interface DiscoveryContext {
  registry: ToolRegistryService;
  /** Workspace cwd for scope checks. */
  cwd?: string;
  /** Denied permissions from config. */
  deniedPermissions?: string[];
  /** Egress allowlist domains. */
  egressAllowlist?: string[];
}

export function discoverCapabilities(
  query: CapabilityDiscoveryQuery,
  ctx: DiscoveryContext,
): Tool[] {
  const registry = ctx.registry;
  const allEntries = registry.list(); // includes lifecycle/trust info via enhanced registry

  // Start with registry's discover which already does mode + allow/deny
  let tools = registry.discover({
    mode: query.mode,
    allow: query.allow,
    deny: query.deny,
  });

  // If registry enhanced with lifecycle map, we need to filter further via entry metadata.
  // The registry's discover should already exclude disabled/quarantined if enhanced, but we double-check for safety (defense in depth).

  const allowSet = query.allow ? new Set(query.allow) : null;
  const denySet = query.deny ? new Set(query.deny) : null;

  // Build quick lookup for entries by exposedName and id
  const entryByExposed = new Map<string, ReturnType<typeof registry.list>[number]>();
  for (const e of allEntries) {
    entryByExposed.set(e.exposedName, e);
    entryByExposed.set(e.id, e);
  }

  // Trust filter
  if (query.trustLevels && query.trustLevels.length > 0) {
    const allowedTrust = new Set(query.trustLevels);
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      if (!entry) return true; // if no entry metadata, allow (backward compat)
      const trustLevel = (entry as any).trustLevel as TrustLevel | undefined;
      if (!trustLevel) return true;
      return allowedTrust.has(trustLevel);
    });
  }

  // Exclude quarantined/revoked by default for model-visible
  const excludeQuarantined = query.excludeQuarantined !== false;
  const excludeRevoked = query.excludeRevoked !== false;

  if (excludeQuarantined || excludeRevoked) {
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      if (!entry) return true;
      const lifecycle = (entry as any).lifecycle as string | undefined;
      if (excludeQuarantined && lifecycle === "quarantined") return false;
      if (excludeRevoked && (lifecycle === "revoked" || lifecycle === "removed")) return false;
      return true;
    });
  }

  // Enabled only filter (default true for model-visible)
  if (query.enabledOnly !== false) {
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      if (!entry) return true;
      const lifecycle = (entry as any).lifecycle as string | undefined;
      // If lifecycle map present, only enabled passes. If absent, rely on registry already filtered.
      if (lifecycle && lifecycle !== "enabled") return false;
      return true;
    });
  }

  // Scope filter
  if (query.scopes && query.scopes.length > 0) {
    const allowedScopes = new Set(query.scopes as string[]);
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      const scope = (entry as any).scope as CapabilityScope | undefined;
      if (!scope) return true; // no scope = shared, allow
      return allowedScopes.has(scope) || scope === "shared";
    });
  }

  // Permission filters
  if (query.requiresPermissions && query.requiresPermissions.length > 0) {
    const required = new Set(query.requiresPermissions);
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      const perms = (entry as any).permissions as CapabilityPermission[] | undefined;
      if (!perms) return true; // if no perms metadata, allow
      for (const r of required) {
        if (!perms.includes(r)) return false;
      }
      return true;
    });
  }

  if (query.excludesPermissions && query.excludesPermissions.length > 0) {
    const excluded = new Set(query.excludesPermissions);
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      const perms = (entry as any).permissions as CapabilityPermission[] | undefined;
      if (!perms) return true;
      for (const e of excluded) {
        if (perms.includes(e)) return false;
      }
      return true;
    });
  }

  // Max risk tier filter
  if (query.maxRiskTier) {
    const maxRank = RISK_RANK[query.maxRiskTier] ?? 99;
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      const tier = (entry as any).riskTier as string | undefined;
      if (!tier) return true;
      return (RISK_RANK[tier] ?? 99) <= maxRank;
    });
  }

  // Denied permissions from config (policy filter)
  if (ctx.deniedPermissions && ctx.deniedPermissions.length > 0) {
    const denied = new Set(ctx.deniedPermissions);
    tools = tools.filter((t) => {
      const entry = entryByExposed.get(t.name);
      const perms = (entry as any).permissions as CapabilityPermission[] | undefined;
      if (!perms) return true;
      for (const d of denied) {
        // Map legacy denied like "shell" to unified
        if (perms.includes(d as CapabilityPermission)) return false;
      }
      return true;
    });
  }

  // Limit
  if (query.limit && query.limit > 0) {
    tools = tools.slice(0, query.limit);
  }

  return tools;
}

