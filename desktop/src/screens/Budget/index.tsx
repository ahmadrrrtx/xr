/*
 * Budget (Phase 13, SCREEN 11). Header + six URL-backed tabs. The screen
 * only *renders* the governor — enforcement lives in `budget/enforce.ts`
 * (TS) and `src-tauri/src/budget/` (Rust), which every call site asks
 * before spending. Keys: 1–6 tabs · / search · P pause (confirms) ·
 * R resume · E export · Esc clears.
 */
import { ChevronDown, Download, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { pauseReasonText, tabForKey } from '@/budget/core';
import { BUDGET_TABS } from '@/budget/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useBudgetStore } from '@/stores/budgetStore';

import { CapsTab } from './components/CapsTab';
import { HistoryTab } from './components/HistoryTab';
import { ModelsTab } from './components/ModelsTab';
import { OverviewTab } from './components/OverviewTab';
import { PauseDialog } from './components/PauseDialog';
import { SettingsTab } from './components/SettingsTab';
import { useBudgetTab } from './useBudgetTab';

export default function BudgetScreen() {
  const [tab, setTab] = useBudgetTab();
  const [params, setParams] = useSearchParams();
  const overview = useBudgetStore((s) => s.overview);
  const settings = useBudgetStore((s) => s.settings);
  const error = useBudgetStore((s) => s.error);
  const initialised = useBudgetStore((s) => s.initialised);
  const eventsTotal = useBudgetStore((s) => s.eventsTotal);
  const [pauseOpen, setPauseOpen] = useState(false);
  const dev = import.meta.env.DEV || params.get('dev') === '1';

  /* First paint: the store may not be initialised if the shell effect raced. */
  useEffect(() => {
    if (!initialised) void useBudgetStore.getState().load();
    else void useBudgetStore.getState().loadCharts();
  }, [initialised]);

  /* `?action=pause|resume|export` — consumed once (bell / palette intents). */
  useEffect(() => {
    const action = params.get('action');
    if (!action) return;
    if (action === 'pause') window.setTimeout(() => setPauseOpen(true), 0);
    else if (action === 'resume') void useBudgetStore.getState().resume();
    else if (action === 'export')
      void useBudgetStore.getState().exportSpend('csv', 'all');
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('action');
        return p;
      },
      { replace: true }
    );
  }, [params, setParams]);

  /* Keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (
        document.querySelector(
          '[data-slot$="-menu-content"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [cmdk-root]'
        ) ||
        target?.closest('[role="alertdialog"]')
      )
        return;
      const st = useBudgetStore.getState();

      if (e.key === 'Escape') {
        if (typing && target) {
          target.blur();
          return;
        }
        if (st.filter.search) st.setFilter({ search: '' });
        return;
      }
      // Range inputs are focusable but not "typing": arrows must keep working.
      if (typing && (target as HTMLInputElement).type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        if (tab !== 'history') setTab('history');
        window.setTimeout(
          () => document.getElementById('spend-search')?.focus(),
          30
        );
        return;
      }
      const idx = tabForKey(e.key);
      if (idx !== null) {
        setTab(BUDGET_TABS[idx].id);
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        if (!st.settings.paused) setPauseOpen(true);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (st.settings.paused) void st.resume();
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        void st.exportSpend('csv', tab === 'history' ? st.filter.range : 'all');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, setTab]);

  const paused = settings.paused;

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-screen="budget">
      {/* Header */}
      <div className="bg-bg-void sticky top-0 z-20 shrink-0">
        <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-2">
          <div className="min-w-0">
            <h2 className="text-text-primary text-[24px] leading-tight font-semibold tracking-tight">
              Budget
            </h2>
            <p className="text-text-tertiary text-[13px]">
              Spend caps are code-enforced — XR will never surprise you with a
              bill.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {paused ? (
              <button
                type="button"
                data-testid="budget-resume"
                onClick={() => void useBudgetStore.getState().resume()}
                title={pauseReasonText(settings.pauseReason)}
                className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors"
              >
                <Play size={13} strokeWidth={1.75} aria-hidden="true" />
                Resume
              </button>
            ) : (
              <button
                type="button"
                data-testid="budget-pause"
                onClick={() => setPauseOpen(true)}
                className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors"
              >
                <Pause size={13} strokeWidth={1.75} aria-hidden="true" />
                Pause
              </button>
            )}
            <ExportMenu count={eventsTotal || overview?.eventsTotal || 0} />
          </div>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Budget sections"
          className="border-border-subtle flex h-9 items-end gap-1 border-b px-4"
        >
          {BUDGET_TABS.map((t, i) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                id={`budget-tab-${t.id}`}
                aria-selected={active}
                aria-controls={`budget-panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                data-testid={`budget-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const delta =
                    e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!delta) return;
                  e.preventDefault();
                  const next =
                    BUDGET_TABS[
                      (i + delta + BUDGET_TABS.length) % BUDGET_TABS.length
                    ];
                  setTab(next.id);
                  document.getElementById(`budget-tab-${next.id}`)?.focus();
                }}
                className={cn(
                  'relative flex h-full cursor-pointer items-center gap-1.5 px-3 text-[13px] transition-colors focus-visible:outline-none',
                  active
                    ? 'text-text-primary font-medium'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                {t.label}
                {t.id === 'overview' &&
                  overview &&
                  overview.state !== 'ok' &&
                  overview.state !== 'local' && (
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full"
                      style={{
                        background:
                          overview.state === 'warn'
                            ? 'var(--budget-warn)'
                            : 'var(--budget-danger)',
                      }}
                    />
                  )}
                {active && (
                  <span
                    aria-hidden="true"
                    className="bg-accent absolute right-1 -bottom-px left-1 h-[2px] rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-danger/40 bg-danger/10 text-danger mx-4 mt-3 rounded-lg border px-3 py-2 text-[12px]"
        >
          {error}
        </div>
      )}

      {/* Panels */}
      <div
        role="tabpanel"
        id={`budget-panel-${tab}`}
        aria-labelledby={`budget-tab-${tab}`}
        className={cn(
          'min-h-0 flex-1',
          tab === 'history' ? 'flex flex-col' : 'overflow-y-auto'
        )}
      >
        {tab === 'overview' && (
          <OverviewTab overview={overview} onTab={setTab} />
        )}
        {tab === 'history' && <HistoryTab />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'agents' && <CapsTab scope="agent" />}
        {tab === 'workspaces' && <CapsTab scope="workspace" />}
        {tab === 'settings' && <SettingsTab dev={dev} />}
      </div>

      <PauseDialog open={pauseOpen} onOpenChange={setPauseOpen} />
    </div>
  );
}

function ExportMenu({ count }: { count: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="budget-export"
          disabled={count === 0}
          className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={13} strokeWidth={1.75} aria-hidden="true" />
          Export
          <ChevronDown
            size={12}
            strokeWidth={1.75}
            aria-hidden="true"
            className="opacity-60"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuItem
          onSelect={() =>
            void useBudgetStore.getState().exportSpend('csv', 'all')
          }
        >
          CSV · all events
          <span className="text-text-tertiary ml-auto font-mono text-[11px]">
            {count}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void useBudgetStore.getState().exportSpend('csv', '30d')
          }
        >
          CSV · last 30 days
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void useBudgetStore.getState().exportSpend('json', 'all')
          }
        >
          JSON · all events + settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
