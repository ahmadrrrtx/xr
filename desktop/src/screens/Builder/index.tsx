/*
 * Builder route (Phase 17). The screen is heavy (CodeMirror, xterm) so it
 * stays a lazy chunk behind this thin wrapper; the router imports this file.
 */
import { lazy, Suspense } from 'react';

const BuilderScreen = lazy(() => import('./BuilderScreen'));

export default function BuilderRoute() {
  return (
    <Suspense fallback={<div className="bg-bg-void h-full w-full" aria-busy="true" aria-label="Loading Builder" />}>
      <BuilderScreen />
    </Suspense>
  );
}
