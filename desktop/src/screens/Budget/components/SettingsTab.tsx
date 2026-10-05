/*
 * Budget › Settings (Phase 13). Limits · Protections · Notifications ·
 * Billing (honestly "Planned") · Data · dev Playground. Every "Enforced"
 * badge marks a value the governor checks before a call; everything else is
 * labelled for what it is.
 */
import { Download, FlaskConical, RotateCcw, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { fmtPct, fmtUsd } from '@/budget/core';
import { modelLabel } from '@/budget/models';
import { shortDate } from '@/budget/period';
import { DEFAULT_BUDGET_SETTINGS, type BudgetSettings } from '@/budget/types';
import { Select, Toggle } from '@/components/settings/controls';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useBudgetStore } from '@/stores/budgetStore';

import { Playground } from './Playground';
import {
  BudgetCard,
  EnforcedBadge,
  PresetChips,
  RangeField,
  Row,
} from './shared';
import { LIMIT_PRESETS } from './model-display';

export function SettingsTab({ dev }: { dev: boolean }) {
  const settings = useBudgetStore((s) => s.settings);
  const overview = useBudgetStore((s) => s.overview);
  const update = useBudgetStore((s) => s.updateSettings);
  const [resetMonthOpen, setResetMonthOpen] = useState(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  const patch = (p: Partial<BudgetSettings>) => void update(p);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="budget-settings">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Limits */}
        <BudgetCard title="Limits" testId="settings-limits">
          <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
            <DraftRange
              label={
                <Labelled badge={<EnforcedBadge />}>Monthly limit</Labelled>
              }
              value={settings.monthlyLimit}
              min={0}
              max={100}
              step={1}
              format={(v) => (v === 0 ? '$0 · local only' : fmtUsd(v))}
              onCommit={(v) => patch({ monthlyLimit: v })}
              testId="settings-monthly"
              extra={
                <div className="flex items-center gap-2">
                  <PresetChips
                    values={LIMIT_PRESETS}
                    current={settings.monthlyLimit}
                    onPick={(v) => patch({ monthlyLimit: v })}
                  />
                  <NumberInput
                    value={settings.monthlyLimit}
                    onCommit={(v) => patch({ monthlyLimit: v })}
                    ariaLabel="Monthly limit in dollars"
                    testId="settings-monthly-input"
                  />
                </div>
              }
            />
            <Row
              bare
              label="Reset day"
              hint={`Period runs from day ${settings.monthStartDay} to the day before. Currently resets ${overview ? shortDate(overview.resetDate) : '—'}.`}
              control={
                <Select
                  ariaLabel="Month reset day"
                  value={String(settings.monthStartDay)}
                  options={Array.from({ length: 28 }, (_, i) => ({
                    value: String(i + 1),
                    label: `Day ${i + 1}`,
                  }))}
                  onChange={(v) => patch({ monthStartDay: Number(v) })}
                  className="w-[120px]"
                />
              }
            />
            <DraftRange
              label={<Labelled badge={<EnforcedBadge />}>Daily limit</Labelled>}
              value={settings.dailyLimit}
              min={0}
              max={20}
              step={0.25}
              format={(v) => (v === 0 ? 'off' : fmtUsd(v))}
              onCommit={(v) => patch({ dailyLimit: v })}
              hint="A soft day boundary inside the month. 0 turns it off."
              testId="settings-daily"
            />
            <DraftRange
              label={
                <Labelled badge={<EnforcedBadge />}>Per-request limit</Labelled>
              }
              value={settings.perRequestLimit}
              min={0}
              max={5}
              step={0.05}
              format={(v) => (v === 0 ? 'off' : fmtUsd(v))}
              onCommit={(v) => patch({ perRequestLimit: v })}
              hint="One call estimated above this is downshifted or blocked before it starts."
              testId="settings-per-request"
            />
          </div>
        </BudgetCard>

        {/* Protections */}
        <BudgetCard title="Protections" testId="settings-protections">
          <div className="flex flex-col pb-1">
            <Row
              label="Hard cap"
              badge={<EnforcedBadge />}
              hint={
                settings.hardCap
                  ? 'Blocks calls that would cross a limit. The spend-per-5-minutes breaker is always on.'
                  : 'Off: XR warns at the limit and keeps going. Spend can exceed your monthly limit.'
              }
              control={
                <Toggle
                  checked={settings.hardCap}
                  onCheckedChange={(v) => patch({ hardCap: v })}
                  ariaLabel="Hard cap"
                  id="settings-hardcap"
                />
              }
              testId="settings-hardcap-row"
            />
            <div className="px-4 py-3">
              <DraftRange
                label={
                  <Labelled badge={<EnforcedBadge />}>Circuit breaker</Labelled>
                }
                value={Math.round(settings.circuitBreakerPct * 100)}
                min={80}
                max={100}
                step={1}
                format={(v) => (v >= 100 ? 'off' : `${v}%`)}
                onCommit={(v) => patch({ circuitBreakerPct: v / 100 })}
                disabled={!settings.hardCap}
                hint="Auto-pauses all spending at this share of the monthly limit (hard cap only)."
                testId="settings-breaker"
              />
            </div>
            <div className="px-4 pb-3">
              <DraftRange
                label={
                  <Labelled badge={<EnforcedBadge />}>Spike breaker</Labelled>
                }
                value={settings.circuitBreakerSpendPer5min}
                min={0.1}
                max={5}
                step={0.1}
                format={(v) => `${fmtUsd(v)} / 5 min`}
                onCommit={(v) => patch({ circuitBreakerSpendPer5min: v })}
                hint="More than this in any rolling five minutes pauses spending — the runaway-loop guard."
                testId="settings-spike"
              />
            </div>
            <Row
              label="Model downshifting"
              hint="Past the warning threshold, route to a cheaper model (then local) instead of failing. Every switch is logged and shown in chat."
              control={
                <Toggle
                  checked={settings.modelDownshifting}
                  onCheckedChange={(v) => patch({ modelDownshifting: v })}
                  ariaLabel="Model downshifting"
                  id="settings-downshift"
                />
              }
            />
            <div className="px-4 py-3">
              <DraftRange
                label="Finalization reserve"
                value={Math.round(settings.finalizationReservePct * 100)}
                min={0}
                max={20}
                step={1}
                format={(v) => `${v}%`}
                onCommit={(v) => patch({ finalizationReservePct: v / 100 })}
                hint={`Held back from new work so a run can wrap up. Currently ${fmtUsd(overview?.reserveUsd ?? 0)}.`}
                testId="settings-reserve"
              />
            </div>
          </div>
        </BudgetCard>

        {/* Notifications */}
        <BudgetCard title="Notifications" testId="settings-notifications">
          <div className="flex flex-col pb-1">
            <div className="px-4 py-3">
              <DraftRange
                label="Warn at"
                value={Math.round(settings.notifyWarnPct * 100)}
                min={50}
                max={95}
                step={5}
                format={(v) => `${v}%`}
                onCommit={(v) => patch({ notifyWarnPct: v / 100 })}
                hint={`Banner + one notification per day once ${fmtPct(settings.notifyWarnPct)} of the month is used. Downshifting starts here too.`}
                testId="settings-warn"
              />
            </div>
            <Row
              label="In-app toasts"
              hint="Blocked calls and limit changes."
              control={
                <Toggle
                  checked={settings.notifyToast}
                  onCheckedChange={(v) => patch({ notifyToast: v })}
                  ariaLabel="In-app toasts"
                  id="settings-toast"
                />
              }
            />
            <Row
              label="System notifications"
              hint="Warning threshold once a day; cap and pause instantly."
              control={
                <Toggle
                  checked={settings.notifyOs}
                  onCheckedChange={(v) => patch({ notifyOs: v })}
                  ariaLabel="System notifications"
                  id="settings-os"
                />
              }
            />
          </div>
        </BudgetCard>

        {/* Billing */}
        <BudgetCard title="Billing" testId="settings-billing">
          <div className="flex flex-col pb-1">
            <Row
              label="XR Personal"
              hint="Bring your own API keys. XR never bills you itself — your providers do."
              badge={
                <span className="text-text-tertiary border-border-subtle rounded-full border px-1.5 text-[10px]">
                  current
                </span>
              }
              control={
                <button
                  type="button"
                  data-testid="upgrade-pro"
                  onClick={() =>
                    toast('Pro tier coming in Phase 30', {
                      description: 'Nothing to buy yet. Personal stays free.',
                    })
                  }
                  className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised h-7 cursor-pointer rounded-md border px-2.5 text-[12px] transition-colors"
                >
                  Upgrade to Pro
                </button>
              }
            />
            <Row
              label="Invoices"
              hint="Monthly statements per provider, in one place."
              badge={<EnforcedBadge planned />}
              control={
                <span className="text-text-tertiary text-[12px]">
                  Not available
                </span>
              }
            />
          </div>
        </BudgetCard>
      </div>

      {/* Data */}
      <BudgetCard title="Data" testId="settings-data">
        <div className="flex flex-col pb-1">
          <Row
            label="Export spend"
            hint="Every event in the current period, as a real file."
            control={
              <div className="flex gap-1.5">
                <GhostBtn
                  onClick={() =>
                    void useBudgetStore.getState().exportSpend('csv', 'all')
                  }
                  testId="export-csv"
                >
                  <Download size={12} aria-hidden="true" /> CSV
                </GhostBtn>
                <GhostBtn
                  onClick={() =>
                    void useBudgetStore.getState().exportSpend('json', 'all')
                  }
                  testId="export-json"
                >
                  <Download size={12} aria-hidden="true" /> JSON
                </GhostBtn>
              </div>
            }
          />
          <Row
            label="Run test charge"
            hint="Records a small charge through the real gate — a capped budget blocks it too."
            control={
              <GhostBtn onClick={() => setTestOpen(true)} testId="test-charge">
                <FlaskConical size={12} aria-hidden="true" /> Test charge
              </GhostBtn>
            }
          />
          <Row
            label="Reset this month"
            hint="Starts a fresh period now. Events stay in History; the counters start at $0."
            control={
              <GhostBtn
                onClick={() => setResetMonthOpen(true)}
                testId="reset-month"
              >
                <RotateCcw size={12} aria-hidden="true" /> Reset month
              </GhostBtn>
            }
          />
          {dev && (
            <Row
              label="Reset all"
              hint="Dev only: delete every event and restore default settings."
              control={
                <GhostBtn
                  onClick={() => setResetAllOpen(true)}
                  danger
                  testId="reset-all"
                >
                  <Trash2 size={12} aria-hidden="true" /> Reset all
                </GhostBtn>
              }
            />
          )}
        </div>
      </BudgetCard>

      {dev && <Playground />}

      <ConfirmDialog
        open={resetMonthOpen}
        onOpenChange={setResetMonthOpen}
        title="Reset this month?"
        description={`The counters restart at $0 and a reset event is logged. ${fmtUsd(overview?.spentMonth ?? 0)} of history is kept.`}
        confirmLabel="Reset month"
        testId="reset-month-dialog"
        onConfirm={() => void useBudgetStore.getState().resetMonth()}
      />
      <ConfirmDialog
        open={resetAllOpen}
        onOpenChange={setResetAllOpen}
        title="Delete all budget data?"
        description="Every spend event is removed and settings return to defaults ($5.00 / month, hard cap on). This cannot be undone."
        confirmLabel="Delete everything"
        danger
        ack="I understand this deletes all spend history"
        testId="reset-all-dialog"
        onConfirm={() => void useBudgetStore.getState().clearAll()}
      />
      <TestChargeDialog open={testOpen} onOpenChange={setTestOpen} />
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

function Labelled({
  children,
  badge,
}: {
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2">
      {children}
      {badge}
    </span>
  );
}

/** RangeField with a local draft so dragging doesn't spam the backend. */
function DraftRange({
  value,
  onCommit,
  extra,
  ...rest
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
  hint?: ReactNode;
  disabled?: boolean;
  testId?: string;
  extra?: ReactNode;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <RangeField
        {...rest}
        value={draft ?? value}
        onChange={setDraft}
        onCommit={(v) => {
          setDraft(null);
          if (Math.abs(v - value) > 0.0001) onCommit(v);
        }}
      />
      {extra}
    </div>
  );
}

function NumberInput({
  value,
  onCommit,
  ariaLabel,
  testId,
}: {
  value: number;
  onCommit: (v: number) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[12px]">
      <span className="text-text-tertiary">$</span>
      <input
        key={value}
        type="number"
        min={0}
        max={100000}
        step={0.5}
        defaultValue={value}
        aria-label={ariaLabel}
        data-testid={testId}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0 && Math.abs(v - value) > 0.0001)
            onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="border-border-subtle bg-bg-raised text-text-primary focus-visible:border-accent h-7 w-24 rounded-md border px-2 font-mono text-[12px] tabular-nums outline-none"
      />
    </label>
  );
}

export function GhostBtn({
  children,
  onClick,
  danger,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'text-danger border-[color-mix(in_oklab,var(--danger)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]'
          : 'border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised'
      )}
    >
      {children}
    </button>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger,
  ack,
  testId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  ack?: string;
  testId?: string;
}) {
  const [acked, setAcked] = useState(false);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setAcked(false);
        onOpenChange(o);
      }}
    >
      {open ? (
        <AlertDialogContent data-testid={testId}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {ack && (
            <label className="border-border-subtle bg-bg-raised/40 flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[13px]">
              <Checkbox
                checked={acked}
                onCheckedChange={(v) => setAcked(v === true)}
                aria-required="true"
                className="mt-0.5"
                data-testid={testId ? `${testId}-ack` : undefined}
              />
              <span className="text-text-primary">{ack}</span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-[13px]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid={testId ? `${testId}-confirm` : undefined}
              disabled={Boolean(ack) && !acked}
              className={cn(
                'h-8 text-[13px] disabled:opacity-40',
                danger && 'bg-danger text-white hover:opacity-90'
              )}
              onClick={(e) => {
                e.preventDefault();
                if (ack && !acked) return;
                onConfirm();
                setAcked(false);
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}

function TestChargeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const settings = useBudgetStore((s) => s.settings);
  const [amount, setAmount] = useState(0.05);
  const [model, setModel] = useState(
    settings.defaultModel || DEFAULT_BUDGET_SETTINGS.defaultModel
  );
  const [finalization, setFinalization] = useState(false);
  const [busy, setBusy] = useState(false);
  const models = [...settings.configuredModels, ...settings.installedLocal];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-border-subtle bg-bg-ink sm:max-w-md"
        data-testid="test-charge-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-text-primary text-base font-semibold">
            Run a test charge
          </DialogTitle>
          <DialogDescription className="text-text-secondary text-[13px]">
            Goes through the same pre-call check as a real call. If the budget
            would block it, it is blocked — and you see exactly what a user
            would.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-1">
          <RangeField
            label="Amount"
            value={amount}
            min={0.01}
            max={2}
            step={0.01}
            format={(v) => fmtUsd(v)}
            onChange={setAmount}
            testId="test-charge-amount"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-primary text-[13px]">Model</span>
            <Select
              ariaLabel="Model"
              value={model}
              options={(models.length ? models : [model]).map((id) => ({
                value: id,
                label: modelLabel(id),
              }))}
              onChange={setModel}
              className="w-[200px]"
            />
          </div>
          <label className="flex items-start gap-2.5 text-[13px]">
            <Checkbox
              checked={finalization}
              onCheckedChange={(v) => setFinalization(v === true)}
              className="mt-0.5"
              data-testid="test-charge-finalization"
            />
            <span>
              <span className="text-text-primary">Finalization call</span>
              <span className="text-text-tertiary block text-[12px]">
                May dip into the reserve — the way a wrap-up step does.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <GhostBtn onClick={() => onOpenChange(false)}>Cancel</GhostBtn>
          <button
            type="button"
            disabled={busy}
            data-testid="test-charge-run"
            onClick={() => {
              setBusy(true);
              void (async () => {
                const { budgetGate, recordSpend } =
                  await import('@/budget/enforce');
                const check = await budgetGate({
                  model,
                  estimatedTokensIn: 0,
                  estimatedTokensOut: 0,
                  estimatedCost: amount,
                  agent: 'main',
                  workspace: null,
                  sessionId: null,
                  finalization,
                  surface: 'test',
                });
                if (check.allowed) {
                  await recordSpend({
                    kind: 'llm_call',
                    agent: 'main',
                    model: check.model,
                    costUsd: amount,
                    category: 'llm',
                    detail: { test: true, finalization },
                  });
                  toast(`Test charge of ${fmtUsd(amount)} recorded`, {
                    description: `${modelLabel(check.model)}${check.downgradedToModel ? ' (downshifted)' : ''} · appears in Spend History as a test.`,
                  });
                }
                setBusy(false);
                onOpenChange(false);
              })();
            }}
            className="bg-accent text-accent-contrast h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Checking…' : `Charge ${fmtUsd(amount)}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
