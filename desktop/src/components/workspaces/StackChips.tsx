/* Phase 10 — stack chips on workspace cards (max `max`, then "+N"). */
import { cn } from '@/lib/utils';
import { stackTone } from '@/workspaces/types';

export function StackChips({
  stack,
  max = 3,
  className,
}: {
  stack: readonly string[];
  max?: number;
  className?: string;
}) {
  if (stack.length === 0) return null;
  const shown = stack.slice(0, max);
  const extra = stack.length - shown.length;
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((t) => (
        <span
          key={t}
          className={cn(
            'text-text-secondary border-border-subtle inline-flex h-[18px] items-center rounded border px-1.5 font-mono text-[10.5px] leading-none',
            stackTone(t)
          )}
        >
          {t}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-text-tertiary inline-flex h-[18px] items-center px-0.5 font-mono text-[10.5px] leading-none">
          +{extra}
        </span>
      )}
    </div>
  );
}
