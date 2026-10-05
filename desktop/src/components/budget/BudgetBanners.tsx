/*
 * App-wide budget banners (Phase 13). One stripe under the Topbar, highest
 * priority wins: paused (red) › limit reached (red) › over budget with the
 * hard cap off (amber) › 80 % warning (amber, dismissible per period).
 * Steady states look steady — 280 ms in/out, opacity-only under reduced
 * motion, nothing pulses here.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, OctagonPause, Wallet, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { fmtPct, fmtUsd } from '@/budget/core';
import { selectWarnBanner, useBudgetStore } from '@/stores/budgetStore';

type Banner =
  | { id: 'paused'; tone: 'danger'; text: string; sub: string; spike: boolean }
  | { id: 'capped'; tone: 'danger'; text: string; sub: string }
  | { id: 'over'; tone: 'warning'; text: string; sub: string }
  | { id: 'warn'; tone: 'warning'; text: string; sub: string };

export function BudgetBanners() {
  const overview = useBudgetStore((s) => s.overview);
  const settings = useBudgetStore((s) => s.settings);
  const showWarn = useBudgetStore(selectWarnBanner);
  const resume = useBudgetStore((s) => s.resume);
  const dismissWarn = useBudgetStore((s) => s.dismissWarn);
  const reduced = useReducedMotion();
  const navigate = useNavigate();

  let banner: Banner | null = null;
  if (overview) {
    const spent = fmtUsd(overview.spentMonth);
    const limit = fmtUsd(overview.monthlyLimit);
    if (overview.state === 'paused') {
      const r = settings.pauseReason;
      banner = {
        id: 'paused',
        tone: 'danger',
        spike: r === 'spike',
        text:
          r === 'spike'
            ? 'Spending paused — unusual spike.'
            : r === 'threshold'
              ? 'Spending paused by the circuit breaker.'
              : 'Spending is paused.',
        sub:
          r === 'spike'
            ? `${fmtUsd(overview.spentLast5min)} in the last 5 minutes.`
            : r === 'threshold'
              ? `${fmtPct(overview.pctUsedMonth)} of the monthly limit used.`
              : 'Cloud and local calls are blocked until you resume.',
      };
    } else if (overview.state === 'capped') {
      banner = {
        id: 'capped',
        tone: 'danger',
        text: 'Budget limit reached.',
        sub: `${spent} of ${limit} — new cloud calls are blocked.`,
      };
    } else if (overview.state === 'over') {
      banner = {
        id: 'over',
        tone: 'warning',
        text: 'Over budget.',
        sub: `${spent} of ${limit} — hard cap is off, so calls still run.`,
      };
    } else if (showWarn) {
      banner = {
        id: 'warn',
        tone: 'warning',
        text: `${fmtPct(overview.pctUsedMonth)} of your monthly budget used.`,
        sub: `${spent} of ${limit} · resets in ${overview.daysUntilReset} day${overview.daysUntilReset === 1 ? '' : 's'}.`,
      };
    }
  }

  return (
    <AnimatePresence initial={false}>
      {banner && (
        <motion.div
          key={banner.id}
          role={banner.tone === 'danger' ? 'alert' : 'status'}
          aria-live={banner.tone === 'danger' ? 'assertive' : 'polite'}
          data-testid={`budget-banner-${banner.id}`}
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="budget-banner relative z-30 shrink-0 overflow-hidden"
          data-tone={banner.tone}
        >
          <div className="flex h-9 items-center gap-2.5 px-4 text-[13px]">
            {banner.id === 'paused' ? (
              <OctagonPause
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0"
                style={{ color: 'var(--danger)' }}
              />
            ) : banner.tone === 'danger' ? (
              <Wallet
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0"
                style={{ color: 'var(--danger)' }}
              />
            ) : (
              <AlertTriangle
                size={14}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0"
                style={{ color: 'var(--warning)' }}
              />
            )}
            <span className="text-text-primary font-medium">{banner.text}</span>
            <span className="text-text-secondary hidden truncate sm:inline">
              {banner.sub}
            </span>

            <div className="ml-auto flex items-center gap-1.5">
              {banner.id === 'paused' ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(banner.spike ? '/budget?tab=history' : '/budget')
                    }
                    className="text-text-tertiary hover:text-text-primary cursor-pointer px-1 text-[12px] underline-offset-2 hover:underline"
                  >
                    {banner.spike ? 'Review' : 'Open Budget'}
                  </button>
                  <button
                    type="button"
                    data-testid="budget-banner-resume"
                    onClick={() => void resume()}
                    className="border-border-subtle bg-bg-ink text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
                  >
                    Resume
                  </button>
                </>
              ) : banner.id === 'over' ? (
                <button
                  type="button"
                  onClick={() => navigate('/budget?tab=settings')}
                  className="border-border-subtle bg-bg-ink text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
                >
                  Turn hard cap on
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="budget-banner-raise"
                  onClick={() => navigate('/budget?tab=settings')}
                  className="border-border-subtle bg-bg-ink text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
                >
                  Raise limit
                </button>
              )}
              {banner.id === 'warn' && (
                <button
                  type="button"
                  aria-label="Dismiss for this month"
                  onClick={dismissWarn}
                  className="text-text-tertiary hover:text-text-primary flex size-7 cursor-pointer items-center justify-center rounded-md"
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
