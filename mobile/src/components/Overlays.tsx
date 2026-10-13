import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RefreshCw, Share, WifiOff } from 'lucide-react';
import { useToasts } from '../stores/toasts';
import { useSettings } from '../stores/settings';
import { useConnection } from '../stores/connection';
import { useQueue } from '../stores/queue';
import { Sheet } from './Sheet';

/* ------------------------------------------------------------- offline bar --- */

export function NetworkBar() {
  const status = useConnection((s) => s.status);
  const draining = useQueue((s) => s.draining);
  const queued = useQueue((s) => s.items.length);
  const offline = status === 'offline';

  return (
    <AnimatePresence>
      {offline || draining ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 26, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex items-center justify-center gap-1.5 overflow-hidden text-[12px] font-medium"
          style={
            draining && !offline
              ? { background: 'color-mix(in srgb, var(--success) 22%, var(--bg-void))', color: 'var(--success)' }
              : { background: 'color-mix(in srgb, var(--danger) 22%, var(--bg-void))', color: 'var(--danger)' }
          }
          role="status"
          aria-live="polite"
        >
          {draining && !offline ? (
            <>
              <Check size={12} strokeWidth={2.2} aria-hidden />
              {queued > 0 ? `Syncing ${queued} queued ${queued === 1 ? 'item' : 'items'}…` : 'Synced'}
            </>
          ) : (
            <>
              <WifiOff size={12} strokeWidth={2} aria-hidden />
              Offline — showing cached data
            </>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ toasts --- */

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[86px] z-[60] flex flex-col items-center gap-2 px-6">
      <AnimatePresence>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="rounded-full px-4 py-2 text-[13.5px] font-medium"
            style={{
              background: 'color-mix(in srgb, var(--bg-raised) 96%, transparent)',
              border: '1px solid var(--border-default)',
              color:
                item.tone === 'error'
                  ? 'var(--danger)'
                  : item.tone === 'success'
                    ? 'var(--success)'
                    : 'var(--text-primary)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            }}
            role="status"
            aria-live="polite"
          >
            {item.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------- update available --- */

export function UpdateBanner({
  needRefresh,
  onRefresh,
}: {
  needRefresh: boolean;
  onRefresh: () => void;
}) {
  return (
    <AnimatePresence>
      {needRefresh ? (
        <motion.button
          type="button"
          onClick={onRefresh}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="mx-3 mt-1 flex items-center justify-center gap-2 rounded-full py-2 text-[13px] font-medium"
          style={{
            background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-ink))',
            border: '1px solid var(--border-accent)',
            color: 'var(--accent)',
            minHeight: 36,
          }}
        >
          <RefreshCw size={13} strokeWidth={1.8} aria-hidden />
          Update available — tap to refresh
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------ install nudge --- */

/**
 * Add-to-Home-Screen nudge. Shown after 3 opens and never more than twice;
 * on iOS there is no install event, so we explain Share → Add to Home Screen.
 */
export function InstallPrompt() {
  const opens = useSettings((s) => s.opens);
  const dismissed = useSettings((s) => s.installPromptDismissed);
  const dismiss = useSettings((s) => s.dismissInstallPrompt);
  const [open, setOpen] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIos(ios);
    if (standalone) return;
    if (dismissed || opens < 3) return;
    const timer = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [opens, dismissed]);

  return (
    <Sheet open={open} onClose={() => { dismiss(); setOpen(false); }} compact title="Keep XR on your home screen">
      <div className="px-4 pb-4">
        {isIos ? (
          <ol
            className="list-decimal space-y-2 pl-5 text-[15px] leading-[1.5]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <li>
              Tap the <Share size={14} className="inline align-[-2px]" aria-hidden /> Share button in
              Safari
            </li>
            <li>Choose “Add to Home Screen”</li>
            <li>XR opens full-screen, with no browser chrome</li>
          </ol>
        ) : (
          <p className="text-[15px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
            Open your browser menu and choose <strong>Install app</strong> (or “Add to Home screen”)
            to run XR full-screen.
          </p>
        )}
        <p className="mt-3 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          XR works on your home WiFi. Push notifications need your desktop to be running.
        </p>
        <button
          type="button"
          onClick={() => {
            dismiss();
            setOpen(false);
          }}
          className="tap mt-4 w-full rounded-[12px] text-[15px] font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--bg-void)' }}
        >
          Got it
        </button>
      </div>
    </Sheet>
  );
}
