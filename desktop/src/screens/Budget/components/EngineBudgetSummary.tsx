import { useEffect, useState } from 'react';
import { fmtUsd } from '@/budget/core';
import { applyOwnerEngineLimits, readEngineBudget } from '@/engine/budget';
import type { EngineBudget } from '@/engine/types';
import { useBudgetStore } from '@/stores/budgetStore';
import { useEngineStore } from '@/stores/engineStore';
/** Explicitly separate authoritative shared estimates from observed UI history. */
export function EngineBudgetSummary() {
  const status = useEngineStore((s) => s.status);
  const settings = useBudgetStore((s) => s.settings);
  const [ledger, setLedger] = useState<EngineBudget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      setLedger(await readEngineBudget());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Engine ledger unavailable');
    }
  };
  useEffect(() => {
    if (status !== 'up') return;
    let current = true;
    void readEngineBudget()
      .then((value) => {
        if (current) {
          setLedger(value);
          setError(null);
        }
      })
      .catch((e) => {
        if (current)
          setError(
            e instanceof Error ? e.message : 'Engine ledger unavailable'
          );
      });
    return () => {
      current = false;
    };
  }, [status]);
  return (
    <section
      aria-label="Shared engine ledger"
      className="border-border-subtle text-text-secondary mx-4 mb-2 rounded-lg border px-3 py-2 text-xs"
    >
      <p className="font-semibold">
        Shared engine ledger · authoritative admission
      </p>
      {ledger ? (
        <p>
          Month estimate: {fmtUsd(ledger.usage.monthUsd ?? NaN)} /{' '}
          {fmtUsd(ledger.persisted?.monthly_cap ?? NaN)} · daily cap:{' '}
          {ledger.persisted?.daily_cap == null
            ? 'off'
            : fmtUsd(ledger.persisted.daily_cap)}{' '}
          · per-task threshold: {fmtUsd(ledger.config.perTaskUsd ?? NaN)}
        </p>
      ) : (
        <p>Engine ledger unavailable — no spending inferred.</p>
      )}
      <p>
        History below contains desktop-observed estimates only;
        interrupted/offline attempts may be absent. Provider invoices, premiums
        and hardware/power are not bounded by these USD estimates. Engine limits
        also apply when the desktop soft guard is off.
      </p>
      {error && (
        <p role="status" className="text-warning">
          {error}
          {ledger ? ' · showing last-known ledger' : ''}
        </p>
      )}
      {status !== 'up' && (
        <p role="status">
          Engine offline; displayed engine data, if any, is last-known.
        </p>
      )}
      <div className="mt-1 flex gap-3">
        <button
          disabled={busy || status !== 'up'}
          onClick={() => void refresh()}
          className="text-accent"
        >
          Refresh ledger
        </button>
        <button
          disabled={busy || status !== 'up'}
          className="text-accent"
          onClick={() => {
            setBusy(true);
            void applyOwnerEngineLimits(settings)
              .then((l) => {
                setLedger(l);
                setError(null);
              })
              .catch((e) =>
                setError(e instanceof Error ? e.message : 'Limit update failed')
              )
              .finally(() => setBusy(false));
          }}
        >
          Apply these monthly/daily/request limits to engine
        </button>
      </div>
    </section>
  );
}
