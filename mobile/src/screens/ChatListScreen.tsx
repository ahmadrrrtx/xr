import { useEffect, useMemo } from 'react';
import { Plus, Search, X, MessageCircle } from 'lucide-react';
import { Screen } from '../components/Screen';
import { PullToRefresh } from '../components/PullToRefresh';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui';
import { useChats } from '../stores/chats';
import { useNav } from '../stores/nav';
import { useConnection } from '../stores/connection';
import { relativeTime } from '../lib/format';

export function ChatListScreen() {
  const chats = useChats((s) => s.chats);
  const loading = useChats((s) => s.loading);
  const refreshing = useChats((s) => s.refreshing);
  const error = useChats((s) => s.error);
  const search = useChats((s) => s.search);
  const setSearch = useChats((s) => s.setSearch);
  const load = useChats((s) => s.load);
  const refresh = useChats((s) => s.refresh);
  const newChat = useChats((s) => s.newChat);
  const push = useNav((s) => s.push);
  const status = useConnection((s) => s.status);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length === 0) return chats;
    return chats.filter(
      (chat) =>
        chat.title.toLowerCase().includes(query) ||
        (chat.lastMessage ?? '').toLowerCase().includes(query),
    );
  }, [chats, search]);

  const onNewChat = async (): Promise<void> => {
    const id = await newChat();
    if (id) push({ name: 'conversation', chatId: id, title: 'New chat' });
  };

  return (
    <Screen
      title="Chats"
      right={
        <button
          type="button"
          onClick={() => void onNewChat()}
          aria-label="New chat"
          className="tap flex items-center justify-center rounded-full"
        >
          <Plus size={22} strokeWidth={1.6} style={{ color: 'var(--accent)' }} aria-hidden />
        </button>
      }
    >
      <div className="search-shell px-4 pb-1 pt-1.5">
        <div
          className="flex items-center gap-2 rounded-[11px] px-2.5"
          style={{
            background: 'color-mix(in srgb, var(--metal) 13%, transparent)',
            minHeight: 38,
          }}
        >
          <Search size={16} strokeWidth={1.7} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-h-[38px] flex-1 bg-transparent text-[16px] outline-none placeholder:opacity-60"
            style={{ color: 'var(--text-primary)' }}
          />
          {search.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="tap flex items-center justify-center"
            >
              <X size={15} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <PullToRefresh onRefresh={refresh} refreshing={refreshing}>
        {loading && chats.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : error && chats.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageCircle size={26} strokeWidth={1.4} />}
            title={search.length > 0 ? 'No chats match that' : 'No chats yet'}
            detail={
              search.length > 0
                ? 'Try a different search.'
                : 'Tap + to start one. Chats stay on your machine.'
            }
            action={
              search.length === 0 ? (
                <button
                  type="button"
                  onClick={() => void onNewChat()}
                  className="tap rounded-full px-5 text-[15px] font-semibold"
                  style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
                >
                  New chat
                </button>
              ) : undefined
            }
          />
        ) : (
          <ul>
            {filtered.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  onClick={() => push({ name: 'conversation', chatId: chat.id, title: chat.title })}
                  className="flex w-full items-center gap-3 px-4 py-[11px] text-left"
                  style={{ borderBottom: '1px solid var(--border-subtle)', minHeight: 62 }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className="truncate text-[16px] font-medium leading-[1.3]"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {chat.title}
                      </p>
                      {chat.unread && chat.unread > 0 ? (
                        <span
                          className="h-[7px] w-[7px] shrink-0 rounded-full"
                          style={{ background: 'var(--accent)' }}
                          aria-label="Unread"
                        />
                      ) : null}
                    </div>
                    <p
                      className="mt-[3px] truncate text-[13.5px] leading-[1.35]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {chat.lastMessage || 'No messages yet'}
                    </p>
                  </div>
                  <span
                    className="shrink-0 self-start pt-[2px] text-[12px]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {relativeTime(chat.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {status === 'offline' && chats.length > 0 ? (
          <p
            className="px-4 py-3 text-center text-[12px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Showing the last {chats.length} chats saved on this phone.
          </p>
        ) : null}
      </PullToRefresh>
    </Screen>
  );
}
