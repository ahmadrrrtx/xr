/*
 * Engine ledger (Phase 14) — what the engine itself has metered, read from
 * `GET /api/v1/budget` (usage, per-task cap, by provider). The desktop
 * governor's own numbers live in the tiles above; this card shows the
 * engine's figures as reported, so the two can be compared, not conflated.
 */
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fmtTokens, fmtUsd } from '@/budget/core';
import { engineJson } from '@/engine/transport';
import { useEngineStore } from '@/stores/engineStore';

import { BudgetCard } from './shared';

interface EngineBudgetResponse {
  config?: { perTaskUsd?: number; perTaskTokens?: number };
  persisted?: { monthly_cap?: number; daily_cap?: number | null; warnings_enabled?: boolean; auto_fallback?: boolean };
  usage?: { totalUsd?: number; totalTokens?: number; dayUsd?: number; monthUsd?: number };
  burn?: { monthUsd?: number; monthlyCap?: number; burnPct?: number | null };
  byProvider?: { provider: string; usd: number; tokens: number }[];
  byModel?: { model: string; usd: number; tokens: number }[];
  recent?: { usd: number; tokens: number; at: number }[];
}

export function EngineLedgerCard() {
  const up = useEngineStore((s) => s.status === 'up');
  const [data, setData] = useState<EngineBudgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Poll while the link is up; state is only set after a response arrives.
  useEffect(() => {
    if (!up) return;
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const next = await engineJson<EngineBudgetResponse>('/budget');
        if (alive) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [up]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await engineJson<EngineBudgetResponse>('/budget'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const usage = data?.usage;
  const providers = (data?.byProvider ?? []).slice(0, 5);
  const cap = data?.config?.perTaskUsd;

  return (
    <BudgetCard
      title="Engine ledger"
      action={
        up ? (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh engine ledger"
            className="text-text-tertiary hover:text-text-primary flex size-6 items-center justify-center rounded-md disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
          </button>
        ) : null
      }
      testId="card-engine-ledger"
    >
      <div className="px-4 pt-1 pb-4 text-[12.5px]">
        {!up ? (
          <p className="text-text-tertiary">Engine not running — nothing metered to show.</p>
        ) : error && !data ? (
          <p className="text-text-tertiary">Could not read the engine ledger: {error}</p>
        ) : !data ? (
          <p className="text-text-tertiary">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <Metric label="Today" value={fmtUsd(usage?.dayUsd ?? 0)} />
              <Metric label="This month" value={fmtUsd(usage?.monthUsd ?? 0)} />
              <Metric label="Tokens" value={fmtTokens(usage?.totalTokens ?? 0)} />
            </dl>
            {providers.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {providers.map((p) => (
                  <li key={p.provider} className="flex items-center justify-between gap-2">
                    <span className="text-text-secondary font-mono text-[11.5px]">{p.provider}</span>
                    <span className="text-text-tertiary font-mono text-[11.5px] tabular-nums">
                      {fmtTokens(p.tokens)} tok ·{' '}
                      {p.usd === 0 ? <span>local</span> : fmtUsd(p.usd, { precise: true })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-text-tertiary mt-3 text-[11.5px] leading-relaxed">
              Metered by the engine from provider-reported usage
              {typeof cap === 'number' ? ` · engine per-task stop ${fmtUsd(cap)}` : ''}. The desktop sends
              its own per-request cap with every turn; the lower of the two applies.
            </p>
          </>
        )}
      </div>
    </BudgetCard>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-tertiary text-[10.5px] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="text-text-primary mt-0.5 font-mono text-[15px] tabular-nums">{value}</dd>
    </div>
  );
}
