/*
 * Settings → Models & Providers (Phase 8) — provider list with connection
 * status, a 12-entry add catalog, default-model-by-capability selects, and
 * the local-Ollama card (detect + pull with live progress).
 * Keys live in the OS keychain when available; otherwise they fall back to
 * the local store with a visible "local-insecure" warning.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  ProviderConfigModal,
  type ProviderCatalogEntry,
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
  Sparkles,
  Bot,
  Cpu,
  Brain,
  Boxes,
  Globe,
  Zap,
  Cloud,
  Flower2,
  Rocket,
  Wrench,
  Download,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isTauri } from '@/lib/tauri';
import {
  detectSystem,
  keychainDelete,
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

interface CatalogEntry extends ProviderCatalogEntry {
  icon: LucideIcon;
}

const CATALOG: CatalogEntry[] = [
  { id: 'openai', name: 'OpenAI', kind: 'openai-compatible', tagline: 'GPT-4o, o-series and more.', baseUrl: 'https://api.openai.com/v1', keysUrl: 'https://platform.openai.com/api-keys', icon: Sparkles },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', tagline: 'Claude models.', baseUrl: 'https://api.anthropic.com', keysUrl: 'https://console.anthropic.com/settings/keys', icon: Brain },
  { id: 'google', name: 'Google Gemini', kind: 'gemini', tagline: 'Gemini models.', baseUrl: 'https://generativelanguage.googleapis.com', keysUrl: 'https://aistudio.google.com/apikey', icon: Flower2 },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai-compatible', tagline: 'One key, every model.', baseUrl: 'https://openrouter.ai/api', keysUrl: 'https://openrouter.ai/keys', icon: Boxes },
  { id: 'ollama', name: 'Ollama (local)', kind: 'ollama', tagline: 'Local models on this machine — no key needed.', baseUrl: 'http://localhost:11434', keyless: true, icon: Cpu },
  { id: 'mistral', name: 'Mistral', kind: 'openai-compatible', tagline: 'Mistral and Codestral models.', baseUrl: 'https://api.mistral.ai/v1', keysUrl: 'https://console.mistral.ai/api-keys', icon: Cloud },
  { id: 'groq', name: 'Groq', kind: 'openai-compatible', tagline: 'Fast inference for open models.', baseUrl: 'https://api.groq.com/openai/v1', keysUrl: 'https://console.groq.com/keys', icon: Zap },
  { id: 'together', name: 'Together', kind: 'openai-compatible', tagline: 'Open models, hosted.', baseUrl: 'https://api.together.xyz/v1', keysUrl: 'https://api.together.ai/settings/api-keys', icon: Rocket },
  { id: 'xai', name: 'xAI', kind: 'openai-compatible', tagline: 'Grok models.', baseUrl: 'https://api.x.ai/v1', keysUrl: 'https://console.x.ai', icon: Bot },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai-compatible', tagline: 'DeepSeek chat and reasoner.', baseUrl: 'https://api.deepseek.com/v1', keysUrl: 'https://platform.deepseek.com/api_keys', icon: Globe },
  { id: 'cohere', name: 'Cohere', kind: 'openai-compatible', tagline: 'Command models.', baseUrl: 'https://api.cohere.com/compatibility/v1', keysUrl: 'https://dashboard.cohere.com/api-keys', icon: Wrench },
  { id: 'custom', name: 'Custom Endpoint', kind: 'custom', tagline: 'Any OpenAI-compatible base URL.', baseUrl: '', icon: Wrench },
];

const OLLAMA_ENTRY = CATALOG.find((entry) => entry.id === 'ollama')!;

const CAPABILITIES: Array<{ key: keyof CapabilityDefaults; label: string; hint?: string }> = [
  { key: 'chat', label: 'Chat', hint: 'The default for new conversations.' },
  { key: 'coding', label: 'Coding', hint: 'Used for code generation and review.' },
  { key: 'embeddings', label: 'Embeddings', hint: 'Powers search over your history.' },
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

interface CuratedModel { id: string; name: string; ram: number; sizeGb: number }
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

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [configFor, setConfigFor] = useState<CatalogEntry | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[] | null>(null);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullModel, setPullModel] = useState<string | null>(null);
  const [pullPct, setPullPct] = useState(0);
  const [totalRam, setTotalRam] = useState(0);

  const refreshOllama = useCallback((): void => {
    if (!isTauri()) return;
    setOllamaBusy(true);
    void ollamaDetect().then((info) => {
      setOllamaModels(info.models);
      setOllamaBusy(false);
    });
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    // initial probes resolve asynchronously — no spinner state to set here
    void detectSystem().then((info) => {
      setTotalRam(info?.totalMemoryGb ?? 0);
    });
    void ollamaDetect().then((info) => {
      setOllamaModels(info.models);
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

  const openProvider = (entry: CatalogEntry): void => {
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
      if (input.apiKey && keyStorage === 'local-insecure') {
        const { readSettingJSON, writeSettingJSON } = await import('@/lib/persistent-store');
        const keys = (await readSettingJSON<Record<string, string>>('xr.providerKeys')) ?? {};
        keys[input.id] = input.apiKey;
        await writeSettingJSON('xr.providerKeys', keys);
      }
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

  const removeProvider = (id: string): void => {
    void (async () => {
      void keychainDelete('xr', id);
      const { readSettingJSON, writeSettingJSON } = await import('@/lib/persistent-store');
      const keys = (await readSettingJSON<Record<string, string>>('xr.providerKeys')) ?? {};
      if (keys[id]) {
        delete keys[id];
        await writeSettingJSON('xr.providerKeys', keys);
      }
      update('models', {
        providers: providers.filter((provider) => provider.id !== id),
      });
      setConfigFor(null);
      toast.success('Provider removed');
    })();
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
            if (progress.total && progress.total > 0 && progress.completed !== null) {
              setPullPct(
                Math.min(100, Math.round((progress.completed / progress.total) * 100))
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
            <p className="text-text-secondary text-[13px]">No providers configured yet.</p>
            <p className="text-text-tertiary mt-1 text-xs">
              Add one below, or use Ollama to run models locally.
            </p>
            <Button size="sm" className="mt-3" onClick={() => setCatalogOpen(true)}>
              Add provider
            </Button>
          </div>
        ) : (
          <>
            {providers.map((provider) => {
              const entry = CATALOG.find((catalog) => catalog.id === provider.id);
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
                      ? provider.baseUrl ?? 'http://localhost:11434'
                      : provider.keyStorage === 'local-insecure'
                        ? 'Key stored locally (no OS keychain available)'
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
                  {insecureCount} {insecureCount === 1 ? 'key is' : 'keys are'} stored without
                  the OS keychain — a system keychain (Keychain / Credential Manager / Secret
                  Service) gives {insecureCount === 1 ? 'it' : 'them'} stronger protection.
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
            <p className="text-text-secondary text-[13px]">No models available yet.</p>
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
            <Button variant="ghost" size="sm" disabled={ollamaBusy} onClick={refreshOllama}>
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
        {ollamaModels !== null && !providers.some((provider) => provider.kind === 'ollama') ? (
          <div className="border-border-subtle border-t px-3.5 py-3">
            <Button variant="outline" size="sm" onClick={() => openProvider(OLLAMA_ENTRY)}>
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
            Bring a key from a provider, or run models locally with Ollama.
          </DialogDescription>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {CATALOG.map((entry) => {
              const Icon = entry.icon;
              const configured = providers.some((provider) => provider.id === entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => openProvider(entry)}
                  className="border-border-subtle bg-bg-raised hover:border-accent/50 flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
                >
                  <span className="border-border-subtle bg-bg-ink text-accent flex size-8 shrink-0 items-center justify-center rounded-md border">
                    <Icon size={15} strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-text-primary flex items-center gap-1.5 text-[13px] font-medium">
                      {entry.name}
                      {configured ? (
                        <Badge variant="secondary" className="text-[9px] uppercase">
                          Added
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-text-tertiary block truncate text-[11px]">
                      {entry.tagline}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Provider config ── */}
      {configFor ? (
        <ProviderConfigModal
          entry={configFor}
          existing={providers.find((provider) => provider.id === configFor.id) ?? null}
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
              const recommended = totalRam > 0 && totalRam >= model.ram && model.ram <= 16;
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
                        <Badge variant="secondary" className="text-[9px] uppercase">
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
