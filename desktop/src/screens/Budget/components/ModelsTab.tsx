/*
 * Budget › Models (Phase 13). Cloud + local card grids from the offline,
 * sourced price registry (`budget/models.ts` — the dated model facts in
 * src/core/model-facts.json plus six curated local rows). That registry is a
 * PRICING surface, not the engine's catalogue: the engine (26 presets +
 * custom endpoints) is the truth for what exists and what is configured, so
 * every provider row below comes from the engine snapshot (S-6), and keys go
 * to the engine's secret broker through the same modal as Settings.
 *
 * "Test model" is a real engine round trip for local models, and an honest
 * "not wired for hosted" for the rest — it never fabricates latency.
 * Downloads run through the desktop's Ollama pull with the engine-side
 * byte counts; a stream that never confirms success is an error, never a
 * "ready" toast.
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
import {
  detectSystem,
  ollamaPull,
  type PullProgressPayload,
  type SystemInfo,
} from '@/lib/settingsApi';
import { cn } from '@/lib/utils';
import { useBudgetStore } from '@/stores/budgetStore';
import { useSettingsStore, type ProviderConfig } from '@/stores/settingsStore';
import { useEngineStore } from '@/stores/engineStore';
import { pingEngineLocalModel } from '@/engine/providers';
import {
  buildProviderCatalog,
  desktopKindFor,
} from '@/engine/providerCatalog';

import { BudgetCard, EstimatePill, LocalPill } from './shared';

const LATENCY_LABEL = {
  fast: 'Fast',
  medium: 'Medium',
  slow: 'Slow',
  unknown: 'Latency unmeasured',
} as const;
const QUALITY_LABEL = {
  good: 'Good',
  great: 'Great',
  best: 'Best',
  unknown: 'Quality unmeasured',
} as const;

export function ModelsTab() {
  const settings = useBudgetStore((s) => s.settings);
  const byModel = useBudgetStore((s) => s.byModel);
  const localMirror = useSettingsStore((s) => s.settings.models.providers);
  const updateSettings = useSettingsStore((s) => s.update);
  const engineProviders = useEngineStore((s) => s.providers?.providers ?? null);
  const enginePrimary = useEngineStore((s) => s.providers?.primary ?? null);
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
  /* S-6 — WHICH providers are configured is an engine fact (hasKey, or the
   * primary local runtime with no key), not the desktop mirror. The mirror
   * keeps only presentation the engine does not own (addedAt, last test). */
  const providers = useMemo<ProviderConfig[]>(
    () =>
      (engineProviders ?? [])
        .filter((p) => p.id !== 'custom' && (p.hasKey || p.id === enginePrimary))
        .map((p) => {
          const meta = localMirror.find((m) => m.id === p.id);
          const tested = meta?.lastTest ?? null;
          return {
            id: p.id,
            kind: desktopKindFor(p.id, p.kind),
            name: meta?.name ?? p.label ?? p.id,
            baseUrl: p.baseUrl ?? meta?.baseUrl,
            model: meta?.model,
            addedAt: meta?.addedAt ?? 0,
            keyStorage: p.hasKey ? 'engine' : 'none',
            lastTest: p.healthState
              ? {
                  ok: p.healthState === 'reachable' && p.hasKey,
                  at: Date.parse(p.checkedAt ?? '') || 0,
                  latencyMs: p.latencyMs ?? undefined,
                }
              : (tested ?? undefined),
          };
        }),
    [engineProviders, enginePrimary, localMirror]
  );
  // The "Add a provider" menu derives from the engine too — 26 presets plus
  // any custom endpoints it holds — with a flagged degraded fallback when the
  // engine has not answered (never a silent subset).
  const catalog = useMemo(
    () => buildProviderCatalog(engineProviders),
    [engineProviders]
  );
  const entryFor = (id: string): ProviderCatalogEntry | undefined =>
    catalog.entries.find((e) => e.id === id);
  const cloud = MODEL_REGISTRY.filter((m) => !m.local);
  const local = MODEL_REGISTRY.filter((m) => m.local);
  const configuredProviders = new Set(providers.map((p) => p.id));
  const ramGb = system?.totalMemoryGb ?? null;

  /* A cloud card is "configured" when the ENGINE reports a usable credential
   * for its provider — not because a desktop list was appended on save. */
  const isConfigured = (m: ModelInfo): boolean =>
    m.local
      ? settings.installedLocal.includes(m.id)
      : configuredProviders.has(m.provider);

  const saveProvider = (input: ProviderSaveInput): void => {
    void (async () => {
      const prev = localMirror.find((p) => p.id === input.id);
      const next: ProviderConfig[] = localMirror.filter((p) => p.id !== input.id);
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

  const removeProvider = async (id: string): Promise<void> => {
    const existing = localMirror.find((p) => p.id === id) ?? providers.find((p) => p.id === id);
    let notice =
      'Desktop entry removed; review external credentials separately.';
    if (existing?.keyStorage === 'engine') {
      const { removeProviderKeyFromEngine } =
        await import('@/engine/providers');
      notice = (await removeProviderKeyFromEngine(id)).notice;
    } else if (existing?.keyStorage === 'none') {
      notice = 'No credential stored for this entry — nothing to remove.';
    } else if (existing?.keyStorage === 'keychain') {
      const { keychainDelete } = await import('@/lib/settingsApi');
      await keychainDelete('xr', id);
    } else if (existing?.keyStorage === 'local-insecure') {
      const { purgeLegacyCredentialSettings } =
        await import('@/lib/persistent-store');
      await purgeLegacyCredentialSettings();
    }
    updateSettings('models', {
      providers: localMirror.filter((p) => p.id !== id),
    });
    setConfigFor(null);
    toast.success('Stored entry removed', { description: notice });
  };

  const testModel = (m: ModelInfo): void => {
    if (m.local) {
      // A real round trip through the engine — the same path a chat turn
      // takes. No fabricated millisecond figure, ever.
      setTesting(m.id);
      void pingEngineLocalModel('ollama', m.id)
        .then((r) => {
          if (r.result.ok) {
            toast.success(`${m.name} answered`, {
              description: `${r.result.latencyMs ?? '?'} ms via the engine · local inference; hardware/power not measured.`,
            });
          } else {
            toast.error(`${m.name} did not answer`, {
              description: r.result.detail ?? 'The engine could not reach this model.',
            });
          }
        })
        .catch((e: unknown) => {
          toast.error('The engine is unreachable', {
            description: e instanceof Error ? e.message : String(e),
          });
        })
        .finally(() => setTesting(null));
      return;
    }
    // Hosted providers have no cheap per-model ping the engine trusts: a
    // "responded in N ms" toast was the fabrication this tab used to ship.
    toast.info('No live probe for hosted models', {
      description:
        'Test a provider when its key is saved (Configure → Test connection). A model ping would spend tokens.',
    });
  };

  const download = (m: ModelInfo): void => {
    if (!isTauri()) {
      // No engine and no runtime in a browser preview: say so instead of
      // faking a pull and marking a model installed.
      toast.error('Downloads run in the desktop app', {
        description: 'Model pulls go through the local engine — open XR and download there.',
      });
      return;
    }
    setPulling(m.id);
    void (async () => {
      let unlisten: (() => void) | null = null;
      let pullId = -1;
      // installLocal is only ever reached on the engine-side pull reporting
      // success — never on a timer, never on a browser stub.
      const finish = (ok: boolean, detail?: string): void => {
        unlisten?.();
        setPulling(null);
        if (ok) {
          void useBudgetStore.getState().installLocal(m.id);
          toast.success(`${m.name} ready`, {
            description: 'Available offline, $0 per call.',
          });
        } else {
          toast.error(`Could not download ${m.name}`, {
            description: detail ?? 'Ollama reported an error.',
          });
        }
      };
      try {
        const { listen } = await import('@tauri-apps/api/event');
        // listen BEFORE invoking — the pull starts on a worker thread.
        unlisten = await listen<PullProgressPayload>(
          'ollama://pull-progress',
          (event) => {
            const progress = event.payload;
            if (progress.id !== pullId) return;
            if (progress.status === 'success') finish(true);
            else if (progress.status === 'error')
              finish(false, progress.detail ?? undefined);
          }
        );
        pullId = await ollamaPull(m.id);
      } catch (err) {
        finish(
          false,
          err instanceof Error && err.message !== 'browser'
            ? err.message
            : 'Ollama is not reachable.'
        );
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
            {catalog.entries.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => setConfigFor(entry)}
              >
                {entry.engineKind === 'local' ? (
                  <Cpu size={13} aria-hidden="true" />
                ) : (
                  <Cloud size={13} aria-hidden="true" />
                )}
                {entry.name}
                {configuredProviders.has(entry.id) && (
                  <Check
                    size={12}
                    aria-hidden="true"
                    className="ml-auto opacity-70"
                  />
                )}
              </DropdownMenuItem>
            ))}
            {catalog.degraded ? (
              <DropdownMenuLabel className="text-warning text-[11px]">
                Engine unreachable — showing the built-in common providers.
              </DropdownMenuLabel>
            ) : null}
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
                const entry = entryFor(m.provider);
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
              onConfigure={() => {
                const entry = catalog.entries.find((e) => e.id === 'ollama');
                if (entry) setConfigFor(entry);
              }}
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
