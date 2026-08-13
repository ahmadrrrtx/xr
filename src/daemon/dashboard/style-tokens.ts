/**
 * XR Control Center served-CSS fragment — design tokens :root (shared colors interpolated from src/ui/tokens.ts).
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

import { COLOR } from "../../ui/tokens.ts";

export const STYLE_TOKENS = `
/* ── Design Tokens (CSS Variables) ────────────────────────────────────── */
:root {
  /* Shared semantic colors are interpolated from src/ui/tokens.ts at build
     time — never hand-maintained here (single source of truth). */
  --bg:         ${COLOR.bg}; /* App background */
  --bg2:        ${COLOR.bg2}; /* Raised panel dark background */
  --surface:    ${COLOR.surface}; /* Card / message bubble base */
  --surface2:   ${COLOR.surface2}; /* Inputs / active rows */
  --border:     ${COLOR.border}; /* Default divider border */
  --border2:    ${COLOR.border2}; /* Hover border */
  --border-strong: #5C7194; /* Phase 8 · T3 — ≥3:1 vs every surface: interactive-control boundaries (WCAG 1.4.11) */
  --cyan:       ${COLOR.primary}; /* Primary active indicator / glow */
  --violet:     ${COLOR.violet}; /* Official brand indigo (asset-verified #6048F8) */
  --green:      ${COLOR.success}; /* Success, local-first, safe */
  --amber:      ${COLOR.warning}; /* Warning, cloud routing, attention */
  --red:        ${COLOR.error}; /* Critical error, security block */
  --muted:      ${COLOR.muted}; /* Phase 8 · T3 — raised for ≥4.5:1 on every surface (WCAG 1.4.3) */
  --text:       ${COLOR.text}; /* Primary high-contrast text */
  --textDim:    ${COLOR.textDim}; /* Secondary dim copy */
  --radius-sm:  4px;
  --radius:     8px;
  --radius-lg:  12px;
  --radius-xl:  16px;
  --font-mono:  'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans:  'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --sidebar-w:  240px;
  --inspector-w:320px;
  --glow-c:     0 0 20px rgba(0, 212, 255, 0.15);
  --glow-g:     0 0 20px rgba(0, 255, 136, 0.12);
  --glow-a:     0 0 20px rgba(245, 158, 11, 0.15);
  --glow-r:     0 0 24px rgba(255, 77, 77, 0.2);
}

`;
