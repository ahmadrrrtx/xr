/*
 * Session list state (Phase 4). Durable via chat-db (SQLite in Tauri,
 * localStorage mirror in browser). The store owns: the list, the active
 * session id (kept in sync with the /chat/:sessionId route), and list
 * mutations (create/rename/archive/delete). Messages live in chatStore.
 */
import { create } from 'zustand';

import { chatDb, type Session } from '@/lib/chat-db';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';
import { engineDefaultModel } from '@/stores/engineStore';

/** Last-resort default when neither the user nor the engine has chosen. */
export const DEFAULT_MODEL = 'claude-sonnet-4.5';

/** Persisted default (seeded by onboarding / last picker choice). */
let defaultModel: string | null = null;

/** Phase 14: the picker's choice becomes the default for new sessions now, not after a reload. */
export async function setDefaultModel(id: string): Promise<void> {
  defaultModel = id;
  await writeSettingJSON('xr.model.default', id);
}

/** New-session model: user default → engine's current default → fallback. */
export function resolveDefaultModel(): string {
  return defaultModel ?? engineDefaultModel() ?? DEFAULT_MODEL;
}

interface SessionsState {
  sessions: Session[];
  activeSessionId: string | null;
  loading: boolean;
  /** Panel visibility (⌘⇧O). Auto-hides under 960px; explicit toggle wins. */
  panelOpen: boolean;

  loadSessions: () => Promise<void>;
  loadDefaultModel: () => Promise<void>;
  createNewSession: (model?: string) => Promise<Session>;
  selectSession: (id: string | null) => void;
  renameSession: (id: string, title: string) => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** Phase 19: a fresh, titled session (agent chats never reuse "New chat"). */
  createTitledSession: (title: string, model?: string) => Promise<Session>;
  /** Auto-title from the first user message (truncate 40 chars). */
  titleFromFirstMessage: (id: string, text: string) => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

/** Derive the list title: first line, whitespace-normalized, 40 chars max. */
export function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0] ?? '';
  const clean = first.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > 40 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  loading: true,
  panelOpen: true,

  loadSessions: async () => {
    set({ loading: true });
    const sessions = await chatDb.listSessions();
    set({ sessions, loading: false });
  },

  loadDefaultModel: async () => {
    const v = await readSettingJSON<string>('xr.model.default');
    if (typeof v === 'string' && v) defaultModel = v;
  },

  createNewSession: async (model) => {
    const now = Date.now();
    // Reuse an existing empty session instead of stacking blank ones.
    const existing = get().sessions.find(
      (s) => s.title === 'New chat' && now - s.updatedAt < 5 * 60_000,
    );
    if (existing) {
      set({ activeSessionId: existing.id });
      return existing;
    }
    const session = await chatDb.createSession(newId(), 'New chat', model ?? resolveDefaultModel(), now);
    set((st) => ({
      sessions: [session, ...st.sessions],
      activeSessionId: session.id,
    }));
    return session;
  },

  createTitledSession: async (title, model) => {
    const now = Date.now();
    const session = await chatDb.createSession(newId(), title.slice(0, 80) || 'New chat', model ?? resolveDefaultModel(), now);
    set((st) => ({ sessions: [session, ...st.sessions], activeSessionId: session.id }));
    return session;
  },

  selectSession: (id) => set({ activeSessionId: id }),

  renameSession: async (id, title) => {
    const now = Date.now();
    await chatDb.updateSessionTitle(id, title, now);
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, title, updatedAt: now } : s)),
    }));
  },

  titleFromFirstMessage: async (id, text) => {
    const s = get().sessions.find((x) => x.id === id);
    if (!s || s.title !== 'New chat') return; // only auto-title once
    const title = deriveTitle(text);
    await get().renameSession(id, title);
  },

  archiveSession: async (id) => {
    await chatDb.archiveSession(id, true);
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      activeSessionId: st.activeSessionId === id ? null : st.activeSessionId,
    }));
  },

  deleteSession: async (id) => {
    await chatDb.deleteSession(id);
    try {
      window.localStorage.removeItem(`xr.chat.agent.${id}`);
    } catch {
      /* nothing to forget */
    }
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      activeSessionId: st.activeSessionId === id ? null : st.activeSessionId,
    }));
  },

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((st) => ({ panelOpen: !st.panelOpen })),
}));
