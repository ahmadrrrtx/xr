/*
 * Command palette state (Phase 5) — one instance per webview.
 *
 * The main window and the HUD each run their own JS context, so this store is
 * NOT shared between them; cross-window effects ride Tauri events (see
 * src/lib/hud.ts and commands/hud.rs). Inside a window it owns everything the
 * shared <CommandPalette> renders: open/close, mode (commands vs quick-ask),
 * the query, the quick-ask stream, and the recent-selections history that
 * pins a "Recent" group when the palette opens.
 */
import { create } from 'zustand';

import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';

export type PaletteMode = 'commands' | 'quick-ask';

export type QuickAskStatus = 'idle' | 'streaming' | 'done' | 'error' | 'stopped';

export interface QuickAskState {
  question: string;
  answer: string;
  status: QuickAskStatus;
}

interface PaletteState {
  open: boolean;
  mode: PaletteMode;
  query: string;
  /** Last 10 selected command ids, most recent first (persisted). */
  history: string[];
  quickAsk: QuickAskState;

  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setPaletteOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  startQuickAsk: (question: string) => void;
  appendQuickAskToken: (text: string) => void;
  finishQuickAsk: (status: Extract<QuickAskStatus, 'done' | 'error' | 'stopped'>) => void;
  resetQuickAsk: () => void;
  recordSelection: (id: string) => void;
}

const HISTORY_KEY = 'xr.palette.history';
const HISTORY_MAX = 10;

function readInitialHistory(): string[] {
  return readSettingJSONSync(HISTORY_KEY);
}

/** Synchronous seed (settings.json via localStorage mirror — see persistent-store). */
function readSettingJSONSync(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown);
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as string[]) : [];
  } catch {
    return [];
  }
}

const idleQuickAsk: QuickAskState = { question: '', answer: '', status: 'idle' };

export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  mode: 'commands',
  query: '',
  history: readInitialHistory(),
  quickAsk: idleQuickAsk,

  openPalette: () => set({ open: true }),

  closePalette: () =>
    set((s) => ({
      open: false,
      // A finished quick-ask lingers so closing feels instant; a NEW open
      // always starts clean.
      query: '',
      mode: 'commands',
      quickAsk: s.quickAsk.status === 'streaming' ? s.quickAsk : idleQuickAsk,
    })),

  togglePalette: () => (get().open ? get().closePalette() : get().openPalette()),

  setPaletteOpen: (open) => (open ? get().openPalette() : get().closePalette()),

  setQuery: (query) =>
    set((s) => {
      // Editing the query after a finished answer returns to command mode
      // (the answer stays visible only while the query is untouched).
      if (s.mode === 'quick-ask' && s.quickAsk.status !== 'streaming') {
        return { query, mode: 'commands', quickAsk: idleQuickAsk };
      }
      return { query };
    }),

  startQuickAsk: (question) =>
    set({ mode: 'quick-ask', quickAsk: { question, answer: '', status: 'streaming' } }),

  appendQuickAskToken: (text) =>
    set((s) => ({
      quickAsk: { ...s.quickAsk, answer: s.quickAsk.answer + text },
    })),

  finishQuickAsk: (status) =>
    set((s) => ({ quickAsk: { ...s.quickAsk, status } })),

  resetQuickAsk: () => set({ quickAsk: idleQuickAsk, mode: 'commands' }),

  recordSelection: (id) => {
    const history = [id, ...get().history.filter((h) => h !== id)].slice(0, HISTORY_MAX);
    writeSettingJSON(HISTORY_KEY, history);
    set({ history });
  },
}));

/** History is also persisted through the Tauri store — hydrate on boot. */
export async function hydratePaletteHistory(): Promise<void> {
  const stored = await readSettingJSON<string[]>(HISTORY_KEY);
  if (Array.isArray(stored)) {
    const clean = stored.filter((v): v is string => typeof v === 'string').slice(0, HISTORY_MAX);
    const current = usePaletteStore.getState().history;
    if (clean.length > 0 && clean.join('\u0000') !== current.join('\u0000')) {
      usePaletteStore.setState({ history: clean });
    }
  }
}
