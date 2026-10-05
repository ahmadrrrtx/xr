/*
 * Shield → Approvals (Phase 12, SCREEN-BRIEFS §8 Tab 2). The pending list IS
 * the Phase 7 queue: each card resolves the same promise the root modal
 * awaits (the modal yields while the Shield screen is mounted — see
 * `inlineSurface` in screens/Shield/index.tsx).
 * History below is derived from the audit log (last 24 h), so there is one
 * record of every decision, not two.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Quote,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  remember1hLabel,
  rememberAlwaysLabel,
  type ApprovalRequest,
  type RememberKey,
} from '@/lib/approvalCore';
import { cn } from '@/lib/utils';
import { fmtClock } from '@/shield/core';
import type { AuditEntry } from '@/shield/types';
import { useApprovalStore } from '@/stores/approvalStore';
import {
  isQuarantinedSkill,
  useShieldStore,
  type HistoryFilter,
} from '@/stores/shieldStore';

import { JsonView, RiskChip, RISK_VAR, ShieldCard, SkillIcon } from './shared';

const DAY_MS = 24 * 60 * 60_000;
const WIPE_MS = 600;

export function ApprovalsTab({ now }: { now: number }) {
  const pending = useApprovalStore((s) => s.pending);
  const audit = useShieldStore((s) => s.audit);
  const historyFilter = useShieldStore((s) => s.historyFilter);

  const { approved, denied } = useMemo(() => {
    const since = now - DAY_MS;
    const a: AuditEntry[] = [];
    const d: AuditEntry[] = [];
    for (const e of audit) {
      if (e.ts < since || !e.skill) continue;
      if (e.decision === 'allowed' || e.decision === 'auto-approved') a.push(e);
      else if (e.decision === 'denied' || e.decision === 'blocked') d.push(e);
    }
    return { approved: a, denied: d };
  }, [audit, now]);

  const byFilter = (e: AuditEntry): boolean => {
    if (historyFilter === 'all') return true;
    const auto = e.ruleId !== null && !e.ruleId.startsWith('user.');
    return historyFilter === 'auto' ? auto : !auto;
  };

  const lowRisk = pending.filter((r) => r.risk === 'low').length;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="shield-approvals-tab">
      <ShieldCard
        title={`Pending${pending.length ? ` · ${pending.length}` : ''}`}
        testId="pending-card"
        action={
          pending.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={lowRisk === 0}
                data-testid="bulk-approve-low"
                onClick={() => useShieldStore.getState().bulkApproveLowRisk()}
                className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={12} strokeWidth={2} aria-hidden="true" />
                Approve all low-risk{lowRisk ? ` (${lowRisk})` : ''}
              </button>
              <button
                type="button"
                data-testid="bulk-deny-all"
                onClick={() => useShieldStore.getState().bulkDenyAll()}
                className="text-danger hover:bg-danger/10 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-[color-mix(in_oklab,var(--danger)_40%,transparent)] px-2 text-[12px] transition-colors"
              >
                <X size={12} strokeWidth={2} aria-hidden="true" />
                Deny all
              </button>
            </div>
          ) : null
        }
      >
        {pending.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 px-4 pt-6 pb-8 text-center"
            data-testid="pending-empty"
          >
            <CheckCircle2
              size={28}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: 'var(--success)' }}
            />
            <p className="text-text-primary text-[14px] font-medium">
              Nothing needs your attention right now
            </p>
            <p className="text-text-tertiary max-w-[420px] text-[12px] leading-relaxed">
              New requests appear here and in the approval prompt. While this
              tab is open the prompt stays out of your way.
            </p>
          </div>
        ) : (
          <ul
            className="flex flex-col gap-3 px-4 pt-1 pb-4"
            data-testid="pending-list"
          >
            <AnimatePresence initial={false}>
              {pending.map((req, i) => (
                <PendingCard
                  key={req.id}
                  req={req}
                  newest={i === pending.length - 1}
                  quiet={pending.length > 5}
                  index={i}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </ShieldCard>

      <HistorySection
        title="Approved · last 24h"
        entries={approved.filter(byFilter)}
        total={approved.length}
        filter={historyFilter}
        testId="approved-history"
        defaultOpen={approved.length > 0 && pending.length === 0}
      />
      <HistorySection
        title="Denied · last 24h"
        entries={denied.filter(byFilter)}
        total={denied.length}
        filter={historyFilter}
        retry
        testId="denied-history"
        defaultOpen={false}
      />
    </div>
  );
}

/* ── Pending card ──────────────────────────────────────────────────────── */

function PendingCard({
  req,
  newest,
  quiet,
  index,
}: {
  req: ApprovalRequest;
  newest: boolean;
  quiet: boolean;
  index: number;
}) {
  const reduced = useReducedMotion();
  const quarantine = useShieldStore((s) => s.quarantine);
  const quarantined = isQuarantinedSkill(quarantine, req.skillId);
  const [remember, setRemember] = useState<RememberKey | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [leaving, setLeaving] = useState<'approved' | 'denied' | null>(null);

  const decide = (status: 'approved' | 'denied'): void => {
    if (leaving) return;
    setLeaving(status);
    const commit = (): void =>
      useShieldStore.getState().decideApproval(req.id, status, {
        remember: status === 'approved' ? (remember ?? undefined) : undefined,
      });
    if (reduced) commit();
    else window.setTimeout(commit, WIPE_MS);
  };

  const alwaysLabel =
    req.rememberOptions?.find((o) => o.key === 'always')?.label ??
    rememberAlwaysLabel(req);
  const hourLabel =
    req.rememberOptions?.find((o) => o.key === '1h')?.label ??
    remember1hLabel(req);
  const opts: { key: RememberKey | null; label: string }[] = [
    { key: null, label: 'Allow once' },
    { key: '1h', label: hourLabel },
    { key: 'always', label: alwaysLabel },
  ];

  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      role="region"
      aria-label={`Pending approval: ${req.action}`}
      data-testid="pending-approval"
      data-risk={req.risk}
      data-index={index}
      data-leaving={leaving ?? undefined}
      className={cn(
        'shield-card bg-bg-raised/40 border-border-subtle relative rounded-lg border border-l-[3px] p-4',
        newest && !quiet && !reduced && !leaving && 'shield-card-newest'
      )}
      style={{ borderLeftColor: RISK_VAR[req.risk] }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="bg-bg-ink border-border-subtle text-text-secondary flex size-8 shrink-0 items-center justify-center rounded-md border">
            <SkillIcon icon={req.skillIcon} size={15} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-primary text-[13px] font-medium">
                {req.skillName}
              </span>
              <span className="text-text-tertiary font-mono text-[11px]">
                {req.skillVersion}
              </span>
              {quarantined && (
                <span
                  className="inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium"
                  style={{
                    color: 'var(--warning)',
                    borderColor:
                      'color-mix(in oklab, var(--warning) 45%, transparent)',
                  }}
                  data-testid="quarantined-badge"
                >
                  <ShieldAlert size={10} strokeWidth={2} aria-hidden="true" />
                  Quarantined skill
                </span>
              )}
            </div>
            <p className="text-text-primary mt-0.5 text-[14px] leading-snug">
              {req.action}
            </p>
            {req.resource && (
              <p className="text-text-secondary mt-0.5 truncate font-mono text-[12px]">
                {req.resource}
              </p>
            )}
          </div>
        </div>
        <RiskChip risk={req.risk} className="shrink-0" />
      </div>

      <blockquote className="text-text-secondary mt-3 flex gap-2 text-[12px] leading-relaxed italic">
        <Quote
          size={12}
          strokeWidth={1.5}
          aria-hidden="true"
          className="text-text-tertiary mt-0.5 shrink-0"
        />
        <span>{req.justification}</span>
      </blockquote>

      <button
        type="button"
        onClick={() => setShowJson((v) => !v)}
        aria-expanded={showJson}
        className="text-text-tertiary hover:text-text-primary mt-2 flex h-6 cursor-pointer items-center gap-1 rounded px-1 text-[11px] transition-colors"
      >
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          aria-hidden="true"
          className={cn('transition-transform', showJson && 'rotate-180')}
        />
        {showJson ? 'Hide request JSON' : 'Show request JSON'}
      </button>
      {showJson && (
        <div className="mt-1">
          <JsonView value={req} maxHeight={240} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        {quarantined ? (
          <p className="text-text-tertiary text-[11px]">
            Remember rules are ignored while this skill is quarantined — trust
            it under Security Settings to allow rules.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Remember this decision"
            className="flex flex-wrap items-center gap-1"
          >
            {opts.map((opt) => {
              const on = remember === opt.key;
              return (
                <label
                  key={opt.key ?? 'once'}
                  className={cn(
                    'flex h-6 cursor-pointer items-center gap-1.5 rounded-full border px-2 text-[11px] transition-colors',
                    on
                      ? 'border-border-accent text-accent bg-accent/10'
                      : 'border-border-subtle text-text-tertiary hover:text-text-secondary'
                  )}
                >
                  <input
                    type="radio"
                    name={`remember-${req.id}`}
                    className="sr-only"
                    checked={on}
                    onChange={() => setRemember(opt.key)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="inline-deny"
            disabled={leaving !== null}
            onClick={() => decide('denied')}
            className="text-danger hover:bg-danger/10 flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--danger)] px-3 text-[12px] font-semibold tracking-wide transition-colors disabled:opacity-60"
          >
            <X size={13} strokeWidth={2.25} aria-hidden="true" />
            DENY
          </button>
          <button
            type="button"
            data-testid="inline-approve"
            disabled={leaving !== null}
            onClick={() => decide('approved')}
            className="bg-accent text-accent-contrast flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold tracking-wide transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Check size={13} strokeWidth={2.25} aria-hidden="true" />
            APPROVE
          </button>
        </div>
      </div>
    </motion.li>
  );
}

/* ── History ───────────────────────────────────────────────────────────── */

function decidedByLabel(e: AuditEntry): { label: string; auto: boolean } {
  const r = e.ruleId;
  if (!r) return { label: 'You', auto: false };
  if (r.startsWith('rule.')) return { label: 'Auto · rule', auto: true };
  if (r === 'auto.timeout') return { label: 'Auto · timeout', auto: true };
  if (r === 'user.bulk') return { label: 'You · bulk', auto: false };
  if (r.startsWith('user.remember.'))
    return { label: 'You · remembered', auto: false };
  if (r.startsWith('user.')) return { label: 'You', auto: false };
  if (r.startsWith('policy.')) return { label: 'Policy', auto: true };
  return { label: 'Auto', auto: true };
}

function HistorySection({
  title,
  entries,
  total,
  filter,
  retry,
  testId,
  defaultOpen,
}: {
  title: string;
  entries: AuditEntry[];
  total: number;
  filter: HistoryFilter;
  retry?: boolean;
  testId: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const filters: HistoryFilter[] = ['all', 'user', 'auto'];
  return (
    <ShieldCard
      testId={testId}
      title={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="hover:text-text-secondary flex cursor-pointer items-center gap-1.5 uppercase"
        >
          <ChevronDown
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            className={cn('transition-transform', !open && '-rotate-90')}
          />
          {title}
          <span className="text-text-tertiary font-mono text-[11px] normal-case">
            {total}
          </span>
        </button>
      }
      action={
        open && total > 0 ? (
          <div
            role="radiogroup"
            aria-label="Decided by"
            className="bg-bg-raised/60 border-border-subtle flex h-7 items-center gap-0.5 rounded-md border p-0.5"
          >
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                onClick={() => useShieldStore.getState().setHistoryFilter(f)}
                className={cn(
                  'h-full cursor-pointer rounded px-2 text-[11px] capitalize transition-colors',
                  filter === f
                    ? 'bg-bg-ink text-text-primary shadow-xs'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {open && (
        <div className="px-1 pb-1">
          {entries.length === 0 ? (
            <p className="text-text-tertiary px-3 pt-1 pb-3 text-[12px]">
              {total === 0
                ? 'Nothing in the last 24 hours.'
                : 'Nothing matches this filter.'}
            </p>
          ) : (
            <ul className="divide-border-subtle divide-y">
              {entries.slice(0, 50).map((e) => {
                const by = decidedByLabel(e);
                return (
                  <li
                    key={e.id}
                    className="grid grid-cols-[56px_1fr_auto] items-center gap-3 px-3 py-1.5 text-[12px]"
                  >
                    <span className="text-text-tertiary font-mono text-[11px] tabular-nums">
                      {fmtClock(e.ts)}
                    </span>
                    <span className="min-w-0">
                      <span className="text-text-primary block truncate">
                        {e.action}
                        {e.skill && (
                          <span className="text-text-tertiary">
                            {' '}
                            · {e.skill}
                          </span>
                        )}
                      </span>
                      {e.resource && (
                        <span className="text-text-tertiary block truncate font-mono text-[11px]">
                          {e.resource}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex h-5 items-center rounded-full border px-1.5 text-[10px]',
                          by.auto
                            ? 'border-border-subtle text-text-tertiary'
                            : 'border-border-accent text-accent'
                        )}
                      >
                        {by.label}
                      </span>
                      {retry && (
                        <button
                          type="button"
                          onClick={() =>
                            toast('Agent must re-request this action', {
                              description:
                                'Denied requests are not replayed — the agent asks again when it needs to.',
                            })
                          }
                          className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[11px]"
                        >
                          <RotateCcw
                            size={11}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          Retry
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </ShieldCard>
  );
}
