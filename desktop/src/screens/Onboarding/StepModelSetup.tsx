import { ChevronDown, Cloud, Download, User } from 'lucide-react';
import { useMemo, useState } from 'react';

import { recommendModel } from '@/lib/detect';
import { useEngineStore } from '@/stores/engineStore';
import { useOnboardingStore } from '@/stores/onboarding';
import { OptionCard, Reveal, StepHeader } from './parts';

/**
 * Step 4 — model setup. The recommended local card is RAM-based (plan §4);
 * BYO key expands inline; guest mode continues without a model.
 * 2026-11-01: the provider list comes from the engine's live provider
 * catalog (every hosted preset it supports), not a hardcoded five.
 */
export function StepModelSetup() {
  const { systemInfo, ollama, modelChoice, setModelChoice, detectFailures } =
    useOnboardingStore();
  const engineProviders = useEngineStore(
    (state) => state.providers?.providers ?? null
  );
  const engineStatus = useEngineStore((state) => state.status);
  const startupError = useEngineStore((state) => state.lastError);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [providerId, setProviderId] = useState('openai');

  // Keyed, hosted providers only — local runtimes have their own card above
  // and keyless entries make no sense in a "bring a key" flow.
  //
  // XR-REL-05 — the list is the ENGINE's (26 presets today). It used to fall
  // back to a hardcoded five whenever the store was empty, which in practice
  // meant "always": nothing polled the engine outside the app shell, so
  // onboarding never had a provider list to show. The fallback is gone. While
  // the link is resolving the card says so; when the engine is unreachable it
  // says that, and offers a retry.
  const cloudProviders = useMemo(
    () =>
      (engineProviders ?? [])
        .filter((p) => p.kind !== 'local' && p.keyless !== true)
        .map((p) => ({ id: p.id, label: p.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [engineProviders]
  );
  const engineResolving =
    engineStatus === 'starting' && engineProviders === null;
  const engineUnavailable =
    !engineResolving && (engineProviders === null || cloudProviders.length === 0);

  // Keep the selection valid if the engine list lacks the default id.
  const effectiveProviderId = cloudProviders.some((p) => p.id === providerId)
    ? providerId
    : cloudProviders[0]?.id ?? '';

  const ram = systemInfo?.totalMemoryGb ?? null;
  // XR-REL-01 — no recommendation without a MEASURED machine. The old code
  // called recommendModel(ram ?? 0), which answers "0.5B" for an unknown
  // system and then offers to download it. Unknown hardware means: no card.
  const rec = ram && ram > 0 ? recommendModel(ram) : null;
  const hardwareUnknown = ram === null || !(ram > 0);

  const localSelected =
    rec !== null &&
    modelChoice.source === 'local' &&
    modelChoice.model === rec.model;

  return (
    <div>
      <StepHeader
        title="Pick a brain."
        sub="Run XR fully local with Ollama, connect a cloud key, or start as a guest."
      />

      <div className="space-y-3">
        <Reveal>
          {rec ? (
            <OptionCard
              selected={localSelected}
              onClick={() =>
                setModelChoice({
                  source: 'local',
                  model: rec.model,
                  label: rec.label,
                })
              }
              badge="Local candidate"
              title={`${rec.label} · ${rec.model}`}
              desc={`${ram} GB RAM detected · ~${rec.sizeGb} GB download only if selected. Runtime/tool compatibility not yet verified.`}
              right={
                <Download
                  aria-hidden="true"
                  className="text-accent size-4 shrink-0"
                  strokeWidth={1.5}
                />
              }
              ariaLabel={`Recommended local model ${rec.label}`}
            />
          ) : (
            <div className="border-border-subtle bg-bg-raised/40 rounded-xl border p-3.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-text-primary block text-[14px] font-medium">
                    Local model — not recommended yet
                  </span>
                  <span className="text-text-tertiary mt-0.5 block text-[12.5px] leading-relaxed">
                    {hardwareUnknown
                      ? (detectFailures.system ??
                        'Your RAM could not be measured, so XR will not guess a model size.')
                      : 'RAM reading was not usable, so XR will not guess a model size.'}{' '}
                    Pick a model later in Settings → Models, or connect a cloud
                    key now.
                  </span>
                </div>
              </div>
            </div>
          )}
        </Reveal>

        <Reveal delay={0.07}>
          <OptionCard
            selected={modelChoice.source === 'cloud'}
            onClick={() => {
              setModelChoice(
                apiKey
                  ? { source: 'cloud', providerId: effectiveProviderId, apiKey }
                  : { source: 'cloud', providerId: effectiveProviderId }
              );
              setCloudOpen(true);
            }}
            title="Bring your own key"
            desc="Choose the provider explicitly. Reachability and agent compatibility are separate from saving a key."
            right={
              <Cloud
                aria-hidden="true"
                className="text-accent size-4 shrink-0"
                strokeWidth={1.5}
              />
            }
          />
          {cloudOpen && modelChoice.source === 'cloud' && (
            <div className="border-border-subtle bg-bg-raised/40 mt-2 rounded-xl border p-3.5">
              <label
                htmlFor="setup-provider"
                className="text-text-tertiary mb-1 block text-xs"
              >
                Provider
              </label>
              {engineResolving ? (
                <p
                  className="text-text-tertiary mb-3 text-[12.5px]"
                  data-testid="setup-provider-loading"
                  aria-live="polite"
                >
                  Waiting for the local engine to list its providers…
                </p>
              ) : engineUnavailable ? (
                <div
                  className="border-warning/40 bg-warning/5 mb-3 rounded-lg border p-2.5"
                  data-testid="setup-provider-unavailable"
                >
                  <p className="text-warning text-[12px] font-medium">
                    The engine has not listed any providers yet.
                  </p>
                  <p className="text-text-tertiary mt-1 text-[11.5px] leading-relaxed">
                    {startupError ??
                      'Provider keys are stored by the engine, so it has to be running before one can be saved.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void useEngineStore.getState().refresh()}
                    className="text-accent hover:text-accent-hover mt-1.5 text-[11.5px] font-medium"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <select
                  id="setup-provider"
                  value={effectiveProviderId}
                  onChange={(event) => {
                    setProviderId(event.target.value);
                    setModelChoice({
                      source: 'cloud',
                      providerId: event.target.value,
                      apiKey,
                    });
                  }}
                  className="border-border-default bg-bg-void text-text-primary mb-3 w-full rounded border p-2 text-sm"
                  data-testid="setup-provider-select"
                >
                  {cloudProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
              <label className="text-text-tertiary mb-1.5 block text-[11px] font-semibold tracking-wide uppercase">
                API key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setModelChoice({
                    source: 'cloud',
                    providerId: effectiveProviderId,
                    apiKey: e.target.value,
                  });
                }}
                placeholder="sk-…"
                autoComplete="off"
                className="border-border-default bg-bg-void text-text-primary placeholder:text-text-tertiary/60 focus:border-accent w-full rounded-lg border px-3 py-2 font-mono text-[13px] outline-none"
              />
              <p className="text-text-tertiary mt-2 text-[11.5px]">
                Stored only through the engine secret broker, never ordinary
                settings. Future prompts use your chosen provider. No live probe
                or cross-provider fallback is enabled here.
              </p>
            </div>
          )}
        </Reveal>

        <Reveal delay={0.14}>
          <OptionCard
            selected={modelChoice.source === 'skip'}
            onClick={() => setModelChoice({ source: 'skip' })}
            title="Continue as guest"
            desc="Explore XR first — choose a model anytime from Settings."
            right={
              <User
                aria-hidden="true"
                className="text-accent size-4 shrink-0"
                strokeWidth={1.5}
              />
            }
          />
        </Reveal>
      </div>

      {ollama === null && detectFailures.ollama && (
        <Reveal delay={0.2}>
          <p className="text-text-tertiary mt-4 flex items-center gap-2 text-[12.5px]">
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0"
              strokeWidth={1.5}
            />
            {detectFailures.ollama} Local mode needs Ollama; you can connect a
            cloud key or continue as a guest instead.
          </p>
        </Reveal>
      )}

      {ollama && !ollama.installed && (
        <Reveal delay={0.2}>
          <p className="text-warning mt-4 flex items-center gap-2 text-[12.5px]">
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0"
              strokeWidth={1.5}
            />
            Ollama isn't installed — the next step offers to help, or skip to
            guest mode.
          </p>
        </Reveal>
      )}
    </div>
  );
}
