/*
 * "Start a demo run" — one entry point for Brain and the Control Room.
 *
 * When the engine is up with a provider that answers, this starts a REAL
 * agent-mode turn (a read-only tool step plus a short answer), so the trace
 * carries an LLM span, a tool span and real token counts. Otherwise it plays
 * the canned mock, labelled honestly as "Demo run (no model configured)".
 */
import { useBrainStore } from '@/stores/brainStore';
import { useEngineStore } from '@/stores/engineStore';
import { resolveDefaultModel } from '@/stores/sessionsStore';

export const DEMO_PROMPT =
  'Use the read_file tool with {"path":"README.md"} and then summarise what this project is in three short bullet points.';
export const DEMO_TITLE = 'Summarise README.md';
export const MOCK_DEMO_TITLE = 'Demo run (no model configured)';

/** True when a real run can be started right now. */
export function demoRunIsReal(): boolean {
  const s = useEngineStore.getState();
  return s.status === 'up' && !!s.providers?.providers.some((p) => p.healthy && (p.kind === 'local' || p.hasKey));
}

/** Start the demo run; returns the run id and whether it is real. */
export function startDemoRun(): { id: string; real: boolean } {
  if (demoRunIsReal()) {
    const model = useEngineStore.getState().providers?.model ?? resolveDefaultModel();
    const id = useBrainStore.getState().startEngineRun(DEMO_PROMPT, { model, title: DEMO_TITLE });
    return { id, real: true };
  }
  return { id: useBrainStore.getState().startMockRun(MOCK_DEMO_TITLE), real: false };
}
