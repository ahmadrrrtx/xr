/*
 * Phase 3 — onboarding wizard state + first-run gating.
 *
 * The wizard's working state lives here; `finishOnboarding()` persists the
 * durable subset to the settings store (Tauri Store + localStorage
 * write-through) and flips `onboardingComplete`, which the router gate reads.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { prepareModelSetup, type SetupChoice } from '@/engine/setup';

import type {
  DetectionProbe,
  GpuInfo,
  MicInfo,
  OllamaInfo,
  SystemInfo,
} from '@/lib/detect';
import { applyTheme, type ThemeId } from '@/stores/theme';
import {
  purgeLegacyCredentialSettings,
  readSettingJSON,
  writeSettingJSON,
} from '@/lib/persistent-store';

export const ONBOARDING_KEY = 'xr.onboarding.complete';
const ONBOARDED_AT_KEY = 'xr.onboarding.at';
const BUDGET_KEY = 'xr.budget.default';
const MODEL_KEY = 'xr.model.default';
const VOICE_KEY = 'xr.voice';

/*
 * S-2 · the wizard's voice choice has to reach the engine.
 *
 * `xr.voice` is a desktop-local key. The engine keeps its own settings behind
 * /voice/settings, and THAT is what synthesis reads — so writing only the local
 * key let onboarding "configure" a voice that never spoke a word, with the
 * Voice screen confidently reporting it as the current voice afterwards.
 *
 * This pushes the choice to the engine and reports the two states the wizard
 * has to be honest about: the engine was unreachable (choice kept, applied on
 * first connect) or the chosen model is not on disk yet (`voice-not-installed`).
 * Neither blocks onboarding — a mute voice must not cost the user a working
 * agent — but both are announced instead of silently dropped.
 */
async function applyOnboardingVoice(s: {
  ttsVoice: string;
  micSelected: string | null;
  noiseSuppression: boolean;
  wakeWordEnabled: boolean;
}): Promise<void> {
  try {
    const [{ EngineHttpError }, { voiceApi }, { isEngineUsable, useEngineStore }] = await Promise.all([
      import('@/engine/transport'),
      import('@/voice/voiceApi'),
      import('@/stores/engineStore'),
    ]);
    type HttpError = InstanceType<typeof EngineHttpError>;
    if (!isEngineUsable(useEngineStore.getState().status)) {
      toast.info('Voice saved — it will be applied when the engine starts.');
      return;
    }
    await voiceApi.settingsSet({ ttsVoice: s.ttsVoice, desktop: { micDeviceId: s.micSelected } });
    // The engine accepts the id but cannot speak it until the model is on disk.
    // /voice/test-tts is the one endpoint that says so, with the byte size.
    try {
      await voiceApi.testTts('Ready when you are.', s.ttsVoice);
    } catch (err) {
      if (!(err instanceof EngineHttpError) || err.body?.error !== 'voice-not-installed') return;
      const bytes = Number((err as HttpError).body?.bytes ?? 0);
      toast.info(
        `Voice saved. Its model is not downloaded yet (${Math.round(bytes / 1e6)} MB) — ` +
          'Settings → Voice → Download starts it.',
      );
    }
  } catch {
    /* the engine is the authority; a failed push is retried by the Voice screen */
  }
}
const INTEGRATIONS_KEY = 'xr.integrations.desired';

export type ModelChoice = SetupChoice;

export type DownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; pct: number; completedGb: number; totalGb: number }
  | { status: 'done' }
  | { status: 'error'; message: string };

interface OnboardingState {
  step: number; // 1..10
  direction: 1 | -1;
  // detections
  systemInfo: SystemInfo | null;
  gpu: GpuInfo | null;
  mics: MicInfo | null;
  ollama: OllamaInfo | null;
  /**
   * XR-REL-01 — why a probe returned nothing. `null` value = the probe has not
   * resolved yet; a key present = it resolved to "unknown" and the UI MUST say
   * so instead of rendering a number. There is no fabricated fallback.
   */
  detectFailures: Partial<Record<DetectionProbe, string>>;
  checking: boolean;
  // selections
  modelChoice: ModelChoice;
  micSelected: string | null;
  noiseSuppression: boolean;
  wakeWordEnabled: boolean;
  ttsVoice: string;
  userName: string;
  theme: ThemeId;
  budget: number;
  desiredIntegrations: string[];
  // download
  download: DownloadState;
  // flow
  complete: boolean;

  nextStep: () => void;
  prevStep: () => void;
  goToStep: (n: number) => void;
  setDetections: (
    d: Partial<
      Pick<
        OnboardingState,
        'systemInfo' | 'gpu' | 'mics' | 'ollama' | 'checking' | 'detectFailures'
      >
    >
  ) => void;
  setModelChoice: (c: ModelChoice) => void;
  setMic: (id: string | null) => void;
  setVoicePrefs: (
    p: Partial<
      Pick<
        OnboardingState,
        'noiseSuppression' | 'wakeWordEnabled' | 'ttsVoice' | 'micSelected'
      >
    >
  ) => void;
  setUserName: (name: string) => void;
  setTheme: (t: ThemeId) => void;
  setBudget: (n: number) => void;
  toggleIntegration: (id: string) => void;
  setDownload: (d: DownloadState) => void;
  reset: () => void;
  finishOnboarding: () => Promise<void>;
}

/** First-run check — used by the router gate + splash. */
export async function isOnboardingComplete(): Promise<boolean> {
  const purged = await purgeLegacyCredentialSettings();
  if (purged)
    toast.warning(
      'Removed legacy plaintext provider settings. Re-enter keys in Models & Providers and rotate keys previously stored by older builds.'
    );
  const v = await readSettingJSON<boolean>(ONBOARDING_KEY);
  if (typeof v === 'boolean') return v;
  // localStorage fallback holds the raw JSON string
  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY);
    if (raw === null) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

const BUDGET_STEPS = [0, 2, 5, 10, 20, 50];

const initial = {
  step: 1,
  direction: 1 as const,
  systemInfo: null,
  gpu: null,
  mics: null,
  ollama: null,
  detectFailures: {},
  checking: true,
  modelChoice: { source: 'skip' } as ModelChoice,
  micSelected: null,
  noiseSuppression: true,
  wakeWordEnabled: true,
  ttsVoice: 'piper-kusal',
  userName: '',
  theme: 'xr-native' as ThemeId,
  budget: 5,
  desiredIntegrations: [] as string[],
  download: { status: 'idle' } as DownloadState,
  complete: false,
};

/** Clear the completion flag WITHOUT touching live wizard state — used by the
 * dev reset paths, which reload immediately (avoids animating during teardown). */
export async function clearOnboardingFlag(): Promise<void> {
  await writeSettingJSON(ONBOARDING_KEY, false);
  try {
    window.localStorage.setItem(ONBOARDING_KEY, 'false');
  } catch {
    /* ignore */
  }
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...initial,

  nextStep: () =>
    set((s) => ({ step: Math.min(10, s.step + 1), direction: 1 })),
  prevStep: () =>
    set((s) => ({ step: Math.max(1, s.step - 1), direction: -1 })),
  goToStep: (n) =>
    set((s) => ({
      step: Math.max(1, Math.min(10, n)),
      direction: n > s.step ? 1 : -1,
    })),

  setDetections: (d) => set(d),
  setModelChoice: (modelChoice) => set({ modelChoice }),
  setMic: (micSelected) => set({ micSelected }),
  setVoicePrefs: (p) => set(p),
  setUserName: (userName) => set({ userName }),
  setTheme: (theme) => {
    applyTheme(theme); // live preview (page behind the modal)
    set({ theme });
  },
  setBudget: (n) => {
    // snap to the nearest allowed step
    const closest = BUDGET_STEPS.reduce(
      (a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a),
      5
    );
    set({ budget: closest });
  },
  toggleIntegration: (id) =>
    set((s) => ({
      desiredIntegrations: s.desiredIntegrations.includes(id)
        ? s.desiredIntegrations.filter((i) => i !== id)
        : [...s.desiredIntegrations, id],
    })),

  setDownload: (download) => set({ download }),

  reset: () => {
    void writeSettingJSON(ONBOARDING_KEY, false);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, 'false');
    } catch {
      /* ignore */
    }
    set({ ...initial });
  },

  finishOnboarding: async () => {
    const s = get();
    await writeSettingJSON(ONBOARDED_AT_KEY, Date.now());
    await writeSettingJSON('xr.user.name', s.userName || 'You');
    await writeSettingJSON(BUDGET_KEY, s.budget);
    const { isEngineUsable, useEngineStore } = await import('@/stores/engineStore');
    const { saveProviderKeyToEngine, setEngineDefault } =
      await import('@/engine/providers');
    const prepared = await prepareModelSetup(s.modelChoice, {
      saveSecret: async (input) => {
        // XR-P01: a credential write requires a VERIFIED contract
        // (`ready`). `degraded` (legacy engine, contract unobserved) may
        // keep working for reads, but no secret is handed to it.
        if (useEngineStore.getState().status !== 'ready')
          throw new Error(
            'Engine not running; no key saved. Start it and retry, or choose guest mode.'
          );
        return saveProviderKeyToEngine(input);
      },
      setDefault: async (providerId, model) => {
        if (isEngineUsable(useEngineStore.getState().status))
          await setEngineDefault(providerId, model);
      },
    });
    if (prepared.selection)
      await writeSettingJSON(MODEL_KEY, prepared.selection);
    // Phase 13: the slider value becomes the enforced monthly limit.
    try {
      const { budgetBackend } = await import('@/budget/api');
      await budgetBackend().updateSettings({ monthlyLimit: s.budget });
    } catch {
      /* governor not reachable yet — Budget screen defaults apply */
    }
    await writeSettingJSON(VOICE_KEY, {
      ttsVoice: s.ttsVoice,
      micDevice: s.micSelected,
      wakeWord: s.wakeWordEnabled,
      noiseSuppression: s.noiseSuppression,
    });
    // S-2: the engine's voice settings are the ones that speak. The wizard used
    // to write `xr.voice` — a key no other surface reads — so a chosen voice
    // could finish onboarding without ever reaching the engine, and nothing
    // noticed. Resolve it to the engine now. The engine is asked last and
    // hard-fails nothing: the wizard must not dead-end on a voice.
    await applyOnboardingVoice(s);
    await writeSettingJSON(INTEGRATIONS_KEY, s.desiredIntegrations);
    applyTheme(s.theme);
    // Completion is after the engine's acknowledgement, never after a swallowed
    // failed secret save. Transient key text is removed from wizard state.
    await writeSettingJSON(ONBOARDING_KEY, true);
    set({ complete: true, modelChoice: prepared.durableChoice });
  },
}));

export { BUDGET_STEPS };
