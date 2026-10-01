import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Keyboard chord chip — mono 11px on a raised surface
 * (docs/phases/08-settings.plan.md §2). Used by the shortcuts tab, palette
 * hints and section headers.
 */
export function Kbd({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <kbd
      className={cn(
        'border-border-subtle bg-bg-raised text-text-secondary inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[11px] leading-none',
        className
      )}
    >
      {children}
    </kbd>
  );
}
