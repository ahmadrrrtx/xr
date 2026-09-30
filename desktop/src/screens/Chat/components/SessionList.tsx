/*
 * Sessions panel (Phase 4) — 260px, New Chat primary, search (>5 sessions),
 * date groups (Today / Yesterday / Last 7 days / Older), archived link.
 * Auto-hides under 960px; ⌘⇧O toggles.
 */
import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSessionsStore } from '@/stores/sessionsStore';
import { SessionItem } from './SessionItem';

const DAY = 86_400_000;

/** Captured once at module load — date grouping never calls Date.now in render. */
const MOUNT_NOW = Date.now();

function dateGroup(updatedAt: number, now: number): 'today' | 'yesterday' | 'week' | 'older' {
  const d = new Date(updatedAt);
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  if (d.getTime() >= todayStart) return 'today';
  if (d.getTime() >= todayStart - DAY) return 'yesterday';
  if (d.getTime() >= todayStart - 7 * DAY) return 'week';
  return 'older';
}

const GROUP_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  older: 'Older',
};
const GROUP_ORDER = ['today', 'yesterday', 'week', 'older'] as const;

export function SessionList({ activeSessionId }: { activeSessionId: string | null }) {
  const navigate = useNavigate();
  const sessions = useSessionsStore((s) => s.sessions);
  const loading = useSessionsStore((s) => s.loading);
  const createNewSession = useSessionsStore((s) => s.createNewSession);
  const selectSession = useSessionsStore((s) => s.selectSession);
  const renameSession = useSessionsStore((s) => s.renameSession);
  const archiveSession = useSessionsStore((s) => s.archiveSession);
  const deleteSession = useSessionsStore((s) => s.deleteSession);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  // "Now" for date grouping — set in an effect (purity rule) and refreshed
  // every minute so Today/Yesterday roll over on long-lived windows.
  const [now, setNow] = useState<number>(MOUNT_NOW);
  useEffect(() => {
    // Roll Today/Yesterday over on long-lived windows (interval callback
    // only — no setState directly in the effect body).
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const searchRef = useMemo(() => ({ current: null as HTMLInputElement | null }), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q))
      : sessions;
    return showAll ? base : base.slice(0, 100);
  }, [sessions, query, showAll]);

  const groups = useMemo(() => {
    const out: Record<string, typeof filtered> = {};
    for (const s of filtered) {
      const g = dateGroup(s.updatedAt, now);
      (out[g] ??= []).push(s);
    }
    return out;
  }, [filtered, now]);

  const newChat = async () => {
    const s = await createNewSession();
    selectSession(s.id);
    navigate(`/chat/${s.id}`);
  };

  return (
    <aside
      aria-label="Chat sessions"
      className="border-border-subtle bg-bg-ink/40 flex w-[260px] shrink-0 flex-col border-r"
    >
      <div className="p-3">
        <button
          type="button"
          onClick={() => void newChat()}
          className="bg-accent text-accent-contrast hover:bg-accent-hover flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold transition-colors focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          style={{ boxShadow: '0 0 14px -6px var(--accent-glow)' }}
        >
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.5} />
          New Chat
          <span className="text-accent-contrast/70 ml-1 font-mono text-[11px]">⌘N</span>
        </button>
      </div>

      {sessions.length > 5 && (
        <div className="px-3 pb-2">
          <div className="border-border-subtle focus-within:border-accent flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors">
            <Search
              aria-hidden="true"
              className="text-text-tertiary size-3.5 shrink-0"
              strokeWidth={1.5}
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations..."
              aria-label="Search conversations"
              className="placeholder:text-text-tertiary/70 w-full bg-transparent text-[13px] outline-none"
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="text-text-tertiary px-2 py-4 text-[12px]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-text-tertiary/70 px-2 py-6 text-center text-[12px]">
            {query ? 'No matching conversations' : 'No conversations yet'}
          </div>
        ) : (
          GROUP_ORDER.map((g) =>
            groups[g]?.length ? (
              <div key={g} className="mb-1">
                <div className="text-text-tertiary px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
                  {GROUP_LABELS[g]}
                </div>
                {groups[g].map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId}
                    onSelect={() => {
                      selectSession(s.id);
                      navigate(`/chat/${s.id}`);
                    }}
                    onRename={(t) => void renameSession(s.id, t)}
                    onArchive={() => void archiveSession(s.id)}
                    onDelete={() => void deleteSession(s.id)}
                  />
                ))}
              </div>
            ) : null,
          )
        )}
        {!query && sessions.length > 100 && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-text-tertiary hover:text-text-secondary w-full py-2 text-[12px]"
          >
            Show all ({sessions.length})
          </button>
        )}
      </div>

      <div className="border-border-subtle border-t p-2">
        <button
          type="button"
          className="text-text-tertiary hover:text-text-secondary w-full rounded-md px-2 py-1.5 text-left text-[12px]"
          onClick={() =>
            import('sonner').then(({ toast }) =>
              toast('Archived chats coming soon', {
                description: 'The archived list lands with Settings (Phase 8).',
              }),
            )
          }
        >
          Archived chats
        </button>
      </div>
    </aside>
  );
}
