/*
 * Budget screen primitives (Phase 13): card shell, stat tile, native range
 * slider with readout, preset chips, the gray "local" pill, enforcement
 * badge, category swatch. Calm by construction — no glow outside the two
 * glow themes, red only for paused / capped.
 */
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { barBand, fmtUsd } from '@/budget/core';
import type { SpendCategory } from '@/budget/types';
import { CATEGORY_LABEL } from '@/budget/types';
import { cn } from '@/lib/utils';

/* ── Card shell ────────────────────────────────────────────────────────── */

export function BudgetCard({
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

/* ── Stat tile ─────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  hint,
  testId,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'bg-bg-ink border-border-subtle flex min-h-[84px] flex-col justify-between rounded-xl border px-4 py-3 text-left',
        onClick &&
          'hover:bg-bg-raised/60 focus-visible:ring-accent cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      <span className="text-text-tertiary text-[12px]">{label}</span>
      <span className="text-text-primary text-[22px] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      {hint !== undefined && (
        <span className="text-text-tertiary mt-1 text-[11px]">{hint}</span>
      )}
    </Tag>
  );
}

/* ── Native range slider ───────────────────────────────────────────────── */

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  format,
  hint,
  disabled,
  testId,
  ariaValueText,
  className,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Fires on release / keyboard end — the backend write. */
  onCommit?: (v: number) => void;
  format: (v: number) => string;
  hint?: ReactNode;
  disabled?: boolean;
  testId?: string;
  ariaValueText?: string;
  className?: string;
}) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-text-primary text-[13px]">
          {label}
        </label>
        <span
          className="text-text-secondary font-mono text-[12px] tabular-nums"
          aria-hidden="true"
        >
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        data-testid={testId}
        aria-valuetext={ariaValueText ?? format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) =>
          onCommit?.(Number((e.target as HTMLInputElement).value))
        }
        onKeyUp={(e) =>
          onCommit?.(Number((e.target as HTMLInputElement).value))
        }
        onBlur={(e) => onCommit?.(Number(e.target.value))}
        className="budget-range"
        style={{ ['--range-pct' as string]: `${pct}%` }}
      />
      {hint !== undefined && (
        <p className="text-text-tertiary text-[11px]">{hint}</p>
      )}
    </div>
  );
}

/* ── Preset chips ──────────────────────────────────────────────────────── */

export function PresetChips({
  values,
  current,
  onPick,
  format = (v) => fmtUsd(v, { compact: true }),
  testIdPrefix,
}: {
  values: readonly number[];
  current: number;
  onPick: (v: number) => void;
  format?: (v: number) => string;
  testIdPrefix?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets">
      {values.map((v) => {
        const active = Math.abs(v - current) < 0.0001;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
            onClick={() => onPick(v)}
            className={cn(
              'h-7 min-w-10 cursor-pointer rounded-md border px-2 font-mono text-[12px] tabular-nums transition-colors',
              active
                ? 'border-accent text-text-primary bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]'
                : 'border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised'
            )}
          >
            {format(v)}
          </button>
        );
      })}
    </div>
  );
}

/* ── Pills & badges ────────────────────────────────────────────────────── */

/** Local models cost nothing in cash — say "local", never "free!". */
export function LocalPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'border-border-subtle text-text-tertiary inline-flex h-[18px] items-center rounded-full border px-1.5 text-[10px] font-medium tracking-wide',
        className
      )}
    >
      local
    </span>
  );
}

export function EstimatePill() {
  return (
    <span
      title="No list price for this model — XR uses a mid-tier estimate."
      className="border-border-subtle text-text-tertiary inline-flex h-[18px] items-center rounded-full border border-dashed px-1.5 text-[10px] font-medium tracking-wide"
    >
      estimate
    </span>
  );
}

/** Enforced = the Rust governor checks it before every call. Planned = it does not, yet. */
export function EnforcedBadge({ planned = false }: { planned?: boolean }) {
  return planned ? (
    <span className="text-text-tertiary border-border-subtle inline-flex h-[18px] items-center gap-1 rounded-full border border-dashed px-1.5 text-[10px] font-medium tracking-wide">
      Planned
    </span>
  ) : (
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
  );
}

export function CategorySwatch({
  category,
  label = true,
}: {
  category: SpendCategory;
  label?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span
        aria-hidden="true"
        className="inline-block size-2 rounded-[2px]"
        style={{ background: `var(--spend-${category})` }}
      />
      {label && (
        <span className="text-text-secondary">{CATEGORY_LABEL[category]}</span>
      )}
    </span>
  );
}

export function CategoryChip({ category }: { category: SpendCategory }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-full border px-1.5 text-[11px]"
      style={{
        color: `var(--spend-${category})`,
        borderColor: `color-mix(in oklab, var(--spend-${category}) 40%, transparent)`,
      }}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/** Thin horizontal usage bar (agents / workspaces / by-model rows). */
export function UsageBar({
  value,
  max,
  cap,
  color,
  height = 6,
  testId,
}: {
  value: number;
  max: number;
  /** Optional cap tick (same unit as value). */
  cap?: number | null;
  color?: string;
  height?: number;
  testId?: string;
}) {
  const denom = Math.max(max, cap ?? 0, 0.000001);
  const pct = Math.min(100, (value / denom) * 100);
  const band = cap ? barBand(value / cap) : 'ok';
  const fill = color ?? `var(--budget-${band})`;
  return (
    <div
      className="bg-bg-raised relative w-full overflow-hidden rounded-full"
      style={{ height }}
      data-testid={testId}
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%`, background: fill }}
      />
      {cap ? (
        <span
          className="absolute top-0 h-full w-px"
          style={{
            left: `${Math.min(100, (cap / denom) * 100)}%`,
            background: 'var(--text-tertiary)',
          }}
        />
      ) : null}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-text-tertiary text-[13px] font-medium tracking-[0.06em] uppercase">
        {children}
      </h3>
      {hint && <span className="text-text-tertiary text-[11px]">{hint}</span>}
    </div>
  );
}

export function Row({
  label,
  hint,
  control,
  badge,
  testId,
  bare,
}: {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  badge?: ReactNode;
  testId?: string;
  /** No padding / divider — for rows inside an already padded stack. */
  bare?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex items-center justify-between gap-4',
        bare
          ? 'py-1'
          : 'border-border-subtle border-b px-4 py-3 last:border-b-0'
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-[13px]">{label}</span>
          {badge}
        </div>
        {hint && (
          <p className="text-text-tertiary mt-0.5 text-[12px]">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
