import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-lg',
        className
      )}
      {...props}
    />
  );
}

/**
 * Command palette dialog — cmdk inside the shadcn Dialog (overlay + focus
 * trap). XR styling per docs/phases/01-app-shell.plan.md: 640px, rounded-xl,
 * backdrop blur; the outer glow is token-driven (accent glow themes only).
 */
function CommandDialog({
  title = 'Command palette',
  description = 'Search commands and screens, or ask XR',
  children,
  className,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-[640px]',
          'backdrop-blur-[20px]',
          'shadow-[0_24px_48px_rgba(0,0,0,0.7),_0_0_0_1px_var(--border-subtle),_0_0_24px_-4px_var(--accent-glow)]',
          className
        )}
      >
        <Command
          className={cn('bg-bg-ink border-border-subtle rounded-xl border')}
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="border-border-subtle flex h-[52px] items-center gap-3 border-b px-4"
    >
      <SearchIcon
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-text-tertiary shrink-0"
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'placeholder:text-text-tertiary text-text-primary flex h-full w-full bg-transparent text-base outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[340px] scroll-py-1 overflow-x-hidden overflow-y-auto',
        className
      )}
      {...props}
    />
  );
}

function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>
) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="text-text-tertiary py-6 text-center text-sm"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'text-text-foreground overflow-hidden p-1',
        '[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:uppercase',
        className
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('bg-border-subtle -mx-1 h-px', className)}
      {...props}
    />
  );
}

/**
 * Command row — selected state per docs/DESIGN-SYSTEM.md §5.10:
 * accent-tinted background + 1px accent left border.
 */
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "data-[selected=true]:text-text-primary data-[selected=true]:before:bg-accent relative flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-[4px] data-[selected=true]:before:left-0 data-[selected=true]:before:w-px data-[selected=true]:before:content-[''] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
};
