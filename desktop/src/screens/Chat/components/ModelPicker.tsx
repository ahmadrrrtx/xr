/*
 * Model picker popover (Phase 4 → Phase 14: engine-backed). Lists what the
 * XR engine can actually run right now: Local = models the local runtime
 * (Ollama) reports, Cloud = providers the engine knows, enabled only when a
 * key is configured. Rows carry provider, context window and list price
 * (an estimate — the provider's invoice is the truth). Selecting sets the
 * session's model; "Set default" makes it the engine's default too.
 * Engine down → the current choice is shown and the list says so; nothing
 * is invented.
 */
import { Check, Cpu, KeyRound, Sparkles, Star, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { fmtUsd } from '@/budget/core';
import { modelInfo, type ModelInfo } from '@/budget/models';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { chatDb } from '@/lib/chat-db';
import { useBudgetStore } from '@/stores/budgetStore';
import { engineModelOptions, useEngineStore, type EngineModelOption } from '@/stores/engineStore';
import { resolveDefaultModel, setDefaultModel, useSessionsStore } from '@/stores/sessionsStore';

function iconFor(m: ModelInfo, o: EngineModelOption) {
  if (o.kind === 'local') return Cpu;
  return m.latency === 'fast' ? Zap : Sparkles;
}

function priceLine(m: ModelInfo, o: EngineModelOption): string {
  const ctx = `${m.contextK}K ctx`;
  if (o.kind === 'local') return `${o.providerLabel}${o.detail ? ` · ${o.detail}` : ''} · $0`;
  return `${o.providerLabel} · ${ctx} · ${fmtUsd(m.inPer1M, { compact: true })} in / ${fmtUsd(m.outPer1M, { compact: true })} out per 1M`;
}

export function ModelPicker({
  sessionId,
  trigger,
}: {
  sessionId: string | null;
  /** Optional custom trigger (topbar chip). */
  trigger?: (label: string) => React.ReactNode;
}) {
  const navigate = useNavigate();
  const sessions = useSessionsStore();
  const engineStatus = useEngineStore((s) => s.status);
  const providers = useEngineStore((s) => s.providers);
  const models = useEngineStore((s) => s.models);
  const catalogError = useEngineStore((s) => s.catalogError);
  const [open, setOpen] = useState(false);

  const active = sessions.sessions.find((s) => s.id === sessionId)?.model ?? resolveDefaultModel();
  const label = modelInfo(active).name;
  const groups = useMemo(() => engineModelOptions(providers, models), [providers, models]);
  const engineDefault = providers?.model ?? null;

  useEffect(() => {
    if (open) void useEngineStore.getState().loadCatalog();
  }, [open]);

  const pick = async (o: EngineModelOption) => {
    if (!o.available) {
      if (o.kind === 'cloud') navigate('/budget?tab=models');
      else toast('Runtime not running', { description: o.unavailableReason ?? 'Start Ollama and retry.' });
      return;
    }
    if (sessionId) {
      await chatDb.updateSessionModel(sessionId, o.id);
      useSessionsStore.setState((st) => ({
        sessions: st.sessions.map((s) => (s.id === sessionId ? { ...s, model: o.id } : s)),
      }));
    }
    // The desktop default (new sessions) follows the last explicit choice.
    await setDefaultModel(o.id);
    void useBudgetStore.getState().updateSettings({ defaultModel: o.id }, { quiet: true });
    setOpen(false);
  };

  const setDefault = async (o: EngineModelOption, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!o.available) return;
    try {
      await useEngineStore.getState().setEngineDefault(o.id);
      toast(`${modelInfo(o.id).name} is now the default`, { description: 'The engine will use it for new runs.' });
    } catch (err) {
      toast('Could not set the default', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const Row = ({ o }: { o: EngineModelOption }) => {
    const m = modelInfo(o.id);
    const Icon = iconFor(m, o);
    const isActive = o.id === active;
    const isDefault = o.id === engineDefault;
    return (
      <div
        role="menuitemradio"
        aria-checked={isActive}
        aria-disabled={!o.available || undefined}
        tabIndex={0}
        data-testid={`model-pick-${o.id}`}
        onClick={() => void pick(o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void pick(o);
          }
        }}
        className={`group/row flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none ${
          o.available ? 'hover:bg-bg-raised' : 'opacity-60 hover:bg-bg-raised/50'
        }`}
      >
        <Icon aria-hidden="true" className="text-text-secondary mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1">
          <span className="text-text-primary flex items-center gap-1.5 text-[13px] font-semibold">
            <span className="truncate">{!o.available && o.kind === 'cloud' ? o.providerLabel : m.name}</span>
            {m.estimate && o.kind !== 'local' && (
              <span className="text-text-tertiary font-mono text-[9px] font-normal tracking-wide uppercase">estimate</span>
            )}
          </span>
          <span className="text-text-tertiary block truncate text-[11px]">
            {o.available
              ? priceLine(m, o)
              : o.kind === 'cloud'
                ? `${m.name} and others · ${o.unavailableReason ?? 'Unavailable'}`
                : `${o.providerLabel} · ${o.unavailableReason ?? 'Unavailable'}`}
          </span>
          {!o.available && o.kind === 'cloud' && (
            <span className="text-accent mt-0.5 flex items-center gap-1 text-[11px]">
              <KeyRound size={11} strokeWidth={1.75} aria-hidden="true" />
              Configure API key
            </span>
          )}
        </span>
        <span className="text-text-tertiary font-mono text-[9px] tracking-wide uppercase">
          {o.kind === 'local' ? 'local' : 'cloud'}
        </span>
        {o.available && (
          <button
            type="button"
            onClick={(e) => void setDefault(o, e)}
            aria-label={isDefault ? `${m.name} is the default` : `Set ${m.name} as default`}
            title={isDefault ? 'Engine default' : 'Set as engine default'}
            className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded ${
              isDefault ? 'text-warning' : 'text-text-tertiary opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
            }`}
          >
            <Star size={13} strokeWidth={1.75} aria-hidden="true" className={isDefault ? 'fill-current' : ''} />
          </button>
        )}
        {isActive && <Check aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0" strokeWidth={1.5} />}
      </div>
    );
  };

  const Group = ({ title, items }: { title: string; items: EngineModelOption[] }) =>
    items.length === 0 ? null : (
      <div>
        <div className="text-text-tertiary px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">{title}</div>
        {items.map((o) => (
          <Row key={`${o.provider}/${o.id}`} o={o} />
        ))}
      </div>
    );

  const empty = groups.local.length === 0 && groups.cloud.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ? (
          trigger(label)
        ) : (
          <button
            type="button"
            data-testid="model-picker-trigger"
            className="text-text-tertiary hover:bg-bg-raised hover:text-text-secondary max-w-[220px] truncate rounded px-2 py-0.5 text-[12px] font-medium transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none"
            aria-label={`Model: ${label}. Change model`}
          >
            {label} ▾
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[320px] border-border-subtle bg-bg-ink max-h-[min(480px,70vh)] overflow-y-auto p-1"
      >
        {empty ? (
          <div className="text-text-secondary px-2 py-3 text-[12.5px]">
            {engineStatus === 'up'
              ? catalogError
                ? `Could not load models: ${catalogError}`
                : 'No models available. Install Ollama or add an API key.'
              : 'Engine not running — the model list comes from the engine.'}
            <div className="text-text-tertiary mt-1 text-[11.5px]">Current: {label}</div>
          </div>
        ) : (
          <>
            <Group title="Local" items={groups.local} />
            <Group title="Cloud" items={groups.cloud} />
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate('/budget?tab=models');
          }}
          className="text-text-tertiary hover:text-text-secondary border-border-subtle mt-1 w-full border-t px-2 pt-2 pb-1 text-left text-[12px]"
        >
          Manage models and keys →
        </button>
      </PopoverContent>
    </Popover>
  );
}
