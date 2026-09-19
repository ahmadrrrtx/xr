/**
 * XR Prism — Design Tokens TS Module
 * Generated from tokens.json — source of truth: docs/xr-rebuild/XR_DESIGN_SYSTEM.md
 * Phase 1 v1 — dark/light/system/high-contrast + density + motion + brand
 */

export const tokens = {
  version: "1.0.0-phase1",
  color: {
    dark: {
      bg: "#0A0A0F",
      surface1: "#101018",
      surface2: "#14141D",
      surface3: "#1A1A24",
      border: "#23232E",
      borderStrong: "#32323F",
      text: "#ECECF1",
      textMuted: "#9A9AA8",
      textFaint: "#6C6C7A",
      cyan: "#00D4FF",
      violet: "#6048F8",
      green: "#00FF88",
      amber: "#FFB454",
      red: "#FF5470",
      cyanGlow: "rgba(0, 212, 255, 0.12)",
      violetGlow: "rgba(96, 72, 248, 0.12)",
      greenGlow: "rgba(0, 255, 136, 0.1)",
    },
    light: {
      bg: "#FAFAF7",
      surface1: "#FFFFFF",
      surface2: "#F4F4EF",
      surface3: "#ECECE5",
      border: "#E2E2DA",
      borderStrong: "#CFCFC6",
      text: "#16161A",
      textMuted: "#55555E",
      textFaint: "#77777F",
      cyan: "#0077A8",
      violet: "#4A34D0",
      green: "#007A4D",
      amber: "#9A5B00",
      red: "#B01030",
    },
  },
  space: {
    base: 4,
    scale: [4, 8, 12, 16, 24, 32, 48, 64] as const,
    tight: 4,
    componentInternal: 8,
    componentGap: 12,
    section: 16,
    panel: 24,
    page: 32,
    hero: 48,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    pill: 999,
    window: 12,
  },
  typography: {
    sans: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
    ramp: [12, 13, 14, 16, 20, 28, 40] as const,
  },
  motion: {
    micro: 120,
    state: 200,
    surface: 320,
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
    easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
    drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  semantic: {
    presence: "#00D4FF",
    success: "#00FF88",
    caution: "#FFB454",
    danger: "#FF5470",
    intelligence: "#6048F8",
  },
} as const;

export type Theme = "dark" | "light" | "system" | "high-contrast";
export type Density = "compact" | "comfortable" | "spacious";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", theme);
  }
  localStorage.setItem("xr-theme", theme);
}

export function applyDensity(density: Density) {
  document.documentElement.setAttribute("data-density", density);
  localStorage.setItem("xr-density", density);
}

export function initThemeSystem() {
  const savedTheme = (localStorage.getItem("xr-theme") as Theme) || "dark";
  const savedDensity = (localStorage.getItem("xr-density") as Density) || "comfortable";
  applyTheme(savedTheme);
  applyDensity(savedDensity);

  // OS theme sync
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const current = localStorage.getItem("xr-theme") as Theme;
    if (current === "system") applyTheme("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
