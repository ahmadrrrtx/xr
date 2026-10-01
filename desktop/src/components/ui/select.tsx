'use client';

import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Themed select (Phase 8) — the settings dropdown.
 * Radix Select via the monolithic `radix-ui` package; styled on XR tokens.
 */
const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;
const SelectGroup = SelectPrimitive.Group;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'border-border-default bg-bg-raised text-text-primary focus-visible:border-accent data-placeholder:text-text-tertiary inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[2px] focus-visible:ring-[color-mix(in_oklab,var(--accent)_40%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" className="text-text-tertiary shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'border-border-subtle bg-bg-ink text-text-primary z-50 max-h-72 min-w-[9rem] overflow-y-auto overflow-x-hidden rounded-lg border shadow-lg',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'text-text-secondary data-highlighted:bg-bg-raised data-highlighted:text-text-primary relative flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="flex-1" />
      <SelectPrimitive.ItemIndicator>
        <Check size={14} strokeWidth={1.5} aria-hidden="true" className="text-accent" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('text-text-tertiary px-2.5 py-1.5 text-[11px] font-medium tracking-[0.08em] uppercase', className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
};
