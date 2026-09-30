/*
 * Notification bell + popover (Phase 1 brief §5.8).
 * 360px popover with an honest empty state — the real notification feed is
 * populated by Shield in Phase 12. The "3" badge is a static visual indicator
 * until then.
 */
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function NotificationBell() {
  const navigate = useNavigate();

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications — 3 unread"
        title="Notifications"
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-void relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <Bell size={18} strokeWidth={1.5} aria-hidden="true" />
        {/* unread badge — static "3" until the Phase 12 feed exists */}
        <span
          aria-hidden="true"
          className="bg-danger text-danger-contrast absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none font-semibold"
        >
          3
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[420px] w-[360px] p-0">
        <div className="border-border-subtle flex h-11 items-center justify-between border-b px-4">
          <span className="text-text-primary text-sm font-semibold">
            Notifications
          </span>
          <button
            type="button"
            className="text-text-tertiary hover:bg-bg-raised hover:text-text-primary rounded-md px-2 py-1 text-xs transition-colors duration-150 ease-out"
            disabled
            title="Enabled when the notification feed ships (Phase 12)"
          >
            Mark all read
          </button>
        </div>

        <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 px-4 py-8">
          <Bell
            size={24}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-text-tertiary"
          />
          <p className="text-text-tertiary text-sm">No new notifications</p>
        </div>

        <div className="border-border-subtle border-t p-2">
          <button
            type="button"
            onClick={() => navigate('/runs')}
            className="text-text-secondary hover:bg-bg-raised hover:text-text-primary w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ease-out"
          >
            Open Control Room
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
