/*
 * Quarantine per-invocation approvals (Phase 20 §13).
 *
 * A quarantined skill never gets a standing approval. Each use it attempts is
 * routed through the Phase 7 approval queue as `humanOnly`: the modal always
 * asks, remember-rules are ignored, and no rule is created from the decision.
 * The engine enforces the capability cap; this is the human-facing gate that
 * fires before a quarantined skill's permission is exercised.
 */
import { useApprovalStore } from '@/stores/approvalStore';
import type { PendingDecision } from '@/lib/approvalCore';
import { QUARANTINE_COPY, permissionChip, type SkillRecord } from '@/skills/core';

/** Per-session attempt counter so the prompt can say "for the nth time". */
const attempts = new Map<string, number>();

export function nthAttempt(skillId: string, scope: string): number {
  const key = `${skillId}:${scope}`;
  const n = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, n);
  return n;
}

export function resetAttempts(): void {
  attempts.clear();
}

export function requestQuarantinedInvocation(
  record: Pick<SkillRecord, 'id' | 'name' | 'version' | 'permissions'>,
  scope: string,
): Promise<PendingDecision> {
  const perm = record.permissions.find((p) => p.scope === scope);
  const chip = permissionChip(perm ?? { scope, reason: '', optional: false, dangerous: false, paths: [], domains: [] });
  const nth = nthAttempt(record.id, scope);
  return useApprovalStore.getState().requestApproval({
    id: `skq-${record.id}-${scope}-${Date.now().toString(36)}-${nth}`,
    createdAt: Date.now(),
    skillId: record.id,
    skillName: record.name,
    skillVersion: record.version,
    skillIcon: 'puzzle',
    action: `Use ${chip.label.toLowerCase()} (quarantined skill)`,
    resource: scope,
    risk: chip.dangerous ? 'high' : 'medium',
    justification: `Quarantined skill ${record.name} is requesting ${chip.label.toLowerCase()} for the ${ordinal(nth)} time. ${QUARANTINE_COPY.limits[4]}.`,
    bodyPreview: chip.consequence,
    humanOnly: true,
    rememberOptions: [],
  });
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Granting a DANGEROUS permission from the detail panel goes through the same
 * human-only approval queue (Shield gate, Phase 12). Revokes never need one.
 */
export function requestPermissionGrant(
  record: Pick<SkillRecord, 'id' | 'name' | 'version' | 'permissions'>,
  scope: string,
  quarantined: boolean,
): Promise<PendingDecision> {
  const perm = record.permissions.find((p) => p.scope === scope);
  const chip = permissionChip(perm ?? { scope, reason: '', optional: false, dangerous: true, paths: [], domains: [] });
  return useApprovalStore.getState().requestApproval({
    id: `skp-${record.id}-${scope}-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    skillId: record.id,
    skillName: record.name,
    skillVersion: record.version,
    skillIcon: 'shield',
    action: `Grant ${chip.label.toLowerCase()} to ${record.name}`,
    resource: scope,
    risk: 'high',
    justification: `${chip.consequence} ${quarantined ? 'The skill is quarantined, so this takes effect only after you promote it.' : ''}`.trim(),
    bodyPreview: perm?.reason,
    humanOnly: true,
    rememberOptions: [],
  });
}
