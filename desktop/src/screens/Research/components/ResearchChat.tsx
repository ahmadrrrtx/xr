/*
 * ResearchChat (UI-redesign 2026-10-29) — the dockable, grounded chat.
 *
 * Answers come FROM the run on screen: each send builds a digest (report
 * excerpt, cited sources + evidence, contradictions, open questions) via
 * research/grounded.ts and hands it to the same Phase 14 chat stream the
 * Chat screen uses (chatStore.sendMessageIn, mode 'ask') — so budget gates,
 * engine transport and history limits all apply unchanged. [sN] markers in
 * replies focus the matching source card, exactly like report citations.
 *
 * The dock is per-run (research:<sessionId>), persists in chat-db like any
 * other session, and toggles with ⌘J from the Research screen.
 */
import { ArrowUp, Eraser, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import { chatDb, type ChatMessage } from '@/lib/chat-db';
import { MarkdownRenderer } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { groundedContextText, groundedDigestFrom, researchSessionId } from '@/research/grounded';
import { StreamingCursor } from '@/screens/Chat/components/StreamingCursor';
import { useChatStore } from '@/stores/chatStore';
import { useResearchStore } from '@/stores/researchStore';
import { useSessionsStore } from '@/stores/sessionsStore';

const EMPTY: ChatMessage[] = [];

/** [s3] → focus that source card. Returns true if the click was handled. */
function citeTarget(el: HTMLElement, focusCitation: (id: string) => void): boolean {
  const marker = el.closest<HTMLElement>('[data-cite-id]');
  const id = marker?.dataset.citeId;
  if (!id) return false;
  focusCitation(id);
  return true;
}

/** Render assistant text, turning [sN] markers into citation chips. */
function GroundedMarkdown({ text, onFocusCitation }: { text: string; onFocusCitation: (id: string) => void }) {
  const parts = useMemo(() => text.split(/(\[s\d+\])/g), [text]);
  return (
    <div className="xr-chat-md">
      {parts.map((p, i) => {
        const m = /^\[s(\d+)\]$/.exec(p);
        if (!m) {
          // Markdown runs per segment; citation chips sit between segments.
          return <MarkdownRenderer key={i} content={p} />;
        }
        const order = useResearchStore.getState().citations.order;
        const id = order[Number(m[1]) - 1];
        if (!id) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            type="button"
            className="xr-cite-chip"
            data-cite-id={id}
            title={`Focus source ${Number(m[1])} in the sources panel`}
            onClick={(e) => citeTarget(e.currentTarget, onFocusCitation)}
          >
            {m[1]}
          </button>
        );
      })}
    </div>
  );
}

export function ResearchChat({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const runSessionId = useResearchStore((s) => s.sessionId);
  const runTopic = useResearchStore((s) => s.runTopic);
  const phase = useResearchStore((s) => s.phase);
  const report = useResearchStore((s) => s.report);
  const focusCitation = useResearchStore((s) => s.focusCitation);

  const sessionId = researchSessionId(runSessionId);
  const messages = useChatStore((s) => s.messages[sessionId]) ?? EMPTY;
  const stream = useChatStore((s) => s.stream);
  const streaming = stream?.sessionId === sessionId ? stream : null;
  const online = useChatStore((s) => s.online);

  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);

  // Lazy session: create the row on first open, load history once.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const existing = await chatDb.getSession(sessionId);
      if (!existing) {
        await chatDb.createSession(sessionId, `Research · ${runTopic || 'chat'}`, null, Date.now());
        void useSessionsStore.getState().loadSessions();
      }
      await useChatStore.getState().loadMessages(sessionId);
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, runTopic, open]);

  // Auto-scroll while pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, open]);

  const grounded = !!report || phase === 'done' || phase === 'partial';

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || streaming) return;
      stick.current = true;
      setDraft('');
      const digest = groundedDigestFrom(useResearchStore.getState());
      void useChatStore.getState().sendMessageIn(sessionId, t, {
        agent: 'Research',
        surface: 'research',
        mode: 'ask',
        context: groundedContextText(digest),
      });
    },
    [sessionId, streaming],
  );

  if (!open) return null;

  return (
    <div className="xr-chat-dock" data-testid="research-chat" aria-label="Research chat">
      <div className="xr-chat-title">
        <span>Ask about this run</span>
        <span className="xr-chat-ground" data-testid="research-chat-mode">
          {grounded ? 'grounded in this run' : 'no report yet — answers won’t be grounded'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="xr-mini"
          aria-label="Clear this chat"
          title="Clear"
          onClick={() =>
            void (async () => {
              for (const m of useChatStore.getState().messages[sessionId] ?? []) await chatDb.deleteMessage(m.id);
              useChatStore.setState((s) => ({ messages: { ...s.messages, [sessionId]: [] } }));
            })()
          }
        >
          <Eraser size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="xr-mini" aria-label="Close research chat (⌘J)" title="Close (⌘J)" onClick={() => onToggle(false)}>
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="xr-chat-log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        aria-label="Research chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {!ready ? null : messages.length === 0 && !streaming ? (
          <div className="xr-chat-empty">
            <p>Ask anything about “{runTopic || 'this research'}” — answers use the run’s own report, sources and evidence, not a fresh search.</p>
            <p className="hint">Try: “what does source 2 actually claim?”, “where do the sources disagree?”, “summarise the open questions”.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn('xr-chat-msg', m.role === 'user' ? 'is-user' : 'is-assistant')} data-testid="research-chat-msg">
              {m.role === 'user' ? <div className="xr-chat-md">{m.content}</div> : <GroundedMarkdown text={m.content} onFocusCitation={focusCitation} />}
            </div>
          ))
        )}
        {streaming ? (
          <div className="xr-chat-msg is-assistant" data-testid="research-chat-msg">
            <GroundedMarkdown text={streaming.text} onFocusCitation={focusCitation} />
            <StreamingCursor />
          </div>
        ) : null}
      </div>
      <div className="xr-chat-composer">
        <TextareaAutosize
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          maxRows={6}
          placeholder={online ? 'Ask about this run… (Enter to send)' : 'Engine offline — messages park until it returns'}
          aria-label="Ask about this research run"
          data-testid="research-chat-input"
        />
        {streaming ? (
          <button type="button" className="xr-chat-send is-stop" aria-label="Stop generating" onClick={() => useChatStore.getState().cancelGeneration()}>
            <Square size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="xr-chat-send" aria-label="Send" disabled={!draft.trim()} onClick={() => send(draft)}>
            <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
