/*
 * One session row (44px): truncated title, relative timestamp + model dot,
 * active treatment (bg-bg-raised + 3px accent bar), hover actions
 * (rename inline / archive / delete). Rename: Enter saves, Escape cancels.
 */
import { Archive, Check, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Session } from '@/lib/chat-db';

function relTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((now.getTime() - ts) / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function TinyAction({
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="text-text-tertiary hover:text-text-primary flex size-7 items-center justify-center rounded-md opacity-0 transition-opacity group-hover/sess:opacity-100 focus-visible:opacity-100"
    >
      {children}
    </button>
  );
}

export function SessionItem({
  session,
  active,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== session.title) onRename(t);
    else setDraft(session.title);
  };

  return (
    <div
      className={`group/sess relative flex h-11 items-center rounded-lg pr-1 transition-colors ${
        active ? 'bg-bg-raised' : 'hover:bg-bg-raised/60'
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="bg-accent absolute top-2 bottom-2 left-0 w-[3px] rounded-full"
        />
      )}
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 pl-3">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(session.title);
                setEditing(false);
              }
            }}
            onBlur={commit}
            className="border-border-default bg-bg-void text-text-primary min-w-0 flex-1 rounded-md border px-2 py-1 text-[14px] outline-none focus:border-accent"
            aria-label="Rename session"
          />
          <TinyAction label="Save name" onClick={commit}>
            <Check aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
          </TinyAction>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pr-1 pl-3 text-left"
        >
          <span
            className={`truncate text-[14px] ${active ? 'text-text-primary' : 'text-text-secondary'}`}
          >
            {session.title}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-text-tertiary text-[11px]">{relTime(session.updatedAt)}</span>
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{
                backgroundColor: session.archived
                  ? 'var(--text-tertiary)'
                  : 'var(--accent)',
              }}
            />
          </span>
        </button>
      )}
      {!editing && (
        <div className="absolute right-1 flex items-center bg-bg-raised/0">
          <TinyAction label="Rename session" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
          </TinyAction>
          <TinyAction label="Archive session" onClick={onArchive}>
            <Archive aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
          </TinyAction>
          <TinyAction label="Delete session" onClick={onDelete}>
            <Trash2 aria-hidden="true" className="text-danger/80 size-3.5" strokeWidth={1.5} />
          </TinyAction>
        </div>
      )}
    </div>
  );
}
