/**
 * XR Website — Single Source of Truth for marketing identity.
 *
 * Must stay in sync with src/core/version.ts and package.json
 * (release.manifest.json stamps all of them; version: 1.0.0 "Truth").
 *
 * Real project identity:
 *   GitHub: https://github.com/ahmadrrrtx/xr
 *   NPM: @rrrtx/xr  https://www.npmjs.com/package/@rrrtx/xr
 *   Homepage: https://xr-gules.vercel.app
 */

export const site = {
  name: "XR",
  tagline: "An AI agent runtime you can actually audit",
  description:
    "XR is an open-source, local-first AI agent runtime. BYOK or local models, approvals and spend caps before every consequential action, a tamper-evident audit log, and skills, plugins, MCP, memory, research, voice and Telegram channels — all on your machine. Built on Bun + TypeScript + SQLite.",
  url: "https://xr-gules.vercel.app",
  twitter: "@ahmadrrrtx",
  github: "https://github.com/ahmadrrrtx/xr",
  npm: "https://www.npmjs.com/package/@rrrtx/xr",
  installCmd: "npm i -g @rrrtx/xr && xr",
  version: "1.0.0",
  codename: "Truth",
  displayVersion: "1.0.0 (Truth)",
  /** Bundled skills, mechanically counted from skills/ at stamp time. */
  skillCount: 65,
  /** Provider presets shipped in src/providers/presets.ts (10 local + 16 hosted). */
  providerCount: 26,
  localRuntimes: 10,
  hostedProviders: 16,
  nav: [
    { label: "Features", href: "/features" },
    { label: "Marketplace", href: "/marketplace" },
    { label: "Models", href: "/models" },
    { label: "Enterprise", href: "/enterprise" },
    { label: "Pricing", href: "/pricing" },
    { label: "Docs", href: "/docs" },
    { label: "Blog", href: "/blog" },
  ],
  footer: {
    product: [
      { label: "Features", href: "/features" },
      { label: "Marketplace", href: "/marketplace" },
      { label: "Skills", href: "/marketplace?tab=skills" },
      { label: "Plugins", href: "/marketplace?tab=plugins" },
      { label: "Models", href: "/models" },
      { label: "Downloads", href: "/downloads" },
      { label: "Changelog", href: "/changelog" },
      { label: "Roadmap", href: "/roadmap" },
    ],
    resources: [
      { label: "Documentation", href: "/docs" },
      { label: "Research", href: "/research" },
      { label: "Blog", href: "/blog" },
      { label: "Community", href: "/community" },
      { label: "Support", href: "/support" },
      { label: "Status", href: "/status" },
      { label: "Contact", href: "/contact" },
    ],
    company: [
      { label: "About", href: "/about" },
      { label: "Contribute", href: "/community" },
      { label: "Enterprise", href: "/enterprise" },
      { label: "Security", href: "/security" },
      { label: "Repository", href: "https://github.com/ahmadrrrtx/xr" },
    ],
    legal: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
} as const;

export type SiteConfig = typeof site;
