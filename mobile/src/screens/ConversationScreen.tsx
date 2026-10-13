import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw, Share2, Square, FileCode2 } from 'lucide-react';
import { Screen } from '../components/Screen';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { ActionSheet, Sheet } from '../components/Sheet';
import { CodeBlock } from '../components/CodeBlock';
import { EmptyState, SkeletonRows } from '../components/ui';
import { useChats } from '../stores/chats';
import { useNav } from '../stores/nav';
import { useToasts } from '../stores/toasts';
import { copyText, share } from '../lib/clipboard';
import { extractFence } from '../lib/highlight';
import type { ChatMessage } from '../types';

export function ConversationScreen({ chatId, title }: { chatId: string; title?: string }) {
  const messages = useChats((s) => s.messages[chatId]);
  const chats = useChats((s) => s.chats);
  const streamingChatId = useChats((s) => s.streamingChatId);
  const loadMessages = useChats((s) => s.loadMessages);
  const send = useChats((s) => s.send);
  const stop = useChats((s) => s.stop);
  const regenerate = useChats((s) => s.regenerate);
  const pop = useNav((s) => s.pop);
  const push = useNav((s) => s.push);
  const show = useToasts((s) => s.show);

  const [target, setTarget] = useState<ChatMessage | null>(null);
  const [fileRef, setFileRef] = useState<{ path: string; code?: string; lang?: string } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  const streaming = streamingChatId === chatId;
  const resolvedTitle = useMemo(
    () => chats.find((chat) => chat.id === chatId)?.title ?? title ?? 'Chat',
    [chats, chatId, title],
  );

  useEffect(() => {
    void loadMessages(chatId);
  }, [chatId, loadMessages]);

  // Follow new tokens only when the user is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = (): void => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const onSend = (text: string): void => {
    pinned.current = true;
    void send(chatId, text);
  };

  const fence = target ? extractFence(target.content) : null;

  return (
    <Screen
      navTitle={resolvedTitle}
      onBack={pop}
      right={
        streaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generating"
            className="tap flex items-center justify-center rounded-full"
          >
            <Square size={16} strokeWidth={2} fill="currentColor" style={{ color: 'var(--danger)' }} aria-hidden />
          </button>
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="scroll-quiet flex-1 px-3 py-3"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {!messages ? (
            <SkeletonRows rows={5} />
          ) : messages.length === 0 ? (
            <EmptyState
              title="Ask XR anything"
              detail="Messages stay on your machine — they're sent to your desktop over your own WiFi."
            />
          ) : (
            <div className="flex flex-col gap-3.5">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onLongPress={setTarget}
                  onOpenFile={(path) => {
                    const source = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.includes(path));
                    const found = source ? extractFence(source.content) : null;
                    setFileRef({ path, code: found?.code, lang: found?.lang });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <Composer
          onSend={onSend}
          onVoice={() => push({ name: 'voice' }, 'voice')}
          onStop={stop}
          streaming={streaming}
        />
      </div>

      {/* Long-press actions */}
      <ActionSheet
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.role === 'user' ? 'Your message' : 'XR message'}
        subtitle={target?.content.slice(0, 90)}
        actions={[
          {
            label: 'Copy',
            icon: <Copy size={17} strokeWidth={1.6} />,
            onSelect: () => {
              if (target) void copyText(target.content).then(() => show('Copied', 'success'));
            },
          },
          {
            label: fence ? 'Copy code' : 'Copy code block',
            icon: <FileCode2 size={17} strokeWidth={1.6} />,
            disabled: !fence,
            onSelect: () => {
              if (fence) void copyText(fence.code).then(() => show('Code copied', 'success'));
            },
          },
          {
            label: 'Share',
            icon: <Share2 size={17} strokeWidth={1.6} />,
            onSelect: () => {
              if (target) void share('XR', target.content);
            },
          },
          {
            label: 'Regenerate',
            icon: <RefreshCw size={17} strokeWidth={1.6} />,
            disabled: streaming || target?.role !== 'assistant',
            onSelect: () => {
              if (target) void regenerate(chatId, target.id);
            },
          },
          ...(streaming
            ? [
                {
                  label: 'Stop',
                  icon: <Square size={16} strokeWidth={2} />,
                  destructive: true,
                  onSelect: stop,
                },
              ]
            : []),
        ]}
      />

      {/* Read-only file reference. No edit, no apply — mobile is a companion. */}
      <Sheet
        open={fileRef !== null}
        onClose={() => setFileRef(null)}
        title={fileRef?.path ?? 'File'}
        compact
      >
        <div className="px-4 pb-6">
          {fileRef?.code ? (
            <CodeBlock code={fileRef.code} lang={fileRef.lang} maxHeight={420} />
          ) : (
            <p className="text-[14px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
              No snippet for this file in this conversation.
            </p>
          )}
          <p className="mt-3 text-[12.5px] leading-[1.45]" style={{ color: 'var(--text-tertiary)' }}>
            Code editing isn’t available on mobile — use the desktop or CLI. You can copy this
            snippet.
          </p>
        </div>
      </Sheet>
    </Screen>
  );
}
