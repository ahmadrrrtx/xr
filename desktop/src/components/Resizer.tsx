import { useCallback, useEffect, useState } from "react";

/**
 * VS Code-style drag-to-resize handle + persisted CSS variable widths.
 *
 * Works against CSS custom properties (--xr-explorer-w / --xr-chat-w / --xr-terminal-h).
 * Double-click resets to default.
 */
export function useResizer(
  varName: "--xr-explorer-w" | "--xr-chat-w" | "--xr-terminal-h" | string,
  axis: "x" | "y",
  defaultValue: number,
  minValue = 160,
  maxValue = 800,
  localStorageKey?: string,
) {
  const [size, setSize] = useState<number>(() => {
    const v = localStorageKey ? safeNum(localStorage.getItem(localStorageKey)) : null;
    return v ?? defaultValue;
  });

  useEffect(() => {
    document.documentElement.style.setProperty(varName, size + "px");
    if (localStorageKey) localStorage.setItem(localStorageKey, String(size));
  }, [size, varName, localStorageKey]);

  const start = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const startSize = size;
    const root = document.documentElement;
    root.style.userSelect = "none";
    root.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    let rafId = 0;

    function onMove(ev: PointerEvent) {
      const delta = axis === "x" ? ev.clientX - startPos : startPos - ev.clientY;
      const next = Math.max(minValue, Math.min(maxValue, startSize + delta));
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setSize(next));
    }
    function onUp() {
      root.style.userSelect = "";
      root.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [axis, size, minValue, maxValue]);

  const reset = useCallback(() => setSize(defaultValue), [defaultValue]);

  return { size, setSize, reset, handlers: { onPointerDown: start, onDoubleClick: reset, role: "separator", "aria-orientation": axis === "x" ? "vertical" as const : "horizontal" as const, tabIndex: 0 } };
}

function safeNum(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ResizeHandle({ direction, onPointerDown, onDoubleClick, style }: {
  direction: "v" | "h";
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={"xr-resizer xr-resizer--" + direction}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={style}
      role="separator"
      aria-orientation={direction === "v" ? "vertical" : "horizontal"}
      tabIndex={0}
    >
      <div className="xr-resizer-hit"/>
    </div>
  );
}
