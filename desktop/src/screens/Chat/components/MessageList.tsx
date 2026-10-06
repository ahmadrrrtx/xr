/*
 * Message list (Phase 4) — normal flex-col flow (pagination + welcome state
 * are simpler than column-reverse; stick-to-bottom comes from the hook).
 * Older messages load when the user scrolls within 80px of the top; the
 * previous first message anchors the scroll offset so nothing jumps.
 * aria-live="polite" mirrors assistant completions for screen readers.
 */
import { useEffect, useRef } from 'react';

import { useChatStore } from '@/stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import type { ChatMessage } from '@/lib/chat-db';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { Skeleton } from '@/components/ui/skeleton';

/** Stable empty page — a fresh `[]` per snapshot would loop useSyncExternalStore. */
const NO_MESSAGES: ChatMessage[] = [];
import { WelcomeState } from './WelcomeState';

export function MessageList({ sessionId }: { sessionId: string }) {
  const messages = useChatStore((s) => s.messages[sessionId] ?? NO_MESSAGES);
  const hasMore = useChatStore((s) => s.hasMore[sessionId] ?? false);
  const loadingMore = useChatStore((s) => s.loadingMore);
  const stream = useChatStore((s) => s.stream);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const regenerate = useChatStore((s) => s.regenerate);

  const scrollKey = `${sessionId}|${messages.length}|${stream?.text.length ?? -1}|${stream?.toolCalls.length ?? 0}|${stream?.status ?? 'idle'}|${stream ? 'streaming' : 'idle'}`;
  const { containerRef, onScroll, scrollToBottom, forceStick, isStuck, newCount } =
    useStickToBottom(scrollKey);

  const anchorRef = useRef<{ el: HTMLElement | null; top: number } | null>(null);

  // Load older when the user nears the top; anchor scroll to the old first row.
  const handleScroll = () => {
    onScroll();
    const el = containerRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollTop <= 80) {
      anchorRef.current = {
        el: el.firstElementChild as HTMLElement | null,
        top: (el.firstElementChild as HTMLElement | null)?.offsetTop ?? 0,
      };
      void loadOlder(sessionId);
    }
  };

  // Restore the anchor position after older messages prepend.
  useEffect(() => {
    const el = containerRef.current;
    if (el && anchorRef.current?.el) {
      const delta = anchorRef.current.el.offsetTop - anchorRef.current.top;
      if (delta > 0) el.scrollTop += delta;
      anchorRef.current = null;
    }
  }, [messages.length, containerRef]);

  // Follow the newest message on send (even if the user had scrolled up).
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'user') {
      forceStick();
      scrollToBottom(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send-follow only
  }, [messages.length]);

  const isStreamingHere = stream?.sessionId === sessionId;

  if (messages.length === 0 && !isStreamingHere) {
    return <WelcomeState />;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-6 pt-6 pb-4"
        aria-label="Conversation"
      >
        {loadingMore && (
          <div className="mb-3 flex flex-col items-center gap-2" aria-label="Loading older messages">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onEdit={(text) => void sendMessage(text)}
            onRetry={m.metadata?.status === 'failed' ? () => void retryMessage(m.id) : undefined}
            onRegenerate={
              m.role === 'assistant' ? () => void regenerate(m.id) : undefined
            }
          />
        ))}

        {isStreamingHere && stream && (
          <MessageBubble
            message={{
              id: 'streaming',
              sessionId,
              role: 'assistant',
              content: stream.text,
              createdAt: stream.startedAt,
              ...(stream.budget ? { metadata: { budget: stream.budget } } : {}),
            }}
            isStreaming
            streamingText={stream.text}
            streamingTools={stream.toolCalls}
          />
        )}
        <div aria-live="polite" className="sr-only">
          {(() => {
            const last = messages[messages.length - 1];
            return last?.role === 'assistant' ? last.content.slice(0, 300) : '';
          })()}
        </div>
      </div>

      {!isStuck && (
        <ScrollToBottomButton
          count={newCount}
          onClick={() => scrollToBottom(true)}
        />
      )}
    </div>
  );
}
