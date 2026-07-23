/**
 * XR Website — Single Source of Truth for marketing identity.
 *
 * This file must stay in sync with src/core/version.ts and package.json.
 * Run `bun run scripts/set-version.ts` to stamp version, repo, npm, homepage.
 *
 * Real project identity:
 *   GitHub: https://github.com/ahmadrrrtx/xr
 *   NPM: @rrrtx/xr  https://www.npmjs.com/package/@rrrtx/xr
 *   Homepage: https://xr-gules.vercel.app
 *   Version: 4.1.0 (Unified Execution Fabric) — from src/core/version.ts
 */

export const site = {
  name: "XR",
  tagline: "The AI Agent You Can Actually Trust — BYOK, local-first, secure",
  description:
    "XR is an open-source, local-first AI operating system — BYOK, secure, with a Unified Execution Fabric, persistent memory, research, voice, plugins, MCP, multi-agent runtime, and workflow automation. Built on Bun + TypeScript + SQLite.",
  url: "https://xr-gules.vercel.app",
  twitter: "@ahmadrrrtx",
  github: "https://github.com/ahmadrrrtx/xr",
  npm: "https://www.npmjs.com/package/@rrrtx/xr",
  installCmd: "npm i -g @rrrtx/xr && xr",
  version: "4.1.0",
  codename: "Unified Execution Fabric",
  displayVersion: "4.1.0 (Unified Execution Fabric)",
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
      { label: "Extensions", href: "/marketplace?tab=extensions" },
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
      { label: "Careers", href: "/careers" },
      { label: "Enterprise", href: "/enterprise" },
      { label: "Security", href: "/security" },
      { label: "Press", href: "/about#press" },
      { label: "Partners", href: "/enterprise#partners" },
    ],
    legal: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
} as const;

export type SiteConfig = typeof site;
