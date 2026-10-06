/*
 * Engine audit → Shield rows (Phase 14).
 *
 * The engine keeps its own append-only, hash-chained audit
 * (`GET /api/v1/audit?limit=` → `{entries, chain:{valid}}`). The desktop
 * keeps a separate chain for what the shell itself decided (policy edits,
 * local approvals, emergency actions). Shield's Audit tab shows both, each
 * entry marked with where it was recorded; the two chains are verified
 * independently and are never spliced together.
 *
 * Only decision-bearing engine events are surfaced here (approvals, tool
 * outcomes, denials, errors, model/provider changes). Engine bookkeeping
 * (`task.checkpointed`, `usage.estimated`, …) stays in the engine log.
 */
import { useEffect, useState } from 'react';

import { engineJson } from '@/engine/transport';
import type { ApprovalRisk } from '@/lib/approvalCore';
import type { AuditDecision, AuditEntry } from '@/shield/types';
import { useEngineStore } from '@/stores/engineStore';

export interface EngineAuditEntry {
  id: number;
  session_id: string | null;
  event: string;
  detail: string | null;
  hash: string;
  created_at: number;
}

export interface EngineAuditResponse {
  entries: EngineAuditEntry[];
  chain?: { valid: boolean; brokenAt?: number | null };
}

/** Events worth a Shield row; everything else is engine bookkeeping. */
const SURFACE = /^(approval\.|tool\.|chat\.message$|session\.error$|session\.max_steps$|models\.select$|providers\.set$|grant\.minted$|budget\.|execution\.|policy\.|security\.|secret\.|onboarding\.)|\.(applied|denied|blocked|refused|failed)$/;

function parseDetail(detail: string | null): Record<string, unknown> {
  if (!detail) return {};
  try {
    const v: unknown = JSON.parse(detail);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { text: detail };
  }
}

function str(v: unknown, max = 120): string | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function decisionFor(event: string, d: Record<string, unknown>): AuditDecision {
  if (event === 'approval.decided') {
    const dec = String(d.decision ?? '');
    if (dec === 'approved') return d.byUser === null && d.byChannel === 'remember' ? 'auto-approved' : 'allowed';
    return 'denied';
  }
  if (event === 'approval.requested') return 'allowed';
  if (/\.denied$|\.refused$/.test(event)) return 'denied';
  if (/\.blocked$|^policy\./.test(event)) return 'blocked';
  if (/error|failed|max_steps/.test(event)) return 'error';
  if (event === 'chat.message' && d.stopped && d.stopped !== 'done' && d.stopped !== 'max_steps') {
    return d.stopped === 'budget' ? 'blocked' : 'error';
  }
  return 'allowed';
}

function riskFor(event: string, d: Record<string, unknown>): ApprovalRisk {
  const tier = String(d.riskTier ?? '');
  if (tier === 'tier2' || tier === 'tier3' || /shell|delete/.test(event)) return 'high';
  if (tier === 'tier1' || /approval|write_file/.test(event)) return 'medium';
  return 'low';
}

function actionFor(event: string, d: Record<string, unknown>): string {
  switch (event) {
    case 'approval.requested':
      return `Approval requested · ${String(d.tool ?? 'tool')}`;
    case 'approval.decided':
      return `Approval ${String(d.decision ?? 'decided')} · ${str(d.approvalId, 24) ?? ''}`.trim();
    case 'chat.message':
      return `Chat turn (${String(d.mode ?? 'ask')})${d.stopped && d.stopped !== 'done' ? ` · ${String(d.stopped)}` : ''}`;
    case 'models.select':
      return 'Model selected';
    case 'providers.set':
      return 'Provider changed';
    case 'grant.minted':
      return 'Capability grant minted';
    default:
      return event.replace(/[._]/g, ' ');
  }
}

function resourceFor(d: Record<string, unknown>): string | null {
  return (
    str(d.path) ??
    str(d.tool) ??
    str(d.model) ??
    str(d.provider) ??
    str(d.input, 80) ??
    str(d.message, 80) ??
    null
  );
}

/** Map one engine entry to the Shield row shape (or null to skip). */
export function toAuditEntry(e: EngineAuditEntry): AuditEntry | null {
  if (!SURFACE.test(e.event)) return null;
  const d = parseDetail(e.detail);
  return {
    id: `eng_${e.id}`,
    ts: e.created_at,
    actor: 'agent:engine',
    skill: str(d.tool, 40) ?? (e.event.includes('.') && !e.event.startsWith('chat') ? e.event.split('.')[0] : null),
    action: actionFor(e.event, d),
    resource: resourceFor(d),
    decision: decisionFor(e.event, d),
    ruleId: null,
    risk: riskFor(e.event, d),
    costUsd: typeof d.usd === 'number' ? d.usd : null,
    signature: null,
    prevHash: null,
    hash: e.hash,
    detail: `Recorded by the XR engine (event ${e.event}${e.session_id ? `, session ${e.session_id}` : ''}). Its chain is verified separately from the desktop log.${e.detail ? `\n${e.detail.slice(0, 600)}` : ''}`,
  };
}

export async function fetchEngineAudit(limit = 200): Promise<{ rows: AuditEntry[]; chainValid: boolean | null }> {
  const res = await engineJson<EngineAuditResponse>(`/audit?limit=${Math.min(200, limit)}`);
  const rows: AuditEntry[] = [];
  for (const e of res.entries ?? []) {
    const row = toAuditEntry(e);
    if (row) rows.push(row);
  }
  return { rows, chainValid: res.chain ? res.chain.valid : null };
}

const POLL_MS = 30_000;

/** Live engine audit rows while the engine link is up (polls every 30 s). */
export function useEngineAudit(): { rows: AuditEntry[]; chainValid: boolean | null; error: string | null } {
  const up = useEngineStore((s) => s.status === 'up');
  const [state, setState] = useState<{ rows: AuditEntry[]; chainValid: boolean | null; error: string | null }>({
    rows: [],
    chainValid: null,
    error: null,
  });

  useEffect(() => {
    if (!up) return;
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetchEngineAudit();
        if (alive) setState({ rows: r.rows, chainValid: r.chainValid, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [up]);

  return up ? state : { rows: [], chainValid: null, error: null };
}
