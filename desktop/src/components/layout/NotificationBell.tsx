/*
 * NotificationBell (Phase 7) — thin re-export: the real bell + popover now
 * lives in components/notifications/BellPopover.tsx (Topbar's import path
 * stays stable, matching how the phase-1 placeholder was mounted).
 */
export { NotificationBell } from '@/components/notifications/BellPopover';
