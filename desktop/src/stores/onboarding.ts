/*
 * Phase 3 — onboarding wizard state + first-run gating.
 *
 * The wizard's working state lives here; `finishOnboarding()` persists the
 * durable subset to the settings store (Tauri Store + localStorage
 * write-through) and flips `onboardingComplete`, which the router gate reads.
 */
import { create } from 'zustand';

import type { GpuInfo, MicInfo, OllamaInfo, SystemInfo } from '@/lib/detect';
import { applyTheme, type ThemeId } from '@/stores/theme';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';

export const ONBOARDING_KEY = 'xr.onboarding.complete';
const ONBOARDED_AT_KEY = 'xr.onboarding.at';
const BUDGET_KEY = 'xr.budget.default';
const MODEL_KEY = 'xr.model.default';
const VOICE_KEY = 'xr.voice';
const INTEGRATIONS_KEY = 'xr.integrations.desired';

export type ModelChoice =
  | { source: 'local'; model: string; label: string }
  | { source: 'cloud'; apiKey?: string }
  | { source: 'skip' };

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
  setDetections: (d: Partial<Pick<OnboardingState, 'systemInfo' | 'gpu' | 'mics' | 'ollama' | 'checking'>>) => void;
  setModelChoice: (c: ModelChoice) => void;
  setMic: (id: string | null) => void;
  setVoicePrefs: (p: Partial<Pick<OnboardingState, 'noiseSuppression' | 'wakeWordEnabled' | 'ttsVoice' | 'micSelected'>>) => void;
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
  checking: true,
  modelChoice: { source: 'skip' } as ModelChoice,
  micSelected: null,
  noiseSuppression: true,
  wakeWordEnabled: true,
  ttsVoice: 'ahmad',
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
    set((s) => ({ step: Math.max(1, Math.min(10, n)), direction: n > s.step ? 1 : -1 })),

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
    const closest = BUDGET_STEPS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 5);
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
    await writeSettingJSON(ONBOARDING_KEY, true);
    await writeSettingJSON(ONBOARDED_AT_KEY, Date.now());
    await writeSettingJSON('xr.user.name', s.userName || 'You');
    await writeSettingJSON(BUDGET_KEY, s.budget);
    await writeSettingJSON(MODEL_KEY, s.modelChoice);
    await writeSettingJSON(VOICE_KEY, {
      ttsVoice: s.ttsVoice,
      micDevice: s.micSelected,
      wakeWord: s.wakeWordEnabled,
      noiseSuppression: s.noiseSuppression,
    });
    await writeSettingJSON(INTEGRATIONS_KEY, s.desiredIntegrations);
    applyTheme(s.theme);
    set({ complete: true });
  },
}));

export { BUDGET_STEPS };
