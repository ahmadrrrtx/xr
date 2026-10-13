import { create } from 'zustand';
import type { ModelInfo, ThemeId } from '../types';
import { readSettings, writeSettings } from '../lib/idb';
import { applyTheme, resolveTheme, watchSystemTheme } from '../lib/theme';

interface SettingsState {
  ready: boolean;
  theme: ThemeId;
  model: string | null;
  models: ModelInfo[];
  pushEnabled: boolean;
  deviceName: string;
  opens: number;
  installPromptDismissed: boolean;
  pairingKeyReady: boolean;

  hydrate: () => Promise<void>;
  setTheme: (theme: ThemeId) => void;
  setModel: (model: string) => void;
  setModels: (models: ModelInfo[]) => void;
  setPushEnabled: (enabled: boolean) => void;
  setDeviceName: (name: string) => void;
  countOpen: () => Promise<number>;
  dismissInstallPrompt: () => void;
  setPairingKeyReady: (ready: boolean) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  theme: 'system',
  model: null,
  models: [],
  pushEnabled: false,
  deviceName: 'Phone',
  opens: 0,
  installPromptDismissed: false,
  pairingKeyReady: false,

  hydrate: async () => {
    const saved = await readSettings();
    const theme = (saved.theme ?? 'system') as ThemeId;
    set({
      ready: true,
      theme,
      model: saved.model ?? null,
      pushEnabled: saved.pushEnabled ?? false,
      deviceName: saved.deviceName ?? defaultDeviceName(),
      opens: saved.opens ?? 0,
      installPromptDismissed: saved.installPromptDismissed ?? false,
    });
    applyTheme(theme);
    // Live-follow the OS when "Follow system" is selected.
    watchSystemTheme(() => {
      if (get().theme === 'system') applyTheme('system');
    });
  },

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    void writeSettings({ theme });
  },

  setModel: (model) => {
    set({ model });
    void writeSettings({ model });
  },

  setModels: (models) => {
    const current = get().model;
    set({
      models,
      model: current && models.some((m) => m.id === current) ? current : (models[0]?.id ?? null),
    });
  },

  setPushEnabled: (pushEnabled) => {
    set({ pushEnabled });
    void writeSettings({ pushEnabled });
  },

  setDeviceName: (deviceName) => {
    set({ deviceName });
    void writeSettings({ deviceName });
  },

  countOpen: async () => {
    const opens = get().opens + 1;
    set({ opens });
    await writeSettings({ opens });
    return opens;
  },

  dismissInstallPrompt: () => {
    set({ installPromptDismissed: true });
    void writeSettings({ installPromptDismissed: true });
  },

  setPairingKeyReady: (pairingKeyReady) => set({ pairingKeyReady }),
}));

export function activeThemeId(): Exclude<ThemeId, 'system'> {
  return resolveTheme(useSettings.getState().theme);
}

function defaultDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Pixel/i.test(ua)) return 'Pixel';
  const android = /Android\s+[\d.]+;[^;]*\s([^)]+)\)/.exec(ua);
  if (android?.[1]) return android[1].split(' ').slice(0, 2).join(' ');
  return 'Phone';
}
