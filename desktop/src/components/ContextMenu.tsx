/**
 * XR — contextual right-click menus (Phase 3).
 *
 * One primitive, many object classes (files, runs, …): each caller supplies
 * the actions that are REAL for that object. The menu itself only handles
 * placement (clamped to the viewport), Esc/outside dismissal, and the
 * enter-animation from the pointer origin (motion law: origin-aware).
 */
import { useEffect, useRef, type CSSProperties } from "react";

export interface CtxItem {
  label: string;
  danger?: boolean;
  run: () => void;
}

export interface CtxState {
  x: number;
  y: number;
  items: CtxItem[];
}

export function ContextMenu({ state, onClose }: { state: CtxState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const W = 210;
  const H = state.items.length * 34 + 12;
  const left = Math.max(8, Math.min(state.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - H - 8));

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left, top, "--ctx-origin": `${state.x - left}px ${state.y - top}px` } as CSSProperties}
      role="menu"
      aria-label="Context actions"
    >
      {state.items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? "ctx-item danger" : "ctx-item"}
          onClick={() => { onClose(); it.run(); }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
