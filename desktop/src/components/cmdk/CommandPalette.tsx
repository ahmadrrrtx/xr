/*
 * Phase 5: the real palette lives in src/components/palette/ (shared between
 * the in-app overlay and the HUD window). This path stays as a thin re-export
 * so AppShell's import from Phase 1 keeps working unchanged.
 */
export { CommandPalette } from '@/components/palette/CommandPalette';
