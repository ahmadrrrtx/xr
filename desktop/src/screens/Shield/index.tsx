/*
 * Shield / Trust Center (Phase 12, SCREEN-BRIEFS SCREEN 8). Header, four
 * tabs (bottom-accent indicator, Brain pattern), tab panels, the audit
 * slide-over and the emergency dialogs. State: stores/shieldStore.ts (+ the
 * Phase 7 approvalStore for the pending queue). The active tab is URL state.
 *
 * Keys: 1–4 tabs · / search (Audit) · R health check · Esc closes the
 * slide-over · A / D decide the first pending request (Approvals tab).
 */
import { RefreshCw, ShieldX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useEngineAudit } from '@/engine/audit';
import { cn } from '@/lib/utils';
import { filterAudit, sortAudit, tabForKey } from '@/shield/core';
import { SHIELD_TABS, type ShieldTab } from '@/shield/types';
import { useApprovalStore } from '@/stores/approvalStore';
import { buildStatus, useShieldStore } from '@/stores/shieldStore';

import { ApprovalsTab } from './components/ApprovalsTab';
import { AuditSlideOver } from './components/AuditSlideOver';
import { AuditTab, ExportMenu } from './components/AuditTab';
import { EmergencyDialogs } from './components/EmergencyDialogs';
import { SecurityTab } from './components/SecurityTab';
import { StatusTab } from './components/StatusTab';
import { useShieldTab } from './useShieldTab';

const CLOCK_MS = 30_000;

export default function ShieldScreen() {
  const [tab, setTab] = useShieldTab();
  const searchRef = useRef<HTMLInputElement>(null);

  const hydrated = useShieldStore((s) => s.hydrated);
  const load = useShieldStore((s) => s.load);
  const checks = useShieldStore((s) => s.checks);
  const paused = useShieldStore((s) => s.paused);
  const audit = useShieldStore((s) => s.audit);
  const auditTotal = useShieldStore((s) => s.auditTotal);
  const auditLoading = useShieldStore((s) => s.auditLoading);
  const quarantine = useShieldStore((s) => s.quarantine);
  const policy = useShieldStore((s) => s.policy);
  const lastCheckedAt = useShieldStore((s) => s.lastCheckedAt);
  const healthRunning = useShieldStore((s) => s.healthRunning);
  const auditFilter = useShieldStore((s) => s.auditFilter);
  const auditSort = useShieldStore((s) => s.auditSort);
  const announce = useShieldStore((s) => s.announce);
  const error = useShieldStore((s) => s.error);
  const pendingCount = useApprovalStore((s) => s.pending.length);

  // Shared "now" for relative times — ticks every 30 s, not per render.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), CLOCK_MS);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The Shield screen owns the approval queue while mounted: the root modal
  // returns null and its away-countdown pauses. Pending requests show in the
  // Approvals tab badge, the pending tile and the inline cards — a modal on
  // top of the trust surface would only get in the way of the emergency card.
  useEffect(() => {
    useApprovalStore.getState().setInlineSurface(true);
    return () => useApprovalStore.getState().setInlineSurface(false);
  }, []);

  // URL intents from the palette (`?action=health-check|revoke`), consumed once.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const action = params.get('action');
    if (!action) return;
    const st = useShieldStore.getState();
    if (action === 'health-check') void st.runHealthCheck();
    else if (action === 'revoke') st.openRevokeDialog();
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const status = useMemo(
    () =>
      buildStatus(
        { checks, paused, audit, quarantine, lastCheckedAt },
        pendingCount,
        clock
      ),
    [checks, paused, audit, quarantine, lastCheckedAt, pendingCount, clock]
  );

  // Phase 14: the engine's own audit chain joins the desktop log in the
  // table (each row says where it was recorded; chains verify separately).
  const engineAudit = useEngineAudit();
  const auditRows = useMemo(
    () =>
      sortAudit(
        filterAudit(
          engineAudit.rows.length ? [...audit, ...engineAudit.rows] : audit,
          auditFilter,
          clock
        ),
        auditSort
      ),
    [audit, engineAudit.rows, auditFilter, auditSort, clock]
  );

  /* ── Keyboard ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      // Any open layer owns the keyboard (menus, dialogs, palette).
      if (
        document.querySelector(
          '[data-slot$="-menu-content"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [cmdk-root]'
        ) ||
        target?.closest('[role="alertdialog"]')
      )
        return;
      const st = useShieldStore.getState();

      if (e.key === 'Escape') {
        if (typing && target) {
          target.blur();
          return;
        }
        if (st.selectedAuditId) st.selectAudit(null);
        else if (st.auditFilter.search) st.setAuditFilter({ search: '' });
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/' && tab === 'audit') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const nextTab = tabForKey(e.key);
      if (nextTab) {
        setTab(nextTab);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        void st.runHealthCheck();
        return;
      }
      if (
        tab === 'approvals' &&
        (e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D')
      ) {
        const first = useApprovalStore.getState().pending[0];
        if (!first) return;
        e.preventDefault();
        st.decideApproval(
          first.id,
          e.key.toLowerCase() === 'a' ? 'approved' : 'denied'
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, setTab]);

  const fresh = hydrated && auditTotal === 0 && !auditLoading;

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-screen="shield">
      {/* Header */}
      <div className="bg-bg-void sticky top-0 z-20 shrink-0">
        <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-2">
          <div className="min-w-0">
            <h2 className="text-text-primary text-[24px] leading-tight font-semibold tracking-tight">
              Shield
            </h2>
            <p className="text-text-tertiary text-[13px]">
              XR's trust layer — approvals, audit, and policy
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {import.meta.env.DEV && <DevTrigger />}
            <button
              type="button"
              onClick={() => void useShieldStore.getState().runHealthCheck()}
              disabled={healthRunning}
              data-testid="run-health-check"
              className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors disabled:cursor-progress"
            >
              <RefreshCw
                size={13}
                strokeWidth={1.75}
                aria-hidden="true"
                className={cn(
                  healthRunning && 'animate-spin [animation-duration:1.2s]'
                )}
              />
              {healthRunning ? 'Checking…' : 'Run health check'}
            </button>
            <ExportMenu count={auditRows.length} ghost />
          </div>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Shield sections"
          className="border-border-subtle flex h-9 items-end gap-1 border-b px-4"
        >
          {SHIELD_TABS.map((t, i) => {
            const active = tab === t.id;
            const badge =
              t.id === 'approvals' && pendingCount > 0 ? pendingCount : null;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                id={`shield-tab-${t.id}`}
                aria-selected={active}
                aria-controls={`shield-panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                data-testid={`shield-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const delta =
                    e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!delta) return;
                  e.preventDefault();
                  const next =
                    SHIELD_TABS[
                      (i + delta + SHIELD_TABS.length) % SHIELD_TABS.length
                    ];
                  setTab(next.id);
                  document.getElementById(`shield-tab-${next.id}`)?.focus();
                }}
                className={cn(
                  'relative flex h-full cursor-pointer items-center gap-1.5 px-3 text-[13px] transition-colors focus-visible:outline-none',
                  active
                    ? 'text-text-primary font-medium'
                    : 'text-text-tertiary hover:text-text-secondary'
                )}
              >
                {t.label}
                {badge !== null && (
                  <span
                    className="bg-warning/15 text-warning inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-medium"
                    data-testid="approvals-tab-badge"
                  >
                    {badge}
                  </span>
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
        id={`shield-panel-${tab}`}
        aria-labelledby={`shield-tab-${tab}`}
        className={cn(
          'min-h-0 flex-1',
          tab === 'audit' ? 'flex flex-col' : 'overflow-y-auto'
        )}
      >
        {tab === 'status' && (
          <StatusTab status={status} now={clock} onTab={setTab} />
        )}
        {tab === 'approvals' && <ApprovalsTab now={clock} />}
        {tab === 'audit' && (
          <AuditTab
            ref={searchRef}
            rows={auditRows}
            total={auditTotal + engineAudit.rows.length}
            loading={!hydrated || auditLoading}
            fresh={fresh}
          />
        )}
        {tab === 'security' && (
          <SecurityTab
            policy={policy}
            quarantine={quarantine}
            checks={checks}
            lastCheckedAt={lastCheckedAt}
            paused={paused}
            now={clock}
          />
        )}
      </div>

      <AuditSlideOver extra={engineAudit.rows} engineChainValid={engineAudit.chainValid} />
      <EmergencyDialogs />
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announce?.text}
      </div>
    </div>
  );
}

/** Dev-only: the next health check fails two integrity checks. */
function DevTrigger() {
  const forced = useShieldStore((s) => s.forcedFailure);
  return (
    <button
      type="button"
      aria-pressed={forced}
      title="Dev: simulate an integrity failure on the next health check"
      data-testid="dev-force-compromised"
      onClick={() => useShieldStore.getState().setForcedFailure(!forced)}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-2 font-mono text-[11px] transition-colors',
        forced
          ? 'border-danger text-danger'
          : 'border-border-subtle text-text-tertiary hover:text-text-secondary'
      )}
    >
      <ShieldX size={12} strokeWidth={1.75} aria-hidden="true" />
      dev: fail next check
    </button>
  );
}

export type { ShieldTab };
