/*
 * Onboarding shared primitives — XR-Native cinematic styling (THEME-SYSTEM
 * rule 7). The wizard root forces data-theme="xr-native", so tokens here
 * always resolve against the dark palette.
 */
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Step heading + supporting line (staggered entrance). */
export function StepHeader({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <header className="mb-6">
      <h2 className="text-text-primary text-[22px] leading-tight font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {sub && (
        <p className="text-text-tertiary mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed">
          {sub}
        </p>
      )}
    </header>
  );
}

/** Selectable card (model / voice / theme rows). */
export function OptionCard({
  selected,
  onClick,
  badge,
  title,
  desc,
  right,
  role = 'button',
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  badge?: string;
  title: string;
  desc?: string;
  right?: ReactNode;
  role?: 'button' | 'radio';
  ariaLabel?: string;
}) {
  // Rendered as a div (not <button>) so interactive content (e.g. voice
  // preview buttons) can nest inside without invalid DOM nesting. Keyboard:
  // Space selects; Enter intentionally falls through to the wizard continue.
  return (
    <div
      role={role === 'radio' ? 'radio' : 'button'}
      tabIndex={0}
      aria-checked={role === 'radio' ? selected : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`border-border-subtle bg-bg-raised/40 hover:border-border-default w-full cursor-pointer rounded-xl border p-3.5 text-left transition-colors outline-none focus-visible:border-accent ${
        selected ? 'border-accent bg-accent/8' : ''
      }`}
      style={selected ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : undefined}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-text-primary truncate text-[14px] font-medium">{title}</span>
            {badge && (
              <span className="bg-accent/15 text-accent rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                {badge}
              </span>
            )}
          </div>
          {desc && <p className="text-text-tertiary mt-1 text-[12.5px] leading-snug">{desc}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

/** System-check row: icon + label + value + state. */
export function CheckRow({
  label,
  value,
  state,
  hint,
}: {
  label: string;
  value: string | null;
  state: 'checking' | 'ok' | 'warn';
  hint?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="border-border-subtle flex items-center gap-3 border-b py-2.5 last:border-b-0"
    >
      <span className="text-text-secondary w-40 shrink-0 text-[13px]">{label}</span>
      <span className="text-text-primary min-w-0 flex-1 truncate text-[13px] font-medium">
        {value ?? 'Detecting…'}
      </span>
      {state === 'checking' && (
        <span
          role="status"
          aria-label={`${label} checking`}
          className="border-accent border-t-accent/40 size-3.5 animate-spin rounded-full border-2"
        />
      )}
      {state === 'ok' && (
        <span aria-label={`${label} ok`} className="text-accent text-[13px]">✓</span>
      )}
      {state === 'warn' && (
        <span
          aria-label={`${label} warning`}
          title={hint}
          className="text-warning text-[13px]"
        >
          ⚠
        </span>
      )}
    </motion.div>
  );
}

/** Small labeled toggle switch. */
export function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <span className="text-text-primary text-[13.5px] font-medium">{label}</span>
        {desc && <p className="text-text-tertiary text-[12px]">{desc}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-bg-raised border-border-subtle border'
        }`}
      >
        <motion.span
          className="bg-accent-contrast absolute top-[2px] size-[18px] rounded-full"
          animate={{ left: checked ? 18 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </label>
  );
}

/** Fade/slide-in wrapper for step content chunks (reduced-motion aware). */
export function Reveal({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
