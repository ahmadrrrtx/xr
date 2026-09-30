/*
 * Quick-ask answer area (Phase 5) — replaces the results list while XR
 * streams a short answer inside the palette (mockLLM; the real engine takes
 * over in Phase 14). Footer: Stop while streaming, Open in chat always.
 */
import { useEffect, useRef } from 'react';
import { ArrowRight, CircleStop } from 'lucide-react';

import { Avatar } from '@/components/brand/Avatar';
import { StreamingCursor } from '@/screens/Chat/components/StreamingCursor';
import { usePaletteStore } from '@/stores/paletteStore';
import { cn } from '@/lib/utils';

interface PaletteQuickAskProps {
  /** Stop the in-flight stream (AbortController lives in the shell). */
  onStop: () => void;
  /** "Open in chat" — persists the Q&A pair and navigates. */
  onOpenInChat: () => void | Promise<void>;
}

export function PaletteQuickAsk({ onStop, onOpenInChat }: PaletteQuickAskProps) {
  const quickAsk = usePaletteStore((s) => s.quickAsk);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Stick to the bottom while tokens arrive (same rule as the chat screen:
  // only when the reader is already near the bottom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [quickAsk.answer]);

  const streaming = quickAsk.status === 'streaming';

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="palette-quick-ask">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        aria-live="polite"
        aria-label="XR quick answer"
      >
        <div className="flex items-center gap-2 pb-2">
          <Avatar size="sm" variant="head" state={streaming ? 'speaking' : 'idle'} aria-hidden="true" />
          <span className="text-accent font-mono text-[12px] tracking-wide">XR</span>
          {quickAsk.status === 'error' && (
            <span className="text-danger ml-1 text-[12px]">
              Something went wrong — try again or open in chat.
            </span>
          )}
          {quickAsk.status === 'stopped' && (
            <span className="text-text-tertiary ml-1 text-[12px]">Stopped.</span>
          )}
        </div>
        <p className="text-text-primary max-h-[240px] overflow-y-auto whitespace-pre-wrap text-[14px] leading-[1.5]">
          {quickAsk.answer || (streaming ? '' : '…')}
          {streaming && <StreamingCursor />}
        </p>
      </div>

      <div className="border-border-subtle flex h-10 shrink-0 items-center justify-between border-t px-4">
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="text-text-secondary hover:text-text-primary flex items-center gap-1.5 text-[12px]"
          >
            <CircleStop size={14} strokeWidth={1.5} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <span className="text-text-tertiary text-[11px]">
            {quickAsk.status === 'done' ? 'Answer complete' : 'Stream ended'}
          </span>
        )}
        <button
          type="button"
          onClick={() => void onOpenInChat()}
          className={cn(
            'text-accent hover:text-accent-hover flex items-center gap-1 text-[12px] font-medium'
          )}
        >
          Open in chat
          <ArrowRight size={13} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
