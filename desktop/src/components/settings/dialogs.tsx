/*
 * Dialog-suite pieces for Settings (Phase 8):
 *   ConfirmDialog  typed-confirmation destructive dialog (aria-live)
 *   ThemeSwatch    72px circular theme preview (Appearance tab)
 *   TimeInput      themed native time picker (quiet hours)
 */
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ThemePreference } from '@/stores/theme';
import { cn } from '@/lib/utils';

/* ── ConfirmDialog ──────────────────────────────────────────────────── */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  requireText,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** When set, the confirm button stays disabled until this is typed. */
  requireText?: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Radix unmounts content while closed, so ConfirmBody's typed-gate
          state resets naturally on every open — no reset effect needed. */}
      <DialogContent
        className="border-border-subtle bg-bg-ink sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          if (requireText) {
            event.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <ConfirmBody
          title={title}
          body={body}
          confirmLabel={confirmLabel}
          requireText={requireText}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          busy={busy}
          inputRef={inputRef}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  title,
  body,
  confirmLabel,
  requireText,
  onConfirm,
  onOpenChange,
  busy,
  inputRef,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  requireText?: string;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [typed, setTyped] = useState('');

  const ready = requireText === undefined || typed === requireText;

  return (
    <>
      <DialogTitle className="text-text-primary text-base font-semibold">
        {title}
      </DialogTitle>
      <DialogDescription asChild>
        <div className="text-text-secondary text-[13px] leading-relaxed">
          <p aria-live="assertive">{body}</p>
          {requireText ? (
            <div className="mt-3">
              <label
                htmlFor="xr-confirm-input"
                className="text-text-tertiary text-xs"
              >
                Type <span className="text-text-primary font-mono">{requireText}</span> to
                confirm.
              </label>
              <Input
                id="xr-confirm-input"
                ref={inputRef}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="border-border-default bg-bg-raised mt-1.5 h-8 font-mono text-[13px]"
              />
            </div>
          ) : null}
        </div>
      </DialogDescription>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={!ready || busy}
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ── ThemeSwatch ────────────────────────────────────────────────────── */

export function ThemeSwatch({
  id,
  label,
  selected,
  onSelect,
}: {
  id: ThemePreference;
  label: string;
  selected: boolean;
  onSelect: (id: ThemePreference) => void;
}) {
  const reduceMotion = useReducedMotion();
  const isSystem = id === 'system';

  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={() => onSelect(id)}
      whileHover={reduceMotion ? undefined : { scale: 1.04 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="group flex flex-col items-center gap-1.5 outline-none"
    >
      <span
        className={cn(
          `swatch-${id}`,
          'relative flex h-[72px] w-[72px] items-center justify-center rounded-full transition-shadow duration-150',
          selected
            ? 'outline-accent outline-2 outline-offset-[3px]'
            : 'group-focus-visible:outline-accent group-focus-visible:outline-2 group-focus-visible:outline-offset-[3px]'
        )}
        style={
          isSystem
            ? {
                background:
                  'linear-gradient(135deg, var(--swatch-dark) 50%, var(--swatch-light) 50%)',
                border: '1px solid var(--swatch-border)',
              }
            : {
                background: 'var(--swatch-bg)',
                border: '1px solid var(--swatch-border)',
                boxShadow: '0 0 18px -4px var(--swatch-glow)',
              }
        }
      >
        {isSystem ? (
          <Settings2
            size={18}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-accent"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="h-5 w-5 rounded-full"
            style={{
              background: 'var(--swatch-dot)',
              boxShadow: '0 0 12px 1px var(--swatch-glow)',
            }}
          />
        )}
      </span>
      <span
        className={cn(
          'text-[11px]',
          selected
            ? 'text-text-primary font-medium'
            : 'text-text-secondary group-hover:text-text-primary'
        )}
      >
        {label}
      </span>
    </motion.button>
  );
}

/* ── TimeInput ──────────────────────────────────────────────────────── */

export function TimeInput({
  value,
  onChange,
  ariaLabel,
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="time"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="xr-time-input border-border-subtle bg-bg-raised text-text-primary focus-visible:border-accent h-8 rounded-md border px-2 text-[13px] tabular-nums outline-none disabled:opacity-50"
    />
  );
}
