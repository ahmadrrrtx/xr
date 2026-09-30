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
import { PageTransition } from '@/components/layout/PageTransition';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useHotkeys } from '@/hooks/useHotkeys';
import { readSettingJSON, readSettingRaw } from '@/lib/persistent-store';
import { useSidebarStore } from '@/stores/sidebar';
import { useThemeStore, type ThemeId } from '@/stores/theme';
import { hydrateUIState, useUIStore } from '@/stores/ui';

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

/** Global keyboard map (Phase 1 brief §5.10). */
function useGlobalHotkeys(): void {
  const navigate = useNavigate();

  useHotkeys([
    {
      combo: 'mod+k',
      handler: () => {
        const { paletteOpen, setPaletteOpen } = useUIStore.getState();
        setPaletteOpen(!paletteOpen);
      },
    },
    {
      combo: 'mod+b',
      handler: () => useSidebarStore.getState().toggle(),
    },
    {
      combo: 'mod+n',
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
      combo: 'mod+.',
      handler: () =>
        toast('Voice coming in Phase 15', {
          description:
            'Voice sessions, wake word and the Theater arrive later.',
        }),
    },
    {
      combo: 'mod+shift+t',
      handler: () => useThemeStore.getState().cycleTheme(),
    },
    {
      combo: 'mod+,',
      handler: () => navigate('/settings'),
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
  useGlobalHotkeys();
  useWelcomeToast();
  const location = useLocation();
  // Chat manages its own flush, full-height layout — no content padding.
  const flush = location.pathname.startsWith('/chat');

  return (
    <TooltipProvider delayDuration={200}>
      <div className="bg-bg-void text-text-primary flex h-screen flex-col">
        <Topbar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className={`bg-bg-void min-w-0 flex-1 overflow-y-auto ${flush ? 'p-0' : 'p-6'}`}>
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>

      {/* Global overlays */}
      <CommandPalette />
      {/* Toaster moved to App root (Phase 3) so onboarding toasts render too */}

    </TooltipProvider>
  );
}
