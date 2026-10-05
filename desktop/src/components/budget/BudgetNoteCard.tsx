/*
 * Inline budget outcomes (Phase 13). Three shapes, all calm:
 *   blocked     — the governor refused the call before it started
 *   downshifted — a cheaper model answered (badge, with the reason on hover)
 *   cutoff      — the stream stopped at the hard limit (partial kept)
 * Chat and the HUD quick-ask render these; the Budget screen owns the fix.
 */
import { ArrowDownRight, Scissors, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { fmtUsd } from '@/budget/core';
import { modelLabel } from '@/budget/models';
import type { BudgetNote } from '@/lib/chat-db';
import { cn } from '@/lib/utils';

function titleFor(code: string | undefined): string {
  switch (code) {
    case 'paused':
    case 'spike':
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
    default:
      return 'Budget limit reached';
  }
}

export function BudgetBlockedCard({
  note,
  compact = false,
  className,
}: {
  note: BudgetNote;
  compact?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const paused = note.code === 'paused' || note.code === 'spike';
  const tone = paused ? 'var(--danger)' : 'var(--warning)';
  return (
    <div
      role="status"
      data-testid="chat-budget-blocked"
      data-code={note.code}
      className={cn(
        'border-border-subtle bg-bg-ink text-text-primary rounded-2xl rounded-tl-[4px] border px-4 py-3',
        compact && 'rounded-lg px-3 py-2',
        className
      )}
      style={{ borderLeft: `3px solid ${tone}` }}
    >
      <div className="flex items-start gap-2.5">
        <Wallet
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className="mt-0.5 shrink-0"
          style={{ color: tone }}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'font-semibold',
              compact ? 'text-[12px]' : 'text-[13px]'
            )}
          >
            {titleFor(note.code)}
          </p>
          {note.reason && (
            <p
              className={cn(
                'text-text-secondary mt-0.5 leading-relaxed',
                compact ? 'text-[11px]' : 'text-[12px]'
              )}
            >
              {note.reason}
            </p>
          )}
          <p className="text-text-tertiary mt-1 text-[11px]">
            Nothing was sent.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                navigate(paused ? '/budget' : '/budget?tab=settings')
              }
              className="border-border-subtle bg-bg-raised text-text-primary hover:bg-bg-raised/70 h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
            >
              {paused ? 'Open Budget' : 'Raise limit'}
            </button>
            {!paused && note.code !== 'local-only' && (
              <button
                type="button"
                onClick={() => navigate('/budget?tab=models')}
                className="text-text-tertiary hover:text-text-primary h-7 cursor-pointer px-1 text-[12px] underline-offset-2 hover:underline"
              >
                Switch to a local model
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DownshiftBadge({
  note,
  className,
}: {
  note: BudgetNote;
  className?: string;
}) {
  if (!note.to) return null;
  const label = `Switched to ${modelLabel(note.to)} to stay within budget.`;
  return (
    <span
      data-testid="chat-downshift-badge"
      title={
        note.why
          ? `${label} ${note.why}${note.from ? ` Requested: ${modelLabel(note.from)}.` : ''}`
          : label
      }
      className={cn(
        'border-border-subtle bg-bg-raised text-text-secondary inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-[11px]',
        className
      )}
    >
      <ArrowDownRight
        size={11}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: 'var(--warning)' }}
      />
      <span className="truncate">{label}</span>
      {note.costUsd !== undefined && (
        <span className="text-text-tertiary shrink-0 font-mono">
          {fmtUsd(note.costUsd, { precise: true })}
        </span>
      )}
    </span>
  );
}

export function CutoffNote({
  note,
  className,
}: {
  note: BudgetNote;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      data-testid="chat-budget-cutoff"
      className={cn(
        'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]',
        className
      )}
    >
      <Scissors
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: 'var(--warning)' }}
      />
      <span className="text-text-secondary">
        {note.reason ?? 'Stopped at the hard budget limit.'}
      </span>
      <button
        type="button"
        onClick={() => navigate('/budget?tab=settings')}
        className="text-accent cursor-pointer font-semibold underline-offset-2 hover:underline"
      >
        Raise limit
      </button>
    </div>
  );
}
