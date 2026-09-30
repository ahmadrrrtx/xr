import { useState } from 'react';

import { BUDGET_STEPS, useOnboardingStore } from '@/stores/onboarding';
import { THEMES, THEME_LABELS, type ThemeId } from '@/stores/theme';
import { Reveal, StepHeader } from './parts';

/**
 * Step 8 — preferences. Name (used in greetings), theme (swatches preview
 * the REAL page behind the modal — applyTheme runs live), and monthly budget
 * snapped to $0/2/5/10/20/50.
 */
export function StepPrefs() {
  const { userName, setUserName, theme, setTheme, budget, setBudget } = useOnboardingStore();
  const [budgetIdx, setBudgetIdx] = useState(() => {
    const i = BUDGET_STEPS.indexOf(budget);
    return i === -1 ? 2 : i; // default $5
  });

  return (
    <div>
      <StepHeader title="Make it yours." sub="Three quick preferences — all changeable later in Settings." />

      <Reveal>
        <label htmlFor="pref-name" className="text-text-tertiary mb-1.5 block text-[11px] font-semibold tracking-wide uppercase">
          What should XR call you?
        </label>
        <input
          id="pref-name"
          type="text"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="Your name (or leave blank)"
          maxLength={24}
          className="border-border-default bg-bg-void text-text-primary placeholder:text-text-tertiary/60 w-full max-w-[320px] rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-5">
          <span className="text-text-tertiary mb-2 block text-[11px] font-semibold tracking-wide uppercase">
            Theme — watch the page behind
          </span>
          <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Theme">
            {THEMES.map((t: ThemeId) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                aria-label={`Theme ${THEME_LABELS[t]}`}
                onClick={() => setTheme(t)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors ${
                  theme === t ? 'border-accent' : 'border-border-subtle hover:border-border-default'
                }`}
                style={theme === t ? { boxShadow: '0 0 0 1px var(--accent)' } : undefined}
              >
                {/* Swatch: resolves --bg-void against ITS OWN theme via data-theme */}
                <span
                  aria-hidden="true"
                  data-theme={t}
                  className="border-border-subtle size-4 rounded-full border"
                  style={{ backgroundColor: 'var(--bg-void)' }}
                />
                <span className="text-text-primary">{THEME_LABELS[t]}</span>
              </button>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.16}>
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="pref-budget" className="text-text-tertiary text-[11px] font-semibold tracking-wide uppercase">
              Monthly cloud budget
            </label>
            <span className="text-text-secondary font-mono text-[12px]">
              ${BUDGET_STEPS[budgetIdx] ?? 5}{BUDGET_STEPS[budgetIdx] === 0 ? '' : ' / mo'}
            </span>
          </div>
          <input
            id="pref-budget"
            type="range"
            min={0}
            max={BUDGET_STEPS.length - 1}
            step={1}
            value={budgetIdx}
            onChange={(e) => {
              const i = Number(e.target.value);
              setBudgetIdx(i);
              setBudget(BUDGET_STEPS[i] ?? 5);
            }}
            list="budget-stops"
            className="accent-accent w-full max-w-[420px]"
          />
          <datalist id="budget-stops">
            {BUDGET_STEPS.map((b) => (
              <option key={b} value={BUDGET_STEPS.indexOf(b)} label={`$${b}`} />
            ))}
          </datalist>
          <p className="text-text-tertiary mt-1.5 text-[11.5px]">
            XR asks before anything crosses this line. $0 = fully local.
          </p>
        </div>
      </Reveal>
    </div>
  );
}
