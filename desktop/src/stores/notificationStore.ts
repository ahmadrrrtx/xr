/*
 * Notification feed (Phase 7) — the bell's data.
 *
 * Session-only by design (pending approvals and their toasts don't survive a
 * restart either; remember rules do — lib/approvalRules.ts). Newest first,
 * capped at NOTIFICATION_CAP; the popover renders the newest BELL_VISIBLE.
 */
import { create } from 'zustand';

import {
  capNotifications,
  NOTIFICATION_CAP,
  type Notification,
} from '@/lib/approvalCore';

interface NotificationState {
  items: Notification[];
  unreadCount: number;
  add: (n: Notification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,

  add: (n) =>
    set((st) => ({
      items: capNotifications([n, ...st.items]),
      unreadCount: Math.min(st.unreadCount + 1, NOTIFICATION_CAP),
    })),

  markRead: (id) =>
    set((st) => {
      const item = st.items.find((n) => n.id === id);
      if (!item || item.read) return st;
      return {
        items: st.items.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: Math.max(0, st.unreadCount - 1),
      };
    }),

  markAllRead: () =>
    set((st) => ({
      items: st.items.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  remove: (id) =>
    set((st) => {
      const item = st.items.find((n) => n.id === id);
      if (!item) return st;
      return {
        items: st.items.filter((n) => n.id !== id),
        unreadCount: item.read ? st.unreadCount : Math.max(0, st.unreadCount - 1),
      };
    }),

  clear: () => set({ items: [], unreadCount: 0 }),
}));

/** Live unread badge text: dot at 1, count up to 99, "99+" beyond. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return null; // dot only
  return count > 99 ? '99+' : String(count);
}
