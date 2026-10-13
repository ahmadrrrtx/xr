/**
 * XR Native — the Phase 30 surface palette.
 *
 * ## Why this file exists instead of changing globals.css in place
 *
 * The site is on a violet accent (`--color-xr: #7c5cff`) with 72 references across
 * 24 files. Repainting all of them in this phase would touch nearly every page in
 * a release whose subject is billing, and a large mechanical diff is exactly where
 * a regression hides. So Phase 30 introduces the canonical XR Native palette as
 * tokens that the *new* surfaces use, and the migration of the older pages is
 * deferred to a phase about design rather than about money.
 *
 * ## The values are not invented here
 *
 * `#03070D` and `#00E5FF` are the shipped XR Native theme (`xr-THEME-SYSTEM.md`),
 * the same cyan-on-near-black the desktop app and the brand assets use. A marketing
 * page that disagrees with the product's own theme is a small thing that reads as
 * carelessness, and this phase is the point at which XR first asks anyone for money.
 *
 * ## Which surface gets which treatment
 *
 *   - Marketing (`/pricing`, `/security`, `/legal`, `/download`) — cinematic is
 *     allowed: the orb, the glow, the grid. It is a landing page.
 *   - Console (`/dashboard/**`) — restrained. Vercel/Linear density: 13px, mono
 *     identifiers, small status dots, no orbs, no parallax, no animated anything.
 *     An admin tool that performs is an admin tool people fight.
 */

/** Canonical palette. Mirrors xr-THEME-SYSTEM.md. */
export const native = {
  bg: "#03070D",
  bgElevated: "#070D16",
  bgSubtle: "#0B141F",
  border: "#152232",
  borderStrong: "#22323F",
  text: "#E8F1F8",
  textMuted: "#9FB3C4",
  textDim: "#6B7F92",
  cyan: "#00E5FF",
  cyanSoft: "#7DF3FF",
  cyanDeep: "#00A8BF",
  /** Used only for "this is fine" states in the console. */
  ok: "#3DD68C",
  warn: "#FFB224",
  danger: "#FF6369",
} as const;

export const nativeCssVars = `
  --color-native-bg: ${native.bg};
  --color-native-bg-elevated: ${native.bgElevated};
  --color-native-bg-subtle: ${native.bgSubtle};
  --color-native-border: ${native.border};
  --color-native-border-strong: ${native.borderStrong};
  --color-native-text: ${native.text};
  --color-native-text-muted: ${native.textMuted};
  --color-native-text-dim: ${native.textDim};
  --color-native-cyan: ${native.cyan};
  --color-native-cyan-soft: ${native.cyanSoft};
  --color-native-cyan-deep: ${native.cyanDeep};
`;

/**
 * The Business tier, stated once.
 *
 * Money lives in one place because a pricing page, a checkout summary and a
 * receipt email that disagree by a dollar each generate a support thread.
 */
export const businessPricing = {
  seatMonthlyUsd: 15,
  seatAnnualUsd: 144,
  /** What the annual price works out to per month, for the "save 20%" claim. */
  annualPerMonthUsd: 12,
  annualSavingPercent: 20,
  currency: "USD",
  trialDays: 30,
  trialMaxSeats: 5,
  /** Soft overage ceiling from the brief §G. Enforced as an approval threshold. */
  defaultMonthlyCapUsd: 20,
} as const;

/**
 * What is free, and it is not a subset.
 *
 * Written as a list of capabilities rather than a list of restrictions, because
 * "free forever, fully functional" is the claim and a list of what you *don't* get
 * is how a generous free plan starts to read like a countdown.
 */
export const personalIncludes = [
  "Every model, with your own keys — BYOK is not a paid feature",
  "Local memory, workspaces and the full knowledge store",
  "Voice, including local transcription",
  "The CLI, the desktop app, VS Code and Neovim extensions, the mobile PWA",
  "Agents, skills, plugins, MCP servers and the marketplace",
  "Research, multi-window, themes — including XR Native",
  "Per-task spend caps and the tamper-evident local audit log",
  "Unlimited seats. There is no seat concept on Personal.",
] as const;

/** Only these six things are Business. Each is a hosted service, not a gate. */
export const businessAdds = [
  {
    name: "Team workspaces",
    detail: "Shared projects, roles and per-member spend caps, administered in one place.",
  },
  {
    name: "Managed models",
    detail: "Use GPT-4.1, Claude and Gemini without your own API keys. Metered per user, capped per user.",
  },
  {
    name: "Cloud relay",
    detail: "Reach a device that is not on your network. Encrypted end to end; the relay cannot read frames.",
  },
  {
    name: "SSO",
    detail: "Google, Okta, Azure or any OIDC/SAML identity provider. Configured by an admin, not by support.",
  },
  {
    name: "Team memory",
    detail: "Facts your team agrees on, shared on purpose, reviewed before they spread.",
  },
  {
    name: "Audit & export",
    detail: "A hash-chained log of administrative actions and data access, exportable on demand.",
  },
] as const;

export const consoleNav = [
  { label: "Overview", href: "/dashboard", icon: "gauge" },
  { label: "Members", href: "/dashboard/members", icon: "users" },
  { label: "SSO", href: "/dashboard/sso", icon: "key" },
  { label: "Policies", href: "/dashboard/policies", icon: "shield" },
  { label: "Workspaces", href: "/dashboard/workspaces", icon: "layers" },
  { label: "Team memory", href: "/dashboard/memory", icon: "brain" },
  { label: "Billing", href: "/dashboard/billing", icon: "card" },
  { label: "Audit log", href: "/dashboard/audit", icon: "list" },
  { label: "Compliance", href: "/dashboard/compliance", icon: "badge" },
  { label: "API keys", href: "/dashboard/keys", icon: "terminal" },
] as const;
