/*
 * Engine approvals bridge (Phase 14).
 *
 * The engine owns consent: a tool that needs a human emits
 * `approval_required{id, tool, reason, args, riskTier, preview, ttlMs}` and
 * the run BLOCKS until `POST /api/v1/approvals/:id/decision {approved}` or
 * the TTL (default-deny, 300 s). The desktop's existing approval queue (modal,
 * bell, Shield tab, remember rules, auto-deny countdown) is reused unchanged:
 * the request enters it under the ENGINE's id, so whatever decides it — the
 * modal buttons, a remember rule, Shield's pause, the timeout — lands on the
 * engine through the single `decideOnEngine` path.
 *
 * The desktop never computes risk here: `riskTier` comes from the engine's
 * tool registry and is only mapped onto the modal's three-step scale.
 */
import type { ApprovalRequest, ApprovalRisk, PendingDecision } from '@/lib/approvalCore';
import { requestApproval, withdrawRequest } from '@/lib/approvalEvents';
import { engineJson, enginePost, EngineHttpError } from './transport';
import type { EngineApprovalRequired, EnginePendingApproval, EnginePreview } from './types';

const TOOL_META: Record<string, { action: string; icon: string }> = {
  write_file: { action: 'Write a file', icon: 'file-edit' },
  edit_file: { action: 'Edit a file', icon: 'file-edit' },
  delete_file: { action: 'Delete a file', icon: 'file' },
  delete: { action: 'Delete', icon: 'file' },
  shell: { action: 'Run a shell command', icon: 'terminal' },
  run_command: { action: 'Run a shell command', icon: 'terminal' },
  exec: { action: 'Run a shell command', icon: 'terminal' },
  send: { action: 'Send a message', icon: 'mail' },
  send_email: { action: 'Send an email', icon: 'mail' },
  http_request: { action: 'Call a web endpoint', icon: 'globe' },
  fetch_url: { action: 'Fetch a URL', icon: 'globe' },
  browser: { action: 'Drive the browser', icon: 'globe' },
};

function humanize(tool: string): string {
  const words = tool.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Run a tool';
}

/** Engine tiers → the modal's scale. Unknown tiers are treated as medium. */
export function riskFromTier(tier: string | undefined): ApprovalRisk {
  const t = (tier ?? '').toLowerCase();
  if (t === 'tier0' || t === 'low' || t === 'read' || t === 'safe') return 'low';
  if (t === 'tier2' || t === 'tier3' || t === 'high' || t === 'critical' || t === 'destructive') return 'high';
  return 'medium';
}

function previewText(preview: EnginePreview | string | null | undefined): string | undefined {
  if (!preview) return undefined;
  if (typeof preview === 'string') return preview.slice(0, 4000);
  const parts = (preview.sections ?? []).map((s) =>
    s.title ? `${s.title}\n${s.body}${s.truncated ? '\n…' : ''}` : s.body,
  );
  const text = parts.join('\n\n').trim();
  return text ? text.slice(0, 4000) : undefined;
}

function resourceOf(a: EngineApprovalRequired): string | null {
  const args = a.args ?? {};
  for (const k of ['path', 'file', 'command', 'cmd', 'to', 'url', 'target']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  }
  if (a.preview && typeof a.preview !== 'string') {
    const p = a.preview.sections?.find((s) => /^(path|command|target|url)$/i.test(s.title));
    if (p?.body) return p.body.length > 160 ? `${p.body.slice(0, 160)}…` : p.body;
  }
  return null;
}

/** Engine request → the desktop's `ApprovalRequest` (same id). */
export function toApprovalRequest(
  a: EngineApprovalRequired,
  createdAt: number = Date.now(),
): ApprovalRequest {
  const meta = TOOL_META[a.tool] ?? { action: humanize(a.tool), icon: 'wrench' };
  const tier = a.riskTier ?? (typeof a.preview === 'object' && a.preview ? a.preview.riskTier : undefined);
  return {
    id: a.id,
    skillId: a.tool,
    skillName: a.tool,
    skillVersion: 'engine',
    skillIcon: meta.icon,
    action: meta.action,
    resource: resourceOf(a),
    bodyPreview: previewText(a.preview),
    risk: riskFromTier(tier),
    // The reason is model-shaped text — the engine marks it untrusted; the
    // modal renders it as a quote, never as instructions.
    justification: a.reason || `${a.tool} needs your approval`,
    createdAt,
  };
}

/** `GET /api/v1/approvals` → the engine's still-pending requests. */
export async function listPendingEngineApprovals(): Promise<EnginePendingApproval[]> {
  const j = await engineJson<{ pending?: EnginePendingApproval[] }>('/approvals');
  return j.pending ?? [];
}

/**
 * Forward a decision. `gone` = the engine had already decided (TTL expiry,
 * another surface) — the caller shows the engine's outcome, not ours.
 */
export async function decideOnEngine(
  id: string,
  approved: boolean,
): Promise<'ok' | 'gone' | 'unreachable'> {
  try {
    await enginePost(`/approvals/${encodeURIComponent(id)}/decision`, { approved });
    return 'ok';
  } catch (e) {
    if (e instanceof EngineHttpError && (e.status === 404 || e.status === 409)) return 'gone';
    return 'unreachable';
  }
}

export interface EngineApprovalOutcome {
  approved: boolean;
  reason?: string;
  /** XR Shield (desktop policy) answered before the human could. */
  blocked?: boolean;
  /** The engine had already resolved it (expired / decided elsewhere). */
  gone?: boolean;
}

/**
 * Park on the human for ONE engine approval. Resolves when a decision has
 * been forwarded to the engine. Aborting `signal` (Stop) withdraws the modal
 * and denies on the engine so the run cannot proceed on a stale consent.
 */
export async function bridgeEngineApproval(
  a: EngineApprovalRequired,
  signal: AbortSignal,
): Promise<EngineApprovalOutcome> {
  const req = toApprovalRequest(a);
  let aborted = false;
  const decision = await Promise.race([
    requestApproval(req),
    new Promise<PendingDecision>((resolve) => {
      const onAbort = () => {
        aborted = true;
        resolve({ status: 'denied', reason: 'Generation cancelled' });
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]);
  if (aborted) withdrawRequest(req.id, 'Generation cancelled');

  const approved = decision.status === 'approved';
  const sent = await decideOnEngine(req.id, approved);
  return {
    approved,
    reason: decision.reason,
    blocked:
      decision.status === 'denied' &&
      decision.auto === true &&
      decision.ruleId?.startsWith('policy.') === true,
    gone: sent === 'gone',
  };
}
