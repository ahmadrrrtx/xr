import { toast } from 'sonner';

import { useOnboardingStore } from '@/stores/onboarding';
import { Reveal, StepHeader } from './parts';

const INTEGRATIONS = [
  { id: 'github', name: 'GitHub' },
  { id: 'notion', name: 'Notion' },
  { id: 'slack', name: 'Slack' },
  { id: 'linear', name: 'Linear' },
  { id: 'figma', name: 'Figma' },
  { id: 'gcal', name: 'Google Calendar' },
];

/**
 * Step 9 — integrations. Chips are wish-list flags (persisted as
 * desiredIntegrations); real OAuth connects land in Phase 22.
 */
export function StepIntegrations() {
  const { desiredIntegrations, toggleIntegration } = useOnboardingStore();

  return (
    <div>
      <StepHeader
        title="Connect your world — later."
        sub="Pick what you'd like XR to plug into. No sign-ins today; we'll remember your picks."
      />

      <div className="flex flex-wrap gap-2.5">
        {INTEGRATIONS.map((intg, i) => {
          const on = desiredIntegrations.includes(intg.id);
          return (
            <Reveal key={intg.id} delay={0.04 * i}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => {
                  toggleIntegration(intg.id);
                  if (!on) {
                    toast(`${intg.name} connects in Phase 22…`, {
                      description: 'We\u2019ve noted your interest — real OAuth arrives with the Integrations phase.',
                    });
                  }
                }}
                className={`rounded-full border px-4 py-2 text-[13px] font-medium transition-colors ${
                  on
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary'
                }`}
              >
                {on ? `✓ ${intg.name}` : intg.name}
              </button>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.3}>
        <p className="text-text-tertiary mt-6 text-[12.5px] leading-relaxed">
          Nothing connects now and nothing is shared. Your picks are saved locally so the
          Integrations screen starts where you left off.
        </p>
      </Reveal>
    </div>
  );
}
