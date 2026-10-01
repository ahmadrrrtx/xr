/*
 * Shared command palette (Phase 5) — one component, two contexts:
 *
 *   embedded  → in-app overlay (Radix Dialog: backdrop, focus trap, ESC),
 *               opened with ⌘K or the topbar pill (AppShell wires both).
 *   HUD       → the entire content of the always-on-top HUD window
 *               (hud.html entry): no backdrop, transparent chrome around
 *               the glass panel, ESC hides the window via hud_close.
 *
 * Keyboard contract (prompt §5.5):
 *   ↑↓/Ctrl+N/P navigate (wraps — cmdk `loop`) · Enter selects ·
 *   ⌘1..⌘9 quick-select the Nth result · Escape layers (stream → stop,
 *   then close) · Backspace on empty query closes · triple-Esc = dev toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PaletteInput } from '@/components/palette/PaletteInput';
import { PaletteResults } from '@/components/palette/PaletteResults';
import { PaletteQuickAsk } from '@/components/palette/PaletteQuickAsk';
import {
  buildPaletteCommands,
  paletteFilter,
  type PaletteCommand,
} from '@/lib/paletteCommands';
import { hudClose, hudNavigate, hudNotifySessionsChanged, hudShortcutInfo } from '@/lib/hud';
import { orbSetState } from '@/lib/orb';
import { makeApprovalGate } from '@/lib/approvalEvents';
import { streamChat } from '@/lib/mockLLM';
import { chatDb, type ChatMessage } from '@/lib/chat-db';
import { newId, useSessionsStore } from '@/stores/sessionsStore';
import { useChatStore } from '@/stores/chatStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useThemeStore } from '@/stores/theme';
import { usePlatform } from '@/hooks/usePlatform';
import { cn } from '@/lib/utils';

/** Escape taps inside this window (triple-Esc dev toast). */
const escWindowMs = 800;

/**
 * Global-shortcut conflict notice (prompt §3): when ⌘+Space was taken by
 * another app (Spotlight), the HUD registered a fallback — say so, once,
 * at the top of the palette instead of failing silently.
 */
function ShortcutConflictBanner({ shortcut }: { shortcut: string }) {
  return (
    <div
      data-testid="shortcut-conflict-banner"
      className="border-border-subtle bg-bg-raised/60 mx-2 mt-2 flex items-center gap-2 rounded-md border px-3 py-2"
    >
      <AlertTriangle
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-warning shrink-0"
      />
      <p className="text-text-secondary text-[12px] leading-4">
        The default HUD shortcut was taken by another app — the HUD now opens
        with <span className="xr-kbd font-mono">{shortcut}</span>. Remapping
        arrives with Settings (Phase 8).
      </p>
    </div>
  );
}

export function CommandPalette({ embedded }: { embedded: boolean }) {
  const isHud = !embedded;
  const open = usePaletteStore((s) => s.open);
  const mode = usePaletteStore((s) => s.mode);
  const streaming = usePaletteStore((s) => s.quickAsk.status === 'streaming');
  const closePalette = usePaletteStore((s) => s.closePalette);

  const platform = usePlatform();
  const sessions = useSessionsStore((s) => s.sessions);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const escTimesRef = useRef<number[]>([]);
  const [conflictShortcut, setConflictShortcut] = useState<string | null>(null);

  const ctxNavigate = useCallback(
    (route: string) => {
      if (isHud) {
        void hudNavigate(route);
      } else {
        void import('@/router').then(({ router }) => router.navigate(route));
      }
    },
    [isHud]
  );

  const commands = useMemo(
    () =>
      buildPaletteCommands(
        {
          isHud,
          navigate: ctxNavigate,
          platform,
          toast: (message, description) =>
            description ? toast(message, { description }) : toast(message),
        },
        sessions
      ),
    [isHud, ctxNavigate, platform, sessions]
  );

  // ── Open/close plumbing ────────────────────────────────────────────────
  // The HUD window IS the palette: mark it open on mount and hide (not
  // unmount) on close so the Rust side owns window visibility.
  useEffect(() => {
    if (isHud) usePaletteStore.getState().openPalette();
  }, [isHud]);

  const close = useCallback((): void => {
    abortRef.current?.abort();
    if (isHud) {
      void hudClose();
      usePaletteStore.getState().closePalette();
    } else {
      closePalette();
    }
  }, [isHud, closePalette]);

  // ── Quick-ask stream (mockLLM — same contract as the chat screen) ─────
  const startQuickAsk = useCallback((question: string): void => {
    const store = usePaletteStore.getState();
    abortRef.current?.abort();
    store.startQuickAsk(question);
    // Companion Orb (Phase 6): quick-ask is a stream too.
    void orbSetState('thinking');

    const controller = new AbortController();
    abortRef.current = controller;
    const model = useSessionsStore.getState().sessions[0]?.model ?? 'claude-sonnet-4.5';

    let spoke = false; // orb: thinking → speaking on the first token
    void streamChat({
      messages: [{ role: 'user', content: question }],
      model,
      signal: controller.signal,
      // Phase 7: quick-ask can hit the same permission gate as chat — but
      // only from the MAIN window (the modal lives there; the HUD keeps the
      // auto-continue behavior).
      requestApproval: isHud ? undefined : makeApprovalGate(controller.signal),
      onEvent: (event) => {
        const s = usePaletteStore.getState();
        switch (event.type) {
          case 'token':
            if (!spoke) {
              spoke = true;
              void orbSetState('speaking');
            }
            s.appendQuickAskToken(event.text);
            break;
          case 'done':
            s.finishQuickAsk('done');
            void orbSetState('idle');
            break;
          case 'error':
            s.finishQuickAsk('error');
            void orbSetState('error');
            break;
          // Quick-ask answers are text-only for v1; tool chatter stays in chat.
          default:
            break;
        }
      },
    }).catch(() => {
      // Abort fires as a rejection — the store already reflects the state.
      const s = usePaletteStore.getState();
      if (s.quickAsk.status === 'streaming') {
        s.finishQuickAsk('stopped');
        void orbSetState('idle');
      }
    });
  }, [isHud]);

  const stopQuickAsk = useCallback((): void => {
    abortRef.current?.abort();
    const s = usePaletteStore.getState();
    if (s.quickAsk.status === 'streaming') {
      s.finishQuickAsk('stopped');
      void orbSetState('idle');
    }
  }, []);

  /** Persist the Q&A pair as a real chat session, then open it. */
  const openQuickAskInChat = useCallback(async (): Promise<void> => {
    const { quickAsk: qa } = usePaletteStore.getState();
    const question = qa.question.trim();
    if (!question) return;
    stopQuickAsk();

    const sessionsStore = useSessionsStore.getState();
    const session = await sessionsStore.createNewSession();
    const now = Date.now();
    const userMsg: ChatMessage = {
      id: newId(),
      sessionId: session.id,
      role: 'user',
      content: question,
      createdAt: now,
    };
    await chatDb.saveMessage(userMsg);
    if (qa.answer.trim()) {
      const assistantMsg: ChatMessage = {
        id: newId(),
        sessionId: session.id,
        role: 'assistant',
        content: qa.answer,
        createdAt: now + 1,
        metadata: { segments: [{ type: 'text', text: qa.answer }] },
      };
      await chatDb.saveMessage(assistantMsg);
    }
    await sessionsStore.titleFromFirstMessage(session.id, question);
    sessionsStore.selectSession(session.id);

    if (isHud) {
      await hudNotifySessionsChanged();
      await hudNavigate(`/chat/${session.id}`);
      usePaletteStore.getState().closePalette();
    } else {
      await useSessionsStore.getState().loadSessions();
      // When the target session is already the active route the param does
      // not change and the chat screen's load effect never fires — reload
      // through the store so the Q&A appears immediately.
      if (window.location.hash.includes(`/chat/${session.id}`)) {
        await useChatStore.getState().loadMessages(session.id);
      }
      ctxNavigate(`/chat/${session.id}`);
      usePaletteStore.getState().closePalette();
    }
  }, [ctxNavigate, isHud, stopQuickAsk]);

  // ── Selection bookkeeping ──────────────────────────────────────────────
  const onSelectCommand = useCallback(
    (command: PaletteCommand): void => {
      const store = usePaletteStore.getState();
      store.recordSelection(command.id);
      void command.action();
      if (!command.keepOpen) {
        if (isHud) {
          // Theme changes and toasts stay visible; everything else leaves.
          void hudClose();
          store.closePalette();
        } else {
          store.closePalette();
        }
      }
    },
    [isHud]
  );

  // ── Keyboard layering (Escape/backspace/⌘N) ────────────────────────────
  const dispatchKey = useCallback((key: string): void => {
    rootRef.current?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      // ⌘/Ctrl + 1..9 → select the Nth result (Home, then N-1 × ArrowDown,
      // then Enter — follows cmdk's own score order by construction).
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (digit && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        dispatchKey('Home');
        const n = Number(digit);
        for (let i = 1; i < n; i += 1) dispatchKey('ArrowDown');
        dispatchKey('Enter');
        return;
      }

      if (event.key === 'Escape') {
        // Layer 1: a live stream stops first (Radix must NOT close on it).
        if (usePaletteStore.getState().quickAsk.status === 'streaming') {
          event.preventDefault();
          event.stopPropagation();
          stopQuickAsk();
          return;
        }
        // Dev helper: triple-Esc → debug toast (version, window, theme).
        if (import.meta.env.DEV) {
          const now = Date.now();
          escTimesRef.current = [
            ...escTimesRef.current.filter((t) => now - t < escWindowMs),
            now,
          ];
          if (escTimesRef.current.length >= 3) {
            escTimesRef.current = [];
            toast('[XR debug]', {
              description: `window=${isHud ? 'hud' : 'main'} theme=${
                useThemeStore.getState().theme
              } platform=${platform} mode=${usePaletteStore.getState().mode}`,
            });
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        // HUD handles Escape itself (no Radix there).
        if (isHud) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return; // in-app: Radix closes the dialog on Escape.
      }

      // Backspace on an empty query closes (Raycast parity).
      if (event.key === 'Backspace' && usePaletteStore.getState().query === '') {
        const { mode: m } = usePaletteStore.getState();
        // ...but never while a quick-ask answer is being read.
        if (m === 'quick-ask') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    [close, dispatchKey, isHud, platform, stopQuickAsk]
  );

  // Abort any live stream when the palette unmounts/closes.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  // Shortcut-conflict notice: read the registration outcome when the
  // palette is shown. Dev-only localStorage override exists for UI preview
  // and e2e (same pattern as xr.mock.errorRate).
  useEffect(() => {
    if (!open && !isHud) return;
    let alive = true;
    void (async () => {
      if (import.meta.env.DEV) {
        try {
          const flag = window.localStorage.getItem('xr.hud.shortcutConflict');
          if (flag === 'true') {
            const fallback =
              window.localStorage.getItem('xr.hud.shortcutFallback') ??
              (navigator.userAgent.toLowerCase().includes('mac') ? '⌥Space' : 'Ctrl+Shift+Space');
            if (alive) setConflictShortcut(fallback);
            return;
          }
        } catch {
          /* storage unavailable */
        }
      }
      const info = await hudShortcutInfo();
      if (alive) setConflictShortcut(info?.conflict ? info.shortcut : null);
    })();
    return () => {
      alive = false;
    };
  }, [open, isHud]);

  // Escape during a live stream must STOP the stream, not dismiss the
  // palette — but Radix's document-level escape listener runs before any
  // React handler can veto it, so intercept at window-capture phase where
  // we are guaranteed first. (Second Escape, non-streaming, closes.)
  useEffect(() => {
    if (!streaming) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopQuickAsk();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [streaming, stopQuickAsk]);

  // ── Render ─────────────────────────────────────────────────────────────
  const body = (
    <Command
      ref={rootRef}
      loop
      filter={paletteFilter}
      onKeyDown={handleKeyDown}
      className="xr-glass flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl"
      aria-label={isHud ? 'XR HUD command palette' : undefined}
    >
      <PaletteInput isHud={isHud} />
      {conflictShortcut && mode !== 'quick-ask' && (
        <ShortcutConflictBanner shortcut={conflictShortcut} />
      )}
      {mode === 'quick-ask' ? (
        <PaletteQuickAsk onStop={stopQuickAsk} onOpenInChat={openQuickAskInChat} />
      ) : (
        <PaletteResults
          commands={commands}
          isHud={isHud}
          onSelectCommand={onSelectCommand}
          onAsk={startQuickAsk}
          onWebSearchStub={() =>
            toast('Web search ships in Phase 18', {
              description: 'The ? prefix will query the XR search stack.',
            })
          }
        />
      )}
      <div className="border-border-subtle text-text-tertiary flex h-9 shrink-0 items-center justify-between border-t px-4 text-[11px]">
        <span aria-hidden="true">
          Type <span className="xr-kbd font-mono">/</span> commands ·{' '}
          <span className="xr-kbd font-mono">@</span> agents ·{' '}
          <span className="xr-kbd font-mono">?</span> web
        </span>
        {isHud ? (
          <button
            type="button"
            onClick={() => void hudNavigate('/chat')}
            className="text-accent hover:text-accent-hover flex items-center gap-1 font-medium"
          >
            Open XR
          </button>
        ) : (
          <span aria-hidden="true" className="font-mono">
            {platform === 'macos' ? '⌘K' : 'Ctrl+K'}
          </span>
        )}
      </div>
    </Command>
  );

  if (isHud) {
    return (
      <div className="flex h-full w-full justify-center pt-10">
        <div className={cn('flex h-[calc(100%-2.5rem)] w-full max-w-[640px] min-h-0')}>{body}</div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? usePaletteStore.getState().openPalette() : close())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none backdrop-blur-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex max-h-[70vh] min-h-0 w-full flex-col">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
