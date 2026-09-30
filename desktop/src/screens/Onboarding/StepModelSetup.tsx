import { ChevronDown, Cloud, Download, User } from 'lucide-react';
import { useEffect, useState } from 'react';

import { recommendModel } from '@/lib/detect';
import { useOnboardingStore } from '@/stores/onboarding';
import { OptionCard, Reveal, StepHeader } from './parts';

/**
 * Step 4 — model setup. The recommended local card is RAM-based (plan §4);
 * BYO key expands inline; guest mode continues without a model.
 */
export function StepModelSetup() {
  const { systemInfo, ollama, modelChoice, setModelChoice } = useOnboardingStore();
  const [cloudOpen, setCloudOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');

  const ram = systemInfo?.totalMemoryGb ?? 8;
  const rec = recommendModel(ram);

  // Default-select the recommendation on mount (user can change it).
  useEffect(() => {
    if (modelChoice.source === 'skip') {
      setModelChoice({ source: 'local', model: rec.model, label: rec.label });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const localSelected = modelChoice.source === 'local' && modelChoice.model === rec.model;

  return (
    <div>
      <StepHeader
        title="Pick a brain."
        sub="Run XR fully local with Ollama, connect a cloud key, or start as a guest."
      />

      <div className="space-y-3">
        <Reveal>
          <OptionCard
            selected={localSelected}
            onClick={() => setModelChoice({ source: 'local', model: rec.model, label: rec.label })}
            badge="Recommended"
            title={`${rec.label} · ${rec.model}`}
            desc={`Fits your ${ram} GB of RAM (~${rec.sizeGb} GB download). Private and offline.`}
            right={<Download aria-hidden="true" className="text-accent size-4 shrink-0" strokeWidth={1.5} />}
            ariaLabel={`Recommended local model ${rec.label}`}
          />
        </Reveal>

        <Reveal delay={0.07}>
          <OptionCard
            selected={modelChoice.source === 'cloud'}
            onClick={() => {
              setModelChoice(apiKey ? { source: 'cloud', apiKey } : { source: 'cloud' });
              setCloudOpen(true);
            }}
            title="Bring your own key"
            desc="OpenAI, Anthropic, or Groq. Paste the key now or later in Settings."
            right={<Cloud aria-hidden="true" className="text-accent size-4 shrink-0" strokeWidth={1.5} />}
          />
          {cloudOpen && modelChoice.source === 'cloud' && (
            <div className="border-border-subtle bg-bg-raised/40 mt-2 rounded-xl border p-3.5">
              <label className="text-text-tertiary mb-1.5 block text-[11px] font-semibold tracking-wide uppercase">
                API key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setModelChoice({ source: 'cloud', apiKey: e.target.value });
                }}
                placeholder="sk-…"
                autoComplete="off"
                className="border-border-default bg-bg-void text-text-primary placeholder:text-text-tertiary/60 w-full rounded-lg border px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
              />
              <p className="text-text-tertiary mt-2 text-[11.5px]">
                Stored locally only. Cloud calls stay off until you enable them.
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
            right={<User aria-hidden="true" className="text-accent size-4 shrink-0" strokeWidth={1.5} />}
          />
        </Reveal>
      </div>

      {ollama && !ollama.installed && (
        <Reveal delay={0.2}>
          <p className="text-warning mt-4 flex items-center gap-2 text-[12.5px]">
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.5} />
            Ollama isn't installed — the next step offers to help, or skip to guest mode.
          </p>
        </Reveal>
      )}
    </div>
  );
}
