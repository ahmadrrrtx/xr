/*
 * Budget enforcement wiring (Phase 13).
 *
 *   1. `budgetGate(req)` — every surface that is about to spend (chat, HUD,
 *      Brain mock, playground, test charge) asks the governor first. A denial
 *      is final: the caller must not start the call. The gate also writes the
 *      evidence (Shield audit BUDGET / BUDGET-DOWNGRADE) and tells the user
 *      (Sonner + bell) — the surface shows the reason inline too.
 *   2. `recordSpend(input)` — the actual cost after the call (or the partial
 *      cost after a cutoff/cancel).
 *   3. `startMeter(check)` — mid-stream guard: counts output tokens against
 *      `hardRemaining` so an in-flight stream stops at the hard limit.
 *   4. State transitions → toasts, bell/OS notifications, orb, audit
 *      BUDGET-PAUSE. Runs in flight are stopped on a breaker pause.
 *
 * Inside the native shell the governor is Rust (src-tauri/src/budget/); the
 * browser fallback runs the same math (budget/core.ts). Either way nothing in
 * this file decides — it asks, then reports.
 */
import { toast } from 'sonner';

import { budgetBackend, type RecordResult } from '@/budget/api';
import { fmtPct, fmtUsd, pauseReasonText, EPS } from '@/budget/core';
import { modelLabel, perOutputToken } from '@/budget/models';
import type {
  BudgetStateId,
  PreCallCheck,
  PreCallRequest,
  SpendInput,
  StateChange,
} from '@/budget/types';
import { sendNotification } from '@/lib/approvalEvents';
import { orbSetState } from '@/lib/orb';
import { useApprovalStore } from '@/stores/approvalStore';
import { useBudgetStore } from '@/stores/budgetStore';

/** Pre-call output estimate for a chat turn (brief: ~800 tokens). */
export const PRE_CALL_OUT_TOKENS = 800;

let initialised = false;

/** Rough token count for a prompt: 4 chars ≈ 1 token. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function openBudget(tab?: string): void {
  void import('@/router').then(({ router }) =>
    router.navigate(tab ? `/budget?tab=${tab}` : '/budget')
  );
}

function notifyToast(): boolean {
  return useBudgetStore.getState().settings.notifyToast;
}

function notifyBell(): boolean {
  return useBudgetStore.getState().settings.notifyOs;
}

function audit(input: {
  action: string;
  resource: string | null;
  decision: 'blocked' | 'allowed' | 'denied';
  ruleId: 'BUDGET' | 'BUDGET-DOWNGRADE' | 'BUDGET-PAUSE';
  costUsd: number | null;
  detail: string | null;
  actor?: string;
}): void {
  void import('@/stores/shieldStore').then(({ useShieldStore }) =>
    useShieldStore.getState().addAuditEntry({
      actor: input.actor ?? 'system',
      skill: 'budget',
      action: input.action,
      resource: input.resource,
      decision: input.decision,
      ruleId: input.ruleId,
      risk: 'low',
      costUsd: input.costUsd,
      detail: input.detail,
    })
  );
}

const lastToastAt = new Map<string, number>();

/** One toast per code per 4 s — a runaway loop must not stack 30 toasts. */
function throttled(key: string, ms = 4000): boolean {
  const now = Date.now();
  const last = lastToastAt.get(key) ?? 0;
  if (now - last < ms) return false;
  lastToastAt.set(key, now);
  return true;
}

function titleFor(check: PreCallCheck): string {
  switch (check.code) {
    case 'paused':
      return 'Spending is paused';
    case 'per-request':
      return 'Call over the per-request limit';
    case 'day':
      return 'Daily limit reached';
    case 'agent':
      return 'Agent cap reached';
    case 'workspace':
      return 'Workspace cap reached';
    case 'local-only':
      return 'Local models only';
    case 'spike':
      return 'Spending spike — paused';
    default:
      return 'Budget limit reached';
  }
}

/**
 * Ask before spending. Resolves with the governor's verdict; on a denial the
 * caller shows `reason` inline and does not start the call.
 */
export async function budgetGate(req: PreCallRequest): Promise<PreCallCheck> {
  let check: PreCallCheck;
  try {
    check = await budgetBackend().check(req);
  } catch (err) {
    // Fail closed: if the governor cannot answer, nothing spends.
    const message =
      err instanceof Error ? err.message : 'Budget service unavailable.';
    check = {
      allowed: false,
      code: 'paused',
      reason: `Budget check failed — ${message}. Nothing was sent.`,
      downgradedToModel: null,
      downshiftWhy: null,
      model: req.model,
      estimatedCost: req.estimatedCost ?? 0,
      remaining: 0,
      hardRemaining: 0,
      state: 'paused',
      warning: null,
    };
  }

  if (!check.allowed) {
    const title = titleFor(check);
    audit({
      action: `budget.block:${check.code}`,
      resource: req.model,
      decision: 'blocked',
      ruleId: 'BUDGET',
      costUsd: check.estimatedCost,
      detail: `${req.surface}: ${check.reason ?? ''}`,
      actor: req.agent ? `agent:${req.agent}` : 'system',
    });
    if (notifyToast() && throttled(`deny:${check.code}`)) {
      toast.error(title, {
        description: check.reason ?? undefined,
        duration: 8000,
        action:
          check.code === 'paused' || check.code === 'spike'
            ? { label: 'Open Budget', onClick: () => openBudget() }
            : { label: 'Raise limit', onClick: () => openBudget('settings') },
      });
    }
    if (notifyBell() && throttled(`bell:${check.code}`, 60_000)) {
      sendNotification({
        type: 'error',
        title,
        body: check.reason ?? '',
        data: { route: '/budget', budgetCode: check.code },
      });
    }
    if (check.code === 'spike') {
      void orbBlink('error');
    } else {
      void orbBlink('waiting-approval');
    }
  } else if (check.downgradedToModel) {
    audit({
      action: 'budget.downshift',
      resource: `${req.model} → ${check.downgradedToModel}`,
      decision: 'allowed',
      ruleId: 'BUDGET-DOWNGRADE',
      costUsd: check.estimatedCost,
      detail: check.downshiftWhy,
      actor: req.agent ? `agent:${req.agent}` : 'system',
    });
  } else if (check.warning && notifyToast() && throttled('over-soft', 30_000)) {
    toast.warning('Over budget', {
      description: check.warning,
      duration: 6000,
    });
  }
  return check;
}

/** Record what a call actually cost (or the partial after a cutoff). */
export async function recordSpend(
  input: SpendInput
): Promise<RecordResult | null> {
  try {
    const res = await budgetBackend().record(input);
    useBudgetStore.setState({
      overview: res.overview,
      settings: res.overview.settings,
    });
    return res;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[budget] record failed', err);
    return null;
  }
}

export interface Meter {
  /** Add output tokens; returns false when the hard limit is hit (stop now). */
  add(tokensOut: number): boolean;
  readonly tokensOut: number;
  readonly cost: number;
  readonly cutoff: boolean;
}

/** Mid-stream guard: per-output-token metering against `hardRemaining`. */
export function startMeter(check: PreCallCheck): Meter {
  const rate = perOutputToken(check.model);
  const limit = check.hardRemaining;
  let tokensOut = 0;
  let cost = 0;
  let cutoff = false;
  return {
    add(n) {
      if (cutoff) return false;
      tokensOut += n;
      cost = tokensOut * rate;
      if (limit !== null && rate > 0 && cost >= limit - EPS) {
        cutoff = true;
        return false;
      }
      return true;
    },
    get tokensOut() {
      return tokensOut;
    },
    get cost() {
      return cost;
    },
    get cutoff() {
      return cutoff;
    },
  };
}

export function cutoffText(check: PreCallCheck): string {
  return `Stopped here — this reply reached your ${fmtUsd(
    check.hardRemaining ?? 0
  )} remaining budget. Raise the limit under Budget to continue.`;
}

/* ── State transitions ─────────────────────────────────────────────────── */

let blinkTimer: number | null = null;

/** Brief orb colour (amber = waiting-approval, red = error), then back. */
async function orbBlink(state: 'error' | 'waiting-approval'): Promise<void> {
  await orbSetState(state);
  if (blinkTimer !== null) window.clearTimeout(blinkTimer);
  blinkTimer = window.setTimeout(() => {
    blinkTimer = null;
    const pending = useApprovalStore.getState().pending.length > 0;
    void orbSetState(pending ? 'waiting-approval' : 'idle');
  }, 1400);
}

const LS_WARN_DAY = 'xr.budget.warnNotifiedDay';

function warnedToday(): boolean {
  const day = new Date().toDateString();
  try {
    if (window.localStorage.getItem(LS_WARN_DAY) === day) return true;
    window.localStorage.setItem(LS_WARN_DAY, day);
  } catch {
    /* ignore */
  }
  return false;
}

async function stopRunsForPause(reason: string): Promise<number> {
  const { useRunsStore } = await import('@/stores/runsStore');
  const rs = useRunsStore.getState();
  const live = Object.values(rs.runs).filter(
    (r) => r.status === 'running' || r.status === 'waiting'
  );
  if (live.length === 0) return 0;
  const { useBrainStore } = await import('@/stores/brainStore');
  const brain = useBrainStore.getState();
  for (const r of live) brain.stopRun(r.id, { silent: true });
  rs.applyCancelled(
    live.map((r) => r.id),
    { by: 'budget', reason }
  );
  return live.length;
}

function onStateChange(change: StateChange): void {
  // Pull the post-transition overview first so every message quotes the
  // numbers the user will see on the screen (not the pre-change snapshot).
  void useBudgetStore
    .getState()
    .refresh()
    .then(() => handleStateChange(change));
}

function handleStateChange(change: StateChange): void {
  const st = useBudgetStore.getState();
  const s = st.settings;
  const o = st.overview;
  const next: BudgetStateId = change.next;

  if (next === 'paused') {
    const reason = s.pauseReason;
    const auto = reason === 'threshold' || reason === 'spike';
    const text = pauseReasonText(reason);
    audit({
      action: `budget.pause:${reason ?? 'manual'}`,
      resource: null,
      decision: 'blocked',
      ruleId: 'BUDGET-PAUSE',
      costUsd: o?.spentMonth ?? null,
      detail: text,
      actor: reason === 'manual' || reason === 'emergency' ? 'user' : 'system',
    });
    if (auto) {
      void orbBlink('error');
      void stopRunsForPause(text).then((n) => {
        if (n > 0 && notifyToast())
          toast(`${n} run${n === 1 ? '' : 's'} stopped by the budget pause.`);
      });
      if (notifyToast()) {
        toast.error(
          reason === 'spike'
            ? 'Spending spike — paused'
            : 'Circuit breaker — spending paused',
          {
            description: text,
            duration: 10_000,
            action: { label: 'Open Budget', onClick: () => openBudget() },
          }
        );
      }
      if (notifyBell()) {
        sendNotification({
          type: 'error',
          title:
            reason === 'spike'
              ? 'Spending paused after a spike'
              : 'Spending paused by the circuit breaker',
          body: text,
          data: { route: '/budget' },
        });
      }
    } else if (notifyToast()) {
      toast('Spending paused.', {
        description: 'Cloud and local calls are blocked until you resume.',
      });
    }
    return;
  }

  if (next === 'capped' && change.prev !== 'capped') {
    void orbBlink('waiting-approval');
    if (notifyToast() && throttled('capped', 10_000)) {
      toast.error('Budget limit reached', {
        description: o
          ? `${fmtUsd(o.spentMonth)} of ${fmtUsd(o.monthlyLimit)} spent. New cloud calls are blocked.`
          : undefined,
        duration: 8000,
        action: { label: 'Raise limit', onClick: () => openBudget('settings') },
      });
    }
    if (notifyBell()) {
      sendNotification({
        type: 'error',
        title: 'Budget limit reached',
        body: o
          ? `${fmtUsd(o.spentMonth)} of ${fmtUsd(o.monthlyLimit)} spent.`
          : '',
        data: { route: '/budget' },
      });
    }
    return;
  }

  if (
    (next === 'warn' || next === 'danger') &&
    (change.prev === 'ok' || change.prev === 'local')
  ) {
    if (warnedToday()) return;
    const pct = o ? fmtPct(o.pctUsedMonth) : fmtPct(s.notifyWarnPct);
    if (notifyToast()) {
      toast.warning(`${pct} of your monthly budget used`, {
        description: o
          ? `${fmtUsd(o.spentMonth)} of ${fmtUsd(o.monthlyLimit)} · resets ${o.resetDate.slice(5)}`
          : undefined,
        duration: 6000,
      });
    }
    if (notifyBell()) {
      sendNotification({
        type: 'warning',
        title: `${pct} of your monthly budget used`,
        body: o
          ? `${fmtUsd(o.spentMonth)} of ${fmtUsd(o.monthlyLimit)} spent.`
          : '',
        data: { route: '/budget' },
      });
    }
    return;
  }

  if (next === 'over' && change.prev !== 'over' && notifyToast()) {
    toast.warning('Over budget', {
      description: 'Hard cap is off — XR is warning instead of blocking.',
      action: {
        label: 'Turn hard cap on',
        onClick: () => openBudget('settings'),
      },
    });
  }
}

export function initBudget(): void {
  if (initialised) return;
  initialised = true;
  void useBudgetStore
    .getState()
    .load()
    .then(() => budgetBackend().subscribe({ onStateChange }));
}

/** Label for a downshift badge. */
export function downshiftBadge(from: string, to: string): string {
  return `Switched to ${modelLabel(to)} to stay within budget (was ${modelLabel(from)}).`;
}
