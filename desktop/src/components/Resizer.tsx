/*
 * Resizer (Phase 9) — the 4px drag divider between Brain panes.
 *
 * Vertical (col-resize) and horizontal (row-resize) variants. Drag updates
 * the parent's flex-basis via callback; double-click resets to defaults.
 * Positions persist through the durable write-through layer
 * (lib/persistent-store.ts) so layouts survive reloads (brief §8).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';

interface ResizerProps {
  orientation: 'vertical' | 'horizontal';
  /** Persisted key, e.g. 'xr.brain.splitter.main'. */
  storageKey: string;
  /** Current size (px) of the FIRST pane. */
  value: number;
  onChange: (px: number) => void;
  min: number;
  max: number;
  /** Default size — restored on double-click. */
  defaultValue: number;
  /** Phase 17: the sized pane sits AFTER the handle (right/bottom), so dragging toward it shrinks it. */
  invert?: boolean;
  /** Optional accessible name (defaults to a generic one). */
  label?: string;
}

export function Resizer({
  orientation,
  storageKey,
  value,
  onChange,
  min,
  max,
  defaultValue,
  invert = false,
  label,
}: ResizerProps) {
  const [dragging, setDragging] = useState(false);
  const startPos = useRef(0);
  const startValue = useRef(value);

  // Hydrate once (write-through pair).
  useEffect(() => {
    let alive = true;
    void readSettingJSON<number>(storageKey).then((v) => {
      if (!alive || v == null) return;
      onChange(Math.min(max, Math.max(min, v)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [storageKey]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startPos.current = orientation === 'vertical' ? e.clientX : e.clientY;
      startValue.current = value;
      setDragging(true);
    },
    [orientation, value]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const pos = orientation === 'vertical' ? e.clientX : e.clientY;
      const delta = (pos - startPos.current) * (invert ? -1 : 1);
      const next = Math.min(max, Math.max(min, startValue.current + delta));
      if (next !== value) onChange(next);
    },
    [dragging, invert, max, min, onChange, orientation, value]
  );

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    writeSettingJSON(storageKey, value);
  }, [dragging, storageKey, value]);

  const onDoubleClick = useCallback(() => {
    onChange(defaultValue);
    writeSettingJSON(storageKey, defaultValue);
  }, [defaultValue, onChange, storageKey]);

  return (
    <div
      role="separator"
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={label ?? 'Resize panes'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
      className={cn(
        'shrink-0 bg-transparent transition-colors duration-100',
        'hover:bg-accent/30',
        dragging && 'bg-accent/40',
        orientation === 'vertical'
          ? 'w-1 cursor-col-resize touch-none'
          : 'h-1 cursor-row-resize touch-none'
      )}
    />
  );
}
