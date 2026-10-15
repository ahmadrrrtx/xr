/**
 * Shared brand helpers (Phase 31 · Bucket F v2).
 *
 * The delivered v2 artwork is raster/animated media now — the old inline
 * SVG gradient defs (`BrandDefs`) and traced layers are retired with
 * art.ts. What remains is the theme-adaptive glow used by the logo lockup.
 */

/**
 * Theme-adaptive glow applied to the logo / energy accents. Strength comes
 * from `--avatar-glow-strength` (0 in Paper/Arctic → no visible glow).
 */
export const brandGlow = {
  filter: 'drop-shadow(0 0 var(--avatar-glow-strength) var(--accent-glow))',
} as const;
