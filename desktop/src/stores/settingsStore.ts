/*
 * Settings store (Phase 8) — the typed model behind the Settings screen.
 *
 * One JSON object persisted at `xr.settings` in the durable write-through
 * layer (Tauri Store `settings.json` + localStorage mirror — see
 * lib/persistent-store.ts). Theme, sidebar, user name and the Rust-owned
 * global-shortcut keys keep their existing store keys; this store owns
 * everything new. There is deliberately NO second copy of the theme here.
 *
 * Every successful write:
 *   1. persists the whole object (write-through),
 *   2. notifies the Rust host (`settings_changed`) so HUD + Orb windows
 *      re-apply appearance/i18n live (same pattern as `theme_changed`).
 */
import { create } from 'zustand';

import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';
import { settingsChanged } from '@/lib/settingsApi';
import { applyAppearanceEffects } from '@/lib/appearance';

export const SETTINGS_KEY = 'xr.settings';

export type Density = 'compact' | 'comfortable' | 'spacious';
export type FontSize = 12 | 13 | 14 | 15 | 16;
export type IconSize = 's' | 'm' | 'l';
export type NotificationStyle = 'banner' | 'alert' | 'none';
export type UpdateChannel = 'stable' | 'beta' | 'nightly';
export type OpenTo = 'chat' | 'last-session' | 'workspaces';
export type BudgetPreset = 'auto' | '2' | '5' | '10' | '20' | '50' | 'custom';
export type ProviderKind =
  'openai-compatible' | 'anthropic' | 'gemini' | 'ollama' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  /** Ollama host / custom base URL. Absent for hosted defaults. */
  baseUrl?: string;
  /** Default model name (custom endpoints). */
  model?: string;
  addedAt: number;
  lastTest?: { ok: boolean; at: number; latencyMs?: number; message?: string };
  /** Where the API key lives — 'none' for keyless local providers. */
  keyStorage: 'keychain' | 'local-insecure' | 'none';
}

export interface DefaultModels {
  chat: string;
  coding: string;
  embeddings: string;
  vision: string;
  stt: string;
  tts: string;
}

export type NotificationEventKind =
  | 'approval'
  | 'agentComplete'
  | 'budget'
  | 'errors'
  | 'voiceActivation'
  | 'memorySaved'
  | 'updates';

export interface XRSettings {
  profile: {
    name: string;
    email: string;
    /** Data-URL of a locally picked photo; null = default avatar. */
    avatar: string | null;
    accountType: 'personal' | 'pro';
  };
  startup: {
    launchAtLogin: boolean;
    startMinimized: boolean;
    openTo: OpenTo;
  };
  workspaces: {
    viewMode: 'grid' | 'list';
    filter: 'all' | 'pinned' | 'recent' | 'git';
    templateStripCollapsed: boolean;
  };
  defaults: {
    model: string;
    fallbackModel: string;
    workspace: string;
    budget: BudgetPreset;
    budgetCustom: number;
  };
  appearance: {
    density: Density;
    fontSize: FontSize;
    iconSize: IconSize;
    glass: boolean;
    glow: boolean;
    reduceMotion: boolean;
  };
  models: {
    providers: ProviderConfig[];
    defaults: DefaultModels;
  };
  shortcuts: {
    /** actionId → chord, for in-app shortcuts ('mod+shift+k' format). */
    overrides: Record<string, string>;
  };
  notifications: {
    enabled: boolean;
    style: NotificationStyle;
    sounds: boolean;
    volume: number;
    osEnabled: boolean;
    events: Record<NotificationEventKind, boolean>;
    quietHours: { enabled: boolean; from: string; to: string };
  };
  voice: {
    micDeviceId: string | null;
    inputVolume: number;
    ttsVoiceUri: string | null;
    rate: number;
    wakeWord: boolean;
    alwaysListen: boolean;
    soundsVolume: number;
    muted: boolean;
    /* Phase 15 mirror of the engine's voice settings (engine is the source
       of truth; voiceStore writes these after every accepted patch). */
    wakePhrase: string;
    wakeSensitivity: 'low' | 'medium' | 'high';
    wakeSound: boolean;
    sttModel: string;
    ttsVoice: string;
    pitch: number;
    theaterEnabled: boolean;
    autoExitSilence: number;
    showTranscripts: boolean;
    pttMode: 'hold' | 'tap' | 'always';
    noiseSuppression: boolean;
    chatMicTarget: 'screen' | 'docked';
    holdGlobalHotkey: boolean;
    profanityFilter: boolean;
  };
  privacy: {
    telemetry: boolean;
    crashReports: boolean;
    redactPii: boolean;
    redactPatterns: string[];
  };
  updates: {
    autoInstall: boolean;
    channel: UpdateChannel;
    lastChecked: number | null;
    skippedVersion: string | null;
  };
  about: {
    devtools: boolean;
  };
}

export const DEFAULT_SETTINGS: XRSettings = {
  profile: {
    name: '',
    email: '',
    avatar: null,
    accountType: 'personal',
  },
  startup: {
    launchAtLogin: false,
    startMinimized: false,
    openTo: 'chat',
  },
  workspaces: {
    viewMode: 'grid',
    filter: 'all',
    templateStripCollapsed: false,
  },
  defaults: {
    model: '',
    fallbackModel: '',
    workspace: 'personal',
    budget: '5',
    budgetCustom: 5,
  },
  appearance: {
    density: 'comfortable',
    fontSize: 14,
    iconSize: 'm',
    glass: true,
    glow: true,
    reduceMotion: false,
  },
  models: {
    providers: [],
    defaults: {
      chat: '',
      coding: '',
      embeddings: '',
      vision: '',
      stt: '',
      tts: '',
    },
  },
  shortcuts: {
    overrides: {},
  },
  notifications: {
    enabled: true,
    style: 'banner',
    sounds: false,
    volume: 70,
    osEnabled: true,
    events: {
      approval: true,
      agentComplete: true,
      budget: true,
      errors: true,
      voiceActivation: false,
      memorySaved: false,
      updates: true,
    },
    quietHours: { enabled: false, from: '22:00', to: '07:00' },
  },
  voice: {
    micDeviceId: null,
    inputVolume: 100,
    ttsVoiceUri: null,
    rate: 1,
    wakeWord: false,
    alwaysListen: false,
    soundsVolume: 70,
    muted: false,
    wakePhrase: 'hey xr',
    wakeSensitivity: 'medium',
    wakeSound: true,
    sttModel: 'sherpa-small-en',
    ttsVoice: 'piper-lessac',
    pitch: 0,
    theaterEnabled: false,
    autoExitSilence: 30,
    showTranscripts: true,
    pttMode: 'tap',
    noiseSuppression: true,
    chatMicTarget: 'screen',
    holdGlobalHotkey: false,
    profanityFilter: false,
  },
  privacy: {
    telemetry: false,
    crashReports: true,
    redactPii: true,
    redactPatterns: [
      '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
      '\\+?\\d{1,3}?[-.\\s]?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}',
      '\\b(?:\\d[ -]*?){13,16}\\b',
      'sk-[A-Za-z0-9]{20,}',
      'ghp_[A-Za-z0-9]{20,}',
    ],
  },
  updates: {
    autoInstall: true,
    channel: 'stable',
    lastChecked: null,
    skippedVersion: null,
  },
  about: {
    devtools: false,
  },
};

type SettingsGroup = keyof XRSettings;

/** Shallow-merge a loaded group over defaults (arrays replace wholesale). */
function mergeGroup<K extends SettingsGroup>(
  group: K,
  loaded: unknown
): XRSettings[K] {
  if (loaded === null || typeof loaded !== 'object') {
    return structuredClone(DEFAULT_SETTINGS[group]);
  }
  return {
    ...structuredClone(DEFAULT_SETTINGS[group]),
    ...(loaded as Partial<XRSettings[K]>),
  };
}

/** Merge an unknown persisted payload over defaults, group by group. */
export function mergeSettings(loaded: unknown): XRSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (loaded === null || typeof loaded !== 'object') return base;
  const raw = loaded as Record<string, unknown>;
  const next = { ...base } as Record<SettingsGroup, unknown>;
  for (const group of Object.keys(base) as SettingsGroup[]) {
    next[group] = mergeGroup(group, raw[group]);
  }
  return next as XRSettings;
}

/** Dot-path read used by tests and the Rust `set_setting` mirror. */
export function getPath(settings: XRSettings, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, settings);
}

/** Immutable dot-path write ('notifications.style' → new object). */
export function setPathImmutable<T>(
  settings: T,
  path: string,
  value: unknown
): T {
  const parts = path.split('.');
  const clone = (node: unknown, depth: number): unknown => {
    if (depth === parts.length) return value;
    const key = parts[depth];
    const record =
      node !== null && typeof node === 'object'
        ? { ...(node as Record<string, unknown>) }
        : {};
    record[key] = clone(record[key], depth + 1);
    return record;
  };
  return clone(settings, 0) as T;
}

interface SettingsStoreState {
  settings: XRSettings;
  hydrated: boolean;
  /** Boot hydration: durable store → defaults merge → apply effects. */
  load: () => Promise<void>;
  /** Group-level patch — the primary API for tab components. */
  update: <K extends SettingsGroup>(
    group: K,
    patch: Partial<XRSettings[K]>
  ) => void;
  /** Leaf path write ('notifications.style', 'banner'). */
  setPath: (path: string, value: unknown) => void;
  /** Cross-window `settings:changed` merge (no re-broadcast). */
  applyRemote: (key: string, value: unknown) => void;
  /** Reset every group to defaults (used by the typed-DELETE flow). */
  resetAll: () => void;
}

function commit(
  next: XRSettings,
  changedGroup: SettingsGroup | null
): Partial<SettingsStoreState> {
  writeSettingJSON(SETTINGS_KEY, next);
  if (changedGroup) {
    void settingsChanged(changedGroup, next[changedGroup]);
  }
  if (
    changedGroup === 'appearance' ||
    changedGroup === null ||
    changedGroup === undefined
  ) {
    applyAppearanceEffects(next.appearance);
  }
  return { settings: next };
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  hydrated: false,

  load: async () => {
    const loaded = await readSettingJSON<unknown>(SETTINGS_KEY);
    const merged = mergeSettings(loaded);
    applyAppearanceEffects(merged.appearance);
    set({ settings: merged, hydrated: true });
  },

  update: (group, patch) => {
    const next = {
      ...get().settings,
      [group]: { ...get().settings[group], ...patch },
    } as XRSettings;
    set(commit(next, group));
  },

  setPath: (path, value) => {
    const group = path.split('.')[0] as SettingsGroup;
    const next = setPathImmutable(get().settings, path, value);
    set(commit(next, group));
  },

  applyRemote: (key, value) => {
    const group = key.split('.')[0] as SettingsGroup;
    if (!(group in DEFAULT_SETTINGS)) return;
    const current = get().settings;
    const next = {
      ...current,
      [group]: mergeGroup(group, {
        ...(current[group] as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      }),
    } as XRSettings;
    set(commit(next, null));
  },

  resetAll: () => {
    const next = structuredClone(DEFAULT_SETTINGS);
    set(commit(next, null));
  },
}));

/** Current settings snapshot (imperative contexts: policy checks, IPC). */
export function currentSettings(): XRSettings {
  return useSettingsStore.getState().settings;
}
