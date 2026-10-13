import { lazy, Suspense, useRef } from 'react';
import { extractFence } from '../lib/highlight';
import type { ChatMessage } from '../types';

interface MessageBubbleProps {
  message: ChatMessage;
  onLongPress: (message: ChatMessage) => void;
  onOpenFile: (path: string) => void;
}

// react-markdown + remark-gfm is ~48 KB gz — keep it out of the first paint.
const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })));

const LONG_PRESS_MS = 420;

export function MessageBubble({ message, onLongPress, onOpenFile }: MessageBubbleProps) {
  const timer = useRef<number | null>(null);
  const moved = useRef(false);
  const isUser = message.role === 'user';

  const start = (): void => {
    moved.current = false;
    timer.current = window.setTimeout(() => {
      if (!moved.current) onLongPress(message);
    }, LONG_PRESS_MS);
  };
  const cancel = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const streaming = message.streaming === true;
  const empty = message.content.length === 0;

  return (
    <div
      className={`flex w-full gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
      onTouchStart={start}
      onTouchEnd={cancel}
      onTouchMove={() => {
        moved.current = true;
        cancel();
      }}
      onTouchCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        onLongPress(message);
      }}
    >
      {!isUser ? (
        <Avatar label="XR" />
      ) : null}

      <div className="flex min-w-0 max-w-[82%] flex-col" style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div
          className={isUser ? 'rounded-[18px] px-3.5 py-2' : ''}
          style={
            isUser
              ? {
                  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-raised))',
                  border: '1px solid var(--border-accent)',
                }
              : undefined
          }
        >
          {empty && streaming ? (
            <span className="text-[15px]" style={{ color: 'var(--text-tertiary)' }}>
              <span className="caret" />
            </span>
          ) : (
            <>
              {isUser ? (
                <p className="whitespace-pre-wrap break-words text-[16px] leading-[1.5]">
                  {message.viaVoice ? <span title="Voice note">🎤 </span> : null}
                  {message.content}
                </p>
              ) : (
                <div className="text-[16px] leading-[1.5]">
                  <Suspense fallback={<span style={{ color: 'var(--text-secondary)' }}>{message.content}</span>}>
                    <Markdown>{message.content}</Markdown>
                  </Suspense>
                  {streaming ? <span className="caret" /> : null}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1.5 px-1">
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
            {message.delivery === 'queued'
              ? '⌛ Will send when connected'
              : message.delivery === 'sending'
                ? 'Sending…'
                : message.delivery === 'failed'
                  ? 'Not sent'
                  : ''}
          </span>
        </div>

        {!isUser && !streaming && message.content.length > 0 ? (
          <MessageActions message={message} onOpenFile={onOpenFile} />
        ) : null}
      </div>

      {isUser ? <Avatar label="You" muted /> : null}
    </div>
  );
}

function MessageActions({
  message,
  onOpenFile,
}: {
  message: ChatMessage;
  onOpenFile: (path: string) => void;
}) {
  const fence = extractFence(message.content);
  const refs = /`?((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|json|md|toml|yaml|yml|sh|css|html|sql|rb|java|c|cpp|h))`?/g;
  const files = [...new Set([...message.content.matchAll(refs)].map((m) => m[1]).filter((v): v is string => Boolean(v)))].slice(0, 3);

  if (!fence && files.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {files.map((file) => (
        <button
          key={file}
          type="button"
          onClick={() => onOpenFile(file)}
          className="tap flex items-center rounded-full px-2.5 text-[11px]"
          style={{
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
            minHeight: 28,
          }}
        >
          {file}
        </button>
      ))}
    </div>
  );
}

function Avatar({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className="mt-[2px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
      style={{
        background: muted
          ? 'color-mix(in srgb, var(--metal) 22%, transparent)'
          : 'radial-gradient(circle at 32% 28%, #16202F 0%, #05080F 70%)',
        border: muted ? '1px solid var(--border-default)' : '1px solid var(--border-accent)',
        color: muted ? 'var(--text-secondary)' : 'var(--accent)',
      }}
      aria-hidden
      title={label}
    >
      {muted ? 'YOU' : 'XR'}
    </span>
  );
}
