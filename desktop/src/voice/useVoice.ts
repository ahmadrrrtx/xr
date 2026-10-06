/*
 * React glue for the voice controller (Phase 15).
 *
 *   useVoiceIpc()     — AppShell, once: global hotkey (toggle or hold), orb
 *                       menu / click, device hot-plug, engine-down → stop,
 *                       the Voice Theater link (Phase 16).
 *   useVoiceHotkeys() — the Voice screen: Space toggle, Esc dock/back,
 *                       M mute, T theater, P cycle PTT mode.
 *   useLevels()       — 60 fps mic/out levels for meters (RAF, no re-render
 *                       storms: consumers get a ref + a tick counter).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useEngineStore } from '@/stores/engineStore';
import { isTauri } from '@/lib/tauri';
import { theaterToggle } from '@/lib/theater';

import { probeMicrophones, voice, type VoiceLevels } from './session';
import { initTheaterLink } from './theaterLink';
import type { VoiceActivation } from './voiceApi';
import { useVoiceStore } from './voiceStore';

const ACTIVATIONS: VoiceActivation[] = ['hold', 'tap', 'always'];

export function useVoiceIpc(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let disposed = false;
    const unlisten: Array<() => void> = [];
    const track = (un: () => void): void => {
      if (disposed) un();
      else unlisten.push(un);
    };

    const onDeviceChange = (): void => {
      void probeMicrophones(false).then(() => {
        const s = useVoiceStore.getState();
        if (s.active && s.devices.length === 0) void voice.stop('mic-lost');
      });
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    // Voice Theater (Phase 16): mirror voice state out, take intents in.
    track(initTheaterLink({ navigate }));

    if (isTauri()) {
      void (async () => {
        const { listen } = await import('@tauri-apps/api/event');
        track(
          await listen('ptt:pressed', () => {
            const hold = useVoiceStore.getState().settings?.desktop.holdGlobalHotkey ?? false;
            if (hold) void voice.pressStart('hotkey');
            else void voice.toggle('hotkey');
          }),
        );
        track(
          await listen('ptt:released', () => {
            const hold = useVoiceStore.getState().settings?.desktop.holdGlobalHotkey ?? false;
            if (hold) voice.pressEnd();
          }),
        );
        track(
          await listen('orb:voice-requested', () => {
            void voice.toggle('orb');
          }),
        );
        track(
          await listen('orb:clicked', () => {
            void voice.toggle('orb');
          }),
        );
        track(
          await listen('orb:open-voice', () => {
            navigate('/voice');
          }),
        );
      })();
    }

    return () => {
      disposed = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      unlisten.forEach((un) => un());
    };
  }, [navigate]);

  // Engine down mid-session → stop cleanly and say so (the banner explains).
  useEffect(
    () =>
      useEngineStore.subscribe((s, prev) => {
        if (prev.status === 'up' && s.status !== 'up' && useVoiceStore.getState().active) {
          void voice.stop('engine');
          toast.warning('Voice stopped — the engine went away.');
        }
      }),
    [],
  );
}

/** Keyboard map for the Voice screen (never while typing in a field). */
export function useVoiceHotkeys(opts: { onEscape: () => void }): void {
  const ref = useRef(opts);
  useEffect(() => {
    ref.current = opts;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useVoiceStore.getState();
      switch (e.key) {
        case ' ': {
          e.preventDefault();
          if (e.repeat) return;
          if (s.settings?.desktop.activation === 'hold') void voice.pressStart('screen');
          else void voice.toggle('screen');
          return;
        }
        case 'Escape':
          e.preventDefault();
          ref.current.onEscape();
          return;
        case 'm':
        case 'M':
          if (!s.active) return;
          e.preventDefault();
          voice.toggleMuted();
          return;
        case 't':
        case 'T':
          e.preventDefault();
          void theaterToggle();
          return;
        case 'p':
        case 'P': {
          e.preventDefault();
          const cur = s.settings?.desktop.activation ?? 'tap';
          const next = ACTIVATIONS[(ACTIVATIONS.indexOf(cur) + 1) % ACTIVATIONS.length] ?? 'tap';
          void s.applySettings({ desktop: { activation: next } }).then(() => toast(`Activation: ${next === 'hold' ? 'hold to talk' : next === 'tap' ? 'tap to talk' : 'always on'}`));
          return;
        }
        default:
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ' && useVoiceStore.getState().settings?.desktop.activation === 'hold') voice.pressEnd();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}

/**
 * Levels at animation rate. Returns the live levels object plus a tick that
 * changes ~12×/s so text readouts (dB, clip badge) re-render calmly while
 * canvases read `levels` directly every frame.
 */
export function useLevels(enabled = true): { levels: VoiceLevels; tick: number } {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let last = 0;
    let raf = 0;
    const loop = (t: number): void => {
      if (!alive) return;
      if (t - last > 80) {
        last = t;
        setTick((n) => (n + 1) % 1_000_000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return { levels: voice.levels, tick };
}
