/*
 * ChatPane (Phase 17) — the compact AI chat on the left.
 *
 * Reuses the Phase 14 chat stream (chatStore.sendMessageIn) with a per-
 * workspace session (`builder:<workspaceId>`), Builder context (open files,
 * selection, terminal tail, git, dev server) and the "diffs, not whole
 * files" system rules. Assistant markdown is segmented so ```diff fences
 * become DiffCards; `path:line` mentions become jump chips.
 */
import { ArrowUp, Download, Eraser, FileCode2, MoreHorizontal, Share2, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { chatDb, type ChatMessage } from '@/lib/chat-db';
import { MarkdownRenderer } from '@/lib/markdown';
import { basenameOf, builderContextText, builderSessionId, findFileLinks, segmentAssistantMarkdown, type DiffBlock } from '@/lib/builderCore';
import { cn } from '@/lib/utils';
import { StreamingCursor } from '@/screens/Chat/components/StreamingCursor';
import { ToolCallCard } from '@/screens/Chat/components/ToolCallCard';
import { liveContent, useBuilderStore } from '@/stores/builderStore';
import { useChatStore } from '@/stores/chatStore';
import { useSessionsStore } from '@/stores/sessionsStore';

import { DiffCard } from './DiffCard';

const EMPTY: ChatMessage[] = [];

export function ChatPane({ workspaceId }: { workspaceId: string }) {
  const sessionId = builderSessionId(workspaceId);
  const workspace = useBuilderStore((s) => s.workspace);
  const project = useBuilderStore((s) => s.project);
  const messages = useChatStore((s) => s.messages[sessionId]) ?? EMPTY;
  const stream = useChatStore((s) => s.stream);
  const streaming = stream?.sessionId === sessionId ? stream : null;
  const busyElsewhere = stream !== null && !streaming;
  const online = useChatStore((s) => s.online);
  const [draft, setDraft] = useState('');
  const [attachActive, setAttachActive] = useState(false);
  const [ready, setReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottom = useRef(true);

  // Session exists lazily; messages load once.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const existing = await chatDb.getSession(sessionId);
      if (!existing) {
        await chatDb.createSession(sessionId, `Builder · ${workspace?.name ?? 'project'}`, null, Date.now());
        void useSessionsStore.getState().loadSessions();
      }
      await useChatStore.getState().loadMessages(sessionId);
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, workspace?.name]);

  // Auto-scroll while the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const known = useMemo(() => new Set(useBuilderStore.getState().tree.filter((e) => e.type === 'file').map((e) => e.rel)), [project?.id, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps -- tree snapshot per message

  const buildContext = useCallback((): string => {
    const st = useBuilderStore.getState();
    const activePath = st.active;
    const activeContent = activePath ? liveContent(activePath) : null;
    return builderContextText({
      projectName: st.project?.name ?? workspace?.name ?? 'project',
      root: st.project?.root ?? workspace?.path ?? '',
      activePath,
      activeContent: attachActive ? activeContent : activeContent ? activeContent.slice(0, 6_000) : null,
      cursorLine: st.cursor.line,
      selection: st.selection || null,
      openFiles: st.tabs.map((t) => t.path),
      terminalTail: [...st.consoleLines.slice(-10).map((l) => l.text), ...st.terminalTail.slice(-20)],
      git: st.git ? { branch: st.git.branch, dirty: st.git.dirty, changed: Object.keys(st.git.files).slice(0, 40) } : null,
      devServer: st.devServer ? { state: st.devServer.state, url: st.devServer.url } : null,
    });
  }, [attachActive, workspace?.name, workspace?.path]);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || stream) return;
      stickToBottom.current = true;
      setDraft('');
      void useChatStore.getState().sendMessageIn(sessionId, t, {
        agent: 'Builder',
        surface: 'builder',
        mode: 'ask',
        context: buildContext(),
        workspace: workspace ? { id: workspace.id, name: workspace.name, path: workspace.path } : null,
      });
    },
    [buildContext, sessionId, stream, workspace],
  );

  // ⌘Enter from anywhere in the Builder sends the current draft.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    const h = () => send(draftRef.current);
    window.addEventListener('xb:send', h);
    return () => window.removeEventListener('xb:send', h);
  }, [send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (native.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  const applyBlock = useCallback((block: DiffBlock, hunks: number[] | undefined) => useBuilderStore.getState().applyBlock(block, hunks), []);
  const explain = useCallback((block: DiffBlock) => send(`Explain this change to ${block.path ?? 'the file'} line by line, briefly:\n\n\`\`\`diff\n${block.patch}\`\`\``), [send]);
  const openPath = useCallback((path: string, line?: number) => void useBuilderStore.getState().openFile(path, { pin: true, ...(line ? { line } : {}) }), []);

  const clear = async () => {
    for (const m of messages) await chatDb.deleteMessage(m.id);
    useChatStore.setState((s) => ({ messages: { ...s.messages, [sessionId]: [] } }));
    toast('Chat cleared');
  };
  const exportMd = async () => {
    const md = messages.map((m) => `**${m.role === 'user' ? 'You' : 'XR'}** · ${new Date(m.createdAt).toLocaleString()}\n\n${m.content}\n`).join('\n---\n\n');
    try {
      await navigator.clipboard.writeText(md || '_Empty chat_');
      toast('Chat copied as Markdown');
    } catch {
      toast('Could not copy', { description: 'Clipboard access was blocked.' });
    }
  };

  const active = useBuilderStore((s) => s.active);
  const selectionLen = useBuilderStore((s) => s.selection.length);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="builder-chat">
      <div className="xb-chat-head">
        <span className="xb-pane-title">AI Chat</span>
        <span className="xb-top-spacer" />
        {!online ? <span className="xb-chip">offline</span> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="xb-icon-btn" aria-label="Chat options">
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px] text-[12.5px]">
            <DropdownMenuItem onSelect={() => void clear()}>
              <Eraser size={13} /> Clear chat
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportMd()}>
              <Download size={13} /> Export as Markdown
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => toast('Sharing is not available yet', { description: 'Export as Markdown works today.' })}>
              <Share2 size={13} /> Share…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={scrollRef} className="xb-chat-scroll" onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions">
        {ready && messages.length === 0 && !streaming ? (
          <div className="xb-chat-empty">
            Ask for a change and XR answers with a diff you can review hunk by hunk.
            <br />
            Nothing is written until you apply it.
          </div>
        ) : null}
        {messages.map((m) => (
          <Message key={m.id} message={m} known={known} onApply={applyBlock} onExplain={explain} onOpen={openPath} />
        ))}
        {streaming ? <StreamingMessage text={streaming.text} toolCalls={streaming.toolCalls} runId={streaming.runId} known={known} onApply={applyBlock} onExplain={explain} onOpen={openPath} /> : null}
      </div>

      <div className="xb-composer">
        <div className="xb-composer-box">
          <TextareaAutosize
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            minRows={1}
            maxRows={5}
            placeholder={busyElsewhere ? 'Another chat is generating…' : 'Describe the change…'}
            aria-label="Message XR about this project"
            disabled={busyElsewhere}
            data-testid="builder-composer"
          />
          <div className="xb-composer-row">
            <button
              type="button"
              className="xb-context-pill"
              aria-pressed={attachActive}
              disabled={!active}
              title={active ? `Attach the full contents of ${active}` : 'Open a file to attach it'}
              onClick={() => setAttachActive((v) => !v)}
            >
              <FileCode2 size={11} />
              {active ? `Attach ${basenameOf(active)}` : 'Attach open file'}
            </button>
            {selectionLen > 0 ? <span className="xb-chip">selection · {selectionLen} chars</span> : null}
            {streaming ? (
              <button type="button" className="xb-send is-stop" aria-label="Stop generating" onClick={() => useChatStore.getState().cancelGeneration()}>
                <Square size={12} />
              </button>
            ) : (
              <button type="button" className="xb-send" aria-label="Send" disabled={!draft.trim() || !!stream} onClick={() => send(draft)}>
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FileChips({ text, known, onOpen }: { text: string; known: ReadonlySet<string>; onOpen: (path: string, line?: number) => void }) {
  const links = useMemo(() => {
    const seen = new Set<string>();
    return findFileLinks(text, known).filter((l) => {
      const k = `${l.path}:${l.line ?? ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [text, known]);
  if (!links.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {links.slice(0, 8).map((l) => (
        <button key={`${l.path}:${l.line ?? ''}`} type="button" className="xb-file-link" onClick={() => onOpen(l.path, l.line ?? undefined)}>
          {l.text}
        </button>
      ))}
    </div>
  );
}

interface SegmentProps {
  known: ReadonlySet<string>;
  onApply: (block: DiffBlock, hunks: number[] | undefined) => Promise<{ ok: boolean; applied: number }>;
  onExplain: (block: DiffBlock) => void;
  onOpen: (path: string, line?: number) => void;
}

function AssistantBody({ content, pending, ...rest }: SegmentProps & { content: string; pending: boolean }) {
  const segments = useMemo(() => segmentAssistantMarkdown(content), [content]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <div key={i} className="xb-md">
            <MarkdownRenderer content={seg.text} />
            <FileChips text={seg.text} known={rest.known} onOpen={rest.onOpen} />
          </div>
        ) : (
          <DiffCard key={i} block={seg.block} pending={pending && i === segments.length - 1} onApply={(h) => rest.onApply(seg.block, h)} onExplain={rest.onExplain} onOpen={rest.onOpen} />
        ),
      )}
    </>
  );
}

function Message({ message, ...rest }: SegmentProps & { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const status = message.metadata?.status;
  const err = message.metadata?.error;
  return (
    <div className={cn('xb-msg', isUser && 'is-user')}>
      <span className={cn('xb-avatar', !isUser && 'is-xr')} aria-hidden="true">
        {isUser ? 'You' : 'XR'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="xb-msg-body">
          {isUser ? message.content : <AssistantBody content={message.content} pending={false} {...rest} />}
          {message.toolCalls?.map((c) => <ToolCallCard key={c.id} call={c} runId={message.metadata?.runId} />)}
        </div>
        {status === 'queued' ? <div className="xb-msg-meta">Queued — sends when back online</div> : null}
        {status === 'failed' ? <div className="xb-msg-meta text-danger">Not sent — engine unreachable</div> : null}
        {err ? <div className="xb-msg-meta text-danger">{err.message}</div> : null}
        {message.metadata?.stopped === 'cancelled' ? <div className="xb-msg-meta">Stopped</div> : null}
      </div>
    </div>
  );
}

function StreamingMessage({ text, toolCalls, runId, ...rest }: SegmentProps & { text: string; toolCalls: ChatMessage['toolCalls']; runId?: string }) {
  return (
    <div className="xb-msg">
      <span className="xb-avatar is-xr" aria-hidden="true">
        XR
      </span>
      <div className="xb-msg-body">
        {text ? <AssistantBody content={text} pending {...rest} /> : null}
        {toolCalls?.map((c) => <ToolCallCard key={c.id} call={c} runId={runId} />)}
        <StreamingCursor />
      </div>
    </div>
  );
}
