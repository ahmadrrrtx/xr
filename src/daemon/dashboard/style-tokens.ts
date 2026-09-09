/**
 * XR Control Center served-CSS fragment — design tokens :root (shared colors interpolated from src/ui/tokens.ts).
 *
 * @internal — composed by the parent module; content is a verbatim slice of
 * the composed template literal, so escaping must not be edited here alone.
 */

import { COLOR } from "../../ui/tokens.ts";

export const STYLE_TOKENS = `
/* ── Design Tokens (CSS Variables) — XR 4.0 Navy/Cyan Theme ────────── */
:root {
  /* Navy-based dark theme with cyan accent */
  --bg:         #0B1120;
  --bg2:        #0F172A;
  --surface:    #1E293B;
  --surface2:   #334155;
  --border:     #1E293B;
  --border2:    #334155;
  --border-strong: #475569;
  --cyan:       #38BDF8;
  --violet:     #6048F8;
  --green:      #22C55E;
  --amber:      #F59E0B;
  --red:        #EF4444;
  --muted:      #64748B;
  --text:       #F1F5F9;
  --textDim:    #94A3B8;
  --radius-sm:  6px;
  --radius:     10px;
  --radius-lg:  14px;
  --radius-xl:  20px;
  --font-mono:  'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans:  'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --sidebar-w:  240px;
  --inspector-w:320px;
  --glow-c:     0 0 20px rgba(56, 189, 248, 0.15);
  --glow-g:     0 0 20px rgba(34, 197, 94, 0.12);
  --glow-a:     0 0 20px rgba(245, 158, 11, 0.15);
  --glow-r:     0 0 24px rgba(239, 68, 68, 0.2);
}

`;
