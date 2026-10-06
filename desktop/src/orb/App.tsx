/**
 * Companion Orb window (Phase 6) — the whole window is the orb.
 *
 * The Phase 2 <CompanionOrb /> SVG renders at 80px inside the 120×120
 * transparent window (the 20px padding lets the halo + voice rings breathe;
 * `overflow-visible` stops the svg box from clipping them).
 *
 * Pointer contract (docs/phases/06-companion-orb.plan.md §6):
 *   left press + move >4px   → native window drag (startDragging)
 *   left click               → 2s listening preview + `orb:clicked` broadcast
 *   left double-click <400ms → focus the main window (Rust command)
 *   right-click              → native OS context menu (Rust pops at cursor)
 *
 * Life rules: 30 minutes without interaction or state changes → sleeping
 * (the component pauses the ring + slows breathing itself); any activity
 * wakes it. Incoming `orb:set-state` events always win over the local click
 * preview; `error` auto-reverts (its SVG flash is a finite 2s).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { CompanionOrb } from '@/components/brand/CompanionOrb';
import type { AvatarState } from '@/components/brand/types';
import {
  CLICK_PREVIEW_MS,
  DOUBLE_CLICK_MS,
  DRAG_THRESHOLD_PX,
  ERROR_REVERT_MS,
  SLEEP_MS_DEFAULT,
  glowIntensityFor,
  isOrbState,
  orbStateForVoice,
  parseDevMs,
} from '@/lib/orbCore';
import { orbEmitClicked, orbOpenMain, orbShowContextMenu, orbStartDrag } from '@/lib/orb';
import { isTauri } from '@/lib/tauri';

type Press = { x: number; y: number; dragging: boolean };

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Dev/e2e: force an initial state ("xr.orb.devState"). */
function initialDevState(): AvatarState {
  const raw = readLS('xr.orb.devState');
  return isOrbState(raw) ? raw : 'idle';
}

export function OrbApp() {
  const [baseState, setBaseState] = useState<AvatarState>(initialDevState);
  const [preview, setPreview] = useState<AvatarState | null>(null);
  const [sleeping, setSleeping] = useState(false);
  /** Activity heartbeat — every interaction bumps it, resetting the sleep clock. */
  const [activity, bump] = useReducer((n: number) => n + 1, 0);

  const press = useRef<Press | null>(null);
  // Start at -∞ so the FIRST click after launch is a single click:
  // performance.now() starts near 0 at page load, so a 0 init would
  // swallow an early click as a "double click".
  const lastClickAt = useRef(Number.NEGATIVE_INFINITY);
  const previewTimer = useRef<number | null>(null);

  const state: AvatarState = sleeping ? 'sleeping' : (preview ?? baseState);

  const clearPreview = useCallback((): void => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setPreview(null);
  }, []);

  // ── Tauri event listeners (no-ops in the browser preview) ────────────
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];
    /** Registration can resolve after unmount — detach immediately then. */
    const track = (un: () => void): void => {
      if (disposed) un();
      else unlisten.push(un);
    };

    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');

      // App activity → orb state (chat streams, the dev palette command).
      track(
        await listen<{ state: AvatarState }>('orb:set-state', (event) => {
          const next = event.payload?.state;
          if (!isOrbState(next)) return;
          clearPreview();
          setBaseState(next);
          setSleeping(false);
        })
      );

      // Phase 15: the main window's voice controller broadcasts its session
      // state; the orb mirrors it (listening / thinking / speaking / approval).
      track(
        await listen<{ state?: string; active?: boolean }>('voice:state-changed', (event) => {
          const next = orbStateForVoice(event.payload?.state, event.payload?.active);
          if (!next) return;
          clearPreview();
          setBaseState(next);
          setSleeping(false);
        })
      );

      // Live glow scaling on theme changes — colors stay XR Native.
      track(
        await listen<string>('palette:theme-change', (event) => {
          document.body.style.setProperty(
            '--orb-glow-intensity',
            String(glowIntensityFor(event.payload))
          );
        })
      );

      // Re-show resets to a clean idle frame.
      track(
        await listen('orb:show', () => {
          clearPreview();
          setBaseState('idle');
          setSleeping(false);
        })
      );
    })();

    return () => {
      disposed = true;
      unlisten.forEach((un) => un());
    };
  }, [clearPreview]);

  // Initial glow from the persisted theme (both windows share localStorage).
  useEffect(() => {
    const theme = readLS('xr.theme') ?? 'xr-native';
    document.body.style.setProperty('--orb-glow-intensity', String(glowIntensityFor(theme)));
  }, []);

  // `error` is a finite flash in the SVG — land back on idle.
  useEffect(() => {
    if (baseState !== 'error') return;
    const timer = window.setTimeout(() => setBaseState('idle'), ERROR_REVERT_MS);
    return () => window.clearTimeout(timer);
  }, [baseState]);

  // Inactivity sleep — any interaction or state change resets the clock.
  // (Dev override "xr.orb.sleepMs" lets the e2e pass shorten it.)
  useEffect(() => {
    const ms = parseDevMs(readLS('xr.orb.sleepMs'), SLEEP_MS_DEFAULT);
    const timer = window.setTimeout(() => setSleeping(true), ms);
    return () => window.clearTimeout(timer);
  }, [activity, baseState, preview, sleeping]);

  // ── Pointer classification ──────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    bump();
    setSleeping(false);
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, dragging: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    if (!p || p.dragging) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD_PX) {
      p.dragging = true;
      void orbStartDrag();
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    press.current = null;
    if (!p || p.dragging || e.button !== 0) return;

    const now = performance.now();
    if (now - lastClickAt.current <= DOUBLE_CLICK_MS) {
      lastClickAt.current = 0;
      void orbOpenMain();
      return;
    }
    lastClickAt.current = now;

    // Single click: play the listening preview locally, tell the app.
    setPreview('listening');
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      setPreview(null);
    }, CLICK_PREVIEW_MS);
    void orbEmitClicked();
  }, []);

  const onPointerLeave = useCallback((): void => {
    // Once the OS owns a drag the webview stops seeing the pointer — only
    // drop presses that never became drags.
    if (press.current?.dragging !== true) press.current = null;
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault(); // never the HTML context menu
    bump();
    void orbShowContextMenu();
  }, []);

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      role="button"
      aria-haspopup="menu"
      aria-label={`XR Companion, ${state}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <CompanionOrb size={80} state={state} className="overflow-visible" />
      </motion.div>
    </div>
  );
}
