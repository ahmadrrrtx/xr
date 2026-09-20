/**
 * XR icon set v1 — Phase 2 · F-5.
 *
 * One module, one grammar: 24 px grid, 1.5 px stroke, rounded caps/joins,
 * 2 px corner radii, mono ink by default (currentColor); semantic color is
 * applied by the CONSUMER only for state (Design System §6). Replaces the
 * ad-hoc rail paths whose optical weights disagreed (audit F-5).
 *
 * Icons are data (path specs), not components-per-icon, so the rail, palette
 * and future context menus render them identically and tree-shaking keeps
 * the bundle to exactly the glyphs in use.
 */
import type { ReactNode } from "react";

export type IconName =
  | "home"
  | "work"
  | "workspace"
  | "agents"
  | "library"
  | "runs"
  | "trust"
  | "settings"
  | "mic"
  | "send"
  | "stop";

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M4.5 10.5 12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4v-5h-5v5h-4a1 1 0 0 1-1-1v-8.5Z" />
    </>
  ),
  work: (
    <>
      <path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2v-10Z" />
      <path d="M8.5 9h7M8.5 12h4.5" />
    </>
  ),
  workspace: (
    <>
      <path d="M3.5 6.5h5l2 2h10V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6.5Z" />
      <path d="M3.5 11h17" />
    </>
  ),
  agents: (
    <>
      <circle cx="9" cy="8.5" r="2.75" />
      <path d="M4 18.5c.6-3 2.6-4.75 5-4.75s4.4 1.75 5 4.75" />
      <circle cx="16.75" cy="9.5" r="2.25" />
      <path d="M15.5 13.9c2.3.2 3.9 1.7 4.5 4.1" />
    </>
  ),
  library: (
    <>
      <path d="M5.5 4.5h3.25v15H5.5zM11 4.5h3.25v15H11z" />
      <path d="m16.6 5.4 3.1.85-3.6 13.3-3.1-.85z" />
    </>
  ),
  runs: (
    <>
      <path d="M5 5.5h14M5 12h14M5 18.5h8" />
      <circle cx="17.5" cy="18.5" r="2.25" />
    </>
  ),
  trust: (
    <>
      <path d="M12 3.5 19.5 6v6c0 4.6-3.2 7.6-7.5 8.5-4.3-.9-7.5-3.9-7.5-8.5V6L12 3.5Z" />
      <path d="m9 11.75 2.25 2.25L15.5 9.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.7 6.7l1.4 1.4M15.9 15.9l1.4 1.4M17.3 6.7l-1.4 1.4M8.1 15.9l-1.4 1.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9.25" y="3.5" width="5.5" height="10" rx="2.75" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  send: <path d="M5 12h13M12.5 5.5 19 12l-6.5 6.5" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
};

export function Icon({ name, size = 20, strokeWidth = 1.5 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
