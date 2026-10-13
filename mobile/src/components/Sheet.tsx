import { type ReactNode, useEffect, useRef } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { haptic } from '../lib/haptics';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string | undefined;
  children: ReactNode;
  /** Compact action list (long-press menu) instead of a tall detail sheet. */
  compact?: boolean;
  footer?: ReactNode | undefined;
}

/**
 * Bottom sheet — never a desktop-style centred modal.
 * Slides up, drag-to-dismiss, respects the home indicator.
 */
export function Sheet({ open, onClose, title, children, compact, footer }: SheetProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo): void => {
    // Only dismiss on a downward drag — pulling up should never close it.
    if (info.offset.y > 110 || info.velocity.y > 650) {
      haptic('light');
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 cursor-default"
            style={{ background: 'color-mix(in srgb, var(--bg-void) 62%, transparent)', backdropFilter: 'blur(6px)' }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title ?? 'Sheet'}
            drag={compact ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={onDragEnd}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
            className="relative flex w-full max-w-[520px] flex-col"
            style={{
              background: 'var(--bg-ink)',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              border: '1px solid var(--border-default)',
              borderBottom: 'none',
              maxHeight: compact ? '78dvh' : '88dvh',
              boxShadow: '0 -12px 40px rgba(0,0,0,0.35)',
            }}
          >
            {/* Grabber — the drag affordance on compact sheets */}
            <div className="flex justify-center pt-2">
              <span
                className="h-[5px] w-9 rounded-full"
                style={{ background: 'var(--border-default)' }}
                aria-hidden
              />
            </div>

            {title ? (
              <div className="flex items-center justify-between px-4 pb-2 pt-3">
                <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="tap -mr-2 flex items-center justify-center rounded-full"
                >
                  <X size={20} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
                </button>
              </div>
            ) : null}

            <div ref={scrollRef} className="scroll-quiet min-h-0 flex-1 overscroll-contain">
              {children}
            </div>

            {footer ? (
              <div className="border-t border-[var(--border-subtle)] px-4 pb-safe pt-3">{footer}</div>
            ) : (
              <div className="pb-safe" />
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

interface Action {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** iOS-style long-press action list. */
export function ActionSheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: string | undefined;
  subtitle?: string | undefined;
  actions: Action[];
}) {
  return (
    <Sheet open={open} onClose={onClose} compact>
      <div className="px-4 pb-2">
        {title ? (
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {title}
          </p>
        ) : null}
        {subtitle ? (
          <p
            className="mt-0.5 line-clamp-2 text-[13px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="px-3 pb-3">
        <div
          className="overflow-hidden rounded-[14px]"
          style={{ background: 'color-mix(in srgb, var(--bg-raised) 70%, transparent)' }}
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={() => {
                haptic('light');
                action.onSelect();
                onClose();
              }}
              className="flex w-full items-center gap-3 px-4 py-[14px] text-left text-[16px] disabled:opacity-40"
              style={{
                color: action.destructive ? 'var(--danger)' : 'var(--text-primary)',
                borderTop: index > 0 ? '1px solid var(--border-subtle)' : 'none',
                minHeight: 44,
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-[14px] py-[14px] text-[16px] font-semibold"
          style={{
            background: 'color-mix(in srgb, var(--bg-raised) 70%, transparent)',
            color: 'var(--text-primary)',
            minHeight: 44,
          }}
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
