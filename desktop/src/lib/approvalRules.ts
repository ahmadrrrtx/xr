/*
 * Remember-rule persistence (Phase 7).
 *
 * Source of truth inside the native shell: the Rust command pair in
 * src-tauri/src/commands/approvals.rs (Tauri Store file `approvals.json`) —
 * the seam Phase 12's Shield database will take over. In the plain browser
 * (dev preview / e2e) the rules live in localStorage, which also mirrors
 * the Tauri writes so a cold webview can render before IPC hydrates.
 */
import {
  isRuleDuration,
  isRuleEffect,
  persistableRules,
  type ApprovalRule,
} from '@/lib/approvalCore';
import { isTauri } from '@/lib/tauri';

const RULES_KEY = 'xr.approval.rules';

/** Parse one untrusted JSON object into a rule — null when malformed. */
function coerceRule(value: unknown): ApprovalRule | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.skillId !== 'string' ||
    typeof v.action !== 'string' ||
    (typeof v.resource !== 'string' && v.resource !== null) ||
    !isRuleEffect(v.effect) ||
    !isRuleDuration(v.duration) ||
    typeof v.createdAt !== 'number'
  ) {
    return null;
  }
  return {
    id: v.id,
    skillId: v.skillId,
    action: v.action,
    resource: v.resource,
    effect: v.effect,
    duration: v.duration,
    createdAt: v.createdAt,
  };
}

function readLocalStorage(): ApprovalRule[] {
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerceRule).filter((r): r is ApprovalRule => r !== null);
  } catch {
    return [];
  }
}

function writeLocalStorage(rules: ApprovalRule[]): void {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    /* storage unavailable — Tauri store remains the source of truth */
  }
}

/** Load persisted rules (Tauri Store via the Rust command; localStorage else). */
export async function loadRules(): Promise<ApprovalRule[]> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<unknown[]>('load_rules');
      if (!Array.isArray(raw)) return [];
      return raw
        .map(coerceRule)
        .filter((r): r is ApprovalRule => r !== null);
    } catch {
      /* fall through to the localStorage mirror */
    }
  }
  return readLocalStorage();
}

/** Persist rules (Tauri Store + localStorage mirror). Never throws. */
export async function saveRules(rules: ApprovalRule[]): Promise<void> {
  const durable = persistableRules(rules); // "session" rules stay memory-only
  writeLocalStorage(durable);
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_rules', { rules: durable });
  } catch {
    /* best-effort persistence; the in-memory rules still apply this session */
  }
}
