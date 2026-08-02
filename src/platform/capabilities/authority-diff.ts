/**
 * XR Phase 7 · T4 — Human-readable authority diff (pre-enable / pre-update).
 *
 * Constitution §10.2: "Users inspect effective authority and data access
 * before installation/use (human-readable authority diff)."
 *
 * Compares a capability's previous effective authority against its next
 * declared/effective authority and renders a Markdown diff the operator can
 * read before enabling or updating — new permissions, removed permissions,
 * denied scopes, risk-tier changes and data-scope changes.
 */

import type { CapabilityAuthorityVector, CapabilityDescriptor, CapabilityRiskTier } from "./types.ts";
import { riskTierForPermissions } from "./authority.ts";

export interface AuthorityDiff {
  capabilityId: string;
  type: string;
  previous: {
    declared: string[];
    effective: string[];
    denied: string[];
    riskTier: CapabilityRiskTier;
    dataScopes: string[];
  } | null;
  next: {
    declared: string[];
    effective: string[];
    denied: string[];
    riskTier: CapabilityRiskTier;
    dataScopes: string[];
  };
  changes: {
    newPermissions: string[];
    removedPermissions: string[];
    newDenied: string[];
    riskTierChanged: boolean;
    riskTierFrom?: CapabilityRiskTier;
    riskTierTo?: CapabilityRiskTier;
    dataScopeChanges: string[];
    undetermined: boolean;
  };
}

export function dataScopeLabel(descriptor: CapabilityDescriptor): string[] {
  return descriptor.dataScopes.map((s) => `${s.kind}:${s.access}${s.scope ? `(${s.scope})` : ""}`);
}

export function vectorView(vector: CapabilityAuthorityVector, descriptor: CapabilityDescriptor) {
  return {
    declared: [...vector.declared].sort(),
    effective: [...vector.effective].sort(),
    denied: [...vector.denied].sort(),
    riskTier: riskTierForPermissions(vector.effective, vector.undetermined),
    dataScopes: dataScopeLabel(descriptor),
  };
}

export function computeAuthorityDiff(
  previous: CapabilityDescriptor | null,
  next: CapabilityDescriptor,
): AuthorityDiff {
  const prevView = previous ? vectorView(previous.permissions.effective, previous) : null;
  const nextView = vectorView(next.permissions.effective, next);

  const prevEffective = new Set(prevView?.effective ?? []);
  const nextEffective = new Set(nextView.effective);
  const newPermissions = nextView.effective.filter((p) => !prevEffective.has(p));
  const removedPermissions = (prevView?.effective ?? []).filter((p) => !nextEffective.has(p));

  const prevDenied = new Set(prevView?.denied ?? []);
  const newDenied = nextView.denied.filter((p) => !prevDenied.has(p));

  const prevScopes = new Set(prevView?.dataScopes ?? []);
  const nextScopes = new Set(nextView.dataScopes);
  const dataScopeChanges = [
    ...nextView.dataScopes.filter((s) => !prevScopes.has(s)).map((s) => `+${s}`),
    ...(prevView?.dataScopes ?? []).filter((s) => !nextScopes.has(s)).map((s) => `-${s}`),
  ];

  const riskTierChanged = prevView !== null && prevView.riskTier !== nextView.riskTier;

  return {
    capabilityId: next.id,
    type: next.type,
    previous: prevView,
    next: nextView,
    changes: {
      newPermissions,
      removedPermissions,
      newDenied,
      riskTierChanged,
      riskTierFrom: prevView?.riskTier,
      riskTierTo: nextView.riskTier,
      dataScopeChanges,
      undetermined: next.permissions.effective.undetermined,
    },
  };
}

/** Markdown renderer — what the operator sees before enable/update. */
export function renderAuthorityDiffMarkdown(diff: AuthorityDiff): string {
  const lines: string[] = [];
  lines.push(`## Authority diff — ${diff.capabilityId} (${diff.type})`);
  if (!diff.previous) {
    lines.push("");
    lines.push("**First enable — no previous authority recorded.** Everything below is NEW:");
  }
  lines.push("");
  lines.push(`- Declared permissions: ${diff.next.declared.join(", ") || "none"}`);
  lines.push(`- Effective authority: ${diff.next.effective.join(", ") || "none"}`);
  lines.push(`- Denied scopes: ${diff.next.denied.join(", ") || "none"}`);
  lines.push(`- Risk tier: ${diff.next.riskTier}${diff.changes.riskTierChanged ? ` (was ${diff.changes.riskTierFrom})` : ""}`);
  lines.push(`- Data scopes: ${diff.next.dataScopes.join(", ") || "none"}`);
  if (diff.changes.undetermined) lines.push("- ⚠️ Effective authority is UNDETERMINED — execution must fail closed");

  const c = diff.changes;
  if (c.newPermissions.length) lines.push("");
  lines.push(`### New permissions (${c.newPermissions.length})`);
  for (const p of c.newPermissions) lines.push(`- ➕ ${p}`);
  if (!c.newPermissions.length) lines.push("- none");
  lines.push("");
  lines.push(`### Removed permissions (${c.removedPermissions.length})`);
  for (const p of c.removedPermissions) lines.push(`- ➖ ${p}`);
  if (!c.removedPermissions.length) lines.push("- none");
  lines.push("");
  lines.push(`### Newly denied (${c.newDenied.length})`);
  for (const p of c.newDenied) lines.push(`- 🚫 ${p}`);
  if (!c.newDenied.length) lines.push("- none");
  if (c.dataScopeChanges.length) {
    lines.push("");
    lines.push(`### Data-scope changes (${c.dataScopeChanges.length})`);
    for (const s of c.dataScopeChanges) lines.push(`- ${s}`);
  }
  if (c.riskTierChanged) {
    lines.push("");
    lines.push(`### ⚠️ Risk tier change: ${c.riskTierFrom} → ${c.riskTierTo}`);
  }
  return lines.join("\n");
}

/** Render the next-vs-current diff for a capability before enable. */
export function authorityDiffForEnable(current: CapabilityDescriptor | null, next: CapabilityDescriptor): string {
  return renderAuthorityDiffMarkdown(computeAuthorityDiff(current, next));
}
