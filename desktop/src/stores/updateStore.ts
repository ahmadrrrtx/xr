/*
 * Update store (Phase 27) — one canonical place for "is there a new XR?".
 *
 * The Rust host owns the truth: it holds the pending `Update` and the verified
 * bytes, and it decides whether this build is provisioned at all. This store is
 * the webview's view of that, plus the three actions the UI can take (check,
 * download, install) and the channel/auto-download preferences.
 *
 * Three properties worth stating, because they are what make the UI honest:
 *
 *   · **A missing shell is a state, not a crash.** In a browser the store
 *     reports `provisioned: false` with a reason, so the Settings card renders
 *     real copy ("updates arrive with the desktop app") instead of spinning.
 *   · **`xr-update:state` is authoritative.** Every command returns the new
 *     state *and* the host emits it; the store takes whichever arrives, so two
 *     windows never disagree.
 *   · **Progress is cheap.** `xr-update:progress` updates one field, not the
 *     whole store, so a 40 MB download does not re-render the Settings tree 400
 *     times.
 */
import { create } from 'zustand';

import {
  SHELL_EVENTS,
  onShellEvent,
  type AvailableUpdate,
  type DownloadProgress,
  type UpdateChannelValue,
  type UpdateState,
} from '@/lib/native';
import { isTauri } from '@/lib/tauri';

interface UpdateStoreState {
  /** Latest state from the host, or a browser-safe default before the first read. */
  state: UpdateState;
  /** True once the host has answered at least once. */
  loaded: boolean;
  /** A check/download/install is in flight (for button spinners). */
  busy: 'check' | 'download' | 'install' | null;
  /** The release-notes modal is open. */
  modalOpen: boolean;

  load: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  setChannel: (channel: UpdateChannelValue) => Promise<void>;
  setAutoDownload: (enabled: boolean) => Promise<void>;
  skipVersion: (version: string) => Promise<void>;
  clearSkip: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  /** Test/SSR seam: inject a state without touching the host. */
  applyState: (state: UpdateState) => void;
}

/** What the UI shows before (or without) a shell. */
export function browserDefaultState(): UpdateState {
  return {
    provisioned: false,
    reason: isTauri()
      ? null
      : 'Browser preview — updates arrive with the desktop app.',
    channel: 'stable',
    channelOptions: ['stable', 'beta', 'nightly'],
    autoDownload: true,
    currentVersion: '0.0.0',
    available: null,
    skippedVersion: null,
    downloading: false,
    progress: null,
    readyToInstall: false,
    lastCheckMs: null,
    error: null,
  };
}

async function invokeShell<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  state: browserDefaultState(),
  loaded: false,
  busy: null,
  modalOpen: false,

  load: async () => {
    const state = await invokeShell<UpdateState>('updates_state');
    if (state) set({ state, loaded: true });
    else set({ loaded: true });
  },

  check: async () => {
    set({ busy: 'check' });
    const state = await invokeShell<UpdateState>('check_update');
    set({ busy: null });
    if (state) set({ state, loaded: true });
  },

  download: async () => {
    set({ busy: 'download' });
    const state = await invokeShell<UpdateState>('download_update');
    set({ busy: null });
    if (state) set({ state });
  },

  install: async () => {
    set({ busy: 'install' });
    const state = await invokeShell<UpdateState>('install_update');
    // On Windows the installer takes over and this promise may never settle
    // in a visible way; on macOS/Linux the host relaunches the app. Either
    // way, do not clear `busy` on success — the next thing the user sees is
    // the new version, not a spinner going away.
    if (state) set({ state, busy: null });
  },

  setChannel: async (channel) => {
    const state = await invokeShell<UpdateState>('updates_set_channel', { channel });
    if (state) set({ state });
  },

  setAutoDownload: async (enabled) => {
    const state = await invokeShell<UpdateState>('updates_set_auto_download', { enabled });
    if (state) set({ state });
  },

  skipVersion: async (version) => {
    const state = await invokeShell<UpdateState>('updates_skip_version', { version });
    if (state) set({ state, modalOpen: false });
  },

  clearSkip: async () => {
    const state = await invokeShell<UpdateState>('updates_clear_skip');
    if (state) set({ state });
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  applyState: (state) => set({ state, loaded: true }),
}));

/**
 * Subscribe the store to the host's events. Called once from the shell bridge
 * mounted in `App` — not from the store module itself, so importing the store in
 * a test does not open listeners.
 */
export function attachUpdateEvents(): () => void {
  const stopState = onShellEvent<UpdateState>(SHELL_EVENTS.updateState, (state) => {
    useUpdateStore.setState({ state, loaded: true });
  });
  const stopProgress = onShellEvent<DownloadProgress>(SHELL_EVENTS.updateProgress, (progress) => {
    useUpdateStore.setState((current) => ({
      state: { ...current.state, progress, downloading: true },
    }));
  });
  return () => {
    stopState();
    stopProgress();
  };
}

/* ── Derived selectors ─────────────────────────────────────────────────────── */

export function useAvailableUpdate(): AvailableUpdate | null {
  return useUpdateStore((state) => state.state.available);
}

/** True when an update is downloaded and waiting for a restart. */
export function usePendingRestart(): boolean {
  return useUpdateStore((state) => state.state.readyToInstall && state.state.available !== null);
}

/** The settings-row copy for the current state, so the tab stays declarative. */
export function updateStatusLine(state: UpdateState): string {
  if (state.error) return state.error;
  if (!state.provisioned && state.reason) return state.reason;
  if (state.downloading) {
    const percent = state.progress?.percent;
    return percent === null || percent === undefined
      ? 'Downloading…'
      : `Downloading… ${Math.round(percent)}%`;
  }
  if (state.readyToInstall) return 'Downloaded and verified — restart to install.';
  if (state.available) {
    return state.skippedVersion === state.available.version
      ? `XR ${state.available.version} is available (skipped).`
      : `XR ${state.available.version} is available.`;
  }
  return 'Up to date.';
}
