/*
 * Checkbox (Phase 7) — shadcn-style primitive on the vendored `radix-ui`
 * package (same source as dialog/popover/badge). Used by the Approval
 * Modal's remember options.
 */
import * as React from 'react';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from 'cn';

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'border-border-default bg-bg-raised/40 peer size-4 shrink-0 rounded-[4px] border',
        'transition-colors duration-150 ease-out',
        'focus-visible:border-accent focus-visible:ring-accent/30 focus-visible:ring-2 focus-visible:outline-none',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-contrast',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3" strokeWidth={2.5} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
