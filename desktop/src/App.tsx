import { AnimatePresence } from 'framer-motion';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useEffect, useRef, useState } from 'react';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { isOnboardingComplete } from '@/stores/onboarding';
import { hydrateUIState } from '@/stores/ui';
import { Splash, type SplashStatus } from '@/screens/Splash';
import { router } from '@/router';

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

  return (
    <>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
      <AnimatePresence>
        {showSplash && <Splash key="splash" progress={progress} status={status} />}
      </AnimatePresence>
      {/* Root-level toaster — covers the app shell AND onboarding (Phase 3) */}
      {toasterBlock}
    </>
  );
}
