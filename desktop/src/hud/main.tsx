/*
 * HUD window entry (Phase 5) — a deliberately minimal second Vite entry.
 * No router, no app shell, no react-query: just the theme bootstrap, the
 * shared palette over a transparent body, and a scoped toaster.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HudApp } from '@/hud/App';
import { initTheme } from '@/stores/theme';
import '../styles/globals.css';

// Sync the DOM with the persisted theme before the first render (the body
// stays transparent — the palette glass paints the surface).
initTheme();

const rootElement = document.getElementById('hud-root');
if (!rootElement) {
  throw new Error('Root element #hud-root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <HudApp />
  </StrictMode>
);
