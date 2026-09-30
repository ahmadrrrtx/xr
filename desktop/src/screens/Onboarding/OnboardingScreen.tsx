/*
 * /onboarding — first-run wizard route (outside the app shell: a fresh user
 * shouldn't see chat yet). Completes → bounce to /chat; already complete →
 * bounce immediately. The wizard itself is the 720×620 XR-Native modal.
 */
import { Navigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';

import { isOnboardingComplete } from '@/stores/onboarding';

import { OnboardingWizard } from '.';

export function OnboardingScreen() {
  const [status, setStatus] = useState<'checking' | 'new' | 'done'>('checking');

  useEffect(() => {
    let cancelled = false;
    void isOnboardingComplete().then((done) => {
      if (!cancelled) setStatus(done ? 'done' : 'new');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'checking') return null;
  if (status === 'done') return <Navigate to="/chat" replace />;
  return <OnboardingWizard />;
}

/**
 * First-run gate for the app shell — fresh installs land in onboarding
 * before the shell renders. The check is async (Tauri Store); while it
 * resolves, the splash (App) is still covering the screen, so a null render
 * never flashes.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'new' | 'done'>('checking');
  useEffect(() => {
    let cancelled = false;
    void isOnboardingComplete().then((done) => {
      if (!cancelled) setStatus(done ? 'done' : 'new');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (status === 'checking') return null;
  if (status === 'new') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
