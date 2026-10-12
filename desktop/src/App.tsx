import { AnimatePresence, MotionConfig } from 'framer-motion';
import { RouterProvider, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useEffect, useRef, useState } from 'react';

import { ApprovalModal } from '@/components/approvals/ApprovalModal';
import { CompromisedModal } from '@/components/shield/CompromisedModal';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { hydrateLocale } from '@/lib/i18n';
import { isOnboardingComplete } from '@/stores/onboarding';
import { useSettingsStore } from '@/stores/settingsStore';
import { hydrateUIState } from '@/stores/ui';
import { Splash, type SplashStatus } from '@/screens/Splash';
import { router } from '@/router';
import { registerOAuthCallbackListener } from '@/integrations/oauthCallback';
import { useIntegrationsStore } from '@/stores/integrationsStore';
import { CrashRecovery } from '@/components/shell/CrashRecovery';
import { ShellBridge } from '@/components/shell/ShellBridge';
import { UpdateBanner } from '@/components/shell/UpdateBanner';
import { UpdateModal } from '@/components/shell/UpdateModal';
import { crashState, type RecoveryInfo } from '@/lib/shellApi';
import { attachUpdateEvents, useUpdateStore } from '@/stores/updateStore';

const MIN_SPLASH_MS = 800;
const MAX_SPLASH_MS = 5000;

const toasterBlock = (
  <Toaster
        position="bottom-right"
        duration={4000}
        style={{ zIndex: 60 }}
        toastOptions={{
          classNames: {
            toast:
              'bg-bg-ink border-border-subtle text-text-primary rounded-lg border text-sm shadow-lg',
            title: 'text-text-primary text-sm font-medium',
            description: 'text-text-secondary text-xs',
            actionButton:
              'bg-accent text-accent-contrast rounded-md text-xs font-medium',
            cancelButton:
              'text-text-secondary hover:text-text-primary text-xs font-medium',
            success: 'border-l-[3px]! border-l-success',
            error: 'border-l-[3px]! border-l-danger',
            warning: 'border-l-[3px]! border-l-warning',
            info: 'border-l-[3px]! border-l-accent',
          },
        }}
      />
);

/**
 * Boot sequence with REAL phases (no fake loader):
 *   0-20   window up            "Starting XR..."
 *   20-50  settings hydration   "Loading settings..."
 *   50-75  theme + stores       "Preparing memory..."
 *   75-100 onboarding check     "Ready."
 * Min 800ms / hard cap 5s, 400ms cross-fade out.
 */
export default function App() {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<SplashStatus>('Starting XR...');
  const [showSplash, setShowSplash] = useState(true);
  const startedAt = useRef(0);
  const reduceMotion = useSettingsStore(
    (state) => state.settings.appearance.reduceMotion
  );

  // Phase 27 — crash recovery gate. The shell's dirty flag decides whether the
  // router mounts at all: a previous, unclean session gets the recovery screen
  // first, because "did my work survive?" is the only question that matters
  // until it is answered. A browser (or a clean launch) resolves to null and
  // boots straight through.
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await crashState();
      if (!cancelled && info?.interrupted) setRecovery(info);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 27 — updater events (state + progress) for the whole session.
  useEffect(() => attachUpdateEvents(), []);

  // Phase 27 — tray state on launch, so the menu is right before anything moves.
  useEffect(() => {
    void useUpdateStore.getState().load();
  }, []);

  // Phase 22: the xr://oauth/callback listener lives at app root, so a browser return
  // is caught on any screen. It registers once per session (see oauthCallback.ts).
  useEffect(() => {
    void registerOAuthCallbackListener((cb) => { void useIntegrationsStore.getState().handleCallback(cb); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();
    const elapsed = () => Date.now() - startedAt.current;

    // Hard cap — never trap the user on splash.
    const cap = window.setTimeout(() => {
      if (!cancelled) setShowSplash(false);
    }, MAX_SPLASH_MS);

    (async () => {
      try {
        if (cancelled) return;
        setProgress(20);
        setStatus('Loading settings...');
        await hydrateUIState();
        await useSettingsStore.getState().load();
        await hydrateLocale();

        if (cancelled) return;
        setProgress(50);
        setStatus('Preparing memory...');
        await Promise.resolve(); // theme already applied pre-paint by theme-init.js

        if (cancelled) return;
        setProgress(75);
        setStatus('Ready.');
        await isOnboardingComplete();

        if (cancelled) return;
        setProgress(100);
        // Enforce minimum show time, then cross-fade.
        const wait = Math.max(0, MIN_SPLASH_MS - elapsed());
        window.setTimeout(() => {
          if (!cancelled) setShowSplash(false);
        }, wait + 350); // +350ms so the bar visibly reaches 100% first
      } catch {
        if (!cancelled) setShowSplash(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(cap);
    };
  }, []);

  if (recovery) {
    return (
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
        <CrashRecovery info={recovery} onResolve={(_action, info) => setRecovery(info && info.interrupted ? info : null)} />
        {toasterBlock}
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
      <ErrorBoundary>
        {/* Phase 27 — the update strip rides above every route, and only while
            a verified update is waiting for a restart. */}
        <UpdateBanner />
        <ShellBridgeHost />
        <RouterProvider router={router} />
      </ErrorBoundary>
      {/* Phase 7 — the approval modal rides above every route (main window) */}
      <ApprovalModal />
      {/* Phase 12 — non-dismissible integrity failure modal */}
      <CompromisedModal />
      <AnimatePresence>
        {showSplash && <Splash key="splash" progress={progress} status={status} />}
      </AnimatePresence>
      {/* Phase 27 — release notes / install, opened from Settings or the banner */}
      <UpdateModal />
      {/* Root-level toaster — covers the app shell AND onboarding (Phase 3) */}
      {toasterBlock}
    </MotionConfig>
  );
}

/**
 * The bridge needs the router's `navigate`, which only exists inside a Router
 * context — so it mounts as a child of the provider rather than beside it. It
 * renders nothing; see components/shell/ShellBridge.tsx.
 */
function ShellBridgeHost() {
  const navigate = useNavigate();
  return (
    <ShellBridge
      navigate={(path) => navigate(path)}
      onOpenPalette={() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }));
      }}
    />
  );
}
