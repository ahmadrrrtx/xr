/*
 * Tab state lives in the URL (`/budget?tab=history`) so deep links from the
 * bell, banners, chat cards and the palette land on the right panel.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isBudgetTab, type BudgetTab } from '@/budget/types';

export function useBudgetTab(): [BudgetTab, (tab: BudgetTab) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: BudgetTab = isBudgetTab(raw) ? raw : 'overview';
  const setTab = useCallback(
    (next: BudgetTab) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'overview') p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        { replace: true }
      );
    },
    [setParams]
  );
  return [tab, setTab];
}
