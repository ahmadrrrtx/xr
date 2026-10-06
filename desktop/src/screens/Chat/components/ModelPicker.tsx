/*
 * Model picker popover (Phase 4, Phase 13: registry-backed). Lists the
 * models the Budget governor knows about — cloud models with a key
 * configured plus installed local models — with their list price so the
 * cost of a choice is visible before the first token. Selecting sets the
 * session's model and persists it as the default (xr.model.default).
 */
import { Check, Cpu, Sparkles, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { fmtUsd } from '@/budget/core';
import { modelInfo, type ModelInfo } from '@/budget/models';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { chatDb } from '@/lib/chat-db';
import { writeSettingJSON } from '@/lib/persistent-store';
import { useBudgetStore } from '@/stores/budgetStore';
import { DEFAULT_MODEL, useSessionsStore } from '@/stores/sessionsStore';

function iconFor(m: ModelInfo) {
  if (m.local) return Cpu;
  return m.latency === 'fast' ? Zap : Sparkles;
}

function priceLine(m: ModelInfo): string {
  if (m.local) return 'Local via Ollama · $0 per call';
  const q = m.quality === 'best' ? 'Best quality' : m.quality === 'great' ? 'Strong all-rounder' : 'Everyday';
  return `${q} · ${fmtUsd(m.outPer1M, { compact: true })}/1M out`;
}

export function ModelPicker({ sessionId }: { sessionId: string | null }) {
  const navigate = useNavigate();
  const sessions = useSessionsStore();
  const configured = useBudgetStore((s) => s.settings.configuredModels);
  const installed = useBudgetStore((s) => s.settings.installedLocal);
  const active =
    sessions.sessions.find((s) => s.id === sessionId)?.model ?? DEFAULT_MODEL;

  const ids = [...new Set([...configured, ...installed, active])];
  const models = ids.map(modelInfo);
  const label = modelInfo(active).name;

  const pick = async (id: string) => {
    if (!sessionId) {
      await writeSettingJSON('xr.model.default', id);
      void useBudgetStore.getState().updateSettings({ defaultModel: id }, { quiet: true });
      // Reflect in any future session creation.
      useSessionsStore.setState((st) => ({
        sessions: st.sessions.map((s) => (s.id === st.activeSessionId ? { ...s, model: id } : s)),
      }));
      return;
    }
    await chatDb.updateSessionModel(sessionId, id);
    useSessionsStore.setState((st) => ({
      sessions: st.sessions.map((s) => (s.id === sessionId ? { ...s, model: id } : s)),
    }));
    await writeSettingJSON('xr.model.default', id);
    void useBudgetStore.getState().updateSettings({ defaultModel: id }, { quiet: true });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary rounded px-2 py-0.5 text-[12px] font-medium transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Model: ${label}. Change model`}
        >
          {label} ▾
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-70 border-border-subtle bg-bg-ink p-1">
        <div className="text-text-tertiary px-2 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
          Model
        </div>
        {models.map((m) => {
          const Icon = iconFor(m);
          return (
          <button
            key={m.id}
            type="button"
            onClick={() => void pick(m.id)}
            role="menuitemradio"
            aria-checked={m.id === active}
            data-testid={`model-pick-${m.id}`}
            className="hover:bg-bg-raised flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left"
          >
            <Icon
              aria-hidden="true"
              className="text-text-secondary mt-0.5 size-4 shrink-0"
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1">
              <span className="text-text-primary block text-[13px] font-semibold">
                {m.name}
              </span>
              <span className="text-text-tertiary block text-[11px]">{priceLine(m)}</span>
            </span>
            <span className="text-text-tertiary font-mono text-[9px] tracking-wide uppercase">
              {m.local ? 'local' : m.estimate ? 'estimate' : 'cloud'}
            </span>
            {m.id === active && (
              <Check aria-hidden="true" className="text-accent mt-0.5 size-4" strokeWidth={1.5} />
            )}
          </button>
          );
        })}
        <button
          type="button"
          onClick={() => navigate('/budget?tab=models')}
          className="text-text-tertiary hover:text-text-secondary mt-1 w-full border-t border-border-subtle px-2 pt-2 pb-1 text-left text-[12px]"
        >
          Manage models →
        </button>
      </PopoverContent>
    </Popover>
  );
}
