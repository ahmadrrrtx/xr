/*
 * Global application shell: fixed 52px topbar (also the drag region), the
 * collapsible 72↔240px sidebar, one scrollable content region with route
 * transitions, and the global overlays (command palette + toasts).
 * Every one of the 14 screens renders inside this layout
 * (docs/SCREEN-BRIEFS.md · GLOBAL APPLICATION SHELL).
 */
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { CommandPalette } from '@/components/cmdk/CommandPalette';
import { useOrbIpc } from '@/hooks/useOrb';
import { usePaletteIpc } from '@/hooks/usePalette';
import { useSettingsSync } from '@/hooks/useSettingsSync';
import { usePaletteStore } from '@/stores/paletteStore';
import { PageTransition } from '@/components/layout/PageTransition';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useHotkeys } from '@/hooks/useHotkeys';
import { readSettingJSON, readSettingRaw } from '@/lib/persistent-store';
import { effectiveCombo } from '@/lib/shortcuts';
import { initRunsBridge } from '@/runs/bridge';
import { BudgetBanners } from '@/components/budget/BudgetBanners';
import { EngineDownBanner } from '@/components/engine/EngineDownBanner';
import { PausedBanner } from '@/components/shield/PausedBanner';
import { initBudget } from '@/budget/enforce';
import { initShield } from '@/shield/enforce';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSidebarStore } from '@/stores/sidebar';
import { useThemeStore, type ThemeId } from '@/stores/theme';
import { hydrateUIState } from '@/stores/ui';

/** Below 960px the sidebar force-collapses (and re-collapses on resize). */
function useResponsiveSidebar(): void {
  useEffect(() => {
    const force = (): void => {
      if (window.innerWidth < 960) {
        useSidebarStore.getState().setCollapsed(true);
      }
    };
    force();
    window.addEventListener('resize', force);
    return () => window.removeEventListener('resize', force);
  }, []);
}

/**
 * Startup hydration: apply the durably persisted theme (Tauri Store is
 * authoritative; localStorage keeps the pre-paint value in sync) plus the
 * sidebar + user-name settings. Runs once.
 */
function usePersistedSettings(): void {
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [theme, sidebarCollapsed] = await Promise.all([
        readSettingRaw('xr.theme'),
        readSettingJSON<boolean>('xr.sidebar.collapsed'),
      ]);
      if (!alive) return;
      if (theme) useThemeStore.getState().setTheme(theme as ThemeId);
      if (sidebarCollapsed !== null) {
        useSidebarStore.getState().hydrate(sidebarCollapsed);
      }
      await hydrateUIState();
    })();
    return () => {
      alive = false;
    };
  }, []);
}

/**
 * Global keyboard map (Phase 1 brief §5.10). Every combo resolves through
 * the user's Settings → Shortcuts overrides (Phase 8), live.
 */
function useGlobalHotkeys(): void {
  const navigate = useNavigate();
  const overrides = useSettingsStore(
    (state) => state.settings.shortcuts.overrides
  );
  const combo = (id: string): string => effectiveCombo(id, overrides);

  useHotkeys([
    {
      combo: combo('palette'),
      handler: () => {
        usePaletteStore.getState().togglePalette();
      },
    },
    {
      combo: combo('sidebar'),
      handler: () => useSidebarStore.getState().toggle(),
    },
    {
      combo: combo('new-chat'),
      handler: () => {
        void (async () => {
          const { useSessionsStore } = await import('@/stores/sessionsStore');
          const s = await useSessionsStore.getState().createNewSession();
          useSessionsStore.getState().selectSession(s.id);
          navigate(`/chat/${s.id}`);
        })();
      },
    },
    {
      combo: combo('ptt'),
      handler: () =>
        toast('Voice comes in Phase 15', {
          description:
            'Hold the push-to-talk key from anywhere — rebinding it in Settings → Voice.',
        }),
    },
    {
      combo: combo('cycle-theme'),
      handler: () => useThemeStore.getState().cycleTheme(),
    },
    {
      combo: combo('settings'),
      handler: () => navigate('/settings'),
    },
    {
      combo: combo('control-room'),
      handler: () => navigate('/runs'),
    },
    {
      combo: combo('focus-composer'),
      handler: () => {
        document.getElementById('xr-composer')?.focus();
      },
    },
  ]);
}

/** Dev-only welcome toast (fires once per page load, StrictMode-safe). */
let welcomed = false;
function useWelcomeToast(): void {
  useEffect(() => {
    if (!import.meta.env.DEV || welcomed) return;
    welcomed = true;
    toast('Welcome back to XR', {
      description: 'Phase 1 app shell — dev build.',
    });
  }, []);
}

export function AppShell() {
  useResponsiveSidebar();
  usePersistedSettings();
  const navigate = useNavigate();
  useGlobalHotkeys();
  useSettingsSync();
  // Cross-window effects from the HUD: navigation, remote commands, theme
  // sync, session-list refresh (Phase 5).
  usePaletteIpc(false, navigate);
  // Companion Orb reactions (Phase 6): click toasts, menu voice/approvals.
  useOrbIpc();
  useWelcomeToast();
  // Control Room feed (Phase 11): Brain runs + shell events → runsStore.
  useEffect(() => initRunsBridge(), []);
  // Shield (Phase 12): policy gate on the approval queue + audit observer.
  useEffect(() => initShield(), []);
  // Budget (Phase 13): spend governor state + cross-surface notifications.
  useEffect(() => initBudget(), []);
  const location = useLocation();
  // Chat, Settings and Brain manage their own full-height layouts — no
  // content padding (Settings is a two-pane pane, SCREEN 14; Brain is a
  // developer-tool surface, SCREEN 2).
  const flush =
    location.pathname.startsWith('/chat') ||
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/brain') ||
    location.pathname.startsWith('/runs') ||
    location.pathname.startsWith('/shield') ||
    location.pathname.startsWith('/budget');

  return (
    <TooltipProvider delayDuration={200}>
      <div className="bg-bg-void text-text-primary flex h-screen flex-col">
        <Topbar />
        <PausedBanner />
        <EngineDownBanner />
        <BudgetBanners />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main
            className={`bg-bg-void min-w-0 flex-1 overflow-y-auto ${flush ? 'p-0' : 'p-6'}`}
          >
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>

      {/* Global overlays */}
      <CommandPalette embedded />
      {/* Toaster moved to App root (Phase 3) so onboarding toasts render too */}
    </TooltipProvider>
  );
}
