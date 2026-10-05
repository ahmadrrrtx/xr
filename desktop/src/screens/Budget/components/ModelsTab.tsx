/*
 * Budget › Models (Phase 13). Cloud + local card grids from the price
 * registry (`budget/models.ts`). Cloud cards: context, $/1M in/out,
 * latency/quality/strength chips, status dot, Set as default, Test model,
 * ⋯ Configure/Remove. Local cards: hardware badge (detectSystem RAM), gray
 * "local" pill, Download via Ollama pull (browser: marked installed).
 *
 * "Add model" opens the Phase 8 ProviderConfigModal for the provider; a
 * saved key unlocks that provider's registry models.
 */
import {
  Check,
  Cloud,
  Cpu,
  Download,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Plus,
  Star,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { fmtUsd } from '@/budget/core';
import {
  MODEL_REGISTRY,
  PROVIDER_LABEL,
  type ModelInfo,
  type ModelProvider,
} from '@/budget/models';
import {
  ProviderConfigModal,
  type ProviderCatalogEntry,
  type ProviderSaveInput,
} from '@/components/settings/ProviderConfigModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isTauri } from '@/lib/tauri';
import { detectSystem, ollamaPull, type SystemInfo } from '@/lib/settingsApi';
import { cn } from '@/lib/utils';
import { useBudgetStore } from '@/stores/budgetStore';
import { useSettingsStore, type ProviderConfig } from '@/stores/settingsStore';

import { BudgetCard, EstimatePill, LocalPill } from './shared';

/* Provider → Phase 8 catalog entry (subset: the ones the registry prices). */
const PROVIDER_ENTRIES: Record<
  Exclude<ModelProvider, 'other'>,
  ProviderCatalogEntry
> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    tagline: 'GPT-5 and GPT-4o.',
    baseUrl: 'https://api.openai.com/v1',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    tagline: 'Claude models.',
    baseUrl: 'https://api.anthropic.com',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    kind: 'gemini',
    tagline: 'Gemini models.',
    baseUrl: 'https://generativelanguage.googleapis.com',
    keysUrl: 'https://aistudio.google.com/apikey',
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    kind: 'openai-compatible',
    tagline: 'Grok models.',
    baseUrl: 'https://api.x.ai/v1',
    keysUrl: 'https://console.x.ai',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'ollama',
    tagline: 'Local models on this machine — no key needed.',
    baseUrl: 'http://localhost:11434',
    keyless: true,
  },
};

const LATENCY_LABEL = { fast: 'Fast', medium: 'Medium', slow: 'Slow' } as const;
const QUALITY_LABEL = { good: 'Good', great: 'Great', best: 'Best' } as const;

export function ModelsTab() {
  const settings = useBudgetStore((s) => s.settings);
  const byModel = useBudgetStore((s) => s.byModel);
  const providers = useSettingsStore((s) => s.settings.models.providers);
  const updateSettings = useSettingsStore((s) => s.update);
  const [configFor, setConfigFor] = useState<ProviderCatalogEntry | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void detectSystem().then((info) => {
      if (alive) setSystem(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  const spendByModel = useMemo(
    () => new Map(byModel.map((r) => [r.key, r.cost])),
    [byModel]
  );
  const cloud = MODEL_REGISTRY.filter((m) => !m.local);
  const local = MODEL_REGISTRY.filter((m) => m.local);
  const configuredProviders = new Set(providers.map((p) => p.id));
  const ramGb = system?.totalMemoryGb ?? null;

  const isConfigured = (m: ModelInfo): boolean =>
    m.local
      ? settings.installedLocal.includes(m.id)
      : settings.configuredModels.includes(m.id);

  const saveProvider = (input: ProviderSaveInput): void => {
    void (async () => {
      if (input.apiKey && input.keyStorage === 'local-insecure') {
        const { readSettingJSON, writeSettingJSON } =
          await import('@/lib/persistent-store');
        const keys =
          (await readSettingJSON<Record<string, string>>('xr.providerKeys')) ??
          {};
        keys[input.id] = input.apiKey;
        await writeSettingJSON('xr.providerKeys', keys);
      }
      const prev = providers.find((p) => p.id === input.id);
      const next: ProviderConfig[] = providers.filter((p) => p.id !== input.id);
      next.push({
        id: input.id,
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl ?? undefined,
        model: input.model ?? undefined,
        addedAt: prev?.addedAt ?? Date.now(),
        keyStorage: input.keyStorage,
        lastTest: input.test
          ? {
              ok: input.test.ok,
              at: Date.now(),
              latencyMs: input.test.latencyMs,
              message: input.test.message,
            }
          : undefined,
      });
      updateSettings('models', { providers: next });
      // A saved provider unlocks its priced models for the governor.
      const ids = MODEL_REGISTRY.filter(
        (m) => m.provider === input.id && !m.local
      ).map((m) => m.id);
      for (const id of ids) await useBudgetStore.getState().addModel(id);
      setConfigFor(null);
      toast.success(`${input.name} saved`, {
        description: ids.length ? `${ids.length} models available.` : undefined,
      });
    })();
  };

  const removeProvider = (id: string): void => {
    void (async () => {
      const { keychainDelete } = await import('@/lib/settingsApi');
      void keychainDelete('xr', id);
      updateSettings('models', {
        providers: providers.filter((p) => p.id !== id),
      });
      for (const m of MODEL_REGISTRY)
        if (m.provider === id && !m.local)
          await useBudgetStore.getState().removeModel(m.id);
      setConfigFor(null);
      toast.success('Provider removed');
    })();
  };

  const testModel = (m: ModelInfo): void => {
    setTesting(m.id);
    // Mock round-trip: no real network, no real spend (Phase 14 wires providers).
    window.setTimeout(() => {
      setTesting(null);
      const ms = m.local
        ? 420 + Math.round(Math.random() * 300)
        : 180 + Math.round(Math.random() * 400);
      toast.success(`${m.name} responded`, {
        description: `${ms} ms · mock round-trip, nothing was charged.`,
      });
    }, 650);
  };

  const download = (m: ModelInfo): void => {
    setPulling(m.id);
    void (async () => {
      try {
        if (isTauri()) await ollamaPull(m.id);
        else await new Promise((r) => window.setTimeout(r, 900));
        await useBudgetStore.getState().installLocal(m.id);
        toast.success(`${m.name} ready`, {
          description: 'Available offline, $0 per call.',
        });
      } catch (err) {
        toast.error(`Could not download ${m.name}`, {
          description:
            err instanceof Error && err.message !== 'browser'
              ? err.message
              : 'Ollama is not reachable.',
        });
      } finally {
        setPulling(null);
      }
    })();
  };

  return (
    <div className="flex flex-col gap-5 p-4" data-testid="budget-models">
      <div className="flex items-center justify-between gap-3">
        <p className="text-text-secondary text-[13px]">
          Prices are list rates per 1M tokens; the governor uses them for every
          pre-call estimate.
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="models-add"
              className="bg-accent text-accent-contrast flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium hover:opacity-90"
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              Add model
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel className="text-text-tertiary text-[11px]">
              Connect a provider
            </DropdownMenuLabel>
            {(
              Object.keys(PROVIDER_ENTRIES) as Array<
                keyof typeof PROVIDER_ENTRIES
              >
            ).map((id) => (
              <DropdownMenuItem
                key={id}
                onSelect={() => setConfigFor(PROVIDER_ENTRIES[id])}
              >
                {id === 'ollama' ? (
                  <Cpu size={13} aria-hidden="true" />
                ) : (
                  <Cloud size={13} aria-hidden="true" />
                )}
                {PROVIDER_ENTRIES[id].name}
                {configuredProviders.has(id) && (
                  <Check
                    size={12}
                    aria-hidden="true"
                    className="ml-auto opacity-70"
                  />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <BudgetCard
        title="Cloud"
        action={
          <span className="text-text-tertiary text-[11px]">
            {cloud.filter(isConfigured).length} of {cloud.length} configured
          </span>
        }
        testId="models-cloud"
      >
        <div
          className="grid gap-3 px-4 pt-1 pb-4"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {cloud.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              configured={isConfigured(m)}
              isDefault={settings.defaultModel === m.id}
              spent={spendByModel.get(m.id) ?? 0}
              testing={testing === m.id}
              onDefault={() =>
                void useBudgetStore.getState().setDefaultModel(m.id)
              }
              onTest={() => testModel(m)}
              onConfigure={() => {
                const entry =
                  PROVIDER_ENTRIES[m.provider as keyof typeof PROVIDER_ENTRIES];
                if (entry) setConfigFor(entry);
              }}
              onRemove={() => void useBudgetStore.getState().removeModel(m.id)}
            />
          ))}
        </div>
      </BudgetCard>

      <BudgetCard
        title="Local"
        action={
          <span className="text-text-tertiary flex items-center gap-1.5 text-[11px]">
            <HardDrive size={11} aria-hidden="true" />
            {ramGb
              ? `${Math.round(ramGb)} GB RAM detected`
              : 'RAM unknown (browser)'}
          </span>
        }
        testId="models-local"
      >
        <div
          className="grid gap-3 px-4 pt-1 pb-4"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {local.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              configured={isConfigured(m)}
              isDefault={settings.defaultModel === m.id}
              spent={0}
              ramGb={ramGb}
              pulling={pulling === m.id}
              testing={testing === m.id}
              onDefault={() =>
                void useBudgetStore.getState().setDefaultModel(m.id)
              }
              onTest={() => testModel(m)}
              onDownload={() => download(m)}
              onConfigure={() => setConfigFor(PROVIDER_ENTRIES.ollama)}
              onRemove={() => void useBudgetStore.getState().removeModel(m.id)}
            />
          ))}
        </div>
      </BudgetCard>

      {configFor ? (
        <ProviderConfigModal
          entry={configFor}
          existing={providers.find((p) => p.id === configFor.id) ?? null}
          open
          onOpenChange={(open) => {
            if (!open) setConfigFor(null);
          }}
          onSave={saveProvider}
          onRemove={removeProvider}
        />
      ) : null}
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────── */

function ModelCard({
  model: m,
  configured,
  isDefault,
  spent,
  ramGb,
  pulling,
  testing,
  onDefault,
  onTest,
  onDownload,
  onConfigure,
  onRemove,
}: {
  model: ModelInfo;
  configured: boolean;
  isDefault: boolean;
  spent: number;
  ramGb?: number | null;
  pulling?: boolean;
  testing?: boolean;
  onDefault: () => void;
  onTest: () => void;
  onDownload?: () => void;
  onConfigure: () => void;
  onRemove: () => void;
}) {
  const fits =
    m.local && ramGb != null && m.ramGb != null ? ramGb >= m.ramGb : null;
  const statusTone = !configured
    ? 'var(--text-tertiary)'
    : m.local
      ? 'var(--success)'
      : 'var(--success)';
  return (
    <article
      data-testid={`model-card-${m.id}`}
      data-configured={configured}
      className={cn(
        'border-border-subtle bg-bg-base/40 flex min-h-[150px] flex-col gap-2 rounded-lg border p-3',
        isDefault && 'border-accent/60',
        !configured && 'opacity-80'
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: statusTone }}
              title={
                configured
                  ? m.local
                    ? 'Installed'
                    : 'Key configured'
                  : m.local
                    ? 'Not installed'
                    : 'No key'
              }
            />
            <h4 className="text-text-primary truncate text-[13px] font-medium">
              {m.name}
            </h4>
            {isDefault && (
              <span
                className="text-accent inline-flex items-center gap-0.5 text-[10px] font-medium"
                title="Default model"
              >
                <Star size={10} strokeWidth={2} aria-hidden="true" /> default
              </span>
            )}
          </div>
          <div className="text-text-tertiary mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span>{PROVIDER_LABEL[m.provider]}</span>
            <span aria-hidden="true">·</span>
            <span className="border-border-subtle rounded-full border px-1.5 font-mono text-[10px]">
              {m.contextK}K ctx
            </span>
            {m.local && <LocalPill />}
            {m.estimate && <EstimatePill />}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${m.name}`}
              className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex size-6 cursor-pointer items-center justify-center rounded"
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onSelect={onConfigure}>
              Configure provider
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onRemove}
              disabled={!configured}
              className="text-danger"
            >
              {m.local ? 'Remove from list' : 'Remove model'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="text-text-secondary flex flex-col gap-0.5 font-mono text-[11px] tabular-nums">
        {m.local ? (
          <span>$0 per call · {m.sizeGb} GB download</span>
        ) : (
          <span>
            {fmtUsd(m.inPer1M)} in · {fmtUsd(m.outPer1M)} out{' '}
            <span className="text-text-tertiary">/ 1M tokens</span>
          </span>
        )}
        {spent > 0 && (
          <span className="text-text-tertiary">
            {fmtUsd(spent)} this period
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip icon={<Zap size={9} aria-hidden="true" />}>
          {LATENCY_LABEL[m.latency]}
        </Chip>
        <Chip>{QUALITY_LABEL[m.quality]}</Chip>
        {m.strengths.map((s) => (
          <Chip key={s}>{s}</Chip>
        ))}
        {m.local && m.ramGb != null && (
          <Chip tone={fits === false ? 'warn' : undefined}>
            {m.ramGb} GB RAM
            {fits === false ? ' · tight' : fits ? ' · fits' : ''}
          </Chip>
        )}
      </div>

      <footer className="mt-auto flex items-center gap-1.5 pt-1">
        {m.local && !configured ? (
          <SmallBtn
            onClick={onDownload}
            disabled={pulling}
            testId={`model-download-${m.id}`}
          >
            {pulling ? (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={12} aria-hidden="true" />
            )}
            {pulling ? 'Downloading…' : 'Download'}
          </SmallBtn>
        ) : !configured ? (
          <SmallBtn onClick={onConfigure} testId={`model-configure-${m.id}`}>
            Add key
          </SmallBtn>
        ) : (
          <>
            <SmallBtn
              onClick={onDefault}
              disabled={isDefault}
              testId={`model-default-${m.id}`}
            >
              {isDefault ? 'Default' : 'Set as default'}
            </SmallBtn>
            <SmallBtn
              onClick={onTest}
              disabled={testing}
              testId={`model-test-${m.id}`}
            >
              {testing ? (
                <Loader2
                  size={12}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              Test model
            </SmallBtn>
          </>
        )}
      </footer>
    </article>
  );
}

function Chip({
  children,
  icon,
  tone,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'warn';
}) {
  return (
    <span
      className={cn(
        'border-border-subtle inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[10px] capitalize',
        tone === 'warn' ? 'text-warning' : 'text-text-secondary'
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function SmallBtn({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-raised flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[12px] transition-colors disabled:cursor-default disabled:opacity-60"
    >
      {children}
    </button>
  );
}
