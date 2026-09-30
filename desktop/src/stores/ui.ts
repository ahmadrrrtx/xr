/*
 * UI-wide state: host platform, command-palette visibility and the persisted
 * display name (used by the sidebar user card and the topbar user menu).
 */
import { create } from 'zustand';

import type { Platform } from '@/lib/tauri';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';

const NAME_KEY = 'xr.user.name';

function readInitialName(): string {
  try {
    const raw = window.localStorage.getItem(NAME_KEY);
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown);
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : 'You';
  } catch {
    return 'You';
  }
}

interface UIState {
  platform: Platform;
  userName: string;
  setPlatform: (platform: Platform) => void;
  setUserName: (name: string) => void;
  hydrateUserName: (name: string | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  platform: 'web',
  userName: readInitialName(),

  setPlatform: (platform) => set({ platform }),

  setUserName: (name) => {
    writeSettingJSON(NAME_KEY, name);
    set({ userName: name });
  },

  hydrateUserName: (name) => {
    if (
      typeof name === 'string' &&
      name.length > 0 &&
      name !== get().userName
    ) {
      writeSettingJSON(NAME_KEY, name);
      set({ userName: name });
    }
  },
}));

/** Startup hydration for everything persisted under the UI store. */
export async function hydrateUIState(): Promise<void> {
  const name = await readSettingJSON<string>(NAME_KEY);
  useUIStore.getState().hydrateUserName(name);
}
