/*
 * StageRail (UI-redesign 2026-10-29) — the slim stage strip that tops the
 * research main column: Plan → Search → Read → Synthesize, driven by the
 * run's real phase (planSteps), plus an Evidence shortcut that scrolls to
 * the evidence matrix once a report exists.
 *
 * No invented progress: a stage is "done" only when the engine's phase has
 * passed it; while idle the rail hides.
 */
import { useCallback } from 'react';

import { planSteps } from '@/research/core';
import { cn } from '@/lib/utils';
import { useResearchStore } from '@/stores/researchStore';

export function StageRail() {
  const phase = useResearchStore((s) => s.phase);
  const report = useResearchStore((s) => s.report);
  const sourceCount = useResearchStore((s) => s.sources.length);

  const scrollToMatrix = useCallback(() => {
    document.querySelector('[data-testid="evidence-matrix"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const steps = planSteps(phase);
  const doneCount = steps.filter((s) => s.state === 'done').length;

  return (
    <div className="xr-stage-rail" data-testid="stage-rail" data-phase={phase} role="group" aria-label="Research stages">
      <ol className="xr-stage-steps" aria-label={`Stage ${Math.min(doneCount + 1, steps.length)} of ${steps.length}`}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={cn('xr-stage', `is-${s.state}`)}
            aria-current={s.state === 'active' ? 'step' : undefined}
          >
            <span className="dot" aria-hidden="true" />
            <span className="label">{s.label}</span>
            {i < steps.length - 1 ? <span className="xr-stage-sep" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
      <span className="xr-stage-spacer" />
      {report ? (
        <button type="button" className="xr-stage-evidence" onClick={scrollToMatrix} title="Jump to the evidence matrix">
          Evidence
        </button>
      ) : (
        <span className="xr-stage-count" data-testid="stage-source-count">
          {sourceCount} source{sourceCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}
