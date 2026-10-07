/*
 * Research route (Phase 18). Same shape as Builder: the screen (article
 * renderer, virtualised sources, stylesheet) is a lazy chunk behind a thin
 * wrapper; the router imports this file. The run itself lives in
 * researchStore, so navigating away never interrupts a stream.
 */
import { lazy, Suspense } from 'react';

const ResearchScreen = lazy(() => import('./ResearchScreen'));

export default function ResearchRoute() {
  return (
    <Suspense fallback={<div className="bg-bg-void h-full w-full" aria-busy="true" aria-label="Loading Research" />}>
      <ResearchScreen />
    </Suspense>
  );
}
