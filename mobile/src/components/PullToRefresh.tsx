import { type ReactNode, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { haptic } from '../lib/haptics';

/**
 * Pull-to-refresh. Deliberately hand-rolled (no heavyweight list lib): it reads
 * the scroll container's own scrollTop and only arms at the very top, so it
 * composes with the message list's stick-to-bottom behaviour.
 */
export function PullToRefresh({
  onRefresh,
  refreshing,
  children,
}: {
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [armed, setArmed] = useState(false);

  const THRESHOLD = 62;

  const reset = (): void => {
    startY.current = null;
    setPull(0);
    setArmed(false);
  };

  const onTouchStart = (event: React.TouchEvent): void => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 2 || refreshing) return;
    const touch = event.touches[0];
    if (touch) startY.current = touch.clientY;
  };

  const onTouchMove = (event: React.TouchEvent): void => {
    if (startY.current === null) return;
    const touch = event.touches[0];
    if (!touch) return;
    const delta = touch.clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      setArmed(false);
      return;
    }
    // Rubber-band: resistance grows the further you pull.
    const resisted = Math.min(96, delta * 0.55);
    setPull(resisted);
    if (resisted > THRESHOLD && !armed) {
      setArmed(true);
      haptic('light');
    } else if (resisted <= THRESHOLD && armed) {
      setArmed(false);
    }
  };

  const onTouchEnd = async (): Promise<void> => {
    if (armed) {
      setPull(THRESHOLD);
      await onRefresh();
    }
    reset();
  };

  return (
    <div className="relative h-full min-h-0">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{ height: 0 }}
        aria-hidden
      >
        <div
          className="flex items-center justify-center"
          style={{
            height: pull,
            opacity: Math.min(1, pull / THRESHOLD),
            transform: `translateY(${pull * 0.35}px)`,
          }}
        >
          {refreshing ? (
            <Loader2 size={18} strokeWidth={1.6} className="spinner" style={{ color: 'var(--accent)' }} />
          ) : (
            <span
              className="text-[12px] font-medium"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {armed ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="scroll-quiet h-full min-h-0"
        style={{
          transform: pull > 0 && !refreshing ? `translateY(${pull * 0.35}px)` : undefined,
          transition: startY.current === null ? 'transform 200ms ease-out' : 'none',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => void onTouchEnd()}
        onTouchCancel={reset}
      >
        {children}
      </div>
    </div>
  );
}
