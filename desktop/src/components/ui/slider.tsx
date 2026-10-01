'use client';

import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Themed slider (Phase 8) — accent-filled range with a 14px thumb.
 */
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex w-full touch-none items-center select-none data-disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-bg-raised relative h-1 w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range className="bg-accent absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="border-border-default bg-bg-ink focus-visible:border-accent block h-3.5 w-3.5 rounded-full border shadow transition-colors outline-none focus-visible:ring-[2px] focus-visible:ring-[color-mix(in_oklab,var(--accent)_40%,transparent)]"
        aria-label="Value"
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
