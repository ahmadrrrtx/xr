/*
 * Skills → Shield audit (Phase 20 §15). Every install / uninstall / promote /
 * permission change is written to the Shield chain with the publisher,
 * signature state and the permissions in play. The engine is the authority on
 * what happened; this records the human-visible trail in the same chain.
 */
import { useShieldStore } from '@/stores/shieldStore';
import type { AuditInput } from '@/shield/types';
import type { SkillRecord } from '@/skills/core';

type SkillAuditAction = 'Skill installed' | 'Skill installed (quarantined)' | 'Skill uninstalled' | 'Skill promoted from quarantine' | 'Skill permission granted' | 'Skill permission revoked' | 'Skill update installed' | 'Skill install refused';

export function auditSkill(
  action: SkillAuditAction,
  skill: Pick<SkillRecord, 'id' | 'name' | 'version' | 'publisher' | 'signed' | 'permissions'> | { id: string; version?: string; publisher?: string; signed?: boolean; permissions?: SkillRecord['permissions'] },
  extra: { decision?: AuditInput['decision']; scopes?: string[]; resource?: string | null; note?: string } = {},
): void {
  const perms = (skill.permissions ?? []).map((p) => `${p.scope}${p.dangerous ? '!' : ''}`);
  const detail = [
    `skill=${skill.id}${skill.version ? `@${skill.version}` : ''}`,
    `publisher=${skill.publisher ?? 'unknown'}`,
    `signature=${skill.signed ? 'verified' : 'none'}`,
    extra.scopes?.length ? `scopes=${extra.scopes.join(',')}` : null,
    perms.length ? `declared=${perms.join(',')}` : null,
    extra.note ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  try {
    void useShieldStore.getState().addAuditEntry({
      actor: 'user',
      skill: skill.id,
      action,
      resource: extra.resource ?? skill.id,
      decision: extra.decision ?? 'allowed',
      ruleId: 'skills.store',
      risk: /dangerous|shell|secret|!/.test(detail) ? 'high' : 'low',
      costUsd: null,
      detail,
    } as AuditInput);
  } catch {
    /* audit is best-effort in the browser preview; the engine keeps its own record */
  }
}
