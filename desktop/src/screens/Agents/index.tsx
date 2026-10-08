/*
 * Agents route (Phase 19). The screen (gallery, editor, React Flow canvas)
 * is a lazy chunk behind this thin wrapper; the router imports this file.
 * Runs live in workflowEditorStore, so navigating away never cancels one —
 * the engine owns the run either way.
 */
import { lazy, Suspense } from 'react';

const AgentsScreen = lazy(() => import('./AgentsScreen'));

export default function AgentsRoute() {
  return (
    <Suspense fallback={<div className="bg-bg-void h-full w-full" aria-busy="true" aria-label="Loading Agents" />}>
      <AgentsScreen />
    </Suspense>
  );
}
