/*
 * Tab state lives in the URL (`/shield?tab=audit`) so deep links from the
 * bell, the palette and Settings land on the right panel. The store never
 * holds it.
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isShieldTab, type ShieldTab } from '@/shield/types';

export function useShieldTab(): [ShieldTab, (tab: ShieldTab) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: ShieldTab = isShieldTab(raw) ? raw : 'status';
  const setTab = useCallback(
    (next: ShieldTab) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'status') p.delete('tab');
          else p.set('tab', next);
          // Section anchors only make sense on the tab that owns them.
          p.delete('section');
          return p;
        },
        { replace: true }
      );
    },
    [setParams]
  );
  return [tab, setTab];
}
