import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '../lib/haptics';

/* ---------------------------------------------------------------- skeleton --- */

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ background: 'color-mix(in srgb, var(--metal) 12%, transparent)' }}
      aria-hidden
    />
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="mt-2 h-3 w-2/3 opacity-70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- empty state --- */

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      {icon ? (
        <div className="mb-3 opacity-70" style={{ color: 'var(--text-tertiary)' }}>
          {icon}
        </div>
      ) : null}
      <p className="text-[16px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </p>
      {detail ? (
        <p className="mt-1.5 max-w-[300px] text-[13px] leading-[1.45]" style={{ color: 'var(--text-tertiary)' }}>
          {detail}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<span style={{ fontSize: 22 }}>⚠️</span>}
      title={message}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="tap rounded-full px-4 text-[15px] font-medium"
            style={{
              border: '1px solid var(--border-accent)',
              color: 'var(--accent)',
            }}
          >
            Retry
          </button>
        ) : undefined
      }
    />
  );
}

/* ------------------------------------------------------------------- toggle --- */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="text-[16px]" style={{ color: 'var(--text-primary)' }}>
          {label}
        </p>
        {description ? (
          <p className="mt-0.5 text-[12.5px] leading-[1.4]" style={{ color: 'var(--text-tertiary)' }}>
            {description}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          haptic('light');
          onChange(!checked);
        }}
        className="relative shrink-0 rounded-full disabled:opacity-40"
        style={{
          width: 51,
          height: 31,
          background: checked ? 'var(--accent)' : 'color-mix(in srgb, var(--metal) 26%, transparent)',
          transition: 'background 200ms ease-out',
        }}
      >
        <motion.span
          className="absolute top-[2px] block rounded-full"
          animate={{ left: checked ? 22 : 2 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32 }}
          style={{ width: 27, height: 27, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- segmented --- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex rounded-[10px] p-[2px]"
      style={{ background: 'color-mix(in srgb, var(--metal) 14%, transparent)' }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              haptic('light');
              onChange(option.value);
            }}
            className="flex-1 rounded-[8px] py-[7px] text-[13.5px] font-medium"
            style={{
              minHeight: 36,
              background: active ? 'var(--bg-raised)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.18)' : 'none',
              transition: 'background 180ms ease-out, color 180ms ease-out',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------- rows --- */

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-[14px] ${className}`}
      style={{
        background: 'color-mix(in srgb, var(--bg-ink) 88%, transparent)',
        border: '1px solid var(--border-subtle)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={{ color: 'var(--text-tertiary)' }}
    >
      {children}
    </p>
  );
}

export function Row({
  label,
  value,
  onPress,
  destructive,
  right,
  icon,
}: {
  label: string;
  value?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  right?: ReactNode;
  icon?: ReactNode;
}) {
  const content = (
    <>
      {icon ? <span style={{ color: 'var(--text-tertiary)' }}>{icon}</span> : null}
      <span
        className="flex-1 text-[16px]"
        style={{ color: destructive ? 'var(--danger)' : 'var(--text-primary)' }}
      >
        {label}
      </span>
      {value !== undefined ? (
        <span className="text-[15px]" style={{ color: 'var(--text-tertiary)' }}>
          {value}
        </span>
      ) : null}
      {right}
    </>
  );

  if (!onPress) {
    return <div className="flex min-h-[44px] items-center gap-3 px-4 py-2.5">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => {
        haptic('light');
        onPress();
      }}
      className="flex w-full min-h-[44px] items-center gap-3 px-4 py-2.5 text-left"
      style={{ borderTop: '1px solid var(--border-subtle)' }}
    >
      {content}
    </button>
  );
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'idle' }) {
  const color =
    tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : tone === 'bad' ? 'var(--danger)' : 'var(--text-tertiary)';
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: 8, height: 8, background: color, boxShadow: `0 0 8px ${color}` }}
      aria-hidden
    />
  );
}

export function Progress({
  value,
  tone = 'accent',
}: {
  value: number;
  tone?: 'accent' | 'warning' | 'danger';
}) {
  const color = tone === 'accent' ? 'var(--accent)' : tone === 'warning' ? 'var(--warning)' : 'var(--danger)';
  return (
    <div
      className="h-[6px] w-full overflow-hidden rounded-full"
      style={{ background: 'color-mix(in srgb, var(--metal) 18%, transparent)' }}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, value * 100))}%`,
          background: color,
          transition: 'width 320ms ease-out',
        }}
      />
    </div>
  );
}
