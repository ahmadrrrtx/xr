import type { VoiceMode, VoiceDesktopPrefs, VoiceActivation, VoiceWakeSensitivity } from '../../../src/voice/types';
export type { VoiceDesktopPrefs, VoiceActivation, VoiceWakeSensitivity };
/*
 * Voice engine API (Phase 15) — typed calls over the Phase 14 transport.
 *
 * Every function talks to `/api/v1/voice/*` through `engineFetch`, so the
 * sidecar bearer token and the dev-proxy session ride along; nothing here
 * opens an `EventSource` (which cannot carry a bearer) — the SSE downlink
 * uses `engineFetch` + `readSse` in session.ts.
 */
import { engineFetch, engineJson, enginePost } from '@/engine/transport';

export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'planning'
  | 'working'
  | 'tool'
  | 'approval'
  | 'speaking'
  | 'success'
  | 'interrupted'
  | 'error'
  | 'offline';

export type VoiceComponent = 'runtime' | 'stt' | 'tts';

export interface VoiceDownloadProgress {
  component: VoiceComponent;
  id: string;
  status: 'downloading' | 'extracting' | 'done' | 'error' | 'cancelled';
  received: number;
  total: number;
  percent: number;
  file?: string;
  detail?: string;
  bundleReceived?: number;
  bundleTotal?: number;
}

export interface VoiceEngineEvent {
  type:
    | 'state'
    | 'final'
    | 'tts'
    | 'tts_stop'
    | 'approval'
    | 'status'
    | 'error'
    | 'download'
    | 'cost';
  state?: VoiceSessionState;
  text?: string;
  wav?: string;
  id?: string;
  tool?: string;
  reason?: string;
  args?: Record<string, unknown>;
  riskTier?: string;
  resolved?: 'approved' | 'denied';
  detail?: string;
  message?: string;
  component?: VoiceComponent;
  status?: VoiceDownloadProgress['status'];
  percent?: number;
  received?: number;
  total?: number;
  bundleReceived?: number;
  bundleTotal?: number;
  file?: string;
  usd?: number;
  provider?: string;
  model?: string;
  seconds?: number;
}

export interface VoiceEngineSettings {
  enabled: boolean;
  mode: VoiceMode;
  noiseSuppression: boolean;
  sttBackend: string;
  sttModel: string;
  ttsBackend: string;
  ttsVoice: string;
  ttsSpeed: number;
  wakeWord: string;
  wakeSensitivity: VoiceWakeSensitivity;
  wakeSound: boolean;
  profanityFilter: boolean;
  sttLanguage?: string;
  desktop: VoiceDesktopPrefs;
}

export type VoiceSettingsPatch = Partial<Omit<VoiceEngineSettings, 'desktop'>> & {
  desktop?: Partial<VoiceDesktopPrefs>;
};

export interface VoiceComponentStatus {
  loaded: boolean;
  backend: string;
  name: string;
  model?: string;
  voice?: string;
  label?: string;
  hasAudio?: boolean;
  missing: string[];
  downloadProgress?: number;
}

export interface VoiceFirstRunEntry {
  id: string;
  component: VoiceComponent;
  name: string;
  bytes: number;
}

export interface VoiceStatus {
  state: VoiceSessionState;
  available: boolean;
  stt: VoiceComponentStatus;
  tts: VoiceComponentStatus;
  runtime: { installed: boolean; detail: string };
  wakeEnabled: boolean;
  modelDir: string;
  nativeDir: string;
  firstRun: { pending: VoiceFirstRunEntry[]; bytes: number };
  download: VoiceDownloadProgress | null;
  settings: VoiceEngineSettings;
}

export interface VoiceModelInfo {
  id: string;
  component: VoiceComponent;
  kind: 'offline' | 'local-binary' | 'cloud';
  name: string;
  detail: string;
  bytes: number;
  installed: boolean;
  downloadable: boolean;
  files?: Array<{ path: string; bytes: number; present: boolean }>;
}

export interface VoiceVoiceInfo {
  id: string;
  kind: 'offline' | 'cloud';
  label: string;
  gender: string;
  accent: string;
  detail: string;
  bytes: number;
  installed: boolean;
  downloadable: boolean;
}

export const voiceApi = {
  status: (options: Pick<RequestInit, 'signal'> = {}) => engineJson<VoiceStatus>('/voice/status', options),
  models: (options: Pick<RequestInit, 'signal'> = {}) =>
    engineJson<{ runtime: VoiceModelInfo; stt: VoiceModelInfo[]; espeak: VoiceModelInfo }>(
      '/voice/models', options,
    ),
  voices: (options: Pick<RequestInit, 'signal'> = {}) => engineJson<{ voices: VoiceVoiceInfo[]; sample: string }>('/voice/voices', options),
  settingsGet: () => engineJson<{ settings: VoiceEngineSettings }>('/voice/settings'),
  settingsSet: (patch: VoiceSettingsPatch) =>
    enginePost<{ ok: boolean; settings: VoiceEngineSettings }>('/voice/settings', patch),
  download: (body: { component?: VoiceComponent; id?: string; firstRun?: boolean }, options: Pick<RequestInit, 'signal'> = {}) =>
    enginePost<{ started: VoiceFirstRunEntry[]; bytes: number }>('/voice/download', body, options),
  cancelDownload: () => enginePost<{ ok: boolean }>('/voice/cancel-download', {}),
  clearModels: () => enginePost<{ ok: boolean; removed: number }>('/voice/clear-models', {}),
  testTts: (text: string, voice?: string, speed?: number, options: Pick<RequestInit, 'signal'> = {}) =>
    enginePost<{ ok: boolean; wav?: string; sampleRate?: number; engine: string; detail?: string }>(
      '/voice/test-tts',
      {
        text,
        voice,
        speed,
      }, options,
    ),
  transcribe: (pcm: string) =>
    enginePost<{ ok: boolean; text: string; backend: string; detail: string; ms: number }>(
      '/voice/transcribe',
      { pcm },
    ),
  session: (action: 'start' | 'stop') =>
    enginePost<{ state: VoiceSessionState }>('/voice/session', { action }),
  audio: (pcm: string) => enginePost<{ ok: boolean }>('/voice/audio', { pcm }),
  bargeIn: () => enginePost<{ ok: boolean }>('/voice/barge-in', {}),
  played: () => enginePost<{ ok: boolean }>('/voice/played', {}),
  say: (text: string) => enginePost<{ ok: boolean }>('/voice/say', { text }),
  /** Open the SSE downlink; the caller pumps it with `readSse`. */
  events: (signal: AbortSignal) =>
    engineFetch('/voice/events', { signal, headers: { Accept: 'text/event-stream' } }),
};
