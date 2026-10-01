/*
 * ProviderConfigModal (Phase 8) — configure one model provider: masked key
 * input (or Ollama host), a real list-models ping, and a keychain-backed
 * save. When the OS keychain is unavailable the key falls back to the
 * clearly-flagged local store and the caller shows a warning badge.
 */
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import {
  keychainSet,
  testProviderConnection,
  type ProviderTestResult,
} from '@/lib/settingsApi';
import type { ProviderConfig, ProviderKind } from '@/stores/settingsStore';

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  kind: ProviderKind;
  tagline: string;
  baseUrl: string;
  /** Ollama needs no key. */
  keyless?: boolean;
  keysUrl?: string;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; result: ProviderTestResult };

export interface ProviderSaveInput {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  keyStorage: ProviderConfig['keyStorage'];
  test: ProviderTestResult | null;
}

export function ProviderConfigModal({
  entry,
  existing,
  open,
  onOpenChange,
  onSave,
  onRemove,
}: {
  entry: ProviderCatalogEntry;
  existing: ProviderConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: ProviderSaveInput) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Radix unmounts content while closed, so the form state below
          initializes fresh from props on every open — no reset effect. */}
      <DialogContent className="border-border-subtle bg-bg-ink sm:max-w-[440px]">
        <ProviderForm
          entry={entry}
          existing={existing}
          onSave={onSave}
          onRemove={onRemove}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProviderForm({
  entry,
  existing,
  onSave,
  onRemove,
  onClose,
}: {
  entry: ProviderCatalogEntry;
  existing: ProviderConfig | null;
  onSave: (input: ProviderSaveInput) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? entry.baseUrl);
  const [model, setModel] = useState(existing?.model ?? '');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);

  const isOllama = entry.kind === 'ollama';
  const isCustom = entry.kind === 'custom';
  const canSave = isOllama || apiKey.trim().length > 0 || existing !== null;

  const runTest = (): void => {
    setTest({ status: 'testing' });
    void testProviderConnection(
      entry.kind,
      baseUrl.trim() || null,
      apiKey.trim() || null
    ).then((result) => {
      setTest({
        status: 'done',
        result:
          result ?? {
            ok: false,
            message: 'Test unavailable in the browser preview.',
            latencyMs: 0,
            models: [],
          },
      });
    });
  };

  const save = (): void => {
    setSaving(true);
    void (async () => {
      const keyStorage: ProviderConfig['keyStorage'] =
        !isOllama && apiKey.trim().length > 0
          ? (await keychainSet('xr', entry.id, apiKey.trim())).status === 'ok'
            ? 'keychain'
            : 'local-insecure' // caller stores the key + shows the badge
          : 'none';
      onSave({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        baseUrl: isOllama || isCustom ? baseUrl.trim() || null : null,
        model: isCustom && model.trim() ? model.trim() : null,
        apiKey: !isOllama && apiKey.trim() ? apiKey.trim() : null,
        keyStorage,
        test: test.status === 'done' && test.result.ok ? test.result : null,
      });
      setSaving(false);
    })();
  };

  return (
    <>
      <DialogTitle className="text-text-primary text-base font-semibold">
        Configure {entry.name}
      </DialogTitle>
      <DialogDescription className="text-text-tertiary text-xs">
        {entry.tagline}
      </DialogDescription>

      <div className="mt-2 grid gap-3.5">
        {isOllama ? (
          <div>
            <label htmlFor="xr-provider-base" className="text-text-tertiary mb-1 block text-xs">
              Host URL
            </label>
            <Input
              id="xr-provider-base"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://localhost:11434"
              className="bg-bg-raised h-8 font-mono text-xs"
              spellCheck={false}
            />
          </div>
        ) : (
          <>
            {isCustom ? (
              <div>
                <label htmlFor="xr-provider-base" className="text-text-tertiary mb-1 block text-xs">
                  Base URL
                </label>
                <Input
                  id="xr-provider-base"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://your-endpoint/v1"
                  className="bg-bg-raised h-8 font-mono text-xs"
                  spellCheck={false}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor="xr-provider-key" className="text-text-tertiary mb-1 block text-xs">
                API key
              </label>
              <div className="relative">
                <Input
                  id="xr-provider-key"
                  type={revealed ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={existing ? 'Saved — enter a new key to replace' : 'sk-…'}
                  className="bg-bg-raised h-8 pr-9 font-mono text-xs"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
                  onClick={() => setRevealed((v) => !v)}
                  className="text-text-tertiary hover:text-text-primary absolute top-1/2 right-2.5 -translate-y-1/2"
                >
                  {revealed ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                </button>
              </div>
              {entry.keysUrl ? (
                <a
                  href={entry.keysUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent mt-1.5 inline-block text-[11px] hover:underline"
                >
                  Get an API key ↗
                </a>
              ) : null}
            </div>
            {isCustom ? (
              <div>
                <label htmlFor="xr-provider-model" className="text-text-tertiary mb-1 block text-xs">
                  Default model
                </label>
                <Input
                  id="xr-provider-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gpt-4o-mini"
                  className="bg-bg-raised h-8 font-mono text-xs"
                  spellCheck={false}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      {test.status === 'done' ? (
        <div
          role="status"
          className={
            test.result.ok
              ? 'border-success/40 bg-success/10 text-success rounded-md border px-3 py-2 text-xs'
              : 'border-danger/40 bg-danger/10 text-danger rounded-md border px-3 py-2 text-xs'
          }
        >
          <span className="font-medium">
            {test.result.ok ? 'Connected' : 'Test failed'}
          </span>
          {' — '}
          {test.result.message}
          {test.result.ok && test.result.models.length > 0 ? (
            <span className="text-text-secondary">
              {' '}
              ({test.result.models.length} models visible)
            </span>
          ) : null}
        </div>
      ) : null}

      <DialogFooter className="gap-2">
        {existing ? (
          <Button
            variant="ghost"
            onClick={() => {
              onRemove(entry.id);
              toast.success(`${entry.name} removed`);
            }}
          >
            Remove
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="outline"
          disabled={test.status === 'testing' || (!isOllama && !apiKey.trim() && !existing)}
          onClick={runTest}
        >
          {test.status === 'testing' ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Testing…
            </>
          ) : (
            'Test connection'
          )}
        </Button>
        <Button disabled={!canSave || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}
