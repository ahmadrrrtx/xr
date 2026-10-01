/*
 * Chat persistence — typed contract with two implementations.
 *
 * Inside Tauri: the `chat_*` Rust commands (rusqlite, WAL, xr.db in the app
 * data dir — src-tauri/src/commands/chat.rs). In a plain browser (bun dev /
 * Playwright): a localStorage mirror with the exact same contract so the
 * whole chat flow is testable without the native shell. Session/message
 * shapes are identical across both.
 */
import { isTauri } from '@/lib/tauri';

export interface Session {
  id: string;
  title: string;
  model?: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'system';

/** Anything that isn't plain text lives here (segments, status, attachments). */
export interface MessageMetadata {
  /** Ordered parts — lets tool cards interject between text segments. */
  segments?: Array<{ type: 'text'; text: string } | { type: 'tool'; index: number }>;
  status?: 'queued' | 'failed' | 'error';
  attachments?: Array<{ name: string; size: number }>;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata;
  toolCalls?: ToolCallRecord[] | null;
  createdAt: number;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  summary: string;
  category: 'llm' | 'tool' | 'file' | 'network' | 'shell' | 'approval';
  input?: unknown;
  output?: string;
  status: 'running' | 'done' | 'error' | 'waiting-approval';
  error?: string;
  /** Phase 7: the approval request gating this call, while one is pending. */
  approvalId?: string;
}

export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface ChatDb {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  createSession(id: string, title: string, model: string | null, now: number): Promise<Session>;
  updateSessionTitle(id: string, title: string, now: number): Promise<void>;
  updateSessionModel(id: string, model: string): Promise<void>;
  archiveSession(id: string, archived: boolean): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listMessages(sessionId: string, cursor: number | null, limit: number): Promise<MessagePage>;
  saveMessage(msg: ChatMessage): Promise<void>;
  deleteMessage(id: string): Promise<void>;
}

/* ── Tauri impl ─────────────────────────────────────────────────────────── */

async function invokeChat<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Rust serializes snake_case → camelCase; messages arrive as raw rows. */
interface RawMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  metadata: MessageMetadata | null;
  toolCalls: ToolCallRecord[] | null;
  createdAt: number;
}

const tauriDb: ChatDb = {
  async listSessions() {
    return invokeChat<Session[]>('chat_list_sessions');
  },
  async getSession(id) {
    return invokeChat<Session | null>('chat_get_session', { id });
  },
  async createSession(id, title, model, now) {
    return invokeChat<Session>('chat_create_session', { id, title, model, now });
  },
  async updateSessionTitle(id, title, now) {
    await invokeChat<void>('chat_update_session_title', { id, title, now });
  },
  async updateSessionModel(id, model) {
    await invokeChat<void>('chat_update_session_model', { id, model });
  },
  async archiveSession(id, archived) {
    await invokeChat<void>('chat_archive_session', { id, archived });
  },
  async deleteSession(id) {
    await invokeChat<void>('chat_delete_session', { id });
  },
  async listMessages(sessionId, cursor, limit) {
    const page = await invokeChat<{ messages: RawMessage[]; hasMore: boolean }>(
      'chat_list_messages',
      { sessionId, cursor, limit },
    );
    return {
      hasMore: page.hasMore,
      messages: page.messages.map((m) => ({
        ...m,
        role: m.role as MessageRole,
        metadata: m.metadata ?? undefined,
        toolCalls: m.toolCalls ?? undefined,
      })),
    };
  },
  async saveMessage(msg) {
    await invokeChat<void>('chat_save_message', {
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role,
      content: msg.content,
      metadata: msg.metadata ?? null,
      toolCalls: msg.toolCalls ?? null,
      createdAt: msg.createdAt,
    });
  },
  async deleteMessage(id) {
    await invokeChat<void>('chat_delete_message', { id });
  },
};

/* ── Browser impl (localStorage mirror) ─────────────────────────────────── */

const LS_SESSIONS = 'xr.chat.sessions.v1';
const LS_MESSAGES = 'xr.chat.messages.v1';

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full/unavailable — session-only */
  }
}

const browserDb: ChatDb = {
  async listSessions() {
    return readLS<Session[]>(LS_SESSIONS, [])
      .filter((s) => !s.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100);
  },
  async getSession(id) {
    return readLS<Session[]>(LS_SESSIONS, []).find((s) => s.id === id) ?? null;
  },
  async createSession(id, title, model, now) {
    const all = readLS<Session[]>(LS_SESSIONS, []);
    const session: Session = { id, title, model, createdAt: now, updatedAt: now, archived: false };
    writeLS(LS_SESSIONS, [...all, session]);
    return session;
  },
  async updateSessionTitle(id, title, now) {
    const all = readLS<Session[]>(LS_SESSIONS, []);
    const s = all.find((x) => x.id === id);
    if (s) {
      s.title = title;
      s.updatedAt = now;
      writeLS(LS_SESSIONS, all);
    }
  },
  async updateSessionModel(id, model) {
    const all = readLS<Session[]>(LS_SESSIONS, []);
    const s = all.find((x) => x.id === id);
    if (s) {
      s.model = model;
      writeLS(LS_SESSIONS, all);
    }
  },
  async archiveSession(id, archived) {
    const all = readLS<Session[]>(LS_SESSIONS, []);
    const s = all.find((x) => x.id === id);
    if (s) {
      s.archived = archived;
      writeLS(LS_SESSIONS, all);
    }
  },
  async deleteSession(id) {
    writeLS(
      LS_SESSIONS,
      readLS<Session[]>(LS_SESSIONS, []).filter((s) => s.id !== id),
    );
    const msgs = readLS<ChatMessage[]>(LS_MESSAGES, []);
    writeLS(
      LS_MESSAGES,
      msgs.filter((m) => m.sessionId !== id),
    );
  },
  async listMessages(sessionId, cursor, limit) {
    const all = readLS<ChatMessage[]>(LS_MESSAGES, [])
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt); // newest first
    const idx = cursor === null ? 0 : all.findIndex((m) => m.createdAt < cursor);
    const start = cursor !== null && idx === -1 ? all.length : idx;
    const page = all.slice(start, start + limit + 1);
    const hasMore = page.length > limit;
    const trimmed = hasMore ? page.slice(0, limit) : page;
    return { messages: trimmed.reverse(), hasMore }; // oldest → newest
  },
  async saveMessage(msg) {
    const all = readLS<ChatMessage[]>(LS_MESSAGES, []);
    const idx = all.findIndex((m) => m.id === msg.id);
    if (idx === -1) all.push(msg);
    else all[idx] = msg;
    writeLS(LS_MESSAGES, all);
    const sessions = readLS<Session[]>(LS_SESSIONS, []);
    const s = sessions.find((x) => x.id === msg.sessionId);
    if (s) {
      s.updatedAt = msg.createdAt;
      writeLS(LS_SESSIONS, sessions);
    }
  },
  async deleteMessage(id) {
    writeLS(
      LS_MESSAGES,
      readLS<ChatMessage[]>(LS_MESSAGES, []).filter((m) => m.id !== id),
    );
  },
};

/** The active backend — Tauri when hosted, localStorage mirror in browser. */
export const chatDb: ChatDb = isTauri() ? tauriDb : browserDb;
