/*
 * Notification bell + popover (Phase 7) — the Phase-1 placeholder becomes
 * the real feed. 360px panel, newest 20 items with day separators, inline
 * approve/deny on pending approval rows, "Mark all read", "Open Control
 * Room" (the /runs screen; Shield takes over in Phase 12).
 *
 * Opening the popover marks everything read — seeing IS reading here.
 */
import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { NotificationItem } from '@/components/notifications/NotificationItem';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { BELL_VISIBLE, dayLabel } from '@/lib/approvalCore';
import { badgeLabel } from '@/stores/notificationStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const navigate = useNavigate();
  const items = useNotificationStore((s) => s.items);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  const [open, setOpen] = useState(false);
  // "Now" for relative times — refreshed while the popover is open (kept in
  // state so render stays pure; Date.now() never runs during render).
  const [now, setNow] = useState(() => Date.now());

  // Opening = "seen": mark everything read + snapshot `now` (event-driven —
  // the effect below only runs the 30s ticker while open).
  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
      setNow(Date.now());
      markAllRead();
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const badge = badgeLabel(unreadCount);
  const visible = items.slice(0, BELL_VISIBLE);
  let lastDay = '';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={
          unreadCount > 0
            ? `Notifications — ${unreadCount} unread`
            : 'Notifications'
        }
        title="Notifications"
        className={cn(
          'text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-void',
          'relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-out',
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
        )}
      >
        <Bell size={18} strokeWidth={1.5} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'bg-danger text-danger-contrast absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full font-semibold',
              badge === null
                ? 'size-2.5' // single unread → dot only
                : 'h-3.5 min-w-3.5 px-1 text-[9px] leading-none'
            )}
          >
            {badge}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="bg-bg-ink w-[360px] max-h-[420px] p-0 overflow-hidden"
      >
        {/* Header */}
        <div className="border-border-subtle flex h-11 shrink-0 items-center justify-between border-b px-4">
          <span className="text-text-primary text-sm font-semibold">
            Notifications
          </span>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="text-accent hover:bg-accent/10 rounded-md px-2 py-1 text-xs transition-colors duration-150 ease-out disabled:cursor-default disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>

        {/* Feed */}
        <div className="flex max-h-[300px] flex-col overflow-y-auto" role="list" aria-label="Notification history">
          {visible.length === 0 ? (
            <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 px-4 py-8">
              <Bell
                size={24}
                strokeWidth={1.5}
                aria-hidden="true"
                className="text-text-tertiary"
              />
              <p className="text-text-tertiary text-sm">No new notifications</p>
            </div>
          ) : (
            visible.map((item) => {
              const day = dayLabel(item.createdAt, now);
              const separator = day !== lastDay ? day : null;
              lastDay = day;
              return (
                <div key={item.id}>
                  {separator && (
                    <div className="bg-bg-raised/40 text-text-tertiary px-4 py-1.5 text-[10px] font-semibold tracking-wider uppercase">
                      {separator}
                    </div>
                  )}
                  <NotificationItem item={item} now={now} />
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-border-subtle border-t p-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/runs');
            }}
            className="text-text-secondary hover:bg-bg-raised hover:text-text-primary w-full rounded-md px-3 py-2 text-left text-[13px] transition-colors duration-150 ease-out"
          >
            Open Control Room
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
