/*
 * Settings primitives (Phase 8) — the section/row chassis every tab uses.
 * No tab inlines its own row markup: everything goes through these two so
 * density, hover and dividers stay uniform (SCREEN 14 · Layout).
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';

/** 13px uppercase section header → card with divided rows. */
export function SettingsSection({
  title,
  description,
  className,
  cardClassName,
  children,
}: {
  title?: string;
  description?: string;
  className?: string;
  cardClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('mb-5', className)}>
      {title ? (
        <h3 className="text-text-tertiary mb-2 text-[13px] font-medium tracking-[0.08em] uppercase">
          {title}
        </h3>
      ) : null}
      {description ? (
        <p className="text-text-tertiary mb-2 text-xs">{description}</p>
      ) : null}
      <div
        className={cn(
          'border-border-subtle bg-bg-ink divide-border-subtle rounded-xl border divide-y',
          cardClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One preference row: label (+ description) left, control right.
 * Density-aware (`.xr-density-row`), 12×14 internal padding, calm hover.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  locked,
  lockedNote,
  danger,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  locked?: boolean;
  lockedNote?: string;
  danger?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const LabelTag = (htmlFor ? 'label' : 'div') as 'label';
  return (
    <div
      className={cn(
        'xr-density-row hover:bg-bg-raised/60 flex items-center justify-between gap-4 px-3.5 transition-colors duration-150',
        className
      )}
    >
      <div className="min-w-0 py-1.5">
        <LabelTag
          htmlFor={htmlFor}
          className={cn(
            'text-[13px] font-medium',
            danger ? 'text-danger' : 'text-text-primary'
          )}
        >
          {label}
          {locked ? (
            <Lock
              size={12}
              strokeWidth={1.5}
              aria-label="Locked"
              className="text-text-tertiary ml-1.5 inline align-[-2px]"
            />
          ) : null}
        </LabelTag>
        {description ? (
          <p className="text-text-tertiary mt-0.5 text-xs leading-relaxed">
            {description}
          </p>
        ) : null}
        {locked && lockedNote ? (
          <p className="text-text-tertiary mt-0.5 text-xs">{lockedNote}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
