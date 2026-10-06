/*
 * Voice store (Phase 15) — the ONE canonical Zustand store for voice.
 *
 * Owns: engine status / catalogues / settings mirror, download progress,
 * microphone permission + devices, the live session view (state, captions,
 * approval bar, error), docked flag and the cost chip. The audio machinery
 * (mic, playback, SSE) lives in session.ts and writes here; screens and the
 * docked pill only read.
 *
 * Settings flow: UI → `applySettings(patch)` → optimistic merge → engine
 * `POST /voice/settings` (validated + clamped there) → the engine's answer
 * wins → a mirror lands in settingsStore.voice (HUD / Rust readers). Never
 * the other direction, so there is no loop.
 */
import { create } from 'zustand';

import { EngineDown, EngineHttpError } from '@/engine/transport';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  voiceApi,
  type VoiceDownloadProgress,
  type VoiceEngineSettings,
  type VoiceModelInfo,
  type VoiceSessionState,
  type VoiceSettingsPatch,
  type VoiceStatus,
  type VoiceVoiceInfo,
} from './voiceApi';

export type MicPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'no-device' | 'unsupported';

export interface VoiceCaption {
  id: number;
  role: 'you' | 'xr' | 'system';
  text: string;
  at: number;
}

export interface VoiceApprovalView {
  id: string;
  tool: string;
  reason: string;
  riskTier?: string;
  /** Set after the first "I didn't catch that" — the bar then leads with buttons. */
  unclear: boolean;
}

export interface VoiceErrorView {
  code: string;
  message: string;
  at: number;
}

export interface VoiceCost {
  /** Estimated cloud spend this session (USD). 0 when fully local. */
  sessionUsd: number;
  /** Estimated hourly rate for the current STT/TTS choice (USD). 0 = local. */
  perHourUsd: number;
  cloud: boolean;
}

export interface VoiceDevice {
  id: string;
  label: string;
}

interface VoiceStoreState {
  status: VoiceStatus | null;
  /** The engine could not answer `/voice/status` (down, or old build). */
  statusError: 'engine-down' | 'unsupported' | null;
  statusLoading: boolean;
  models: { runtime: VoiceModelInfo; stt: VoiceModelInfo[]; espeak: VoiceModelInfo } | null;
  voices: VoiceVoiceInfo[];
  sampleText: string;
  settings: VoiceEngineSettings | null;
  saving: boolean;
  download: VoiceDownloadProgress | null;
  downloadBusy: boolean;
  downloadError: string | null;
  micPermission: MicPermission;
  devices: VoiceDevice[];

  /** Live session view. */
  active: boolean;
  connected: boolean;
  sessionState: VoiceSessionState;
  muted: boolean;
  /** Hold-to-talk: the key/button is down right now. */
  pressed: boolean;
  captions: VoiceCaption[];
  approval: VoiceApprovalView | null;
  error: VoiceErrorView | null;
  docked: boolean;
  /** Where the running session was started from (routes the Esc behaviour). */
  origin: 'screen' | 'docked' | 'hotkey' | 'orb' | 'chat' | 'theater' | null;
  cost: VoiceCost;
  startedAt: number | null;

  refreshStatus: () => Promise<VoiceStatus | null>;
  loadCatalogues: () => Promise<void>;
  applySettings: (patch: VoiceSettingsPatch) => Promise<void>;
  startDownload: (body: { component?: 'runtime' | 'stt' | 'tts'; id?: string; firstRun?: boolean }) => Promise<boolean>;
  cancelDownload: () => Promise<void>;
  /** Drop a finished/stopped download from view (the files stay for resume). */
  dismissDownload: () => void;
  clearModels: () => Promise<void>;
  setDevices: (devices: VoiceDevice[]) => void;
  setMicPermission: (p: MicPermission) => void;
  setDocked: (docked: boolean) => void;

  /* session.ts writers */
  _session: (patch: Partial<Pick<VoiceStoreState, 'active' | 'connected' | 'sessionState' | 'muted' | 'pressed' | 'origin' | 'startedAt' | 'approval' | 'error' | 'download'>>) => void;
  _caption: (role: VoiceCaption['role'], text: string) => void;
  _clearCaptions: () => void;
  _cost: (usd: number) => void;
}

let captionSeq = 0;
const CAPTION_CAP = 8;

/** Cloud list prices (USD) — mirrors src/voice/transcript.ts on the engine. */
const STT_PER_HOUR: Record<string, number> = { groq: 0.04, openai: 0.18 };
/** ~150 wpm × 5.5 chars ≈ 50k chars/hour at $15 / 1M chars (OpenAI tts-1). */
const TTS_PER_HOUR_OPENAI = 0.75;

export function costFor(settings: VoiceEngineSettings | null, status: VoiceStatus | null): Omit<VoiceCost, 'sessionUsd'> {
  const stt = settings?.sttBackend ?? status?.stt.backend ?? 'auto';
  const tts = settings?.ttsBackend ?? status?.tts.backend ?? 'system';
  let perHour = 0;
  if (stt in STT_PER_HOUR) perHour += STT_PER_HOUR[stt] ?? 0;
  if (tts === 'openai') perHour += TTS_PER_HOUR_OPENAI;
  return { perHourUsd: Math.round(perHour * 100) / 100, cloud: perHour > 0 };
}

function mirrorToSettingsStore(s: VoiceEngineSettings): void {
  const d = s.desktop;
  useSettingsStore.getState().update('voice', {
    micDeviceId: d.micDeviceId,
    inputVolume: d.inputGain,
    rate: s.ttsSpeed,
    wakeWord: s.mode === 'wake-word',
    alwaysListen: d.activation === 'always',
    wakePhrase: s.wakeWord,
    wakeSensitivity: s.wakeSensitivity,
    wakeSound: s.wakeSound,
    sttModel: s.sttBackend === 'sherpa' || s.sttBackend === 'auto' ? s.sttModel : s.sttBackend,
    ttsVoice: s.ttsVoice,
    pitch: d.ttsPitch,
    theaterEnabled: d.theaterImmersive,
    autoExitSilence: d.autoExitSilenceSec,
    showTranscripts: d.showTranscripts,
    pttMode: d.activation,
    noiseSuppression: d.noiseSuppression,
    chatMicTarget: d.chatMicTarget,
    holdGlobalHotkey: d.holdGlobalHotkey,
    profanityFilter: s.profanityFilter,
  });
}

function deepMerge(base: VoiceEngineSettings, patch: VoiceSettingsPatch): VoiceEngineSettings {
  const { desktop, ...rest } = patch;
  return { ...base, ...rest, desktop: { ...base.desktop, ...(desktop ?? {}) } };
}

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  status: null,
  statusError: null,
  statusLoading: false,
  models: null,
  voices: [],
  sampleText: 'Ready when you are.',
  settings: null,
  saving: false,
  download: null,
  downloadBusy: false,
  downloadError: null,
  micPermission: 'unknown',
  devices: [],

  active: false,
  connected: false,
  sessionState: 'idle',
  muted: false,
  pressed: false,
  captions: [],
  approval: null,
  error: null,
  docked: false,
  origin: null,
  cost: { sessionUsd: 0, perHourUsd: 0, cloud: false },
  startedAt: null,

  refreshStatus: async () => {
    set({ statusLoading: true });
    try {
      const status = await voiceApi.status();
      const settings = status.settings ?? get().settings;
      set((s) => ({
        status,
        settings,
        statusError: null,
        statusLoading: false,
        download: status.download ?? (s.download?.status === 'downloading' ? null : s.download),
        downloadBusy: status.download?.status === 'downloading' || status.download?.status === 'extracting',
        cost: { ...s.cost, ...costFor(settings, status) },
      }));
      if (settings) mirrorToSettingsStore(settings);
      return status;
    } catch (e) {
      set({
        statusLoading: false,
        statusError: e instanceof EngineDown ? 'engine-down' : e instanceof EngineHttpError && e.status === 404 ? 'unsupported' : 'engine-down',
      });
      return null;
    }
  },

  loadCatalogues: async () => {
    try {
      const [models, voices] = await Promise.all([voiceApi.models(), voiceApi.voices()]);
      set({ models, voices: voices.voices, sampleText: voices.sample || 'Ready when you are.' });
    } catch {
      /* status already carries the engine-down story */
    }
  },

  applySettings: async (patch) => {
    const before = get().settings;
    if (before) set({ settings: deepMerge(before, patch), saving: true });
    try {
      const res = await voiceApi.settingsSet(patch);
      set((s) => ({ settings: res.settings, saving: false, cost: { ...s.cost, ...costFor(res.settings, s.status) } }));
      mirrorToSettingsStore(res.settings);
    } catch (e) {
      set({ settings: before, saving: false });
      throw e;
    }
  },

  startDownload: async (body) => {
    set({ downloadError: null, downloadBusy: true });
    try {
      const res = await voiceApi.download(body);
      const first = res.started[0];
      set({
        download: first
          ? { component: first.component, id: first.id, status: 'downloading', received: 0, total: first.bytes, percent: 0, bundleReceived: 0, bundleTotal: res.bytes }
          : null,
        downloadBusy: res.started.length > 0,
      });
      if (res.started.length === 0) void get().refreshStatus();
      return res.started.length > 0;
    } catch (e) {
      const msg = e instanceof EngineHttpError ? (typeof e.body?.detail === 'string' ? e.body.detail : e.message) : e instanceof EngineDown ? 'Engine unreachable' : 'Download could not start';
      set({ downloadBusy: false, downloadError: msg });
      return false;
    }
  },

  cancelDownload: async () => {
    try {
      await voiceApi.cancelDownload();
    } catch {
      /* the progress event will tell the truth */
    }
    set({ downloadBusy: false });
  },

  dismissDownload: () => set({ download: null, downloadBusy: false, downloadError: null }),

  clearModels: async () => {
    await voiceApi.clearModels();
    set({ download: null, downloadBusy: false });
    await get().refreshStatus();
    await get().loadCatalogues();
  },

  setDevices: (devices) => set({ devices }),
  setMicPermission: (micPermission) => set({ micPermission }),
  setDocked: (docked) => set({ docked }),

  _session: (patch) => set(patch),
  _caption: (role, text) =>
    set((s) => {
      // The engine announces a reply as `status` text first and again on the
      // `tts` event — same words, one caption (promoted to XR's voice).
      const last = s.captions[s.captions.length - 1];
      if (last && last.text === text && (last.role === role || last.role === 'system')) {
        return { captions: [...s.captions.slice(0, -1), { ...last, role }] };
      }
      return { captions: [...s.captions, { id: ++captionSeq, role, text, at: Date.now() }].slice(-CAPTION_CAP) };
    }),
  _clearCaptions: () => set({ captions: [] }),
  _cost: (usd) => set((s) => ({ cost: { ...s.cost, sessionUsd: Math.round((s.cost.sessionUsd + usd) * 10_000) / 10_000 } })),
}));

/** Download progress → store (called from the SSE pump). */
export function applyDownloadEvent(p: VoiceDownloadProgress): void {
  const prev = useVoiceStore.getState().download;
  const terminal = p.status === 'done' || p.status === 'error' || p.status === 'cancelled';
  useVoiceStore.setState({
    download: { ...prev, ...p, bundleTotal: p.bundleTotal ?? prev?.bundleTotal, bundleReceived: p.bundleReceived ?? p.received },
    downloadBusy: !terminal || (p.status === 'done' && (p.bundleReceived ?? p.received) < (p.bundleTotal ?? prev?.bundleTotal ?? 0)),
    downloadError: p.status === 'error' ? (p.detail ?? 'Download failed') : null,
  });
  if (terminal) {
    const bundleDone = (p.bundleReceived ?? p.received) >= (p.bundleTotal ?? prev?.bundleTotal ?? p.total);
    if (p.status !== 'done' || bundleDone) {
      void useVoiceStore.getState().refreshStatus().then(() => useVoiceStore.getState().loadCatalogues());
    }
  }
}

// Dev/e2e seam (browser dev builds only): lets the Playwright pass stage
// states the real engine only produces mid-run (approval bar, errors).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __xrVoiceStore?: typeof useVoiceStore }).__xrVoiceStore = useVoiceStore;
}
