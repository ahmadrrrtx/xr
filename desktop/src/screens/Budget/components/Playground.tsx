/*
 * Dev Playground (Phase 13). Five scenarios that drive the real gate from
 * the UI so reviewers can watch enforcement happen: ten small calls, one
 * heavy prompt, a runaway loop (spike breaker), raise limit, hard cap off.
 * Everything goes through `budgetGate` → `recordSpend`; nothing bypasses.
 */
import { Flame, Repeat, ShieldOff, Sparkles, TrendingUp } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { fmtUsd } from '@/budget/core';
import { estimateCost } from '@/budget/models';
import { useBudgetStore } from '@/stores/budgetStore';

import { BudgetCard } from './shared';

type Log = { at: number; text: string; tone?: 'ok' | 'warn' | 'danger' };

async function fire(opts: {
  model: string;
  tokensIn: number;
  tokensOut: number;
  agent: string;
  sessionId: string;
  finalization?: boolean;
}): Promise<{
  allowed: boolean;
  code: string;
  model: string;
  cost: number;
  downshifted: boolean;
}> {
  const { budgetGate, recordSpend } = await import('@/budget/enforce');
  const check = await budgetGate({
    model: opts.model,
    estimatedTokensIn: opts.tokensIn,
    estimatedTokensOut: opts.tokensOut,
    agent: opts.agent,
    workspace: 'xr',
    sessionId: opts.sessionId,
    finalization: opts.finalization,
    surface: 'playground',
  });
  if (!check.allowed) {
    return {
      allowed: false,
      code: check.code,
      model: check.model,
      cost: check.estimatedCost,
      downshifted: false,
    };
  }
  const cost = estimateCost(check.model, opts.tokensIn, opts.tokensOut);
  await recordSpend({
    kind: 'llm_call',
    agent: opts.agent,
    workspace: 'xr',
    sessionId: opts.sessionId,
    model: check.model,
    tokensIn: opts.tokensIn,
    tokensOut: opts.tokensOut,
    costUsd: cost,
    category: 'llm',
    detail: { playground: true },
  });
  return {
    allowed: true,
    code: check.code,
    model: check.model,
    cost,
    downshifted: Boolean(check.downgradedToModel),
  };
}

export function Playground() {
  const settings = useBudgetStore((s) => s.settings);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Log[]>([]);
  const push = (text: string, tone?: Log['tone']) =>
    setLog((l) => [{ at: Date.now(), text, tone }, ...l].slice(0, 40));
  const sessionRef = useRef<string | null>(null);
  const sessionId = (): string => {
    sessionRef.current ??= `play-${Math.random().toString(36).slice(2, 6)}`;
    return sessionRef.current;
  };

  const run = (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    void fn().finally(() => setBusy(null));
  };

  const tenSmall = () =>
    run('ten', async () => {
      let ok = 0;
      let blocked = 0;
      let shifted = 0;
      for (let i = 0; i < 10; i++) {
        const r = await fire({
          model: 'claude-haiku-4-6',
          tokensIn: 600,
          tokensOut: 300,
          agent: 'main',
          sessionId: sessionId(),
        });
        if (r.allowed) {
          ok++;
          if (r.downshifted) shifted++;
        } else {
          blocked++;
          push(`Call ${i + 1} blocked (${r.code})`, 'danger');
          break;
        }
      }
      push(
        `10 small calls: ${ok} ran${shifted ? ` (${shifted} downshifted)` : ''}, ${blocked} blocked`,
        blocked ? 'warn' : 'ok'
      );
    });

  const heavy = () =>
    run('heavy', async () => {
      const r = await fire({
        model: 'claude-opus-4-6',
        tokensIn: 40_000,
        tokensOut: 8_000,
        agent: 'research',
        sessionId: sessionId(),
      });
      if (r.allowed)
        push(
          `Heavy prompt ran on ${r.model} for ${fmtUsd(r.cost)}${r.downshifted ? ' (downshifted)' : ''}`,
          r.downshifted ? 'warn' : 'ok'
        );
      else
        push(
          `Heavy prompt blocked (${r.code}) — estimated ${fmtUsd(r.cost)}`,
          'danger'
        );
    });

  const runaway = () =>
    run('runaway', async () => {
      let n = 0;
      for (let i = 0; i < 30; i++) {
        const r = await fire({
          model: 'claude-sonnet-4.5',
          tokensIn: 1_500,
          tokensOut: 1_700,
          agent: 'coder',
          sessionId: sessionId(),
        });
        if (!r.allowed) {
          const reason = useBudgetStore.getState().settings.pauseReason;
          const why =
            r.code === 'paused' && reason === 'spike'
              ? 'spike breaker tripped'
              : r.code;
          push(`Runaway loop stopped after ${n} calls — ${why}`, 'danger');
          return;
        }
        n++;
      }
      push(
        `Runaway loop: 30 calls ran without tripping — raise nothing, lower the spike breaker`,
        'warn'
      );
    });

  const raise = () =>
    run('raise', async () => {
      const next = Math.min(
        1000,
        Math.max(settings.monthlyLimit * 2, settings.monthlyLimit + 5)
      );
      await useBudgetStore.getState().updateSettings({ monthlyLimit: next });
      push(`Monthly limit raised to ${fmtUsd(next)}`, 'ok');
    });

  const hardCapOff = () =>
    run('hardcap', async () => {
      await useBudgetStore
        .getState()
        .updateSettings({ hardCap: !settings.hardCap });
      push(
        settings.hardCap
          ? 'Hard cap OFF — calls over the limit now warn instead of block'
          : 'Hard cap back ON',
        settings.hardCap ? 'warn' : 'ok'
      );
      if (settings.hardCap)
        toast.warning('Hard cap is off', {
          description: 'Spend can now exceed the monthly limit.',
        });
    });

  return (
    <BudgetCard
      title="Playground"
      action={
        <span className="text-text-tertiary text-[11px]">
          dev · every call goes through the real gate
        </span>
      }
      testId="budget-playground"
    >
      <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
        <div className="flex flex-wrap gap-2">
          <PlayBtn
            icon={<Sparkles size={13} aria-hidden="true" />}
            onClick={tenSmall}
            busy={busy === 'ten'}
            testId="play-ten"
          >
            Fire 10 small calls
          </PlayBtn>
          <PlayBtn
            icon={<Flame size={13} aria-hidden="true" />}
            onClick={heavy}
            busy={busy === 'heavy'}
            testId="play-heavy"
          >
            Heavy prompt (~$1.20)
          </PlayBtn>
          <PlayBtn
            icon={<Repeat size={13} aria-hidden="true" />}
            onClick={runaway}
            busy={busy === 'runaway'}
            testId="play-runaway"
          >
            Runaway loop
          </PlayBtn>
          <PlayBtn
            icon={<TrendingUp size={13} aria-hidden="true" />}
            onClick={raise}
            busy={busy === 'raise'}
            testId="play-raise"
          >
            Raise limit
          </PlayBtn>
          <PlayBtn
            icon={<ShieldOff size={13} aria-hidden="true" />}
            onClick={hardCapOff}
            busy={busy === 'hardcap'}
            testId="play-hardcap"
          >
            {settings.hardCap ? 'Hard cap off' : 'Hard cap on'}
          </PlayBtn>
        </div>
        <ol
          className="bg-bg-base/40 border-border-subtle max-h-[160px] min-h-[56px] overflow-auto rounded-lg border px-3 py-2 font-mono text-[11px]"
          aria-live="polite"
          data-testid="play-log"
        >
          {log.length === 0 && (
            <li className="text-text-tertiary">Nothing fired yet.</li>
          )}
          {log.map((l) => (
            <li
              key={l.at + l.text}
              className={
                l.tone === 'danger'
                  ? 'text-danger'
                  : l.tone === 'warn'
                    ? 'text-warning'
                    : l.tone === 'ok'
                      ? 'text-text-primary'
                      : 'text-text-secondary'
              }
            >
              <span className="text-text-tertiary mr-2">
                {new Date(l.at).toLocaleTimeString()}
              </span>
              {l.text}
            </li>
          ))}
        </ol>
      </div>
    </BudgetCard>
  );
}

function PlayBtn({
  children,
  icon,
  onClick,
  busy,
  testId,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  busy: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid={testId}
      className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:cursor-wait disabled:opacity-60"
    >
      {icon}
      {children}
    </button>
  );
}
