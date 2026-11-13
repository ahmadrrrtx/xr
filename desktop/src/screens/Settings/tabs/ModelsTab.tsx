/*
 * Settings → Models & Providers (Phase 8) — provider list with connection
 * status, the add catalog (2026-11-01: derived LIVE from the engine's
 * provider list — 26 presets + custom, not a hardcoded subset), default-
 * model-by-capability selects, and the local-Ollama card (detect + pull
 * with live progress).
 * Keys are held by the engine secret broker, never generic desktop settings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  ProviderConfigModal,
} from '@/components/settings/ProviderConfigModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { Select } from '@/components/settings/controls';
import {
  Boxes,
  Download,
} from 'lucide-react';
import {
  buildProviderCatalog,
  type ProviderCatalogEntryUi,
} from '@/engine/providerCatalog';
import { useEngineStore } from '@/stores/engineStore';
import { isTauri } from '@/lib/tauri';
import {
  detectSystem,
  ollamaDetect,
  ollamaPull,
  openUrl,
  type OllamaModelInfo,
  type ProviderTestResult,
  type PullProgressPayload,
} from '@/lib/settingsApi';
import type { ProviderConfig, ProviderKind } from '@/stores/settingsStore';
import { useSettingsStore } from '@/stores/settingsStore';

/* ── Catalog (12) ─────────────────────────────────────────────── */


const CAPABILITIES: Array<{
  key: keyof CapabilityDefaults;
  label: string;
  hint?: string;
}> = [
  { key: 'chat', label: 'Chat', hint: 'The default for new conversations.' },
  {
    key: 'coding',
    label: 'Coding',
    hint: 'Used for code generation and review.',
  },
  {
    key: 'embeddings',
    label: 'Embeddings',
    hint: 'Powers search over your history.',
  },
  { key: 'vision', label: 'Vision', hint: 'Reading images and screenshots.' },
  { key: 'stt', label: 'Speech to text' },
  { key: 'tts', label: 'Text to speech' },
];

type CapabilityDefaults = {
  chat: string;
  coding: string;
  embeddings: string;
  vision: string;
  stt: string;
  tts: string;
};

/* ── Ollama curated models ────────────────────────────────────── */

interface CuratedModel {
  id: string;
  name: string;
  ram: number;
  sizeGb: number;
}
const CURATED: CuratedModel[] = [
  { id: 'gemma2:2b', name: 'Gemma 2 2B', ram: 8, sizeGb: 1.6 },
  { id: 'qwen2.5:3b', name: 'Qwen 2.5 3B', ram: 8, sizeGb: 1.9 },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', ram: 8, sizeGb: 2.0 },
  { id: 'mistral:7b', name: 'Mistral 7B', ram: 16, sizeGb: 4.1 },
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', ram: 16, sizeGb: 4.7 },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', ram: 16, sizeGb: 4.7 },
  { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', ram: 16, sizeGb: 4.7 },
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', ram: 48, sizeGb: 40 },
];

export function ModelsTab() {
  const models = useSettingsStore((state) => state.settings.models);
  const update = useSettingsStore((state) => state.update);
  const engineProviders = useEngineStore((state) => state.providers?.providers ?? null);

  // The add-provider catalog comes from the ENGINE (26 presets + any custom
  // providers), merged with presentation metadata — see engine/providerCatalog.
  const catalog = useMemo(
    () => buildProviderCatalog(engineProviders),
    [engineProviders]
  );
  const CATALOG = catalog.entries;
  const OLLAMA_ENTRY = CATALOG.find((entry) => entry.id === 'ollama');

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [configFor, setConfigFor] = useState<ProviderCatalogEntryUi | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[] | null>(
    null
  );
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullModel, setPullModel] = useState<string | null>(null);
  const [pullPct, setPullPct] = useState(0);
  const [totalRam, setTotalRam] = useState(0);

  const refreshOllama = useCallback((): void => {
    if (!isTauri()) return;
    setOllamaBusy(true);
    void ollamaDetect()
      .then((info) => {
        setOllamaModels(info.models);
        setOllamaBusy(false);
      })
      .catch((error: unknown) => {
        setOllamaModels(null);
        setOllamaBusy(false);
        console.warn('[xr] ollamaDetect failed', error);
      });
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    // initial probes resolve asynchronously — no spinner state to set here
    // XR-REL-01 — a failed probe leaves the value UNKNOWN (0 = not measured),
    // never a substituted number. The RAM line then says so instead of tuning
    // recommendations to a machine we never read.
    void detectSystem()
      .then((info) => {
        setTotalRam(info?.totalMemoryGb ?? 0);
      })
      .catch((error: unknown) => {
        setTotalRam(0);
        console.warn('[xr] detectSystem failed', error);
      });
    void ollamaDetect()
      .then((info) => {
        setOllamaModels(info.models);
      })
      .catch((error: unknown) => {
        setOllamaModels(null);
        console.warn('[xr] ollamaDetect failed', error);
      });
  }, []);

  const providers = models.providers;
  const hasProviders = providers.length > 0;
  const insecureCount = providers.filter(
    (provider) => provider.keyStorage === 'local-insecure'
  ).length;

  const modelOptions = (): Array<{ value: string; label: string }> => [
    ...providers.map((provider) => ({
      value: provider.id,
      label: provider.name,
    })),
    ...(ollamaModels ?? []).map((model) => ({
      value: `ollama:${model.name}`,
      label: `Ollama · ${model.name}`,
    })),
  ];

  const openProvider = (entry: ProviderCatalogEntryUi): void => {
    setCatalogOpen(false);
    setConfigFor(entry);
  };

  const saveProvider = (input: {
    id: string;
    kind: ProviderKind;
    name: string;
    baseUrl: string | null;
    model: string | null;
    apiKey: string | null;
    keyStorage: ProviderConfig['keyStorage'];
    test: ProviderTestResult | null;
  }): void => {
    void (async () => {
      const keyStorage = input.keyStorage;

      const next = providers.filter((provider) => provider.id !== input.id);
      next.push({
        id: input.id,
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl ?? undefined,
        model: input.model ?? undefined,
        addedAt: existingAddedAt(input.id, providers) ?? Date.now(),
        keyStorage,
        lastTest: input.test
          ? {
              ok: input.test.ok,
              at: Date.now(),
              latencyMs: input.test.latencyMs,
              message: input.test.message,
            }
          : undefined,
      });
      update('models', { providers: next });
      setConfigFor(null);
      toast.success(`${input.name} saved`);
    })();
  };

  const removeProvider = async (id: string): Promise<void> => {
    const existing = providers.find((p) => p.id === id);
    let notice =
      'Desktop entry removed; review external credentials separately.';
    if (existing?.keyStorage === 'engine') {
      const { removeProviderKeyFromEngine } =
        await import('@/engine/providers');
      notice = (await removeProviderKeyFromEngine(id)).notice;
    } else if (existing?.keyStorage === 'keychain') {
      const { keychainDelete } = await import('@/lib/settingsApi');
      await keychainDelete('xr', id);
    } else if (existing?.keyStorage === 'local-insecure') {
      const { purgeLegacyCredentialSettings } =
        await import('@/lib/persistent-store');
      await purgeLegacyCredentialSettings();
    }
    update('models', { providers: providers.filter((p) => p.id !== id) });
    setConfigFor(null);
    toast.success('Stored entry removed', { description: notice });
  };

  const pull = (model: string): void => {
    setPullModel(model);
    setPullPct(0);
    void (async () => {
      let unlisten: (() => void) | null = null;
      let pullId = -1;
      const finish = (ok: boolean, detail?: string): void => {
        unlisten?.();
        setPullModel(null);
        if (ok) {
          setPullOpen(false);
          toast.success(`${model} downloaded`);
          refreshOllama();
        } else {
          toast.error(`Could not download ${model}`, { description: detail });
        }
      };
      try {
        const { listen } = await import('@tauri-apps/api/event');
        // listen BEFORE invoking — the pull runs on a worker thread at once
        unlisten = await listen<PullProgressPayload>(
          'ollama://pull-progress',
          (event) => {
            const progress = event.payload;
            if (progress.id !== pullId) return;
            if (
              progress.total &&
              progress.total > 0 &&
              progress.completed !== null
            ) {
              setPullPct(
                Math.min(
                  100,
                  Math.round((progress.completed / progress.total) * 100)
                )
              );
            }
            if (progress.status === 'success') {
              finish(true);
            } else if (progress.status === 'error') {
              finish(false, progress.detail ?? 'Ollama reported an error.');
            }
          }
        );
        pullId = await ollamaPull(model);
      } catch {
        finish(false, 'Check your connection and disk space, then try again.');
      }
    })();
  };

  return (
    <div>
      {/* ── Providers ── */}
      <SettingsSection title="Providers">
        {!hasProviders ? (
          <div className="px-3.5 py-6 text-center">
            <p className="text-text-secondary text-[13px]">
              No providers configured yet.
            </p>
            <p className="text-text-tertiary mt-1 text-xs">
              Add one below, or use Ollama to run models locally.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => setCatalogOpen(true)}
            >
              Add provider
            </Button>
          </div>
        ) : (
          <>
            {providers.map((provider) => {
              const entry = CATALOG.find(
                (catalog) => catalog.id === provider.id
              );
              const Icon = entry?.icon ?? Boxes;
              const connected = provider.lastTest?.ok === true;
              return (
                <SettingRow
                  key={provider.id}
                  label={
                    <span className="flex items-center gap-2.5">
                      <span className="border-border-subtle bg-bg-raised text-accent flex size-7 shrink-0 items-center justify-center rounded-md border">
                        <Icon size={14} strokeWidth={1.5} />
                      </span>
                      <span className="text-text-primary text-[13px] font-medium">
                        {provider.name}
                      </span>
                      <span
                        aria-label={connected ? 'Connected' : 'Saved'}
                        title={
                          connected
                            ? `Connected · ${provider.lastTest?.latencyMs ?? '–'}ms`
                            : 'Saved — use Test connection to verify'
                        }
                        className={
                          connected
                            ? 'bg-success size-1.5 shrink-0 rounded-full'
                            : 'bg-text-quaternary size-1.5 shrink-0 rounded-full'
                        }
                      />
                    </span>
                  }
                  description={
                    provider.kind === 'ollama'
                      ? (provider.baseUrl ?? 'http://localhost:11434')
                      : provider.keyStorage === 'local-insecure'
                        ? 'Key stored locally (no OS keychain available)'
                        : provider.keyStorage === 'engine'
                          ? 'engine secret broker'
                          : provider.keyStorage === 'keychain'
                            ? 'Key in OS keychain'
                            : 'Saved'
                  }
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      openProvider(
                        entry ?? {
                          id: provider.id,
                          name: provider.name,
                          kind: provider.kind,
                          tagline: 'Configured provider.',
                          baseUrl: provider.baseUrl ?? '',
                          icon: Boxes,
                          engineKind: 'custom',
                          hasKey: false,
                          healthy: false,
                        }
                      )
                    }
                  >
                    Configure
                  </Button>
                </SettingRow>
              );
            })}
            <div className="px-3.5 py-3">
              <Button size="sm" onClick={() => setCatalogOpen(true)}>
                Add provider
              </Button>
              {insecureCount > 0 ? (
                <p className="text-warning mt-2 max-w-[60ch] text-[11px]">
                  {insecureCount} {insecureCount === 1 ? 'key is' : 'keys are'}{' '}
                  stored without the OS keychain — a system keychain (Keychain /
                  Credential Manager / Secret Service) gives{' '}
                  {insecureCount === 1 ? 'it' : 'them'} stronger protection.
                </p>
              ) : null}
            </div>
          </>
        )}
      </SettingsSection>

      {/* ── Default models ── */}
      <SettingsSection title="Default models">
        {!hasProviders && (ollamaModels ?? []).length === 0 ? (
          <div className="px-3.5 py-5 text-center">
            <p className="text-text-secondary text-[13px]">
              No models available yet.
            </p>
            <button
              type="button"
              className="text-accent mt-1 text-xs hover:underline"
              onClick={() => setCatalogOpen(true)}
            >
              Add a provider to get started
            </button>
          </div>
        ) : (
          CAPABILITIES.map((capability) => (
            <SettingRow
              key={capability.key}
              label={capability.label}
              description={capability.hint}
            >
              <Select
                ariaLabel={`${capability.label} model`}
                value={models.defaults[capability.key] ?? ''}
                placeholder="Default"
                options={modelOptions()}
                onChange={(value) =>
                  update('models', {
                    defaults: { ...models.defaults, [capability.key]: value },
                  })
                }
              />
            </SettingRow>
          ))
        )}
      </SettingsSection>

      {/* ── Ollama (local) ── */}
      <SettingsSection title="Ollama (local)">
        <SettingRow
          label="Local models"
          description={
            ollamaModels === null
              ? 'Not detected. Install Ollama, then check again.'
              : ollamaModels.length === 0
                ? 'Running — no models pulled yet.'
                : `${ollamaModels.length} models available (${ollamaModels
                    .map((model) => model.name)
                    .slice(0, 3)
                    .join(', ')}${ollamaModels.length > 3 ? '…' : ''})`
          }
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={ollamaBusy}
              onClick={refreshOllama}
            >
              {ollamaBusy ? 'Checking…' : 'Check again'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void openUrl('https://ollama.com/download')}
            >
              Get Ollama
            </Button>
          </div>
        </SettingRow>
        {ollamaModels !== null &&
        !providers.some((provider) => provider.kind === 'ollama') ? (
          <div className="border-border-subtle border-t px-3.5 py-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!OLLAMA_ENTRY}
              onClick={() => OLLAMA_ENTRY && openProvider(OLLAMA_ENTRY)}
            >
              Use Ollama in XR
            </Button>
          </div>
        ) : null}
        <SettingRow
          label="Download models"
          description={
            totalRam > 0
              ? `Your machine: ${totalRam} GB RAM — recommendations are tuned to it.`
              : 'Picks based on your available RAM.'
          }
        >
          <Button variant="ghost" size="sm" onClick={() => setPullOpen(true)}>
            Browse…
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Add provider catalog ── */}
      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="border-border-subtle bg-bg-ink sm:max-w-lg">
          <DialogTitle className="text-text-primary text-base font-semibold">
            Add a provider
          </DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {catalog.degraded
              ? 'Engine offline — showing the basic set. Start the engine for every provider it supports.'
              : `${catalog.counts.hosted} hosted + ${catalog.counts.local} local runtimes from the engine, plus a custom endpoint.`}
          </DialogDescription>
          <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1" data-testid="provider-catalog">
            {(['hosted', 'local', 'custom'] as const).map((group) => {
              const groupEntries = CATALOG.filter((entry) =>
                group === 'custom'
                  ? entry.engineKind === 'custom'
                  : group === 'local'
                    ? entry.engineKind === 'local'
                    : entry.engineKind === 'hosted' || entry.engineKind === 'cloud'
              );
              if (groupEntries.length === 0) return null;
              return (
                <div key={group} className="mb-3">
                  <p className="text-text-tertiary mb-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase">
                    {group === 'hosted' ? 'Hosted APIs' : group === 'local' ? 'Local runtimes' : 'Custom'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {groupEntries.map((entry) => {
                      const Icon = entry.icon;
                      const configured = providers.some(
                        (provider) => provider.id === entry.id
                      );
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => openProvider(entry)}
                          data-testid={`provider-catalog-${entry.id}`}
                          className="border-border-subtle bg-bg-raised hover:border-accent/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
                        >
                          <span className="border-border-subtle bg-bg-ink text-accent flex size-8 shrink-0 items-center justify-center rounded-md border">
                            <Icon size={15} strokeWidth={1.5} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-text-primary flex items-center gap-1.5 text-[13px] font-medium">
                              {entry.name}
                              {configured ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] uppercase"
                                >
                                  Added
                                </Badge>
                              ) : null}
                            </span>
                            <span className="text-text-tertiary block truncate text-[11px]">
                              {entry.keyless ? 'No key needed' : entry.tagline}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Provider config ── */}
      {configFor ? (
        <ProviderConfigModal
          entry={configFor}
          existing={
            providers.find((provider) => provider.id === configFor.id) ?? null
          }
          open
          onOpenChange={(open) => {
            if (!open) setConfigFor(null);
          }}
          onSave={(input) => saveProvider(input)}
          onRemove={removeProvider}
        />
      ) : null}

      {/* ── Ollama pull dialog ── */}
      <Dialog open={pullOpen} onOpenChange={setPullOpen}>
        <DialogContent className="border-border-subtle bg-bg-ink sm:max-w-md">
          <DialogTitle className="text-text-primary text-base font-semibold">
            Download local models
          </DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            Downloaded once, then available offline.
          </DialogDescription>
          <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
            {CURATED.map((model) => {
              const pulling = pullModel === model.id;
              const recommended =
                totalRam > 0 && totalRam >= model.ram && model.ram <= 16;
              const tooBig = totalRam > 0 && totalRam < model.ram;
              return (
                <div
                  key={model.id}
                  className="border-border-subtle bg-bg-raised flex items-center gap-3 rounded-lg border p-3"
                >
                  <Download
                    size={14}
                    strokeWidth={1.5}
                    className="text-text-tertiary shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary flex items-center gap-1.5 text-[13px] font-medium">
                      {model.name}
                      {recommended ? (
                        <Badge
                          variant="secondary"
                          className="text-[9px] uppercase"
                        >
                          Recommended
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-text-tertiary text-[11px]">
                      {model.sizeGb.toFixed(1)} GB · needs ~{model.ram} GB RAM
                      {tooBig ? ' — more than you have' : ''}
                    </p>
                    {pulling ? (
                      <div className="bg-bg-ink mt-2 h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-accent h-full rounded-full transition-[width] duration-300"
                          style={{ width: `${Math.max(3, pullPct)}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant={pullModel ? 'ghost' : 'outline'}
                    disabled={pullModel !== null || tooBig}
                    onClick={() => pull(model.id)}
                  >
                    {pulling ? `${pullPct}%` : 'Download'}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function existingAddedAt(
  id: string,
  providers: ProviderConfig[]
): number | null {
  return providers.find((provider) => provider.id === id)?.addedAt ?? null;
}
