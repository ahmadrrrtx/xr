/*
 * One notification row (Phase 7) — icon + title/body/time, with inline
 * APPROVE/DENY while the approval that raised it is still pending.
 */
import {
  Check,
  Info,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

import { relativeTime, type Notification } from '@/lib/approvalCore';
import { decideApproval } from '@/lib/approvalEvents';
import { cn } from '@/lib/utils';
import { useApprovalStore } from '@/stores/approvalStore';

const TYPE_STYLE: Record<
  Notification['type'],
  { icon: typeof Info; className: string; label: string }
> = {
  'approval-request': {
    icon: ShieldAlert,
    className: 'bg-warning/15 text-warning',
    label: 'approval request',
  },
  'approval-decided': {
    icon: ShieldCheck,
    className: 'bg-accent/10 text-accent',
    label: 'decision',
  },
  success: { icon: Check, className: 'bg-success/15 text-success', label: 'success' },
  error: { icon: X, className: 'bg-danger/15 text-danger', label: 'error' },
  warning: {
    icon: AlertTriangle,
    className: 'bg-warning/15 text-warning',
    label: 'warning',
  },
  info: { icon: Info, className: 'bg-bg-raised text-text-secondary', label: 'info' },
};

export function NotificationItem({
  item,
  now,
}: {
  item: Notification;
  now: number;
}) {
  const reduced = useReducedMotion();
  const pendingApprovalId =
    item.type === 'approval-request' && typeof item.data?.approvalId === 'string'
      ? item.data.approvalId
      : null;
  const stillPending = useApprovalStore((s) =>
    pendingApprovalId
      ? s.pending.some((r) => r.id === pendingApprovalId)
      : false
  );

  const style = TYPE_STYLE[item.type];
  const Icon = style.icon;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 20 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="border-border-subtle/70 hover:bg-bg-raised/60 flex items-start gap-3 border-b p-3"
      role="listitem"
      aria-label={`${item.title} — ${style.label}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
          style.className
        )}
      >
        <Icon size={14} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary truncate text-[13px] font-semibold">
          {item.title}
        </p>
        {item.body && (
          <p className="text-text-secondary mt-0.5 line-clamp-2 text-[12px]">
            {item.body}
          </p>
        )}
        <p className="text-text-tertiary mt-1 text-[11px]">
          {relativeTime(item.createdAt, now)}
        </p>
      </div>
      {stillPending && pendingApprovalId && (
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() =>
              decideApproval(pendingApprovalId, 'approved')
            }
            className="text-accent hover:bg-accent/10 rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => decideApproval(pendingApprovalId, 'denied')}
            className="border-danger/60 text-danger hover:bg-danger/10 rounded-md border px-2 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors"
          >
            Deny
          </button>
        </div>
      )}
    </motion.div>
  );
}
