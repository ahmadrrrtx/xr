/** Onboarding writes a pending intent; only the engine's acknowledgement clears it. */
import { EngineHttpError } from '@/engine/transport';
import { readSettingJSON, writeSettingJSONDurable } from '@/lib/persistent-store';
import { voiceApi, type VoiceSettingsPatch } from './voiceApi';
import { createPreferenceQueue, type PendingPreference } from './preferenceQueue';

const PENDING_VOICE_KEY = 'xr.voice.pending';
const queue = createPreferenceQueue<VoiceSettingsPatch>({
  read: () => readSettingJSON<PendingPreference<VoiceSettingsPatch>>(PENDING_VOICE_KEY),
  write: (value) => writeSettingJSONDurable(PENDING_VOICE_KEY, value),
  apply: (patch, revision) => voiceApi.settingsSet(patch, revision ?? 'initial'),
});

export function queueOnboardingVoice(s: {
  ttsVoice: string;
  ttsSpeed: number;
  micSelected: string | null;
  noiseSuppression: boolean;
  wakeWordEnabled: boolean;
}, revision = 'initial'): Promise<void> {
  return queue.enqueue({
    ttsVoice: s.ttsVoice,
    ttsSpeed: s.ttsSpeed,
    noiseSuppression: s.noiseSuppression,
    mode: s.wakeWordEnabled ? 'wake-word' : 'push-to-talk',
    // Configuring activation NEVER opens a mic. A user must still start a
    // session and grant permission; wake mode then needs an open session mic.
    desktop: { micDeviceId: s.micSelected, activation: s.wakeWordEnabled ? 'always' : 'tap' },
  }, revision);
}

let blocked: { revision: string; error: Error } | null = null;
export async function flushOnboardingVoice(): Promise<void> {
  const pending = await queue.peek();
  if (pending && blocked?.revision === pending.revision) throw blocked.error;
  try { await queue.flush(); }
  catch (e) {
    if (pending && e instanceof EngineHttpError && e.status === 409) blocked = { revision: pending.revision, error: e };
    throw e;
  }
}

export const pendingOnboardingVoice = queue.peek;
export async function discardOnboardingVoice(): Promise<void> { await queue.discard(); blocked = null; }
/** User-confirmed resolution only; automatic replay never rebases old intent. */
export async function retryOnboardingVoice(): Promise<void> {
  const pending = await queue.peek();
  if (!pending) return;
  const { settings } = await voiceApi.settingsGet();
  if (!settings.revision) throw new Error('This engine does not support voice settings revisions.');
  await queue.enqueue(pending.patch, settings.revision);
  blocked = null;
  await flushOnboardingVoice();
}
