import { create } from 'zustand';
import { api, isOfflineError, streamChat } from '../api/client';
import { cacheChats, cacheMessages, readChats, readMessages } from '../lib/idb';
import { uid } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useQueue } from './queue';
import { useConnection } from './connection';
import { useSettings } from './settings';
import type { ChatMessage, ChatSummary } from '../types';

interface ChatsState {
  chats: ChatSummary[];
  messages: Record<string, ChatMessage[]>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  streamingChatId: string | null;
  search: string;
  /** Set while a queued message is being replayed. */
  drainIds: string[];

  abort: AbortController | null;

  setSearch: (search: string) => void;
  load: (opts?: { force?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  loadMessages: (chatId: string, opts?: { force?: boolean }) => Promise<void>;
  newChat: () => Promise<string | null>;
  send: (chatId: string, content: string, opts?: { viaVoice?: boolean }) => Promise<void>;
  stop: () => void;
  regenerate: (chatId: string, messageId: string) => Promise<void>;
  /** Replay a queued send (called by the drain loop, in FIFO order). */
  replay: (chatId: string, content: string, localId: string) => Promise<void>;
  patchMessage: (chatId: string, messageId: string, patch: Partial<ChatMessage>) => void;
}

function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

function touchChat(chats: ChatSummary[], chatId: string, snippet: string): ChatSummary[] {
  return sortChats(
    chats.map((chat) =>
      chat.id === chatId
        ? { ...chat, lastMessage: snippet, updatedAt: Date.now(), unread: 0 }
        : chat,
    ),
  );
}

export const useChats = create<ChatsState>((set, get) => ({
  chats: [],
  messages: {},
  loading: false,
  refreshing: false,
  error: null,
  streamingChatId: null,
  search: '',
  drainIds: [],
  abort: null,

  setSearch: (search) => set({ search }),

  load: async ({ force } = {}) => {
    const state = get();
    if (state.loading && force !== true) return;
    if (state.chats.length === 0) set({ loading: true });

    try {
      const { chats } = await api.chats(50);
      const sorted = sortChats(chats);
      set({ chats: sorted, loading: false, error: null });
      await cacheChats(sorted);
      useConnection.getState().setOnline(true);
    } catch (error) {
      const cached = await readChats();
      if (cached.length > 0) {
        set({ chats: cached, loading: false, error: null });
      } else {
        set({
          chats: [],
          loading: false,
          error: isOfflineError(error)
            ? "Can't reach XR on this WiFi."
            : 'Something went wrong loading chats.',
        });
      }
      if (isOfflineError(error)) useConnection.getState().setOnline(false);
    } finally {
      set({ loading: false });
    }
  },

  refresh: async () => {
    set({ refreshing: true });
    await get().load({ force: true });
    set({ refreshing: false });
  },

  loadMessages: async (chatId, { force } = {}) => {
    const existing = get().messages[chatId];
    if (existing && existing.length > 0 && !force) return;

    if (!existing) {
      const cached = await readMessages(chatId);
      if (cached.length > 0) set((state) => ({ messages: { ...state.messages, [chatId]: cached } }));
    }

    try {
      const { messages } = await api.messages(chatId, 200);
      set((state) => ({ messages: { ...state.messages, [chatId]: messages }, error: null }));
      await cacheMessages(chatId, messages);
    } catch (error) {
      if (!get().messages[chatId]) {
        set({
          error: isOfflineError(error) ? "Can't reach XR on this WiFi." : 'Failed to load messages.',
        });
      }
    }
  },

  newChat: async () => {
    const optimisticId = uid('chat');
    const optimistic: ChatSummary = {
      id: optimisticId,
      title: 'New chat',
      updatedAt: Date.now(),
      lastMessage: '',
    };
    set((state) => ({
      chats: sortChats([optimistic, ...state.chats]),
      messages: { ...state.messages, [optimisticId]: [] },
    }));

    try {
      const created = await api.newChat();
      set((state) => ({
        chats: sortChats(
          state.chats.map((c) => (c.id === optimisticId ? { ...c, id: created.id, title: created.title } : c)),
        ),
      }));
      return created.id;
    } catch (error) {
      if (isOfflineError(error)) {
        await useQueue
          .getState()
          .add({
            id: uid('q'),
            url: '/api/v1/chats',
            method: 'POST',
            body: { title: 'New chat' },
            createdAt: Date.now(),
            localId: optimisticId,
            kind: 'new-chat',
            attempts: 0,
          });
        return optimisticId;
      }
      set((state) => ({ chats: state.chats.filter((c) => c.id !== optimisticId) }));
      return null;
    }
  },

  send: (chatId, content, opts) => {
    const localId = uid('msg');
    const userMessage: ChatMessage = {
      id: localId,
      chatId,
      role: 'user',
      content,
      createdAt: Date.now(),
      delivery: 'sending',
      viaVoice: opts?.viaVoice ?? false,
    };
    appendMessage(set, chatId, userMessage);
    set((state) => ({ chats: touchChat(state.chats, chatId, content) }));
    haptic('light');
    return performSend(set, get, chatId, content, localId);
  },

  replay: (chatId, content, localId) => performSend(set, get, chatId, content, localId, true),

  stop: () => {
    const { abort } = get();
    abort?.abort();
    set({ abort: null, streamingChatId: null });
    haptic('warning');
  },

  regenerate: async (chatId, messageId) => {
    const messages = get().messages[chatId] ?? [];
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const priorUser = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user');
    if (!priorUser) return;
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: messages.filter((m) => m.id !== messageId),
      },
    }));
    await performSend(set, get, chatId, priorUser.content, uid('msg'), false, true);
  },

  patchMessage: (chatId, messageId, patch) => {
    set((state) => {
      const list = state.messages[chatId];
      if (!list) return {};
      return {
        messages: {
          ...state.messages,
          [chatId]: list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
        },
      };
    });
  },
}));

/* ------------------------------------------------------------------ helpers --- */

type Setter = (partial: Partial<ChatsState> | ((state: ChatsState) => Partial<ChatsState>)) => void;
type Getter = () => ChatsState;

function appendMessage(set: Setter, chatId: string, message: ChatMessage): void {
  set((state) => ({
    messages: { ...state.messages, [chatId]: [...(state.messages[chatId] ?? []), message] },
  }));
}

async function performSend(
  set: Setter,
  get: Getter,
  chatId: string,
  content: string,
  localId: string,
  isReplay = false,
  isRegenerate = false,
): Promise<void> {
  let connection = useConnection.getState();

  // We only trust "connected". Anything else (offline, still probing, unknown)
  // gets one live check before we decide — fail-closed, and it keeps a stale
  // "connected" flag from swallowing the user's message.
  if (connection.status !== 'connected') {
    await connection.probe();
    connection = useConnection.getState();
  }

  // Offline: park it in the outbox and leave the ⌛ bubble on screen.
  if (connection.status === 'offline' || !connection.online) {
    await useQueue.getState().add({
      id: uid('q'),
      url: '/api/v1/chat',
      method: 'POST',
      body: { chatId, content },
      createdAt: Date.now(),
      localId,
      kind: 'chat',
      attempts: 0,
    });
    set((state) => {
      const list = state.messages[chatId] ?? [];
      return {
        messages: {
          ...state.messages,
          [chatId]: list.map((m) => (m.id === localId ? { ...m, delivery: 'queued' } : m)),
        },
      };
    });
    return;
  }

  const replyId = uid('msg');
  const controller = new AbortController();
  set({ abort: controller, streamingChatId: chatId });

  set((state) => ({
    messages: {
      ...state.messages,
      [chatId]: [
        ...(state.messages[chatId] ?? []).map((m) =>
          m.id === localId ? { ...m, delivery: 'sending' as const } : m,
        ),
        ...(isRegenerate
          ? []
          : [
              {
                id: replyId,
                chatId,
                role: 'assistant' as const,
                content: '',
                createdAt: Date.now(),
                streaming: true,
              } satisfies ChatMessage,
            ]),
      ],
    },
  }));

  try {
    const model = useSettings.getState().model ?? undefined;
    let accumulated = '';

    for await (const event of streamChat({ chatId, content, model, signal: controller.signal })) {
      if (event.type === 'token' && event.text) {
        accumulated += event.text;
        set((state) => {
          const list = state.messages[chatId] ?? [];
          return {
            messages: {
              ...state.messages,
              [chatId]: list.map((m) => (m.id === replyId ? { ...m, content: accumulated } : m)),
            },
          };
        });
      } else if (event.type === 'error') {
        throw new Error(event.message ?? 'Stream error');
      }
    }

    set((state) => {
      const list = (state.messages[chatId] ?? []).map((m) =>
        m.id === replyId
          ? { ...m, streaming: false, createdAt: Date.now() }
          : m.id === localId
            ? { ...m, delivery: 'sent' as const }
            : m,
      );
      return { messages: { ...state.messages, [chatId]: list }, abort: null, streamingChatId: null };
    });

    set((state) => ({ chats: touchChat(state.chats, chatId, accumulated.slice(0, 140)) }));
    void cacheMessages(chatId, get().messages[chatId] ?? []);
    haptic('success');
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    const offline = isOfflineError(error);

    set((state) => {
      const list = (state.messages[chatId] ?? []).map((m) => {
        if (m.id === replyId) {
          return aborted
            ? { ...m, streaming: false, content: m.content.length > 0 ? m.content : '_Stopped_' }
            : {
                ...m,
                streaming: false,
                content:
                  m.content.length > 0
                    ? m.content
                    : offline
                      ? "I can't reach XR on this WiFi. Your message is saved and will send when you're back."
                      : "Something went wrong reaching XR. Tap to retry.",
                error: offline ? 'offline' : 'failed',
              };
        }
        if (m.id === localId) {
          return offline ? { ...m, delivery: 'queued' as const } : m;
        }
        return m;
      });
      return { messages: { ...state.messages, [chatId]: list }, abort: null, streamingChatId: null };
    });

    if (offline) {
      useConnection.getState().setOnline(false);
      await useQueue.getState().add({
        id: uid('q'),
        url: '/api/v1/chat',
        method: 'POST',
        body: { chatId, content },
        createdAt: Date.now(),
        localId,
        kind: 'chat',
        attempts: 0,
      });
    } else if (!aborted) {
      haptic('error');
    }
  }

  if (isReplay) {
    set((state) => ({ drainIds: state.drainIds.filter((id) => id !== localId) }));
  }
}
