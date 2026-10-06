/*
 * Voice Theater window entry (Phase 16) — the orb.tsx shape: no router, no
 * app shell, no react-query, no toaster. The brand CSS, the cinematic
 * override and the stage. The theater is a render target for the main
 * window's voice session (docs/phases/16-theater-notes.md) — it opens no
 * AudioContext and never talks to the engine.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TheaterStage } from '@/theater/App';
import '../styles/globals.css';
import '../styles/theater.css';

const rootElement = document.getElementById('theater-root');
if (!rootElement) {
  throw new Error('Root element #theater-root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <TheaterStage />
  </StrictMode>
);
