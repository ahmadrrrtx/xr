/*
 * ShellBridge (Phase 27) — the one component that talks to the host.
 *
 * Mounted once, near the root, it does four jobs and renders nothing:
 *
 *   1. **Feeds the tray.** The tray's menu shows approvals, today's spend, voice
 *      state, whether agents are paused and whether the engine is up. Those live
 *      in four different stores; this bridge collects them and pushes one
 *      snapshot whenever any of them changes. The push is debounced, because a
 *      run streaming tokens updates the approval store and the budget store many
 *      times a second and the tray does not need forty snapshots.
 *
 *   2. **Runs tray and menu actions.** A tray click arrives as `xr-tray-action`
 *      and is routed here: navigation, opening settings or approvals, starting
 *      voice, checking for updates. Rust deliberately does not own navigation —
 *      the router does — so ids are handled where the routes live.
 *
 *   3. **Screenshot-and-ask.** `xr-global-screenshot` means a region was
 *      captured (or the user pressed Esc). On success the capture is handed to
 *      the chat store, which owns the new-chat-with-attachment flow, and the
 *      temp file is deleted as soon as a message owns a copy. On cancel:
 *      nothing, silently — Esc is not an event.
 *
 *   4. **OS appearance.** The host emits `xr-os-theme`; only a user whose theme
 *      preference is "follow system" is moved by it. Anyone who picked a theme
 *      keeps it.
 */
import { useEffect, useMemo, useRef } from 'react';

import {
  SHELL_EVENTS,
  useShellEvent,
  type OsThemeEvent,
  type ScreenshotPayload,
  type TrayAction,
  type TraySnapshot,
} from '@/lib/native';
import { invokeShell, pushTrayState, screenshotDiscard } from '@/lib/shellApi';
import { useApprovalStore } from '@/stores/approvalStore';
import { useBudgetStore } from '@/stores/budgetStore';
import { useEngineStore } from '@/stores/engineStore';
import { useShieldStore } from '@/stores/shieldStore';
import { useThemeStore } from '@/stores/theme';
import { useVoiceStore } from '@/voice/voiceStore';

/** How long to wait for the stores to settle before telling the tray. */
const TRAY_PUSH_DEBOUNCE_MS = 150;

interface ShellBridgeProps {
  /** Navigate — injected so this component stays router-agnostic. */
  navigate: (path: string) => void;
  /** Hand a captured screenshot to the chat surface (new chat + attachment). */
  onScreenshot?: (path: string) => void | Promise<void>;
  /** Open the command palette (the tray's "Command Palette" item). */
  onOpenPalette?: () => void;
  /** Toggle the sidebar (the tray's "Toggle Sidebar" item). */
  onToggleSidebar?: () => void;
}

export function ShellBridge({
  navigate,
  onScreenshot,
  onOpenPalette,
  onToggleSidebar,
}: ShellBridgeProps) {
  // ── 1. Tray feed ──────────────────────────────────────────────────────────
  const approvals = useApprovalStore((state) => state.pending.length);
  const agentsPaused = useShieldStore((state) => state.paused);
  const resumeAgents = useShieldStore((state) => state.resume);
  const spentToday = useBudgetStore((state) => state.overview?.spentToday ?? null);
  const voiceActive = useVoiceStore((state) => state.active);
  const voiceSupported = useVoiceStore((state) => state.status !== null);
  // The engine the shell spawned is the one the tray should report on: the
  // store's own status is the health of the whole link, not of one provider.
  const engineUp = useEngineStore((state) => state.status === 'up');

  const snapshot: TraySnapshot = useMemo(
    () => ({
      approvals,
      spendToday: spentToday,
      agentsPaused,
      listening: voiceActive,
      engineUp,
      voiceAvailable: voiceSupported,
    }),
    [approvals, spentToday, agentsPaused, voiceActive, engineUp, voiceSupported]
  );
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void pushTrayState(latest.current);
    }, TRAY_PUSH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  // ── 2. Tray / menu actions ────────────────────────────────────────────────
  useShellEvent<TrayAction>(SHELL_EVENTS.trayAction, ({ id }) => {
    switch (id) {
      case 'xr-open':
        navigate('/');
        break;
      case 'xr-new-chat':
        navigate('/chat');
        break;
      case 'xr-new-workspace':
        navigate('/workspaces');
        break;
      case 'xr-toggle-hud':
        // Rust already toggled the HUD window; no route changes.
        break;
      case 'xr-toggle-listening':
        void (async () => {
          const { voice } = await import('@/voice/session');
          if (voice.active) await voice.stop();
          else await voice.start('hotkey');
        })();
        break;
      case 'xr-toggle-agents':
        // The Shield store owns pause/resume (pausing opens its own confirm
        // dialog when armed); the tray row is the same action as the UI.
        if (agentsPaused) void resumeAgents();
        else navigate('/settings?tab=privacy');
        break;
      case 'xr-approvals':
        navigate('/approvals');
        break;
      case 'xr-spend':
        navigate('/control-room');
        break;
      case 'xr-engine-status':
        navigate('/settings?tab=diagnostics');
        break;
      case 'xr-settings':
        navigate('/settings');
        break;
      case 'xr-check-updates':
        navigate('/settings?tab=updates&check=1');
        break;
      case 'xr-report-crash':
        navigate('/settings?tab=about&report=1');
        break;
      case 'xr-docs':
        void invokeShell('open_url', { url: 'https://github.com/ahmadrrrtx/xr#readme' });
        break;
      case 'xr-toggle-sidebar':
        onToggleSidebar?.();
        break;
      case 'xr-palette':
        onOpenPalette?.();
        break;
      case 'xr-reload-window':
        window.location.reload();
        break;
      case 'xr-simulate-crash':
        void invokeShell('crash_simulate');
        break;
      case 'xr-close-window':
        // Rust hides the window; nothing to do here.
        break;
      case 'xr-quit':
        // Rust exits the process; this handler never runs.
        break;
      default:
        break;
    }
  });

  // ── 3. Screenshot-and-ask ─────────────────────────────────────────────────
  useShellEvent<ScreenshotPayload>(SHELL_EVENTS.screenshot, (payload) => {
    if (payload.cancelled) return;
    if (!payload.path) {
      if (payload.error) {
        void import('sonner').then(({ toast }) =>
          toast.error('Could not capture a region', { description: payload.error ?? undefined })
        );
      }
      return;
    }
    const path = payload.path;
    void (async () => {
      if (onScreenshot) {
        await onScreenshot(path);
      } else {
        navigate(`/chat?screenshot=${encodeURIComponent(path)}`);
      }
      // The capture is transient by contract: once the chat surface has taken
      // it, the file goes. A refusal (the file is still referenced) is reported
      // rather than swallowed — leaving PNGs in a temp dir silently is how
      // scratch space disappears.
      const discarded = await screenshotDiscard(path);
      if (discarded === false) {
        void import('sonner').then(({ toast }) =>
          toast('The screenshot is still on disk', {
            description: 'Attach it to a message, or remove it from your temp folder.',
          })
        );
      }
    })();
  });

  // ── 4. OS appearance ──────────────────────────────────────────────────────
  useShellEvent<OsThemeEvent>(SHELL_EVENTS.osTheme, ({ theme }) => {
    // The store's own seatbelt: a concrete preference is never overridden, only
    // `system` follows the OS. `arctic` is XR's light theme, `xr-native` the
    // dark one — the same mapping `resolveSystemTheme` uses for the web.
    useThemeStore
      .getState()
      .refreshSystemTheme(theme === 'dark' ? 'xr-native' : 'arctic');
  });

  return null;
}
