/** Store-level onboarding/reconnect, not a source-substring assertion. */
import { storage, setTauri } from './helpers/dom-shim.ts';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { useOnboardingStore } from '../../desktop/src/stores/onboarding.ts';
import { useEngineStore } from '../../desktop/src/stores/engineStore.ts';
import { useVoiceStore } from '../../desktop/src/voice/voiceStore.ts';
import { voiceApi, type VoiceSettingsPatch, type VoiceEngineSettings, type VoiceStatus } from '../../desktop/src/voice/voiceApi.ts';
import { defaultVoiceSettings } from '../../src/voice/types.ts';

const realFetch = globalThis.fetch;
let engine: VoiceEngineSettings;
let writes: VoiceSettingsPatch[];
let failWrite = false;
let restores: Array<() => void> = [];
beforeEach(() => {
  storage.clear(); setTauri(false); writes = []; failWrite = false;
  engine = defaultVoiceSettings() as VoiceEngineSettings;
  useEngineStore.setState({ status: 'disconnected' });
  useVoiceStore.setState({ settings: null, status: null });
  useOnboardingStore.setState({ complete: false, modelChoice: { source: 'skip' },
    ttsVoice: 'piper-amy', ttsSpeed: 1.25, micSelected: 'input-two', noiseSuppression: false, wakeWordEnabled: true });
  globalThis.fetch = (async () => Response.json({})) as typeof fetch;
  const set = spyOn(voiceApi, 'settingsSet').mockImplementation(async (patch) => {
    writes.push(patch);
    if (failWrite) throw new Error('connection lost');
    engine = { ...engine, ...patch, desktop: { ...engine.desktop, ...patch.desktop } };
    return { settings: engine };
  });
  const status = spyOn(voiceApi, 'status').mockImplementation(async () => ({ settings: engine }) as VoiceStatus);
  const preview = spyOn(voiceApi, 'testTts').mockResolvedValue({ ok: true, engine: 'fixture', wav: 'fixture' });
  restores = [() => set.mockRestore(), () => status.mockRestore(), () => preview.mockRestore()];
});
afterEach(() => { for (const restore of restores) restore(); globalThis.fetch = realFetch; });

const expected = { ttsVoice: 'piper-amy', ttsSpeed: 1.25, noiseSuppression: false, mode: 'wake-word',
  desktop: { micDeviceId: 'input-two', activation: 'always' } };

test('offline onboarding retains intent and applies it on the first voice refresh after reconnect', async () => {
  await useOnboardingStore.getState().finishOnboarding();
  expect(writes).toHaveLength(0);
  expect(useOnboardingStore.getState().complete).toBe(true);
  useEngineStore.setState({ status: 'ready' });
  await useVoiceStore.getState().refreshStatus();
  expect(writes).toEqual([expected]);
  expect(useVoiceStore.getState().settings?.ttsVoice).toBe('piper-amy');
  expect(useVoiceStore.getState().settings?.noiseSuppression).toBe(false);
  await useVoiceStore.getState().refreshStatus();
  expect(writes).toHaveLength(1); // acknowledged intent is not replayed forever
});

test('a rejected preference write remains pending and is retried rather than overwritten by engine defaults', async () => {
  await useOnboardingStore.getState().finishOnboarding();
  useEngineStore.setState({ status: 'ready' });
  failWrite = true;
  await useVoiceStore.getState().refreshStatus();
  failWrite = false;
  await useVoiceStore.getState().refreshStatus();
  expect(writes).toEqual([expected, expected]);
  expect(engine.ttsVoice).toBe('piper-amy');
});

test('online onboarding sends microphone, noise suppression and wake activation together', async () => {
  useEngineStore.setState({ status: 'ready' });
  await useOnboardingStore.getState().finishOnboarding();
  expect(writes).toEqual([expected]);
});
