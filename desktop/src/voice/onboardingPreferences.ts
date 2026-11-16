/** Onboarding writes a pending intent; only the engine's acknowledgement clears it. */
import { readSettingJSON, writeSettingJSONDurable } from '@/lib/persistent-store';
import { voiceApi, type VoiceSettingsPatch } from './voiceApi';
import { createPreferenceQueue, type PendingPreference } from './preferenceQueue';

const PENDING_VOICE_KEY = 'xr.voice.pending';
const queue = createPreferenceQueue<VoiceSettingsPatch>({
  read: () => readSettingJSON<PendingPreference<VoiceSettingsPatch>>(PENDING_VOICE_KEY),
  write: (value) => writeSettingJSONDurable(PENDING_VOICE_KEY, value),
  apply: (patch) => voiceApi.settingsSet(patch),
});

export function queueOnboardingVoice(s: {
  ttsVoice: string;
  micSelected: string | null;
  noiseSuppression: boolean;
  wakeWordEnabled: boolean;
}): Promise<void> {
  return queue.enqueue({
    ttsVoice: s.ttsVoice,
    noiseSuppression: s.noiseSuppression,
    mode: s.wakeWordEnabled ? 'wake-word' : 'push-to-talk',
    // Configuring activation NEVER opens a mic. A user must still start a
    // session and grant permission; wake mode then needs an open session mic.
    desktop: { micDeviceId: s.micSelected, activation: s.wakeWordEnabled ? 'always' : 'tap' },
  });
}

export const flushOnboardingVoice = queue.flush;
