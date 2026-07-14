/**
 * XR 3.1 — Shell entry (fullscreen terminal application)
 *
 * `xr` with no args opens the dedicated Shell — not a CLI menu loop.
 *
 * Architecture:
 *   interfaces/shell/app.ts      — controller (state, input, agent)
 *   interfaces/shell/render.ts   — frame assembly (header/sidebar/main/…)
 *   interfaces/shell/layout.ts   — responsive geometry
 *   interfaces/shell/types.ts    — shared types
 *   ui/tokens.ts · theme.ts · primitives.ts · terminal.ts · icons.ts
 *
 * Spec sources of truth:
 *   docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md
 *   docs/xr-3.1/XR-3.1-NAVIGATION-ARCHITECTURE.md
 *   docs/xr-3.1/XR-3.1-INFORMATION-ARCHITECTURE.md
 *   docs/xr-3.1/XR-3.1-PERFORMANCE-STANDARDS.md
 *   docs/xr-3.1/XR-3.1-COMPONENT-STANDARDS.md
 *   docs/xr-3.1/XR-3.1-ACCESSIBILITY-STANDARDS.md
 *
 * Backend systems are frozen. This module only redesigns the experience.
 */

export { runShell as runTUI } from "./shell/app.ts";
