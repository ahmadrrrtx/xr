/*
 * Budget › Overview (Phase 13, SCREEN 11 §Overview). Hero figure + bar,
 * four stat tiles, the 30-day stacked area, by-model bars and quick
 * settings. Everything renders the governor's overview; every control
 * writes through the store to the backend (the toggles are real).
 */
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, OctagonPause } from 'lucide-react';
import { useState } from 'react';

import {
  barBand,
  fmtPct,
  fmtTokens,
  fmtUsd,
  STATE_LABEL,
  usableLimit,
} from '@/budget/core';
import { modelLabel } from '@/budget/models';
import { shortDate } from '@/budget/period';
import {
  SPEND_RANGE_LABEL,
  SPEND_RANGES,
  type BudgetOverview,
  type BudgetTab,
  type SpendRange,
} from '@/budget/types';
import { Segmented, Toggle } from '@/components/settings/controls';
import { cn } from '@/lib/utils';
import { useTween } from '@/screens/Runs/useTween';
import { useBudgetStore } from '@/stores/budgetStore';

import { PauseDialog } from './PauseDialog';
import {
  BudgetCard,
  EnforcedBadge,
  EstimatePill,
  LocalPill,
  PresetChips,
  RangeField,
  StatTile,
} from './shared';
import { LIMIT_PRESETS, displayModel } from './model-display';
import { SpendChart } from './SpendChart';

const RANGE_OPTIONS = SPEND_RANGES.map((r) => ({
  value: r,
  label: SPEND_RANGE_LABEL[r],
}));

export function OverviewTab({
  overview,
  onTab,
}: {
  overview: BudgetOverview | null;
  onTab: (tab: BudgetTab) => void;
}) {
  const series = useBudgetStore((s) => s.series);
  const seriesRange = useBudgetStore((s) => s.seriesRange);
  const setSeriesRange = useBudgetStore((s) => s.setSeriesRange);
  const byModel = useBudgetStore((s) => s.byModel);
  const [pauseOpen, setPauseOpen] = useState(false);

  if (!overview) return <OverviewSkeleton />;

  const s = overview.settings;
  const localOnly = s.monthlyLimit <= 0.0001;
  const modelRows = byModel.filter((r) => r.key !== '—').slice(0, 7);
  const modelMax = modelRows.length ? modelRows[0].cost : 0;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="budget-overview">
      {/* Hero row */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {localOnly ? (
          <LocalHero overview={overview} />
        ) : (
          <Hero overview={overview} onTab={onTab} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Today"
            value={fmtUsd(overview.spentToday)}
            hint={
              s.dailyLimit > 0
                ? `of ${fmtUsd(s.dailyLimit)} daily limit`
                : 'no daily limit'
            }
            testId="tile-today"
          />
          <StatTile
            label="Biggest run"
            value={
              overview.biggestRun ? fmtUsd(overview.biggestRun.costUsd) : '—'
            }
            hint={
              overview.biggestRun?.model
                ? modelLabel(overview.biggestRun.model)
                : 'this month'
            }
            testId="tile-biggest"
            onClick={overview.biggestRun ? () => onTab('history') : undefined}
          />
          <StatTile
            label="Projected month-end"
            value={fmtUsd(overview.projectedMonthEnd)}
            hint={`avg ${fmtUsd(overview.avgPerDay)}/day`}
            testId="tile-projected"
          />
          <StatTile
            label="Tokens"
            value={fmtTokens(overview.tokensInMonth + overview.tokensOutMonth)}
            hint={`${fmtTokens(overview.tokensInMonth)} in · ${fmtTokens(overview.tokensOutMonth)} out`}
            testId="tile-tokens"
          />
        </div>
      </div>

      {/* Chart row */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <BudgetCard
          title={`Spend · ${seriesRange === 'all' ? 'all time' : `last ${SPEND_RANGE_LABEL[seriesRange]}`}`}
          action={
            <Segmented<SpendRange>
              value={seriesRange}
              options={RANGE_OPTIONS}
              onChange={setSeriesRange}
              ariaLabel="Chart range"
            />
          }
          testId="card-spend-chart"
        >
          <div className="px-4 pt-1 pb-3">
            {series.length ? (
              <SpendChart
                buckets={series}
                rangeLabel={SPEND_RANGE_LABEL[seriesRange]}
              />
            ) : (
              <div
                className="bg-bg-raised/40 h-[200px] animate-pulse rounded-lg"
                aria-hidden="true"
              />
            )}
          </div>
        </BudgetCard>

        <BudgetCard
          title={`By model · ${seriesRange === 'all' ? 'all time' : SPEND_RANGE_LABEL[seriesRange]}`}
          action={
            <button
              type="button"
              onClick={() => onTab('models')}
              className="text-text-tertiary hover:text-text-primary flex cursor-pointer items-center gap-1 text-[12px]"
            >
              Models{' '}
              <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
          }
          testId="card-by-model"
        >
          <ul
            className="flex flex-col gap-2.5 px-4 pt-1 pb-4"
            aria-label="Spend by model"
          >
            {modelRows.length === 0 && (
              <li className="text-text-tertiary text-[12px]">
                No spend in this range.
              </li>
            )}
            {modelRows.map((row) => {
              const info = displayModel(row.key);
              return (
                <li key={row.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-text-primary flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{info.name}</span>
                      {info.local && <LocalPill />}
                      {info.estimate && <EstimatePill />}
                    </span>
                    <span className="text-text-secondary shrink-0 font-mono tabular-nums">
                      {fmtUsd(row.cost, {
                        precise: row.cost > 0 && row.cost < 0.01,
                      })}
                    </span>
                  </div>
                  <div
                    className="bg-bg-raised h-1.5 w-full overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${modelMax > 0 ? Math.max(2, (row.cost / modelMax) * 100) : 0}%`,
                        background: info.local
                          ? 'var(--text-tertiary)'
                          : `var(--chart-${info.family})`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </BudgetCard>
      </div>

      {/* Quick settings */}
      <QuickSettings onPause={() => setPauseOpen(true)} />
      <PauseDialog open={pauseOpen} onOpenChange={setPauseOpen} />
    </div>
  );
}

/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero({
  overview,
  onTab,
}: {
  overview: BudgetOverview;
  onTab: (tab: BudgetTab) => void;
}) {
  const reduced = useReducedMotion();
  const s = overview.settings;
  const spent = useTween(overview.spentMonth, 600);
  const pct = Math.min(1, overview.pctUsedMonth);
  const band = barBand(pct);
  const usablePct = s.monthlyLimit > 0 ? usableLimit(s) / s.monthlyLimit : 1;
  const state = overview.state;
  const chip =
    state === 'paused'
      ? { label: 'Paused', tone: 'var(--danger)' }
      : state === 'capped'
        ? { label: 'Limit reached', tone: 'var(--danger)' }
        : state === 'over'
          ? { label: 'Over limit · hard cap off', tone: 'var(--warning)' }
          : state === 'danger' || state === 'warn'
            ? { label: `${fmtPct(pct)} used`, tone: 'var(--warning)' }
            : null;

  return (
    <BudgetCard
      testId="budget-hero"
      className="flex flex-col justify-between px-5 py-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className="budget-hero-glow text-text-primary text-[32px] leading-none font-semibold tracking-tight tabular-nums"
              data-testid="hero-spent"
              aria-label={`${fmtUsd(overview.spentMonth)} spent of ${fmtUsd(s.monthlyLimit)}`}
            >
              {fmtUsd(spent)}
            </span>
            <span className="text-text-tertiary text-[18px] font-medium tabular-nums">
              / {fmtUsd(s.monthlyLimit)}
            </span>
          </div>
          <p
            className="text-text-secondary mt-1.5 text-[13px]"
            data-testid="hero-reset"
          >
            Resets {shortDate(overview.resetDate)} · {overview.daysUntilReset}{' '}
            day{overview.daysUntilReset === 1 ? '' : 's'} left
          </p>
        </div>
        <div className="flex items-center gap-2">
          {chip && (
            <span
              data-testid="hero-chip"
              data-state={state}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium"
              style={{
                color: chip.tone,
                borderColor: `color-mix(in oklab, ${chip.tone} 45%, transparent)`,
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: chip.tone }}
                aria-hidden="true"
              />
              {chip.label}
            </span>
          )}
          {(state === 'capped' ||
            state === 'danger' ||
            state === 'warn' ||
            state === 'over') && (
            <button
              type="button"
              onClick={() => onTab('settings')}
              data-testid="hero-raise"
              className="border-border-subtle bg-bg-raised text-text-primary hover:bg-bg-raised/70 h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
            >
              Raise limit
            </button>
          )}
          {state === 'paused' && (
            <button
              type="button"
              onClick={() => void useBudgetStore.getState().resume()}
              data-testid="hero-resume"
              className="border-border-subtle bg-bg-raised text-text-primary hover:bg-bg-raised/70 h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
            >
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Bar */}
      <div className="mt-4">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          aria-valuetext={`${fmtPct(pct)} of monthly budget used`}
          data-testid="hero-bar"
          data-band={band}
          className="bg-bg-raised relative h-2 w-full overflow-hidden rounded-full"
        >
          {/* Reserve: hatched tail from the usable line to 100 %. */}
          {usablePct < 1 && (
            <div
              className="budget-reserve-hatch absolute top-0 h-full"
              style={{ left: `${usablePct * 100}%`, right: 0 }}
              aria-hidden="true"
              title={`${fmtUsd(overview.reserveUsd)} held for finalization`}
            />
          )}
          <motion.div
            className="budget-bar-fill relative h-full rounded-full"
            data-pulse={pct >= 0.9 && !reduced ? 'on' : 'off'}
            initial={false}
            animate={{ width: `${pct * 100}%` }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 300, damping: 30 }
            }
            style={{ background: `var(--budget-${band})` }}
          />
          {/* Cap tick at the usable limit */}
          {usablePct < 1 && (
            <span
              aria-hidden="true"
              className="absolute top-0 h-full w-px"
              style={{
                left: `calc(${usablePct * 100}% - 0.5px)`,
                background: 'var(--text-secondary)',
              }}
            />
          )}
        </div>
        <div
          className="text-text-tertiary mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
          data-testid="hero-micro"
        >
          <span>{fmtPct(pct)} used</span>
          <span aria-hidden="true">·</span>
          <span>avg {fmtUsd(overview.avgPerDay)}/day</span>
          <span aria-hidden="true">·</span>
          <span>{overview.blockedMonth} blocked</span>
          {overview.downshiftedMonth > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{overview.downshiftedMonth} downshifted</span>
            </>
          )}
          {overview.reserveUsd > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{fmtUsd(overview.reserveUsd)} reserve</span>
            </>
          )}
          <span className="sr-only">{STATE_LABEL[state]}</span>
        </div>
      </div>
    </BudgetCard>
  );
}

function LocalHero({ overview }: { overview: BudgetOverview }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <BudgetCard
      testId="budget-hero-local"
      className="flex flex-col justify-between px-5 py-4"
    >
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-text-primary text-[32px] leading-none font-semibold tracking-tight">
            All local
          </span>
          <LocalPill className="translate-y-[-4px]" />
        </div>
        <p className="text-text-secondary mt-1.5 text-[13px]">
          {fmtUsd(overview.spentMonth)} spent · monthly budget is $0, so cloud
          models are off.
        </p>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {confirm ? (
          <>
            <span className="text-text-secondary text-[12px]">
              Set the monthly limit to $5.00 and allow cloud calls?
            </span>
            <button
              type="button"
              data-testid="enable-cloud-confirm"
              onClick={() => {
                setConfirm(false);
                void useBudgetStore
                  .getState()
                  .updateSettings({ monthlyLimit: 5 });
              }}
              className="bg-accent text-accent-contrast h-7 cursor-pointer rounded-md px-2.5 text-[12px] font-medium"
            >
              Enable
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="text-text-tertiary hover:text-text-primary h-7 cursor-pointer px-2 text-[12px]"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid="enable-cloud"
            onClick={() => setConfirm(true)}
            className="border-border-subtle bg-bg-raised text-text-primary hover:bg-bg-raised/70 h-7 cursor-pointer rounded-md border px-2.5 text-[12px] font-medium transition-colors"
          >
            Enable cloud models
          </button>
        )}
      </div>
    </BudgetCard>
  );
}

/* ── Quick settings ────────────────────────────────────────────────────── */

export function QuickSettings({ onPause }: { onPause: () => void }) {
  const settings = useBudgetStore((s) => s.settings);
  const update = useBudgetStore((s) => s.updateSettings);
  const [limit, setLimit] = useState<number | null>(null);
  const [breaker, setBreaker] = useState<number | null>(null);
  const [reserve, setReserve] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);

  const limitValue = limit ?? settings.monthlyLimit;
  const isPreset = LIMIT_PRESETS.some(
    (p) => Math.abs(p - settings.monthlyLimit) < 0.0001
  );

  return (
    <BudgetCard title="Quick settings" testId="card-quick-settings">
      <div className="grid gap-5 px-4 pt-1 pb-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <RangeField
            label={
              <span className="flex items-center gap-2">
                Monthly limit <EnforcedBadge />
              </span>
            }
            value={limitValue}
            min={0}
            max={100}
            step={1}
            format={(v) => (v === 0 ? '$0 · local only' : fmtUsd(v))}
            onChange={setLimit}
            onCommit={(v) => {
              setLimit(null);
              if (Math.abs(v - settings.monthlyLimit) > 0.0001)
                void update({ monthlyLimit: v });
            }}
            testId="quick-monthly"
            hint={
              settings.paused
                ? 'Spending is paused — the limit applies once you resume.'
                : undefined
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <PresetChips
              values={LIMIT_PRESETS}
              current={settings.monthlyLimit}
              onPick={(v) => void update({ monthlyLimit: v })}
              testIdPrefix="preset"
            />
            <button
              type="button"
              aria-pressed={custom || !isPreset}
              onClick={() => setCustom((c) => !c)}
              className={cn(
                'h-7 cursor-pointer rounded-md border px-2 text-[12px] transition-colors',
                custom || !isPreset
                  ? 'border-accent text-text-primary bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]'
                  : 'border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised'
              )}
            >
              Custom
            </button>
            {(custom || !isPreset) && (
              <label className="flex items-center gap-1 text-[12px]">
                <span className="text-text-tertiary">$</span>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step={0.5}
                  defaultValue={settings.monthlyLimit}
                  aria-label="Custom monthly limit in dollars"
                  data-testid="quick-monthly-custom"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (
                      Number.isFinite(v) &&
                      v >= 0 &&
                      Math.abs(v - settings.monthlyLimit) > 0.0001
                    )
                      void update({ monthlyLimit: v });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      (e.target as HTMLInputElement).blur();
                  }}
                  className="border-border-subtle bg-bg-raised text-text-primary focus-visible:border-accent h-7 w-24 rounded-md border px-2 font-mono text-[12px] tabular-nums outline-none"
                />
              </label>
            )}
          </div>

          <RangeField
            label={
              <span className="flex items-center gap-2">
                Circuit breaker <EnforcedBadge />
              </span>
            }
            value={Math.round((breaker ?? settings.circuitBreakerPct) * 100)}
            min={80}
            max={100}
            step={1}
            format={(v) => (v >= 100 ? 'off' : `${v}%`)}
            onChange={(v) => setBreaker(v / 100)}
            onCommit={(v) => {
              setBreaker(null);
              if (Math.abs(v / 100 - settings.circuitBreakerPct) > 0.0001)
                void update({ circuitBreakerPct: v / 100 });
            }}
            disabled={!settings.hardCap}
            hint={
              settings.hardCap
                ? 'Auto-pauses spending at this share of the monthly limit.'
                : 'Needs the hard cap — the spend-per-5-minutes breaker stays on.'
            }
            testId="quick-breaker"
          />

          <RangeField
            label="Finalization reserve"
            value={Math.round(
              (reserve ?? settings.finalizationReservePct) * 100
            )}
            min={0}
            max={20}
            step={1}
            format={(v) => `${v}%`}
            onChange={(v) => setReserve(v / 100)}
            onCommit={(v) => {
              setReserve(null);
              if (Math.abs(v / 100 - settings.finalizationReservePct) > 0.0001)
                void update({ finalizationReservePct: v / 100 });
            }}
            hint="Held back so a run can wrap up cleanly instead of stopping mid-sentence."
            testId="quick-reserve"
          />
        </div>

        <div className="flex flex-col gap-3">
          <ToggleRow
            label="Hard cap"
            hint={
              settings.hardCap
                ? 'Calls over the limit are blocked before they start.'
                : undefined
            }
            badge={<EnforcedBadge />}
            checked={settings.hardCap}
            onChange={(v) => void update({ hardCap: v })}
            testId="quick-hardcap"
          />
          {!settings.hardCap && (
            <p
              role="status"
              data-testid="hardcap-off-warning"
              className="rounded-lg border px-3 py-2 text-[12px]"
              style={{
                color: 'var(--danger)',
                borderColor:
                  'color-mix(in oklab, var(--danger) 45%, transparent)',
                background:
                  'color-mix(in oklab, var(--danger) 8%, transparent)',
              }}
            >
              Hard cap is off: XR warns at the limit but keeps spending. The
              spike breaker still pauses runaway loops.
            </p>
          )}
          <ToggleRow
            label="Model downshifting"
            hint="Past the warning threshold, route to cheaper models (then local) instead of failing."
            checked={settings.modelDownshifting}
            onChange={(v) => void update({ modelDownshifting: v })}
            testId="quick-downshift"
          />

          <div className="mt-auto flex justify-end pt-2">
            <button
              type="button"
              data-testid="pause-now"
              onClick={onPause}
              disabled={settings.paused}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                color: 'var(--danger)',
                borderColor:
                  'color-mix(in oklab, var(--danger) 55%, transparent)',
                background:
                  'color-mix(in oklab, var(--danger) 6%, transparent)',
              }}
            >
              <OctagonPause size={13} strokeWidth={2} aria-hidden="true" />
              {settings.paused ? 'Spending paused' : 'Pause all spending now'}
            </button>
          </div>
        </div>
      </div>
    </BudgetCard>
  );
}

export function ToggleRow({
  label,
  hint,
  badge,
  checked,
  onChange,
  testId,
  disabled,
}: {
  label: string;
  hint?: string;
  badge?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-[13px]">{label}</span>
          {badge}
        </div>
        {hint && (
          <p className="text-text-tertiary mt-0.5 text-[12px]">{hint}</p>
        )}
      </div>
      <Toggle
        checked={checked}
        onCheckedChange={onChange}
        ariaLabel={label}
        disabled={disabled}
        id={testId}
      />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 p-4"
      aria-busy="true"
      aria-label="Loading budget"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="bg-bg-ink border-border-subtle h-[140px] animate-pulse rounded-xl border" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-ink border-border-subtle h-[84px] animate-pulse rounded-xl border"
            />
          ))}
        </div>
      </div>
      <div className="bg-bg-ink border-border-subtle h-[260px] animate-pulse rounded-xl border" />
    </div>
  );
}
