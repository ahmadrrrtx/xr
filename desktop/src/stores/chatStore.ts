/*
 * Chat conversation state (Phase 4; Phase 14: real engine): messages per
 * session, the streaming pipeline (engine SSE → tokens/tool/status events →
 * persisted assistant message), attachments, offline queue, pagination.
 *
 * Streaming shape: `stream` holds the in-flight assistant turn
 * { sessionId, text, toolCalls, status, phase, runId, usage } — tokens
 * append to `text`, tool events update `toolCalls`, engine status frames
 * update `phase` ("Waiting for qwen2.5:0.5b…"). On `done` the turn is
 * persisted (content + segments + run/usage in metadata) and `stream`
 * clears. A failed turn persists with `metadata.error{kind}` so the bubble
 * renders the honest state (no provider, engine down, …) — never a fake
 * reply. `mode` (ask/agent/plan) is per session, default agent.
 */
import { create } from 'zustand';

import { makeApprovalGate } from '@/lib/approvalEvents';
import {
  chatDb,
  type BudgetNote,
  type ChatMessage,
  type MessagePage,
  type ToolCallRecord,
  type TurnError,
} from '@/lib/chat-db';
import { streamChat, type ChatMode, type ChatTurn, type StreamEvent } from '@/lib/llm';
import { orbSetState } from '@/lib/orb';
import type { EngineRunRecorder } from '@/brain/engine';
import { useBrainStore } from '@/stores/brainStore';
import { useEngineStore } from '@/stores/engineStore';
import { newId, resolveDefaultModel, useSessionsStore } from '@/stores/sessionsStore';

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'error';

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /** dataURL preview for images (UI-only in v1). */
  preview?: string;
  /** Phase 14: text content (UTF-8 files ≤ 1 MB) sent to the engine. */
  text?: string;
}

export interface StreamingTurn {
  sessionId: string;
  text: string;
  toolCalls: ToolCallRecord[];
  status: StreamStatus;
  startedAt: number;
  /** Phase 13: downshift / cutoff note carried into the final message. */
  budget?: BudgetNote;
  /** Phase 14: engine status vocabulary (`provider_selection`, `generating`, …). */
  phase?: string;
  phaseMessage?: string;
  provider?: string;
  model: string;
  mode: ChatMode;
  runId?: string;
  usage?: { inTokens: number; outTokens: number };
  firstTokenAt?: number;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  path: string;
}

/** What the engine is told about the open workspace (system-prompt context). */
export function workspaceContextText(ws: WorkspaceContext): string {
  return `The user is working in the workspace "${ws.name}" located at ${ws.path}. Treat that directory as the project root: read and write files there unless told otherwise, and keep answers specific to this project.`;
}

export const CHAT_MODES: readonly ChatMode[] = ['ask', 'agent', 'plan'];
const MODE_KEY = (id: string | null): string => `xr.chat.mode.${id ?? 'default'}`;

function readMode(sessionId: string | null): ChatMode | null {
  try {
    const v = window.localStorage.getItem(MODE_KEY(sessionId));
    return v === 'ask' || v === 'agent' || v === 'plan' ? v : null;
  } catch {
    return null;
  }
}

/** Per-session mode, falling back to the last chosen default, then `agent`. */
export function modeFor(sessionId: string | null): ChatMode {
  return readMode(sessionId) ?? readMode(null) ?? 'agent';
}

const MAX_ATTACHMENT_BYTES = 1024 * 1024;
export { MAX_ATTACHMENT_BYTES };

/** Fenced blocks for attached text files (what the engine sees). */
export function attachmentText(atts: FileAttachment[]): string {
  return atts
    .filter((a) => typeof a.text === 'string' && a.text.length > 0)
    .map((a) => `\n\n--- Attached file: ${a.name} ---\n${a.text}\n--- end of ${a.name} ---`)
    .join('');
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
  /** Phase 14: per-session execution mode (ask / agent / plan). */
  modes: Record<string, ChatMode>;
  setMode: (sessionId: string | null, mode: ChatMode) => void;
  /** Phase 14: Workbench context (`/chat?workspace=:id`) sent with every turn. */
  workspace: WorkspaceContext | null;
  setWorkspace: (ws: WorkspaceContext | null) => void;

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
    .filter((m) => !(m.role === 'assistant' && m.metadata?.error && !m.content))
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content + (m.metadata?.attachmentText ?? ''),
    }));
}

/** The engine is known to be down (two misses) — don't pretend to send. */
function engineKnownDown(): boolean {
  const e = useEngineStore.getState();
  return (e.status === 'down' && e.failures >= 2) || e.status === 'unauthorized';
}

/** Run the engine and fold its events into store state. */
async function runGeneration(sessionId: string, history: ChatTurn[]): Promise<void> {
  const sessions = useSessionsStore.getState();
  controller = new AbortController();
  const signal = controller.signal;
  const model = sessions.sessions.find((s) => s.id === sessionId)?.model ?? resolveDefaultModel();
  const mode = useChatStore.getState().modes[sessionId] ?? modeFor(sessionId);

  useChatStore.setState({
    stream: {
      sessionId,
      text: '',
      toolCalls: [],
      status: 'connecting',
      startedAt: Date.now(),
      model,
      mode,
    },
  });
  // Companion Orb (Phase 6): XR is thinking until the first token lands.
  void orbSetState('thinking');

  const patchStream = (fn: (st: StreamingTurn) => Partial<StreamingTurn>): void => {
    const cur = useChatStore.getState().stream;
    if (cur && cur.sessionId === sessionId) useChatStore.setState({ stream: { ...cur, ...fn(cur) } });
  };

  const workspace = useChatStore.getState().workspace;

  // Phase 14: every engine turn is a real Brain run. The recorder starts
  // when the engine acknowledges (its run id keys the trace, so the tool
  // card's "View trace" deep-link resolves); events before that are replayed.
  let recorder: EngineRunRecorder | null = null;
  const early: StreamEvent[] = [];
  const prompt = history[history.length - 1]?.content ?? '';
  const turnStartedAt = Date.now();
  const tee = (e: StreamEvent): void => {
    if (recorder) {
      recorder.feed(e);
      return;
    }
    if (e.type === 'run') {
      const title = useSessionsStore.getState().sessions.find((x) => x.id === sessionId)?.title;
      recorder = useBrainStore.getState().beginEngineRun(
        e.runId,
        {
          title: (title && title !== 'New chat' ? title : prompt).slice(0, 72) || 'Chat turn',
          agent: 'Main',
          model: useChatStore.getState().stream?.model ?? model,
          ...(workspace ? { workspace: workspace.name } : {}),
          startedAt: turnStartedAt,
          sessionId,
          prompt: prompt.slice(0, 2000),
          mode,
          quiet: true,
        },
        { stop: () => controller?.abort() },
      );
      recorder.feed(e);
      for (const b of early) recorder.feed(b);
      early.length = 0;
      return;
    }
    if (early.length < 200) early.push(e);
  };

  await streamChat({
    messages: history,
    model,
    mode,
    sessionId,
    signal,
    ...(workspace ? { context: workspaceContextText(workspace) } : {}),
    // Phase 7 contract (mock seam only; engine approvals bridge themselves).
    requestApproval: makeApprovalGate(signal),
    // Phase 13: the budget governor gates, meters and bills this turn.
    budget: { surface: 'chat', sessionId, agent: 'main', workspace: workspace?.id ?? null },
    onEvent: (e) => {
      tee(e);
      const st = useChatStore.getState();
      const stream = st.stream;
      if (e.type === 'budget_charged') {
        // Lands after the stream settles: keep the cost with the turn.
        if (stream && stream.sessionId === sessionId) {
          useChatStore.setState({
            stream: {
              ...stream,
              budget: { ...(stream.budget ?? { kind: 'charged' }), costUsd: e.costUsd },
            },
          });
          return;
        }
        const list = st.messages[sessionId] ?? [];
        const last = [...list].reverse().find((m) => m.role === 'assistant');
        if (last && last.metadata?.budget?.costUsd === undefined) {
          void commit({
            ...last,
            metadata: {
              ...last.metadata,
              budget: { ...(last.metadata?.budget ?? { kind: 'charged' }), costUsd: e.costUsd },
            },
          });
        }
        return;
      }
      if (!stream || stream.sessionId !== sessionId) return; // stale (switched away)

      switch (e.type) {
        case 'budget_blocked': {
          // Nothing was sent. The turn becomes a calm inline block card.
          const msg: ChatMessage = {
            id: newId(),
            sessionId,
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
            metadata: { budget: { kind: 'blocked', code: e.code, reason: e.reason }, mode, model },
          };
          void commit(msg);
          useChatStore.setState({ stream: null });
          void orbSetState('idle');
          return;
        }
        case 'model_switched': {
          patchStream(() => ({
            budget: { kind: 'downshifted', from: e.from, to: e.to, why: e.why ?? undefined },
            model: e.to,
          }));
          return;
        }
        case 'budget_cutoff': {
          patchStream((cur) => ({ budget: { ...cur.budget, kind: 'cutoff', reason: e.reason } }));
          return;
        }
        case 'status': {
          patchStream(() => ({
            phase: e.status,
            phaseMessage: e.message,
            ...(e.provider ? { provider: e.provider } : {}),
            ...(e.model ? { model: e.model } : {}),
          }));
          if (e.status === 'awaiting_approval') void orbSetState('waiting-approval');
          else if (e.status === 'tool_running') void orbSetState('thinking');
          return;
        }
        case 'run': {
          patchStream(() => ({ runId: e.runId }));
          return;
        }
        case 'usage': {
          patchStream(() => ({ usage: { inTokens: e.inTokens, outTokens: e.outTokens } }));
          return;
        }
        case 'replace': {
          patchStream(() => ({ text: e.text }));
          return;
        }
        case 'token': {
          if (stream.status !== 'streaming') {
            useChatStore.setState({
              stream: {
                ...stream,
                status: 'streaming',
                text: stream.text + e.text,
                firstTokenAt: stream.firstTokenAt ?? Date.now(),
              },
            });
            void orbSetState('speaking');
          } else {
            useChatStore.setState({ stream: { ...stream, text: stream.text + e.text } });
          }
          return;
        }
        case 'tool_call': {
          const call: ToolCallRecord = { ...e.call, startedAt: e.call.startedAt ?? Date.now() };
          useChatStore.setState({
            stream: { ...stream, toolCalls: [...stream.toolCalls, call], status: 'streaming' },
          });
          void orbSetState('thinking');
          return;
        }
        case 'tool_waiting': {
          patchStream((cur) => ({
            toolCalls: cur.toolCalls.map((t) =>
              t.id === e.id ? { ...t, status: 'waiting-approval', approvalId: e.approvalId } : t,
            ),
          }));
          return;
        }
        case 'tool_result': {
          patchStream((cur) => ({
            toolCalls: cur.toolCalls.map((t) =>
              t.id === e.id
                ? {
                    ...t,
                    status: e.status,
                    output: e.output,
                    ...(e.status === 'error' ? { error: e.output } : {}),
                    ...(e.blocked ? { blocked: true } : {}),
                    ...(e.denied ? { denied: true } : {}),
                    durationMs: t.startedAt ? Date.now() - t.startedAt : undefined,
                  }
                : t,
            ),
          }));
          return;
        }
        case 'error': {
          void orbSetState('error');
          const error: TurnError = {
            kind: e.kind ?? 'model',
            message: e.message,
            ...(e.code ? { code: e.code } : {}),
            ...(typeof e.retryable === 'boolean' ? { retryable: e.retryable } : {}),
          };
          // Persist the partial (if any) as an errored assistant message.
          const segments: NonNullable<ChatMessage['metadata']>['segments'] = [];
          if (stream.text) segments.push({ type: 'text', text: stream.text });
          for (let i = 0; i < stream.toolCalls.length; i++) segments.push({ type: 'tool', index: i });
          const msg: ChatMessage = {
            id: newId(),
            sessionId,
            role: 'assistant',
            content: stream.text,
            createdAt: Date.now(),
            metadata: {
              ...(segments.length ? { segments } : {}),
              status: 'error',
              error,
              mode,
              model: stream.model,
              ...(stream.runId ? { runId: stream.runId } : {}),
              ...(stream.usage ? { usage: stream.usage } : {}),
              ...(stream.budget ? { budget: stream.budget } : {}),
            },
            toolCalls: stream.toolCalls.length ? stream.toolCalls : undefined,
          };
          void commit(msg);
          useChatStore.setState({ stream: null });
          window.setTimeout(() => void orbSetState('idle'), 1500);
          return;
        }
        case 'done': {
          // Compose the final message: text segments + tool cards interleaved
          // in arrival order (tools land between the text that surrounded them).
          void finishStream(sessionId, stream, e.stopped);
          return;
        }
      }
    },
  }).finally(() => {
    if (controller?.signal === signal) controller = null;
    // A stream that ended without `done` (abort, transport drop) still
    // closes its trace honestly.
    if (recorder && !recorder.ended()) {
      recorder.finish(signal.aborted ? 'killed' : 'failed', signal.aborted ? 'Stopped by the user' : 'Stream ended early');
    }
  });
}

/** Fold a finished streaming turn into a persisted assistant message. */
async function finishStream(
  sessionId: string,
  stream: StreamingTurn,
  stopped?: string,
): Promise<void> {
  // The latest snapshot may carry late fields (usage, cost, run id).
  const latest = useChatStore.getState().stream;
  const turn = latest?.sessionId === sessionId ? latest : stream;
  const text = turn.text;
  const toolCalls = turn.toolCalls.map((t) =>
    t.status === 'running' || t.status === 'waiting-approval'
      ? { ...t, status: 'error' as const, error: t.error ?? 'Stopped before the tool finished.' }
      : t,
  );
  const ended =
    stopped === 'cancelled' || stopped === 'max_steps' || stopped === 'budget' || stopped === 'error'
      ? stopped
      : undefined;
  if (!text && toolCalls.length === 0 && !ended) {
    useChatStore.setState({ stream: null });
    void orbSetState('idle');
    return;
  }
  const segments: NonNullable<ChatMessage['metadata']>['segments'] = [];
  if (text) segments.push({ type: 'text', text });
  for (let i = 0; i < toolCalls.length; i++) segments.push({ type: 'tool', index: i });
  const now = Date.now();
  const msg: ChatMessage = {
    id: newId(),
    sessionId,
    role: 'assistant',
    content: text,
    createdAt: now,
    metadata: {
      segments,
      mode: turn.mode,
      model: turn.model,
      ...(turn.budget ? { budget: turn.budget } : {}),
      ...(turn.runId ? { runId: turn.runId } : {}),
      ...(turn.usage ? { usage: turn.usage } : {}),
      ...(ended ? { stopped: ended } : {}),
      timing: {
        ...(turn.firstTokenAt ? { ttftMs: turn.firstTokenAt - turn.startedAt } : {}),
        totalMs: now - turn.startedAt,
      },
    },
    toolCalls,
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
  modes: {},
  workspace: null,
  setWorkspace: (workspace) => set({ workspace }),

  setMode: (sessionId, mode) => {
    try {
      window.localStorage.setItem(MODE_KEY(sessionId), mode);
      window.localStorage.setItem(MODE_KEY(null), mode); // becomes the default for new chats
    } catch {
      /* storage unavailable */
    }
    if (sessionId) set((st) => ({ modes: { ...st.modes, [sessionId]: mode } }));
  },

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

    // Attachments: the bubble shows a note; the engine gets the file text.
    const atts = get().attachments;
    const note = atts.length
      ? `\n\n${atts.map((a) => `[Attached: ${a.name}]`).join('\n')}`
      : '';
    const content = text + note;
    const extra = attachmentText(atts);

    const userMsg: ChatMessage = {
      id: newId(),
      sessionId,
      role: 'user',
      content,
      createdAt: Date.now(),
      metadata: atts.length
        ? {
            attachments: atts.map(({ name, size }) => ({ name, size })),
            ...(extra ? { attachmentText: extra } : {}),
          }
        : undefined,
    };

    set({ attachments: [] }); // strip clears on send

    // Offline → park as queued, flush on reconnect.
    if (!get().online) {
      await commit({ ...userMsg, metadata: { ...userMsg.metadata, status: 'queued' } });
      set((st) => ({ queuedIds: [...st.queuedIds, userMsg.id] }));
      return;
    }

    // Engine down → the message is kept and marked, never silently dropped.
    if (engineKnownDown()) {
      await commit({ ...userMsg, metadata: { ...userMsg.metadata, status: 'failed' } });
      void sessions.titleFromFirstMessage(sessionId, text);
      return;
    }

    await commit(userMsg);
    void sessions.titleFromFirstMessage(sessionId, text);
    await runGeneration(sessionId, [
      ...currentUserTurns(sessionId).slice(0, -1),
      { role: 'user', content: content + extra },
    ]);
  },

  cancelGeneration: () => {
    const stream = get().stream;
    controller?.abort(); // closes the reader → the engine aborts the run
    controller = null;
    if (stream) {
      // Keep whatever streamed so far, marked as stopped by the user.
      void finishStream(stream.sessionId, stream, 'cancelled');
    }
  },

  retryMessage: async (id) => {
    // Mark the failed user message healthy and regenerate from it.
    const all = Object.values(get().messages).flat();
    const msg = all.find((m) => m.id === id);
    if (!msg) return;
    await commit({ ...msg, metadata: { ...msg.metadata, status: undefined } });
    // The retried message is the last user turn; everything after it (a
    // failed assistant turn, say) is not part of the prompt.
    const turns = currentUserTurns(msg.sessionId);
    let cut = turns.length;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'user') {
        cut = i + 1;
        break;
      }
    }
    await runGeneration(msg.sessionId, turns.slice(0, cut));
  },

  regenerate: async (assistantId) => {
    const all = Object.values(get().messages).flat();
    const msg = all.find((m) => m.id === assistantId);
    if (!msg) return;
    const turns = currentUserTurns(msg.sessionId);
    let cut = turns.length;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'user') {
        cut = i + 1;
        break;
      }
    }
    await runGeneration(msg.sessionId, turns.slice(0, cut));
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
