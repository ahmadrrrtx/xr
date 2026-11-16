/* Start a real, bounded example task through the configured engine.
 * No provider or no engine is an unavailable state, never a fake trace. */
import { hasUsableProvider, localRuntimeUsable } from '@/engine/providerReadiness';
import { useBrainStore } from '@/stores/brainStore';
import { isEngineUsable, useEngineStore } from '@/stores/engineStore';
import { resolveDefaultModel } from '@/stores/sessionsStore';

export const DEMO_PROMPT =
  'Use the read_file tool with {"path":"README.md"} and then summarise what this project is in three short bullet points.';
export const DEMO_TITLE = 'Summarise README.md';

export function demoRunIsReal(): boolean {
  const s = useEngineStore.getState();
  // S-7: `healthy` is false until a probe runs; a saved key or a running local
  // runtime is enough to start a real run. See engine/providerReadiness.
  return isEngineUsable(s.status) && (hasUsableProvider(s.providers?.providers) || localRuntimeUsable(s.models?.current));
}

/** Null means no real run could be started. Never substitutes a script. */
export function startDemoRun(): { id: string } | null {
  if (!demoRunIsReal()) return null;
  const model = useEngineStore.getState().providers?.model ?? resolveDefaultModel();
  return { id: useBrainStore.getState().startEngineRun(DEMO_PROMPT, { model, title: DEMO_TITLE }) };
}
