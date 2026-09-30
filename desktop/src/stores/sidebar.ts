/*
 * Sidebar state — collapsed by default on launch, persisted via the
 * write-through settings layer (Tauri Store + localStorage).
 * Below 960px viewport width the sidebar is forced collapsed
 * (docs/SCREEN-BRIEFS.md · GLOBAL APPLICATION SHELL).
 */
import { create } from 'zustand';

import { writeSettingJSON } from '@/lib/persistent-store';

const STORAGE_KEY = 'xr.sidebar.collapsed';

function readInitial(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Default: collapsed (icon rail) on first launch.
    return raw === null ? true : JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

interface SidebarState {
  collapsed: boolean;
  /** True once the persisted value has been applied (guards late hydration). */
  hydrated: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  hydrate: (collapsed: boolean) => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: readInitial(),
  hydrated: false,

  setCollapsed: (collapsed) => {
    if (collapsed === get().collapsed) return;
    writeSettingJSON(STORAGE_KEY, collapsed);
    set({ collapsed });
  },

  toggle: () => {
    get().setCollapsed(!get().collapsed);
  },

  hydrate: (collapsed) => {
    // Never clobber a deliberate user action that raced hydration.
    if (get().hydrated) return;
    writeSettingJSON(STORAGE_KEY, collapsed);
    set({ collapsed, hydrated: true });
  },
}));
