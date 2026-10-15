/*
 * Wallet widget (Phase 1 brief §5.3 · docs/DESIGN-SYSTEM.md §5.7).
 * Phase 13: live from the spend governor — "$X.XX left" of the usable
 * monthly budget, with the health dot (green / amber / red; gray when the
 * budget is $0 = local only). Click opens the Budget screen.
 *
 * #14 — when the budget is in a warn / danger / capped / over state, an
 * inline "Add credits" pill appears next to the balance so a user watching
 * their spend run out mid-task has an obvious path to top up (deep-links
 * to /budget which is where the top-up flow lives). Hidden on narrow
 * windows (lg:inline) where there's no room for the balance text either.
 */
import { Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { fmtUsd, STATE_LABEL } from '@/budget/core';
import { cn } from '@/lib/utils';
import { selectBudgetState, useBudgetStore } from '@/stores/budgetStore';

/** States where the user is about to run out / has run out — show the CTA. */
const LOW_STATES = new Set(['warn', 'danger', 'capped', 'over']);

export function WalletWidget() {
  const navigate = useNavigate();
  const overview = useBudgetStore((s) => s.overview);
  const state = useBudgetStore(selectBudgetState);

  const color =
    state === 'paused' || state === 'capped' || state === 'over'
      ? 'var(--danger)'
      : state === 'warn' || state === 'danger'
        ? 'var(--warning)'
        : state === 'local'
          ? 'var(--text-tertiary)'
          : 'var(--success)';

  const label = !overview
    ? '—'
    : state === 'local'
      ? 'local'
      : state === 'paused'
        ? 'Paused'
        : `${fmtUsd(overview.remaining, { compact: true })} left`;

  const showAddCredits = !!overview && LOW_STATES.has(state) && state !== 'local';

  const aria = !overview
    ? 'Wallet — loading budget. Open Budget.'
    : state === 'local'
      ? 'Wallet — local models only, $0 budget. Open Budget.'
      : `Wallet — ${fmtUsd(overview.remaining)} left of ${fmtUsd(overview.monthlyLimit)} this month. ${STATE_LABEL[state]}. Open Budget.${showAddCredits ? ' Add credits.' : ''}`;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={aria}
        title="Wallet and budget"
        data-testid="topbar-wallet"
        data-state={state}
        onClick={() => navigate('/budget')}
        className="hover:bg-bg-raised focus-visible:ring-accent focus-visible:ring-offset-bg-void flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span className="relative flex items-center">
          <Wallet
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-text-secondary"
          />
          <span
            aria-hidden="true"
            data-testid="topbar-budget-dot"
            className={cn(
              'absolute -right-[3px] -bottom-[2px] h-1.5 w-1.5 rounded-full',
              'border-border-subtle rounded-full border'
            )}
            style={{ background: color }}
          />
        </span>
        {/* Icon-only on narrow windows */}
        <span
          className="text-text-secondary hidden text-[13px] leading-none font-medium tabular-nums lg:inline"
          data-testid="topbar-wallet-label"
        >
          {label}
        </span>
      </button>
      {showAddCredits && (
        <button
          type="button"
          aria-label="Add credits — open Budget to top up"
          title="Add credits"
          data-testid="topbar-wallet-add-credits"
          onClick={(e) => {
            e.stopPropagation();
            navigate('/budget?action=topup');
          }}
          className="bg-accent/15 text-accent hover:bg-accent/25 focus-visible:ring-accent hidden h-6 items-center rounded-full px-2 text-[11px] font-medium transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:outline-none lg:inline-flex"
        >
          + Add credits
        </button>
      )}
    </div>
  );
}
