/*
 * Chat screen (Phase 4) — XR's primary surface.
 * [sessions 260px] [conversation: messages + composer] — no right panel yet.
 * Owns: session/route sync, offline banner, panel toggle (⌘⇧O), Esc handling,
 * narrow-viewport collapse, drag-drop overlay across the whole conversation.
 */
import { Bot, FolderOpen, PanelLeftClose, PanelLeftOpen, WifiOff, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAgentsStore } from '@/stores/agentsStore';
import { useChatStore } from '@/stores/chatStore';
import { useSessionsStore } from '@/stores/sessionsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { SessionList } from './components/SessionList';
import { WelcomeState } from './components/WelcomeState';

export default function ChatScreen() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  const sessions = useSessionsStore();
  const setOnline = useChatStore((s) => s.setOnline);
  const online = useChatStore((s) => s.online);
  const cancelGeneration = useChatStore((s) => s.cancelGeneration);
  const stream = useChatStore((s) => s.stream);
  const workspace = useChatStore((s) => s.workspace);
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceParam = searchParams.get('workspace');
  const agentParam = searchParams.get('agent');
  const sessionAgent = useChatStore((s) => (sessionId ? s.agents[sessionId] : undefined) ?? null);

  // Agents hand-off (Phase 19): `/chat?agent=:id` opens a NEW session that
  // speaks as that agent — its system prompt, tool allowlist, model and
  // per-run cap ride every turn (engine-side tool scope, local governor).
  useEffect(() => {
    if (!agentParam) return;
    let alive = true;
    void (async () => {
      const binding = await useAgentsStore.getState().bindingFor(agentParam);
      if (!alive) return;
      if (!binding) {
        toast.error('That agent is not available from the engine.');
        navigate('/chat', { replace: true });
        return;
      }
      const title = `${binding.emoji ? `${binding.emoji} ` : ''}${binding.label}`;
      const session = await useSessionsStore.getState().createTitledSession(title, binding.model);
      if (!alive) return;
      useChatStore.getState().bindAgent(session.id, {
        id: binding.id,
        label: binding.label,
        emoji: binding.emoji,
        builtin: binding.builtin,
        systemPrompt: binding.systemPrompt,
        tools: binding.tools,
        ...(binding.model ? { model: binding.model } : {}),
        ...(binding.budgetUsd !== undefined ? { budgetUsd: binding.budgetUsd } : {}),
      });
      navigate(`/chat/${session.id}`, { replace: true });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume the intent once per value
  }, [agentParam]);

  // A reload keeps the binding (localStorage) — surface it for the chip.
  useEffect(() => {
    if (sessionId) useChatStore.getState().agentFor(sessionId);
  }, [sessionId]);

  // Workbench hand-off (Phase 14): `/chat?workspace=:id` scopes every turn
  // to that project (engine system context + budget workspace scope).
  useEffect(() => {
    if (!workspaceParam) {
      useChatStore.getState().setWorkspace(null);
      return;
    }
    let alive = true;
    void (async () => {
      const ws = useWorkspaceStore.getState();
      if (!ws.loaded) await ws.refresh();
      if (!alive) return;
      const found = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceParam);
      useChatStore
        .getState()
        .setWorkspace(found ? { id: found.id, name: found.name, path: found.path } : null);
    })();
    return () => {
      alive = false;
    };
  }, [workspaceParam]);

  // Boot: sessions + default model (idempotent).
  useEffect(() => {
    void sessions.loadSessions();
    void sessions.loadDefaultModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  // Keep the store's active session in sync with the route.
  useEffect(() => {
    useSessionsStore.setState({ activeSessionId: sessionId ?? null });
    if (sessionId) void useChatStore.getState().loadMessages(sessionId);
  }, [sessionId]);

  // Store → route: a session created outside the list (composer send, chip)
  // must move the URL; deleting the active session returns to /chat.
  const activeId = useSessionsStore((s) => s.activeSessionId);
  useEffect(() => {
    const search = searchParams.toString();
    const qs = search ? `?${search}` : '';
    if (activeId && activeId !== sessionId) navigate(`/chat/${activeId}${qs}`, { replace: true });
    if (!activeId && sessionId) navigate(`/chat${qs}`, { replace: true });
  }, [activeId, sessionId, navigate, searchParams]);

  // Offline banner: navigator.onLine + auto-flush queue on reconnect.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [setOnline]);

  // ⌘⇧O panel · Esc cancel · ⌘F session search · ⌘⇧C copy last code block.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        useSessionsStore.getState().togglePanel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') return; // composer owns it
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search conversations"]')
          ?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        const blocks = document.querySelectorAll('[role="code"]');
        const last = blocks[blocks.length - 1];
        const code = last?.querySelector('code')?.textContent ?? last?.textContent ?? '';
        if (code) {
          void navigator.clipboard.writeText(code).then(() =>
            import('sonner').then(({ toast }) => toast('Copied last code block')),
          );
        }
        return;
      }
      if (e.key === 'Escape' && useChatStore.getState().stream) {
        cancelGeneration();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelGeneration]);

  // Auto-hide the panel below 960px (explicit ⌘⇧O still wins while mounted).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 959px)');
    const apply = () => {
      if (mq.matches) useSessionsStore.setState({ panelOpen: false });
      else useSessionsStore.setState({ panelOpen: true });
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const panelVisible = useMemo(
    () => sessions.panelOpen && !sessions.loading,
    [sessions.panelOpen, sessions.loading],
  );

  return (
    <div className="flex h-full min-h-0">
      <a
        href="#conversation"
        className="focus:bg-bg-ink text-accent sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:px-3 focus:py-1.5 focus:text-[13px] focus:font-semibold"
      >
        Skip to conversation
      </a>
      {panelVisible && <SessionList activeSessionId={sessionId ?? null} />}

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Session panel toggle (top-left of the conversation) */}
        <button
          type="button"
          onClick={() => useSessionsStore.getState().togglePanel()}
          aria-label={panelVisible ? 'Hide session panel (⌘⇧O)' : 'Show session panel (⌘⇧O)'}
          className="border-border-subtle bg-bg-ink/70 text-text-tertiary hover:text-text-secondary absolute top-3 left-3 z-20 flex size-8 items-center justify-center rounded-lg border backdrop-blur transition-colors"
        >
          {panelVisible ? (
            <PanelLeftClose aria-hidden="true" className="size-4" strokeWidth={1.5} />
          ) : (
            <PanelLeftOpen aria-hidden="true" className="size-4" strokeWidth={1.5} />
          )}
        </button>

        {!online && (
          <div
            className="border-warning/40 bg-warning/10 text-warning flex items-center justify-center gap-2 px-4 py-1.5 text-[12.5px] font-medium"
            role="status"
          >
            <WifiOff aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
            Offline — messages queued, will send when reconnected
          </div>
        )}

        {sessionId && <ChatHeader sessionId={sessionId} />}

        <div id="conversation" className="contents">
          {sessionId ? <MessageList sessionId={sessionId} /> : <WelcomeState />}
        </div>

        {sessionAgent && sessionId && (
          <div className="mx-auto flex w-full max-w-[820px] items-center gap-2 px-6 pb-1">
            <span
              className="border-border-subtle bg-bg-ink text-text-secondary inline-flex h-6 items-center gap-1.5 rounded-full border pr-1 pl-2 text-[11.5px]"
              data-testid="chat-agent-chip"
              title={`${sessionAgent.tools.length ? `${sessionAgent.tools.length} tools` : 'engine default tools'}${sessionAgent.model ? ` · ${sessionAgent.model}` : ''}${sessionAgent.budgetUsd !== undefined ? ` · $${sessionAgent.budgetUsd.toFixed(2)} per run` : ''}`}
            >
              {sessionAgent.emoji ? (
                <span aria-hidden="true">{sessionAgent.emoji}</span>
              ) : (
                <Bot size={12} strokeWidth={1.75} aria-hidden="true" />
              )}
              Agent: {sessionAgent.label}
              <button
                type="button"
                aria-label="Stop speaking as this agent"
                onClick={() => useChatStore.getState().bindAgent(sessionId, null)}
                className="text-text-tertiary hover:text-text-primary flex size-4 items-center justify-center rounded-full"
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          </div>
        )}

        {workspace && (
          <div className="mx-auto flex w-full max-w-[820px] items-center gap-2 px-6 pb-1">
            <span
              className="border-border-subtle bg-bg-ink text-text-secondary inline-flex h-6 items-center gap-1.5 rounded-full border pr-1 pl-2 text-[11.5px]"
              data-testid="chat-workspace-chip"
              title={workspace.path}
            >
              <FolderOpen size={12} strokeWidth={1.75} aria-hidden="true" />
              Workspace: {workspace.name}
              <button
                type="button"
                aria-label="Detach workspace from this chat"
                onClick={() => {
                  searchParams.delete('workspace');
                  setSearchParams(searchParams, { replace: true });
                }}
                className="text-text-tertiary hover:text-text-primary flex size-4 items-center justify-center rounded-full"
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          </div>
        )}

        {/* Streaming that starts while still on /chat (chip click) shows
            through the welcome state until the route catches up. */}
        {stream && stream.sessionId !== sessionId && !sessionId && (
          <div className="sr-only" aria-live="polite">
            XR is responding
          </div>
        )}

        <Composer sessionId={sessionId ?? null} />
      </div>
    </div>
  );
}
