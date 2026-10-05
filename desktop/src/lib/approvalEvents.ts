/*
 * Approval event plumbing (Phase 7) — the surface-facing API.
 *
 * Any surface (chat tool cards, quick-ask, voice, bots, CLI) calls
 * `requestApproval(req)` and awaits the decision; everything else — queueing,
 * the modal, bell badge, orb state, toasts, OS notifications and the
 * cross-window IPC events future surfaces (Phases 12/16/24/26) consume —
 * happens here.
 *
 * Events (broadcast to every webview, the Phase 5 convention):
 *   approval:requested  { request }
 *   approval:decided    { request, decision }
 *   notification:new    { notification }
 * In dev builds a DOM CustomEvent seam ("xr-approval-seam") mirrors each
 * emit so browser e2e can assert the wiring without the native shell — the
 * xr-orb-seam pattern from Phase 6.
 */
import { toast } from 'sonner';

import {
  checkRules,
  newApprovalId,
  ruleFromDecision,
  type ApprovalRequest,
  type ApprovalSpec,
  type Notification,
  type PendingDecision,
  type RememberKey,
} from '@/lib/approvalCore';
import type { AuditDecision, DecidedBy } from '@/shield/types';
import { emitApprovalEvent, runApprovalGate } from '@/lib/approvalGate';
import {
  notificationKindFor,
  playNotificationSound,
  shouldOsNotify,
  shouldSound,
} from '@/lib/notificationPolicy';
import { orbSetState } from '@/lib/orb';
import { currentSettings } from '@/stores/settingsStore';
import { isTauri } from '@/lib/tauri';
import { useApprovalStore } from '@/stores/approvalStore';
import { useNotificationStore } from '@/stores/notificationStore';

type SeamKind = 'requested' | 'decided' | 'notification' | 'auto';

/** Dev/e2e seam — browser only, dev builds only (Phase 6 pattern). */
function devSeam(kind: SeamKind, payload: unknown): void {
  if (import.meta.env.DEV && !isTauri()) {
    window.dispatchEvent(
      new CustomEvent('xr-approval-seam', { detail: { kind, payload } })
    );
  }
}

async function emit(event: string, payload: unknown): Promise<void> {
  if (!isTauri()) return;
  const { emit: tauriEmit } = await import('@tauri-apps/api/event');
  await tauriEmit(event, payload).catch(() => {
    /* cross-window pings are best-effort */
  });
}

// ─── OS notifications ──────────────────────────────────────────────────────

/** True when the user probably isn't looking at this window. */
function appUnfocused(): boolean {
  return (
    (typeof document !== 'undefined' && document.hidden) ||
    (typeof window !== 'undefined' && !document.hasFocus())
  );
}

/** Rust bridge → tauri-plugin-notification. Degrades to in-app only. */
export async function sendOsNotification(
  title: string,
  body: string,
  notificationId: string
): Promise<void> {
  devSeam('notification', { os: true, title, body, notificationId });
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('send_os_notification', { title, body, notificationId });
  } catch {
    /* permission denied / plugin unavailable — the in-app feed still shows it */
  }
}

// ─── Notification feed helper ──────────────────────────────────────────────

/**
 * Push into the notification feed (+ `notification:new` broadcast, + OS
 * notification when the app is unfocused). The one call every surface uses.
 */
export function sendNotification(
  partial: Omit<Notification, 'id' | 'createdAt' | 'read'> &
    Partial<Pick<Notification, 'id' | 'createdAt'>>
): Notification {
  const notification: Notification = {
    id: partial.id ?? newApprovalId(),
    createdAt: partial.createdAt ?? Date.now(),
    read: false,
    ...partial,
  };
  // The feed is always written ("Managed by XR"); the policy gates the
  // noisier channels: OS notifications (per-event + quiet hours + channel)
  // and the optional chime.
  const settings = currentSettings();
  const kind = notificationKindFor(notification.type);
  useNotificationStore.getState().add(notification);
  devSeam('notification', notification);
  void emit('notification:new', { notification });
  if (appUnfocused() && shouldOsNotify(kind, settings)) {
    void sendOsNotification(
      `XR — ${notification.title}`,
      notification.body ?? '',
      notification.id
    );
  }
  if (shouldSound(kind, settings)) {
    playNotificationSound(settings.voice.soundsVolume);
  }
  return notification;
}

// ─── Orb sync ──────────────────────────────────────────────────────────────

/**
 * Pending approvals paint the orb amber. Going back to idle is skipped while
 * a chat stream is mid-flight (its next token re-asserts speaking anyway —
 * this avoids a half-second idle flicker after an approval).
 */
async function syncOrbToQueue(): Promise<void> {
  const pending = useApprovalStore.getState().pending;
  if (pending.length > 0) {
    void orbSetState('waiting-approval');
    return;
  }
  try {
    const { useChatStore } = await import('@/stores/chatStore');
    const streaming = useChatStore.getState().stream?.status === 'streaming';
    if (!streaming) void orbSetState('idle');
  } catch {
    void orbSetState('idle');
  }
}

// ─── Request / decide ──────────────────────────────────────────────────────

/**
 * Ask the human. Rule check first: a matching remembered rule decides
 * silently (auto-approve / auto-deny, "Auto-approved (rule)" notification).
 * Otherwise the request queues, the modal opens (oldest first), the orb goes
 * amber, and the returned promise resolves when a decision lands.
 */
export async function requestApproval(
  req: ApprovalRequest
): Promise<PendingDecision> {
  const store = useApprovalStore.getState();
  const now = Date.now();

  // Phase 12: a quarantined skill ignores remember rules (it must prompt);
  // the store applies the gate's hard decisions (paused / blocked / auto)
  // itself below — this preview only decides whether rules may run.
  const preview = runApprovalGate(req);
  const rulesApply = preview.kind === 'prompt' && !preview.quarantined;
  const { decision, rules } = rulesApply
    ? checkRules(store.rules, req, now)
    : { decision: null, rules: store.rules };
  if (rules.length !== useApprovalStore.getState().rules.length) {
    useApprovalStore.getState().setRules(rules); // pruned expired 1h rules
  }

  if (decision) {
    // Rule decided — no modal, no queue; surfaces still hear about it.
    useApprovalStore.setState((st) => ({
      decisions: { ...st.decisions, [req.id]: decision },
    }));
    devSeam('auto', { request: req, decision });
    emitApprovalEvent({
      kind: 'decided',
      request: req,
      decision,
      decidedBy: 'auto-rule',
      remember: null,
    });
    sendNotification({
      type: decision.status === 'approved' ? 'success' : 'warning',
      title:
        decision.status === 'approved'
          ? `Auto-approved: ${req.action}`
          : `Auto-denied: ${req.action}`,
      body: `A remember rule for ${req.skillName} matched this request.`,
      data: { approvalId: req.id, auto: true },
    });
    void emit('approval:decided', { request: req, decision });
    return decision;
  }

  const decisionPromise = useApprovalStore.getState().requestApproval(req);

  // Shield decided synchronously (paused, policy block, low-risk auto):
  // nothing was queued, so say what happened instead of "needs approval".
  if (!useApprovalStore.getState().pending.some((r) => r.id === req.id)) {
    const gated = await decisionPromise;
    devSeam('auto', { request: req, decision: gated });
    sendNotification({
      type: gated.status === 'approved' ? 'success' : 'warning',
      title:
        gated.status === 'approved'
          ? `Auto-approved: ${req.action}`
          : `Blocked: ${req.action}`,
      body: gated.reason ?? req.skillName,
      data: { approvalId: req.id, auto: true },
    });
    void emit('approval:decided', { request: req, decision: gated });
    return gated;
  }

  // Effects: broadcast, bell feed (with OS notification when unfocused),
  // and a toast only when this request is queued BEHIND another — the modal
  // already fronts the active one, so a second toast would say it twice.
  devSeam('requested', req);
  void emit('approval:requested', { request: req });
  sendNotification({
    type: 'approval-request',
    title: `${req.skillName} needs approval`,
    body: `${req.action}${req.resource ? ` — ${req.resource}` : ''}`,
    data: { approvalId: req.id },
  });
  const activeId = useApprovalStore.getState().activeId;
  if (activeId !== req.id) {
    toast(`${req.skillName} needs approval`, {
      description: `${req.action}${req.resource ? ` — ${req.resource}` : ''} (queued)`,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'Review',
        onClick: () => useApprovalStore.getState().activate(req.id),
      },
    });
  }
  void syncOrbToQueue();
  return decisionPromise;
}

/**
 * The single decide path for every caller (modal buttons, bell inline
 * actions, auto-deny countdown): store state → remember rule → toast +
 * notification + broadcast → orb back.
 */
export function decideApproval(
  id: string,
  status: 'approved' | 'denied',
  opts: {
    remember?: RememberKey;
    reason?: string;
    /** Who/what decided — the audit log records it (default: the user). */
    decidedBy?: DecidedBy;
    /** Audit row override (a paused-deny is recorded as `blocked`). */
    auditDecision?: AuditDecision;
    /** Sonner feedback — off for bulk actions that announce themselves. */
    silent?: boolean;
  } = {}
): void {
  const store = useApprovalStore.getState();
  const req = store.pending.find((r) => r.id === id);
  if (!req) return;

  const newRule =
    status === 'approved' && opts.remember
      ? ruleFromDecision(req, opts.remember, Date.now())
      : undefined;
  const decision: PendingDecision = {
    status,
    remember: opts.remember,
    ruleId: newRule?.id,
    reason: opts.reason,
  };

  store.decide(id, decision, newRule, {
    decidedBy: opts.decidedBy ?? 'user',
    remember: opts.remember ?? null,
    auditDecision: opts.auditDecision,
  });

  devSeam('decided', { request: req, decision });
  void emit('approval:decided', { request: req, decision });
  sendNotification({
    type: 'approval-decided',
    title:
      status === 'approved' ? `Approved: ${req.action}` : `Denied: ${req.action}`,
    body: opts.reason ?? req.skillName,
    data: { approvalId: id, status },
  });
  if (opts.silent) {
    void syncOrbToQueue();
    return;
  }
  if (status === 'approved') {
    toast.success(`Approved: ${req.action}`, {
      description: opts.remember
        ? 'Remembered — matching requests auto-approve next time.'
        : undefined,
    });
  } else {
    toast.warning(`Denied: ${req.action}`, {
      description: opts.reason,
    });
  }
  void syncOrbToQueue();
}

/**
 * Quietly resolve a pending request as denied — used when the generation
 * that asked is cancelled. No toast, no notification; surfaces still get the
 * `approval:decided` broadcast.
 */
export function withdrawRequest(id: string, reason: string): void {
  const store = useApprovalStore.getState();
  const req = store.pending.find((r) => r.id === id);
  if (!req) return;
  const decision: PendingDecision = { status: 'denied', reason };
  store.decide(id, decision, undefined, { decidedBy: 'user', remember: null });
  devSeam('decided', { request: req, decision });
  void emit('approval:decided', { request: req, decision });
  void syncOrbToQueue();
}

// ─── The mock-provider gate ────────────────────────────────────────────────

/**
 * Build the approval gate a streaming surface passes to the provider
 * (mockLLM today, the real backend in Phase 14 — same callback shape).
 * Racing the stream's abort signal keeps a cancelled generation from
 * stranding an orphaned modal: the request is withdrawn the moment the
 * stream dies.
 */
export function makeApprovalGate(
  signal: AbortSignal
): (
  call: { summary: string; approvalId?: string },
  spec: ApprovalSpec
) => Promise<{ approved: boolean; reason?: string; blocked?: boolean }> {
  return async (call, spec) => {
    const req: ApprovalRequest = {
      ...spec,
      id: newApprovalId(),
      createdAt: Date.now(),
    };
    // Link the call → request so the chat card can surface this approval.
    call.approvalId = req.id;
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const decision = await Promise.race([
      requestApproval(req),
      new Promise<PendingDecision>((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve({ status: 'denied', reason: 'Generation cancelled' }),
          { once: true }
        );
      }),
    ]);

    signal.removeEventListener('abort', onAbort);
    if (cancelled) withdrawRequest(req.id, 'Generation cancelled');
    return {
      approved: decision.status === 'approved',
      reason: decision.reason,
      // Shield answered before the human could: the card says so.
      blocked:
        decision.status === 'denied' &&
        decision.auto === true &&
        decision.ruleId?.startsWith('policy.') === true,
    };
  };
}
