/*
 * Settings controls (Phase 8) — the four widgets every tab reaches for.
 *
 *   Toggle    40×22 pill, 18px thumb, spring 380/26 (real role=switch)
 *   Segmented iOS-style equal segments with a sliding indicator
 *   LabeledSlider  ui/slider + right-aligned value readout
 *   Select    native select, 32px, chevron affordance
 *   SearchInput   32px raised input with a leading search glyph
 */
import { useId, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Search } from 'lucide-react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { Kbd } from '@/components/ui/kbd';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

/* ── Toggle ─────────────────────────────────────────────────────────── */

export function Toggle({
  checked,
  onCheckedChange,
  disabled,
  id,
  ariaLabel,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'focus-visible:ring-accent/50 inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border px-[2px] transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-void disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-transparent bg-accent'
          : 'border-border-default bg-bg-raised',
        className
      )}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          className={cn(
            'block h-[18px] w-[18px] rounded-full shadow-sm',
            checked ? 'bg-accent-contrast' : 'bg-text-tertiary'
          )}
          animate={{ x: checked ? 18 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

/* ── Segmented ──────────────────────────────────────────────────────── */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const onkeydown = (event: React.KeyboardEvent, index: number): void => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    const button = buttonsRef.current[next];
    button?.focus();
    onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'bg-bg-raised inline-flex items-center gap-[2px] rounded-md p-[3px]',
        className
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onkeydown(event, index)}
            className={cn(
              'focus-visible:ring-accent/50 relative h-7 rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2',
              selected
                ? 'text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`segmented-${groupId}`}
                className="border-border-subtle bg-bg-ink absolute inset-0 rounded-[5px] border"
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 300, damping: 26 }
                }
              />
            ) : null}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Labeled slider ─────────────────────────────────────────────────── */

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  className?: string;
}) {
  return (
    <div className={cn('flex w-44 items-center gap-3', className)}>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(values) => onChange(values[0] ?? value)}
      />
      <span className="text-text-secondary w-10 shrink-0 text-right text-xs tabular-nums">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/* ── Search input ───────────────────────────────────────────────────── */

export function Select({
  ariaLabel,
  value,
  placeholder,
  options,
  onChange,
  className,
}: {
  ariaLabel: string;
  value: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-border-subtle bg-bg-raised text-text-primary focus-visible:border-accent h-8 max-w-56 cursor-pointer appearance-none rounded-md border pr-7 pl-2.5 text-xs outline-none"
      >
        {placeholder ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-text-tertiary pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
      />
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  id,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-text-tertiary pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
      />
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border-border-subtle bg-bg-raised text-text-primary placeholder:text-text-tertiary focus-visible:border-accent h-8 w-full rounded-md border pr-12 pl-8 text-[13px] outline-none"
      />
      {hint ? (
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
          <Kbd>{hint}</Kbd>
        </span>
      ) : null}
    </div>
  );
}
