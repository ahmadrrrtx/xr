/*
 * Message bubble (Phase 4).
 * User: right, bg-bg-raised, rounded-16 with 4px top-RIGHT corner, initial
 * circle to the right, hover edit/copy. XR: left, Avatar (head, 28px) at
 * top-left, bg-bg-ink, rounded-16 with 4px top-LEFT corner, theme-adapted
 * treatment (xr-native glow · graphite/midnight accent left border ·
 * paper/arctic subtle border + light shadow), hover copy/regenerate.
 * Markdown body + interjected tool cards + streaming caret.
 */
import { Check, Clock, Copy, Pencil, RotateCcw } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { toast } from 'sonner';

import { Avatar } from '@/components/brand/Avatar';
import { BudgetBlockedCard, CutoffNote, DownshiftBadge } from '@/components/budget/BudgetNoteCard';
import { modelInfo } from '@/budget/models';
import type { ChatMessage } from '@/lib/chat-db';
import { MarkdownRenderer } from '@/lib/markdown';
import type { StreamingTurn } from '@/stores/chatStore';
import { useThemeStore } from '@/stores/theme';
import { useUIStore } from '@/stores/ui';
import { StreamingCursor } from './StreamingCursor';
import { ToolCallCard } from './ToolCallCard';
import { TurnErrorCard } from './TurnErrorCard';

/** Honest in-flight status (engine `status` frames), never a fake "thinking". */
function waitingLine(turn: StreamingTurn): string {
  const model = modelInfo(turn.model).name;
  switch (turn.phase) {
    case 'awaiting_approval':
      return 'Waiting for your approval…';
    case 'tool_running':
      return turn.phaseMessage || 'Running a tool…';
    case 'compacting_context':
      return 'Compacting context…';
    case 'provider_selection':
    case 'preparing':
      return 'Connecting to the engine…';
    case 'provider_ready':
    case 'generating':
    default:
      return `Waiting for ${model}…`;
  }
}

const STOPPED_NOTE: Record<string, string> = {
  cancelled: 'Stopped.',
  max_steps: 'Stopped at the step limit for this turn.',
  interrupted: 'Interrupted — the stream ended early.',
};

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** XR-bubble chrome per theme (THEME-SYSTEM component adaptation table). */
function xrBubbleStyle(theme: string): React.CSSProperties {
  if (theme === 'xr-native') {
    return { boxShadow: '0 0 12px -4px var(--accent-glow)' };
  }
  if (theme === 'graphite' || theme === 'midnight') {
    return { borderLeft: '2px solid var(--accent)' };
  }
  return { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)' }; // paper / arctic
}

function HoverActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
      {children}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised flex size-7 items-center justify-center rounded-md"
    >
      {children}
    </button>
  );
}

export function MessageBubble({
  message,
  isStreaming = false,
  streamingText = '',
  streamingTools,
  streamingTurn,
  onEdit,
  onRetry,
  onRegenerate,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
  streamingText?: string;
  streamingTools?: ChatMessage['toolCalls'];
  /** The live turn (status line while nothing has streamed yet). */
  streamingTurn?: StreamingTurn;
  onEdit?: (text: string) => void;
  onRetry?: () => void;
  onRegenerate?: () => void;
}) {
  const reduced = useReducedMotion();
  const theme = useThemeStore((s) => s.theme);
  const userName = useUIStore((s) => s.userName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';
  const queued = message.metadata?.status === 'queued';
  const failed = message.metadata?.status === 'failed';
  const errored = message.metadata?.status === 'error';
  const turnError = message.metadata?.error;
  const stoppedNote = message.metadata?.stopped ? STOPPED_NOTE[message.metadata.stopped] : undefined;
  // Phase 13: what the budget governor did to this turn.
  const budget = message.metadata?.budget;
  const blocked = budget?.kind === 'blocked';
  // A failed turn with nothing streamed renders as the honest state card only.
  const errorOnly = errored && !!turnError && !message.content && !(message.toolCalls?.length);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      toast('Copied');
    } catch {
      toast('Copy failed — clipboard unavailable');
    }
  };

  const initial = (userName.trim()[0] ?? 'Y').toUpperCase();

  const body = isStreaming ? (
    <>
      {streamingText && <MarkdownRenderer content={streamingText} />}
      {streamingTools?.map((t) => (
        <ToolCallCard key={t.id} call={t} runId={streamingTurn?.runId} />
      ))}
      {!streamingText && streamingTurn && (
        <span
          className="text-text-tertiary text-[13px]"
          data-testid="chat-waiting-line"
          aria-live="polite"
        >
          {waitingLine(streamingTurn)}
        </span>
      )}
      <StreamingCursor />
    </>
  ) : (
    (message.metadata?.segments ?? [{ type: 'text' as const, text: message.content }]).map(
      (seg, i) =>
        seg.type === 'text' ? (
          <MarkdownRenderer key={i} content={seg.text} />
        ) : (
          <ToolCallCard
            key={`t-${i}`}
            call={message.toolCalls?.[seg.index] ?? null}
            runId={message.metadata?.runId}
          />
        ),
    )
  );

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`group/msg mb-3 flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {isUser ? (
        <>
          <div className="flex max-w-[70%] flex-col items-end">
            <HoverActions>
              {failed && (
                <span className="text-danger mr-1 text-[11px] font-semibold">Failed to send</span>
              )}
              {failed && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-accent hover:underline px-1 text-[11px] font-semibold"
                >
                  Retry
                </button>
              )}
              <IconAction
                label="Copy message"
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                ) : (
                  <Copy aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                )}
              </IconAction>
              <IconAction
                label="Edit and resend"
                onClick={() => {
                  setDraft(
                    message.content.replace(/\n\[Attached: [^\]]+\]\n?/g, '\n').trim(),
                  );
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
              </IconAction>
            </HoverActions>

            {editing ? (
              <div className="border-border-default bg-bg-ink w-full rounded-2xl border p-2">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="text-text-primary w-full resize-none bg-transparent text-[15px] outline-none"
                  aria-label="Edit message"
                />
                <div className="mt-1 flex justify-end gap-2 text-[12px]">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="text-text-tertiary hover:text-text-secondary px-2 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      onEdit?.(draft);
                    }}
                    className="bg-accent text-accent-contrast rounded-md px-3 py-1 font-semibold"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`bg-bg-raised text-text-primary rounded-2xl rounded-tr-[4px] px-4 py-3 text-[15px] leading-relaxed ${
                  queued ? 'border-border-default border-dashed' : ''
                } ${failed ? 'border-danger/60 border' : ''}`}
              >
                {queued && (
                  <Clock
                    aria-hidden="true"
                    className="text-text-tertiary mb-1 inline size-3.5"
                    strokeWidth={1.5}
                  />
                )}
                {message.content}
              </div>
            )}
            <span className="text-text-tertiary mt-1 pr-1 text-[11px]">
              {timeLabel(message.createdAt)}
              {queued && ' · Sending…'}
            </span>
          </div>

          <div
            aria-hidden="true"
            className="bg-accent/20 text-accent flex size-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold select-none"
          >
            {initial}
          </div>
        </>
      ) : (
        <>
          <span className="mt-0.5 block size-7 shrink-0 [&_svg]:size-7">
            <Avatar size="sm" variant="head" state={isStreaming ? 'speaking' : 'idle'} />
          </span>
          <div className="flex max-w-[70%] flex-col items-start">
            {budget?.kind === 'downshifted' && !blocked && (
              <DownshiftBadge note={budget} className="mb-1" />
            )}
            {blocked ? (
              <BudgetBlockedCard note={budget} />
            ) : errorOnly && turnError ? (
              <TurnErrorCard error={turnError} onRetry={onRegenerate} />
            ) : (
              <div
                className={`border-border-subtle bg-bg-ink text-text-primary rounded-2xl rounded-tl-[4px] px-4 py-3 ${
                  errored ? 'border-l-[3px]' : ''
                }`}
                style={{
                  ...(errored ? { borderLeftColor: 'var(--danger)' } : xrBubbleStyle(theme)),
                }}
              >
              {body}
              {budget?.kind === 'cutoff' && !isStreaming && <CutoffNote note={budget} />}
              {errored && (
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-danger text-[12px]">
                    {turnError?.kind === 'interrupted'
                      ? '[Interrupted — retry]'
                      : (turnError?.message ?? 'Something went wrong.')}
                  </span>
                  {onRegenerate && (
                    <button
                      type="button"
                      onClick={onRegenerate}
                      className="text-accent hover:underline text-[12px] font-semibold"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
              {!errored && stoppedNote && !isStreaming && (
                <div className="text-text-tertiary mt-2 text-[12px]" data-testid="turn-stopped">
                  {stoppedNote}
                </div>
              )}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1 pl-1">
              <span className="text-text-tertiary text-[11px]">
                {timeLabel(message.createdAt)}
                {!isStreaming && message.metadata?.model && (
                  <> · {modelInfo(message.metadata.model).name}</>
                )}
                {!isStreaming && message.metadata?.usage && (
                  <>
                    {' '}
                    · {message.metadata.usage.inTokens + message.metadata.usage.outTokens} tok
                  </>
                )}
                {!isStreaming && message.metadata?.timing?.ttftMs !== undefined && (
                  <> · {(message.metadata.timing.ttftMs / 1000).toFixed(1)}s to first token</>
                )}
              </span>
              {!isStreaming && (
                <HoverActions>
                  <IconAction label="Copy message" onClick={() => void copy()}>
                    <Copy aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                  </IconAction>
                  {onRegenerate && (
                    <IconAction label="Regenerate response" onClick={onRegenerate}>
                      <RotateCcw aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                    </IconAction>
                  )}
                </HoverActions>
              )}
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
