/*
 * Non-component helpers for the Budget screen (kept out of shared.tsx so
 * Fast Refresh stays happy).
 */
import { modelInfo } from '@/budget/models';

export const LIMIT_PRESETS = [0, 2, 5, 10, 20, 50, 100] as const;

/** Non-LLM "models" that show up in spend (voice, embeddings) — named, not flagged. */
const NON_LLM_MODELS: Record<string, string> = {
  'tts-1': 'TTS-1 (voice)',
  'tts-1-hd': 'TTS-1 HD (voice)',
  'text-embedding-3-small': 'Embeddings (small)',
};

export function displayModel(id: string): {
  name: string;
  local: boolean;
  estimate: boolean;
  family: string;
} {
  const known = NON_LLM_MODELS[id];
  if (known)
    return { name: known, local: false, estimate: false, family: 'other' };
  const info = modelInfo(id);
  return {
    name: info.name,
    local: info.local,
    estimate: Boolean(info.estimate),
    family: info.family,
  };
}
