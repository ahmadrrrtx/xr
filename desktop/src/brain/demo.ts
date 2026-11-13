/* Start a real, bounded example task through the configured engine.
 * No provider or no engine is an unavailable state, never a fake trace. */
import { useBrainStore } from '@/stores/brainStore';
import { isEngineUsable, useEngineStore } from '@/stores/engineStore';
import { resolveDefaultModel } from '@/stores/sessionsStore';

export const DEMO_PROMPT =
  'Use the read_file tool with {"path":"README.md"} and then summarise what this project is in three short bullet points.';
export const DEMO_TITLE = 'Summarise README.md';

export function demoRunIsReal(): boolean {
  const s = useEngineStore.getState();
  return isEngineUsable(s.status) && !!s.providers?.providers.some((p) => p.healthy && (p.kind === 'local' || p.hasKey));
}

/** Null means no real run could be started. Never substitutes a script. */
export function startDemoRun(): { id: string } | null {
  if (!demoRunIsReal()) return null;
  const model = useEngineStore.getState().providers?.model ?? resolveDefaultModel();
  return { id: useBrainStore.getState().startEngineRun(DEMO_PROMPT, { model, title: DEMO_TITLE }) };
}
