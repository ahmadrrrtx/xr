/*
 * Shield → Status (Phase 12, SCREEN-BRIEFS §8 Tab 1): hero verdict, four
 * stat tiles, the health-check card, recent activity and the emergency card.
 * Every green here is backed by a check that ran — before the first run the
 * hero says "Checking", never "Protected".
 */
import { useReducedMotion } from 'framer-motion';
import { ArrowRight, OctagonX, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useTween } from '@/screens/Runs/useTween';
import {
  fmtAgo,
  fmtClock,
  fmtPercent,
  recentActivity,
  sortChecks,
} from '@/shield/core';
import type {
  AuditEntry,
  HealthCheck,
  ShieldStatus,
  ShieldTab,
} from '@/shield/types';
import { useShieldStore } from '@/stores/shieldStore';
import { cn } from '@/lib/utils';

import {
  ActorChip,
  CheckMark,
  DecisionMark,
  ShieldCard,
  STATE_COLOR,
  StateIcon,
} from './shared';

interface Props {
  status: ShieldStatus;
  now: number;
  onTab: (tab: ShieldTab) => void;
}

export function StatusTab({ status, now, onTab }: Props) {
  const audit = useShieldStore((s) => s.audit);
  const recent = useMemo(() => recentActivity(audit, 10), [audit]);
  const [, setParams] = useSearchParams();

  const goQuarantine = (): void => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tab', 'security');
        p.set('section', 'quarantine');
        return p;
      },
      { replace: true }
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="shield-status-tab">
      <Hero status={status} now={now} />

      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="shield-stats"
      >
        <StatTile
          label="Blocked (24h)"
          value={status.stats.blocked24h}
          hint="Requests that did not run"
          testId="stat-blocked"
        />
        <StatTile
          label="Pending approvals"
          value={status.stats.pendingApprovals}
          hint={
            status.stats.pendingApprovals > 0
              ? 'Open Approvals →'
              : 'Nothing waiting'
          }
          onClick={() => onTab('approvals')}
          emphasize={status.stats.pendingApprovals > 0}
          testId="stat-pending"
        />
        <StatTile
          label="Auto-approved (30d)"
          value={status.stats.autoApprovedRate30d}
          format={fmtPercent}
          hint="Share of decisions made by rules"
          testId="stat-auto"
        />
        <StatTile
          label="Quarantined skills"
          value={status.stats.quarantinedSkills}
          hint="Review under Security →"
          onClick={goQuarantine}
          testId="stat-quarantined"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HealthCard
          checks={status.checks}
          lastCheckedAt={status.lastCheckedAt}
          now={now}
        />
        <RecentActivity
          entries={recent}
          now={now}
          onViewAll={() => onTab('audit')}
        />
      </div>

      <EmergencyCard paused={status.paused} />
    </div>
  );
}

/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero({ status, now }: { status: ShieldStatus; now: number }) {
  const reduced = useReducedMotion();
  const color = STATE_COLOR[status.state];
  const glow = status.state === 'protected' && !reduced && !status.paused;
  const checked = status.lastCheckedAt;

  return (
    <section
      aria-label="Shield status"
      data-testid="shield-hero"
      data-state={status.state}
      className="border-border-subtle bg-bg-ink relative flex flex-col items-center gap-3 overflow-hidden rounded-xl border px-6 py-8 text-center"
    >
      <span
        className="shield-hero-icon inline-flex"
        data-glow={glow ? 'on' : 'off'}
        style={{ color }}
      >
        <StateIcon state={status.state} size={120} />
      </span>
      <h2
        className="text-text-primary text-[22px] leading-tight font-semibold tracking-tight"
        data-testid="shield-headline"
      >
        {status.headline}
      </h2>
      <p className="text-text-secondary max-w-[560px] text-[13px] leading-relaxed">
        {status.subtitle}
      </p>
      <span
        className="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium"
        style={{
          color,
          borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
          background: `color-mix(in oklab, ${color} 10%, transparent)`,
        }}
        data-testid="shield-cta"
      >
        {status.cta}
      </span>
      <p className="text-text-tertiary text-[11px]">
        {checked
          ? `Last health check ${fmtAgo(checked, now)} · hash-chained audit log (Ed25519 signatures planned)`
          : 'No health check has run yet.'}
      </p>
    </section>
  );
}

/* ── Stat tile ─────────────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  hint,
  format,
  onClick,
  emphasize,
  testId,
}: {
  label: string;
  value: number | null;
  hint?: string;
  format?: (v: number | null) => string;
  onClick?: () => void;
  emphasize?: boolean;
  testId?: string;
}) {
  const shown = useTween(value ?? 0, 600);
  const text = format
    ? format(value === null ? null : Math.round(shown))
    : String(Math.round(shown));
  const body = (
    <>
      <span className="text-text-tertiary text-[11px] font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-[26px] leading-none font-semibold tabular-nums',
          emphasize ? 'text-warning' : 'text-text-primary'
        )}
      >
        {text}
      </span>
      {hint && (
        <span className="text-text-tertiary flex items-center gap-1 text-[11px]">
          {hint}
        </span>
      )}
    </>
  );
  const cls =
    'border-border-subtle bg-bg-ink flex min-h-[96px] flex-col justify-between gap-2 rounded-xl border px-4 py-3 text-left';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        cls,
        'hover:border-border-accent hover:bg-bg-raised/60 focus-visible:ring-accent/50 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      {body}
    </button>
  ) : (
    <div data-testid={testId} className={cls}>
      {body}
    </div>
  );
}

/* ── Health card ───────────────────────────────────────────────────────── */

export function HealthCard({
  checks,
  lastCheckedAt,
  now,
  compact,
}: {
  checks: HealthCheck[];
  lastCheckedAt: number | null;
  now: number;
  compact?: boolean;
}) {
  const running = useShieldStore((s) => s.healthRunning);
  const sorted = useMemo(() => sortChecks(checks), [checks]);
  return (
    <ShieldCard
      title="Health check"
      testId="shield-health-card"
      action={
        <div className="flex items-center gap-2">
          <span className="text-text-tertiary text-[11px]">
            {lastCheckedAt ? fmtAgo(lastCheckedAt, now) : '—'}
          </span>
          <button
            type="button"
            onClick={() => void useShieldStore.getState().runHealthCheck()}
            disabled={running}
            data-testid="health-rerun"
            className="text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors disabled:cursor-progress"
          >
            <RefreshCw
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
              className={cn(
                running && 'animate-spin [animation-duration:1.2s]'
              )}
            />
            {running ? 'Running…' : 'Re-run'}
          </button>
        </div>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-text-tertiary px-4 pt-1 pb-4 text-[13px]">
          {running
            ? 'Running the first health check…'
            : 'No checks have run yet.'}
        </p>
      ) : (
        <ul
          className="divide-border-subtle divide-y px-1 pb-1"
          data-testid="health-list"
        >
          {sorted.map((c) => (
            <li
              key={c.id}
              data-check={c.id}
              data-status={c.status}
              className={cn(
                'flex items-start gap-3 px-3',
                compact ? 'py-1.5' : 'py-2'
              )}
            >
              <span className="mt-0.5">
                <CheckMark status={c.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-text-primary text-[13px] font-medium">
                    {c.label}
                  </span>
                  {c.critical && c.status !== 'planned' && (
                    <span className="text-text-tertiary text-[10px] tracking-wide uppercase">
                      critical
                    </span>
                  )}
                </div>
                {!compact && (
                  <p className="text-text-tertiary text-[12px] leading-relaxed">
                    {c.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ShieldCard>
  );
}

/* ── Recent activity ───────────────────────────────────────────────────── */

function RecentActivity({
  entries,
  now,
  onViewAll,
}: {
  entries: AuditEntry[];
  now: number;
  onViewAll: () => void;
}) {
  return (
    <ShieldCard
      title="Recent activity"
      testId="shield-recent"
      action={
        <button
          type="button"
          onClick={onViewAll}
          className="text-accent hover:bg-bg-raised flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px]"
        >
          View all
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" />
        </button>
      }
    >
      {entries.length === 0 ? (
        <p className="text-text-tertiary px-4 pt-1 pb-4 text-[13px]">
          Nothing has been recorded yet.
        </p>
      ) : (
        <ul className="divide-border-subtle divide-y px-1 pb-1">
          {entries.map((e) => (
            <li
              key={e.id}
              className="grid grid-cols-[64px_1fr_auto] items-center gap-2 px-3 py-1.5 text-[12px]"
              title={fmtAgo(e.ts, now)}
            >
              <span className="text-text-tertiary font-mono text-[11px] tabular-nums">
                {fmtClock(e.ts)}
              </span>
              <span className="min-w-0">
                <span className="text-text-primary block truncate">
                  {e.action}
                </span>
                {e.resource && (
                  <span className="text-text-tertiary block truncate font-mono text-[11px]">
                    {e.resource}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <ActorChip actor={e.actor} />
                <DecisionMark
                  decision={e.decision}
                  className="text-text-secondary w-[96px] text-[11px]"
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </ShieldCard>
  );
}

/* ── Emergency card ────────────────────────────────────────────────────── */

export function EmergencyCard({ paused }: { paused: boolean }) {
  return (
    <ShieldCard title="Emergency" danger testId="shield-emergency">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-1 pb-4">
        <div className="max-w-[560px] min-w-0">
          {paused ? (
            <>
              <p className="text-text-primary text-[13px] font-medium">
                XR Shield is paused.
              </p>
              <p className="text-text-tertiary text-[12px] leading-relaxed">
                Every new request is denied and nothing runs until you resume.
                Finished work was not touched.
              </p>
            </>
          ) : (
            <>
              <p className="text-text-primary text-[13px] font-medium">
                Stop everything, now.
              </p>
              <p className="text-text-tertiary text-[12px] leading-relaxed">
                Denies every pending approval, stops every running agent and
                blocks new requests until you resume. Completed work is kept.
              </p>
            </>
          )}
        </div>
        {paused ? (
          <button
            type="button"
            data-testid="shield-resume"
            onClick={() => useShieldStore.getState().openResumeDialog()}
            className="border-border-subtle text-text-primary hover:bg-bg-raised flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
          >
            Resume agents
          </button>
        ) : (
          <button
            type="button"
            data-testid="shield-revoke"
            onClick={() => useShieldStore.getState().openRevokeDialog()}
            className="bg-danger flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50 focus-visible:outline-none"
          >
            <OctagonX size={14} strokeWidth={1.75} aria-hidden="true" />
            Revoke all approvals and pause agents
          </button>
        )}
      </div>
    </ShieldCard>
  );
}
