import type { ReactNode } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { haptic } from '../lib/haptics';

interface ScreenProps {
  children: ReactNode;
  /** Large iOS-style title in the content area (chat list, settings). */
  title?: string | undefined;
  /** Compact centred title in the nav bar (conversation). */
  navTitle?: string | undefined;
  onBack?: (() => void) | undefined;
  right?: ReactNode | undefined;
  /** Renders a hairline divider under the header. Default true. */
  divider?: boolean;
}

/**
 * Screen chrome with safe-area insets applied everywhere:
 * nothing ever sits under the notch, the Dynamic Island or the home indicator.
 */
export function Screen({ children, title, navTitle, onBack, right, divider = true }: ScreenProps) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header
        className="pt-safe glass shrink-0"
        style={divider ? { borderBottom: '1px solid var(--border-subtle)' } : undefined}
      >
        <div className="flex h-[44px] items-center gap-1 px-2">
          {onBack ? (
            <button
              type="button"
              onClick={() => {
                haptic('light');
                onBack();
              }}
              aria-label="Back"
              className="tap -ml-2 flex items-center justify-center rounded-full px-1"
            >
              <ChevronLeft size={26} strokeWidth={1.5} style={{ color: 'var(--accent)' }} aria-hidden />
            </button>
          ) : null}

          {navTitle ? (
            <h1
              className="flex-1 truncate px-1 text-center text-[17px] font-semibold tracking-[-0.01em]"
              style={{ color: 'var(--text-primary)' }}
            >
              {navTitle}
            </h1>
          ) : (
            <div className="flex-1" />
          )}

          <div className="flex items-center gap-1">
            {right}
            {/* Balance the back button so titles stay optically centred. */}
            {onBack && !right ? <span className="w-[38px]" aria-hidden /> : null}
          </div>
        </div>

        {title ? (
          <h1
            className="px-4 pb-2 pt-1 text-[32px] font-bold leading-[1.15] tracking-[-0.02em]"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </h1>
        ) : null}
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function ScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
      <Loader2 size={20} strokeWidth={1.5} className="spinner" style={{ color: 'var(--accent)' }} aria-hidden />
      {label ? (
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </p>
      ) : null}
    </div>
  );
}
