/*
 * Wallet widget (Phase 1 brief §5.3 · docs/DESIGN-SYSTEM.md §5.7).
 * Static "$5.00" with a green budget-health dot — the real spend governor
 * wires in Phase 13. Click navigates to the Budget screen.
 */
import { Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils';

export function WalletWidget() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      aria-label="Wallet — $5.00 available. Open Budget."
      title="Wallet and budget"
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
        {/* budget-health dot — static green until Phase 13 */}
        <span
          aria-hidden="true"
          className={cn(
            'bg-success absolute -right-[3px] -bottom-[2px] h-1.5 w-1.5 rounded-full',
            'border-border-subtle rounded-full border'
          )}
        />
      </span>
      {/* Icon-only on narrow windows */}
      <span className="text-text-secondary hidden text-[13px] leading-none font-medium lg:inline">
        $5.00
      </span>
    </button>
  );
}
