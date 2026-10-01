/*
 * Orb window entry (Phase 6) — the smallest Vite entry: no router, no app
 * shell, no react-query, no fonts, no toaster. Just the theme-locked brand
 * CSS and the orb itself (the entry stays under the bundle-size budget —
 * the build report verifies no router/chat/shiki leakage).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OrbApp } from '@/orb/App';
import '../styles/globals.css';

const rootElement = document.getElementById('orb-root');
if (!rootElement) {
  throw new Error('Root element #orb-root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <OrbApp />
  </StrictMode>
);
