/*
 * "Start a demo run" — one entry point for Brain and the Control Room.
 *
 * XR-REL-03. This used to fall back to a CANNED MOCK whenever no provider
 * answered, so a fresh install could "run" an agent and be shown a scripted
 * trace — spans, tokens, dollars — for work that never happened. A demo that
 * cannot run is now a pointer to the thing that would make it run.
 *
 *   · engine up + a usable provider  → a REAL agent-mode turn
 *   · otherwise                      → no run is created; the caller is told
 *                                      to configure a provider, and a
 *                                      development build may still play the
 *                                      scripted demo (explicitly labelled).
 */
import { useBrainStore } from '@/stores/brainStore';
import { isEngineUsable, useEngineStore } from '@/stores/engineStore';
import { resolveDefaultModel } from '@/stores/sessionsStore';

export const DEMO_PROMPT =
  'Use the read_file tool with {"path":"README.md"} and then summarise what this project is in three short bullet points.';
export const DEMO_TITLE = 'Summarise README.md';
/**
 * XR-REL-03 — the scripted demo's title only exists in a dev build, so the
 * string is not shipped in a release bundle (a "Demo run (no model
 * configured)" row would be reachable-looking fake data).
 */
export const MOCK_DEMO_TITLE = import.meta.env.DEV
  ? 'Demo run (no model configured)'
  : '';

export type DemoOutcome =
  | { kind: 'started'; id: string; real: true }
  /** No provider: nothing was created. The caller should explain + offer Setup. */
  | { kind: 'no-provider' }
  /** Development build only: the labelled scripted demo. */
  | { kind: 'started'; id: string; real: false; title: string };

/** True when a real run can be started right now. */
export function demoRunIsReal(): boolean {
  const s = useEngineStore.getState();
  return (
    isEngineUsable(s.status) &&
    !!s.providers?.providers.some(
      (p) => (p.healthy || p.hasKey) && (p.kind === 'local' || p.hasKey)
    )
  );
}

/**
 * Start the demo run, or report that no run could be started.
 *
 * A release build NEVER synthesises a run: the caller gets `no-provider` and
 * decides what to show. `import.meta.env.DEV` is a literal `false` in a
 * production bundle, so the scripted branch is dead code there.
 */
export function startDemoRun(): DemoOutcome {
  if (demoRunIsReal()) {
    const model =
      useEngineStore.getState().providers?.model ?? resolveDefaultModel();
    const id = useBrainStore
      .getState()
      .startEngineRun(DEMO_PROMPT, { model, title: DEMO_TITLE });
    return { kind: 'started', id, real: true };
  }
  if (import.meta.env.DEV) {
    const id = useBrainStore.getState().startMockRun(MOCK_DEMO_TITLE);
    return { kind: 'started', id, real: false, title: MOCK_DEMO_TITLE };
  }
  return { kind: 'no-provider' };
}
