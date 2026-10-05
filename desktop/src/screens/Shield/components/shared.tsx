/* eslint-disable react-refresh/only-export-components -- leaf module: the
   Shield marks and their colour tables are one cohesive API. */
/*
 * Shield building blocks (Phase 12): state icon/dot, risk + decision marks,
 * Enforced/Planned badge, actor chip, card shell, JSON viewer. Pure
 * presentation; every colour comes from a theme token (risk-*, success,
 * warning, danger) — the accent is reserved for interaction, never status.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bot,
  Check,
  CircleDashed,
  FileEdit,
  Globe,
  Mail,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Terminal,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { ApprovalRisk } from '@/lib/approvalCore';
import { highlightToHtml } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import {
  DECISION_LABEL,
  RISK_LABEL,
  actorKind,
  actorLabel,
} from '@/shield/core';
import type {
  AuditDecision,
  CheckStatus,
  Enforcement,
  ShieldState,
} from '@/shield/types';

/* ── State ─────────────────────────────────────────────────────────────── */

export const STATE_COLOR: Record<ShieldState, string> = {
  protected: 'var(--success)',
  attention: 'var(--warning)',
  compromised: 'var(--danger)',
  unknown: 'var(--text-tertiary)',
};

export const STATE_LABEL: Record<ShieldState, string> = {
  protected: 'Protected',
  attention: 'Attention needed',
  compromised: 'Compromised',
  unknown: 'Checking',
};

/** Shield glyph per state — a static switch, not a component factory. */
export function StateIcon({
  state,
  size,
  strokeWidth = 1,
  className,
}: {
  state: ShieldState;
  size: number;
  strokeWidth?: number;
  className?: string;
}) {
  const common = { size, strokeWidth, className, 'aria-hidden': true as const };
  if (state === 'compromised') return <ShieldX {...common} />;
  if (state === 'attention') return <ShieldAlert {...common} />;
  return <ShieldCheck {...common} />;
}

/** 6 px status dot; paused shows as attention (intentional, not broken). */
export function StateDot({
  state,
  paused,
  className,
}: {
  state: ShieldState;
  paused?: boolean;
  className?: string;
}) {
  const effective: ShieldState =
    paused && state !== 'compromised' ? 'attention' : state;
  return (
    <span
      aria-hidden="true"
      data-state={effective}
      className={cn('inline-block size-1.5 shrink-0 rounded-full', className)}
      style={{ background: STATE_COLOR[effective] }}
    />
  );
}

/* ── Risk / decision ───────────────────────────────────────────────────── */

export const RISK_VAR: Record<ApprovalRisk, string> = {
  low: 'var(--risk-low)',
  medium: 'var(--risk-medium)',
  high: 'var(--risk-high)',
};

export function RiskChip({
  risk,
  className,
}: {
  risk: ApprovalRisk;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`Risk: ${RISK_LABEL[risk]}`}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium',
        className
      )}
      style={{
        color: RISK_VAR[risk],
        borderColor: `color-mix(in oklab, ${RISK_VAR[risk]} 40%, transparent)`,
        background: `color-mix(in oklab, ${RISK_VAR[risk]} 10%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ background: RISK_VAR[risk] }}
      />
      {RISK_LABEL[risk]}
    </span>
  );
}

export const DECISION_COLOR: Record<AuditDecision, string> = {
  allowed: 'var(--success)',
  'auto-approved': 'var(--success)',
  denied: 'var(--text-tertiary)',
  quarantined: 'var(--warning)',
  blocked: 'var(--danger)',
  error: 'var(--danger)',
};

export function DecisionMark({
  decision,
  className,
}: {
  decision: AuditDecision;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          decision === 'auto-approved' &&
            'ring-1 ring-current ring-offset-1 ring-offset-transparent'
        )}
        style={{
          background:
            decision === 'auto-approved'
              ? 'transparent'
              : DECISION_COLOR[decision],
          color: DECISION_COLOR[decision],
        }}
      />
      <span className="truncate">{DECISION_LABEL[decision]}</span>
    </span>
  );
}

/* ── Checks ────────────────────────────────────────────────────────────── */

export const CHECK_COLOR: Record<CheckStatus, string> = {
  pass: 'var(--success)',
  warn: 'var(--warning)',
  fail: 'var(--danger)',
  planned: 'var(--text-tertiary)',
};

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'Passed',
  warn: 'Warning',
  fail: 'Failed',
  planned: 'Planned',
};

export function CheckMark({ status }: { status: CheckStatus }) {
  const color = CHECK_COLOR[status];
  return (
    <span
      role="img"
      aria-label={CHECK_STATUS_LABEL[status]}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full"
      style={{
        color,
        background:
          status === 'planned'
            ? 'transparent'
            : `color-mix(in oklab, ${color} 14%, transparent)`,
      }}
    >
      {status === 'pass' && (
        <Check size={11} strokeWidth={2.5} aria-hidden="true" />
      )}
      {status === 'warn' && (
        <span aria-hidden="true" className="text-[11px] leading-none font-bold">
          !
        </span>
      )}
      {status === 'fail' && (
        <span aria-hidden="true" className="text-[11px] leading-none font-bold">
          ×
        </span>
      )}
      {status === 'planned' && (
        <CircleDashed size={13} strokeWidth={1.75} aria-hidden="true" />
      )}
    </span>
  );
}

/* ── Enforcement badge (Art. IV.2: planned things say so) ──────────────── */

export function EnforcementBadge({
  enforcement,
  unavailable,
}: {
  enforcement: Enforcement;
  unavailable?: boolean;
}) {
  if (unavailable)
    return (
      <span className="text-text-tertiary border-border-subtle inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium tracking-wide">
        ○ Unavailable
      </span>
    );
  return enforcement === 'enforced' ? (
    <span
      className="inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium tracking-wide"
      style={{
        color: 'var(--success)',
        borderColor: 'color-mix(in oklab, var(--success) 40%, transparent)',
      }}
    >
      <Check size={9} strokeWidth={3} aria-hidden="true" />
      Enforced
    </span>
  ) : (
    <span className="text-text-tertiary border-border-subtle inline-flex h-[18px] items-center gap-1 rounded-full border border-dashed px-1.5 text-[10px] font-medium tracking-wide">
      Planned
    </span>
  );
}

/* ── Actor / skill ─────────────────────────────────────────────────────── */

export function ActorChip({ actor }: { actor: string }) {
  const kind = actorKind(actor);
  const Icon = kind === 'user' ? User : kind === 'agent' ? Bot : ShieldCheck;
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-1.5 text-[11px]',
        kind === 'user'
          ? 'border-border-subtle text-text-primary'
          : kind === 'agent'
            ? 'border-border-accent text-accent'
            : 'border-border-subtle text-text-tertiary'
      )}
    >
      <Icon size={10} strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{actorLabel(actor)}</span>
    </span>
  );
}

const SKILL_ICONS: Record<string, LucideIcon> = {
  mail: Mail,
  gmail: Mail,
  email: Mail,
  'file-edit': FileEdit,
  file: FileEdit,
  'fs-skill': FileEdit,
  terminal: Terminal,
  shell: Terminal,
  'shell-skill': Terminal,
  globe: Globe,
  web: Globe,
  'web-skill': Globe,
};

export function SkillIcon({
  icon,
  size = 14,
  className,
}: {
  icon: string;
  size?: number;
  className?: string;
}) {
  const Icon = SKILL_ICONS[icon] ?? Wrench;
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={1.5}
      size={size}
      className={className}
    />
  );
}

/* ── Card shell ────────────────────────────────────────────────────────── */

export function ShieldCard({
  title,
  action,
  children,
  className,
  danger,
  testId,
  as: Tag = 'section',
  ariaLabel,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  danger?: boolean;
  testId?: string;
  as?: 'section' | 'div';
  ariaLabel?: string;
}) {
  return (
    <Tag
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn(
        'bg-bg-ink rounded-xl border',
        danger
          ? 'border-[color-mix(in_oklab,var(--danger)_45%,transparent)]'
          : 'border-border-subtle',
        className
      )}
    >
      {(title || action) && (
        <header className="flex min-h-10 items-center justify-between gap-3 px-4 pt-3 pb-1">
          {title && (
            <h3
              className={cn(
                'text-[13px] font-medium tracking-[0.06em] uppercase',
                danger ? 'text-danger' : 'text-text-tertiary'
              )}
            >
              {title}
            </h3>
          )}
          {action}
        </header>
      )}
      {children}
    </Tag>
  );
}

/* ── JSON viewer (Shiki, dual theme vars) ──────────────────────────────── */

export function JsonView({
  value,
  maxHeight = 320,
  testId,
}: {
  value: unknown;
  maxHeight?: number;
  testId?: string;
}) {
  const text = useMemo(() => JSON.stringify(value ?? null, null, 2), [value]);
  const [cached, setCached] = useState<{ text: string; html: string | null }>({
    text,
    html: null,
  });
  if (cached.text !== text) setCached({ text, html: null });

  useEffect(() => {
    let alive = true;
    void highlightToHtml(text, 'json').then((h) => {
      if (alive) setCached({ text, html: h });
    });
    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <div
      data-testid={testId}
      className="bg-bg-raised/40 border-border-subtle overflow-auto rounded-md border p-2.5"
      style={{ maxHeight }}
    >
      {cached.html ? (
        <pre
          className="shiki font-mono text-[12px] leading-5"
          // sink-allow: shiki engine output only — the text is JSON.stringify'd audit/approval data, tokenized and HTML-escaped BY shiki itself (it is a syntax highlighter), so no raw or user-authored HTML can reach this node.
          dangerouslySetInnerHTML={{ __html: cached.html }}
        />
      ) : (
        <pre className="text-text-secondary font-mono text-[12px] leading-5">
          {text}
        </pre>
      )}
    </div>
  );
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('font-mono text-[12px]', className)}>{children}</span>
  );
}
