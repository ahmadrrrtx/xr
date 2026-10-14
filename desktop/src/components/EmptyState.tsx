/**
 * Shared empty state (Phase 31 · Bucket F v2, F6).
 *
 * The delivered pack contains no UI-illustration set (verified in Drive),
 * so the visual is the sentinel itself: the v2 front render at reading
 * size with a reduced-motion-safe idle float — never a state GIF (those
 * are reserved for large hero surfaces). Title, one-line consequence,
 * and up to two actions; never rendered while loading.
 */
import type { ReactNode } from 'react';

import { Avatar } from '@/components/brand/Avatar';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Primary + optional secondary action buttons. */
  actions?: ReactNode;
  /** Override the sentinel visual (e.g. a delivered icon at large size). */
  visual?: ReactNode;
  className?: string;
  testId?: string;
}

export function EmptyState({ title, description, actions, visual, className, testId }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-10 text-center',
        className,
      )}
      data-testid={testId}
    >
      {visual ?? (
        <div className="motion-safe:animate-[xr-empty-float_7s_ease-in-out_infinite]" aria-hidden="true">
          <Avatar variant="head" size="lg" state="sleeping" />
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-text-primary text-[15px] font-medium">{title}</p>
        {description ? (
          <p className="text-text-tertiary mx-auto max-w-[380px] text-[13px] leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
