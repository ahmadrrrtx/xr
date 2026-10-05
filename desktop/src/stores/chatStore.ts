/*
 * Chat conversation state (Phase 4): messages per session, the streaming
 * pipeline (mock provider → tokens/tool events → persisted assistant
 * message), attachments, offline queue, and pagination cursors.
 *
 * Streaming shape: `stream` holds the in-flight assistant turn
 * { sessionId, text, toolCalls, status } — tokens append to `text`, tool
 * events update `toolCalls`. On `done` the turn is persisted (content +
 * segments in metadata) and `stream` clears. `editingId` tracks a user
 * message being edited (v1: save → send as new message).
 */
import { create } from 'zustand';

import { makeApprovalGate } from '@/lib/approvalEvents';
import {
  chatDb,
  type ChatMessage,
  type MessagePage,
  type ToolCallRecord,
} from '@/lib/chat-db';
import { streamChat, type ChatTurn } from '@/lib/mockLLM';
import { orbSetState } from '@/lib/orb';
import { newId, useSessionsStore } from '@/stores/sessionsStore';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'error';

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** dataURL preview for images (UI-only in v1). */
  preview?: string;
}

export interface StreamingTurn {
  sessionId: string;
  text: string;
  toolCalls: ToolCallRecord[];
  status: StreamStatus;
  startedAt: number;
}

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  hasMore: Record<string, boolean>;
  loadingSession: boolean;
  loadingMore: boolean;
  stream: StreamingTurn | null;
  attachments: FileAttachment[];
  online: boolean;
  /** ids of user messages parked while offline. */
  queuedIds: string[];

  loadMessages: (sessionId: string) => Promise<void>;
  loadOlder: (sessionId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  cancelGeneration: () => void;
  retryMessage: (id: string) => Promise<void>;
  regenerate: (assistantId: string) => Promise<void>;
  setOnline: (online: boolean) => void;
  flushQueued: () => Promise<void>;
  addAttachment: (f: FileAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
}

let controller: AbortController | null = null;

/** Persist + upsert a message locally (append, or replace in place on retry). */
async function commit(msg: ChatMessage, prepend = false): Promise<void> {
  await chatDb.saveMessage(msg);
  useChatStore.setState((st) => {
    const list = st.messages[msg.sessionId] ?? [];
    const idx = list.findIndex((m) => m.id === msg.id);
    const next =
      idx === -1
        ? prepend
          ? [msg, ...list]
          : [...list, msg]
        : list.map((m) => (m.id === msg.id ? msg : m));
    return { messages: { ...st.messages, [msg.sessionId]: next } };
  });
}

function currentUserTurns(sessionId: string): ChatTurn[] {
  const msgs = useChatStore.getState().messages[sessionId] ?? [];
  return msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.metadata?.status !== 'queued' && m.metadata?.status !== 'failed')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

/** Run the (mock) provider and fold events into store state. */
async function runGeneration(sessionId: string, history: ChatTurn[]): Promise<void> {
  const sessions = useSessionsStore.getState();
  controller = new AbortController();
  const signal = controller.signal;

  useChatStore.setState({
    stream: { sessionId, text: '', toolCalls: [], status: 'connecting', startedAt: Date.now() },
  });
  // Companion Orb (Phase 6): XR is thinking until the first token lands.
  void orbSetState('thinking');

  await streamChat({
    messages: history,
    model: sessions.sessions.find((s) => s.id === sessionId)?.model ?? 'claude-sonnet-4.5',
    signal,
    // Phase 7: permission-gated tools park the stream on the approval modal.
    requestApproval: makeApprovalGate(signal),
    onEvent: (e) => {
      const st = useChatStore.getState();
      const stream = st.stream;
      if (!stream || stream.sessionId !== sessionId) return; // stale (switched away)

      switch (e.type) {
        case 'token': {
          if (stream.status !== 'streaming') {
            useChatStore.setState({
              stream: { ...stream, status: 'streaming', text: stream.text + e.text },
            });
            void orbSetState('speaking');
          } else {
            useChatStore.setState({ stream: { ...stream, text: stream.text + e.text } });
          }
          return;
        }
        case 'tool_call': {
          useChatStore.setState({
            stream: { ...stream, toolCalls: [...stream.toolCalls, e.call] },
          });
          // Phase 11: the first tool call of a reply is an agent run — give
          // it a short Brain run so it shows up in the Control Room (and the
          // card's "View trace" lands on it). Lazy import: no store cycle.
          if (stream.toolCalls.length === 0) {
            void import('@/stores/brainStore').then(({ useBrainStore }) => {
              const b = useBrainStore.getState();
              const live = b.runOrder.some(
                (id) =>
                  b.runs[id]?.status === 'running' ||
                  b.runs[id]?.status === 'waiting'
              );
              if (!live) b.startMockRun(e.call.summary, { flavor: 'short' });
            });
          }
          return;
        }
        case 'tool_result': {
          useChatStore.setState({
            stream: {
              ...stream,
              toolCalls: stream.toolCalls.map((t) =>
                t.id === e.id ? { ...t, status: e.status, output: e.output } : t,
              ),
            },
          });
          return;
        }
        case 'error': {
          useChatStore.setState({
            stream: { ...stream, status: 'error' },
          });
          void orbSetState('error');
          // Persist the partial as an errored assistant message.
          const msg: ChatMessage = {
            id: newId(),
            sessionId,
            role: 'assistant',
            content: stream.text,
            createdAt: Date.now(),
            metadata: {
              ...(stream.text ? { segments: [{ type: 'text', text: stream.text }] } : {}),
              status: 'error',
            },
            toolCalls: stream.toolCalls.length ? stream.toolCalls : undefined,
          };
          void commit(msg);
          useChatStore.setState({ stream: null });
          return;
        }
        case 'done': {
          // Compose the final message: text segments + tool cards interleaved
          // in arrival order (tools land between the text that surrounded them).
          void finishStream(sessionId, stream);
          return;
        }
      }
    },
  }).finally(() => {
    if (controller?.signal === signal) controller = null;
  });
}

/** Fold a finished streaming turn into a persisted assistant message. */
async function finishStream(sessionId: string, stream: StreamingTurn): Promise<void> {
  if (!stream.text && stream.toolCalls.length === 0) {
    useChatStore.setState({ stream: null });
    void orbSetState('idle');
    return;
  }
  const segments: NonNullable<ChatMessage['metadata']>['segments'] = [];
  if (stream.text) segments.push({ type: 'text', text: stream.text });
  for (let i = 0; i < stream.toolCalls.length; i++) segments.push({ type: 'tool', index: i });
  const msg: ChatMessage = {
    id: newId(),
    sessionId,
    role: 'assistant',
    content: stream.text,
    createdAt: Date.now(),
    metadata: { segments },
    toolCalls: stream.toolCalls,
  };
  await commit(msg);
  useChatStore.setState({ stream: null });
  void orbSetState('idle');
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  hasMore: {},
  loadingSession: false,
  loadingMore: false,
  stream: null,
  attachments: [],
  online: true,
  queuedIds: [],

  loadMessages: async (sessionId) => {
    set({ loadingSession: true });
    const page: MessagePage = await chatDb.listMessages(sessionId, null, 30);
    set((st) => ({
      messages: { ...st.messages, [sessionId]: page.messages },
      hasMore: { ...st.hasMore, [sessionId]: page.hasMore },
      loadingSession: false,
    }));
  },

  loadOlder: async (sessionId) => {
    const st = get();
    const list = st.messages[sessionId];
    if (!list || list.length === 0 || st.loadingMore || !st.hasMore[sessionId]) return;
    const cursor = list[0].createdAt;
    set({ loadingMore: true });
    const page = await chatDb.listMessages(sessionId, cursor, 30);
    set((s2) => ({
      messages: { ...s2.messages, [sessionId]: [...page.messages, ...(s2.messages[sessionId] ?? [])] },
      hasMore: { ...s2.hasMore, [sessionId]: page.hasMore },
      loadingMore: false,
    }));
  },

  sendMessage: async (rawText) => {
    const text = rawText.trim();
    if (!text && get().attachments.length === 0) return;
    const sessions = useSessionsStore.getState();
    let sessionId = sessions.activeSessionId;
    if (!sessionId) {
      const s = await sessions.createNewSession();
      sessionId = s.id;
    }

    // Attachments ride along as a text note (v1 contract — no upload yet).
    const atts = get().attachments;
    const note = atts.length
      ? `\n\n${atts.map((a) => `[Attached: ${a.name}]`).join('\n')}`
      : '';
    const content = text + note;

    const userMsg: ChatMessage = {
      id: newId(),
      sessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
      metadata: atts.length
        ? { attachments: atts.map(({ name, size }) => ({ name, size })) }
        : undefined,
    };

    set({ attachments: [] }); // strip clears on send (v1)

    // Offline → park as queued, flush on reconnect.
    if (!get().online) {
      await commit({ ...userMsg, metadata: { ...userMsg.metadata, status: 'queued' } });
      set((st) => ({ queuedIds: [...st.queuedIds, userMsg.id] }));
      return;
    }

    await commit(userMsg);
    void sessions.titleFromFirstMessage(sessionId, text);
    await runGeneration(sessionId, [...currentUserTurns(sessionId), { role: 'user', content }]);
  },

  cancelGeneration: () => {
    const stream = get().stream;
    controller?.abort();
    controller = null;
    if (stream) {
      // Keep whatever streamed so far as a normal assistant message.
      void finishStream(stream.sessionId, stream);
    }
  },

  retryMessage: async (id) => {
    // Mark the failed user message healthy and regenerate from it.
    const all = Object.values(get().messages).flat();
    const msg = all.find((m) => m.id === id);
    if (!msg) return;
    await commit({ ...msg, metadata: { ...msg.metadata, status: undefined } });
    await runGeneration(msg.sessionId, [
      ...currentUserTurns(msg.sessionId),
      { role: 'user', content: msg.content },
    ]);
  },

  regenerate: async (assistantId) => {
    const all = Object.values(get().messages).flat();
    const msg = all.find((m) => m.id === assistantId);
    if (!msg) return;
    await runGeneration(msg.sessionId, currentUserTurns(msg.sessionId));
  },

  setOnline: (online) => {
    set({ online });
    if (online) void get().flushQueued();
  },

  flushQueued: async () => {
    const ids = get().queuedIds;
    if (ids.length === 0) return;
    set({ queuedIds: [] });
    for (const id of ids) {
      await get().retryMessage(id);
    }
  },

  addAttachment: (f) => set((st) => ({ attachments: [...st.attachments, f] })),
  removeAttachment: (id) =>
    set((st) => ({ attachments: st.attachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
}));

/** Announce assistant completions to screen readers (aria-live mirror). */
export function lastAssistantAnnouncement(msgs: ChatMessage[]): string {
  const last = [...msgs].reverse().find((m) => m.role === 'assistant');
  return last ? last.content.slice(0, 300) : '';
}
