# Phase 30 — Business tier — study notes (as read, before code)

> Study pass for the FINAL v1.0 feature phase. Everything below was read from the
> tree at `phase/28-mobile-pwa` merge (`4a255ac`) on branch `phase/30-business`.
> Where the phase brief and the tree disagree, the tree wins and the disagreement
> is recorded here rather than papered over (Constitution Art. IV.2, Art. XIX.1).

## 1. What the tree actually contains

| Area | Reality at study time | Consequence for Phase 30 |
| --- | --- | --- |
| `src/` | 40 domains — daemon, engine, voice, research, memory, skills, MCP, bots, runs, budget, shield, CLI. Bun ≥ 1.3, strict TS, `zod ^3.23.8` (v3, not v4). | Cloud may use zod v4 (separate deployable, own lockfile). Daemon-side code must stay on zod **v3** to avoid a second major in the kernel. |
| `desktop/` | Tauri v2, React + Vite, Settings is a **tabbed** two-pane shell (`desktop/src/screens/Settings/index.tsx`), tabs grouped `account \| app \| preferences \| privacy \| system`. | "Billing & Account" becomes an **`account`-group tab**, not a card wedged between General and About. See §4. |
| `website/` | Next.js 16.3.8, React 19.2.4, Tailwind v4 via `@theme`, `clsx` + `tailwind-merge`, `framer-motion`, `lucide-react`. Public routes already exist at `/pricing`, `/security`, `/privacy`, `/terms`, `/downloads`, `/enterprise`, `/features`, `/models`, `/marketplace`. | Phase 30 **rewrites** `/pricing` and `/security`; adds `/legal/*`, `/download`, `/auth/*`, `/dashboard/*`. It does not re-create what exists. |
| `satellites/` | `business-os/` + `xr-enterprise/` are real extracted packages with their own `package.json`/`tsconfig`/tests (ADR-0028). | Confirms the P30 placement: the cloud service is a **new sibling** `cloud/`, not a `satellites/` member (it is operated by XR, not self-hosted by the user). |
| `src/daemon/routes/business.routes.ts` | 14.2 KB. The **Business Operating Layer** dashboard: work queues, active workflows, AI-worker status, approvals/escalations, records changed, artifacts, cost/time, failures, audit/provenance. Header says *"No Phase 11 cloud control plane."* Resolves the Business OS through the kernel token registry and answers honest 503/empty payloads when the extension is not loaded. | **Do not touch.** It is an operational dashboard with an honest-degradation contract. Phase 30's billing/accounts is a different concern entirely (Art. III.2 — one source of truth per concern). New concerns get new files. |
| `src/security/` | `secret-broker.ts` (the ONLY credential path), `secrets.ts` (keychain / secret-service / DPAPI / AES-GCM file), `egress-proxy.ts` (`guardedFetch` — allowlist + DNS pin + private-range refusal + byte caps), `audit-signer.ts` (Ed25519 checkpoints over a SHA-256 chain), `audit-anchor.ts` (optional, egress-gated remote anchor). | Reuse **all** of it. The cloud session token goes in the secret broker, not a config file. Every cloud request goes through `guardedFetch`. The cloud audit log mirrors the local hash-chain shape. |
| `src/context/memory/` | 16 modules. `MemoryEntry.scope` is a plain `string` — `"global"` or a project key. `sensitivity.ts` exports `scanSensitive(content) → SensitiveMatch[]` over credit-card (Luhn), SSN, API keys, private keys. | `scope: "team"` needs **no type change** — the field is already open. The sensitivity scanner is reused verbatim as the pre-upload gate. |
| `src/integrations/` | `registry.ts` + `credentials.ts` (`CredentialVault`, AES-256-GCM, format v2, `decryptLegacy`). | Vault pattern re-implemented server-side in the cloud for team tokens; local vault is not reused across a process boundary. |
| `src/context/budget.ts`, `src/services/budget-service.ts`, `src/core/providers/budget.ts` | Local spend governor: per-task caps, daily/monthly caps, cost summary by model/provider. | Team policy caps are a **second, admin-authored** ceiling that composes with — never replaces — the local one. Local cap stays sovereign. |

## 2. The constitutional lines this phase must not cross

Read from `docs/CONSTITUTION.md` (reconstructed 2026-09, 800+ commits of enforcement):

- **Art. II.1 / II.2** — the machine is the seat of authority; **no feature may require a hosted control plane**. Cloud services are optional accelerants, never a dependency for correctness.
- **Art. IV.2 / IV.4** — degraded results are reported as degraded, never a fake success; ambiguity denies, fail closed.
- **Art. IX.5** — secrets are scoped, revocable, never globally exposed, never logged.
- **Art. X.1 / X.3** — honesty at the boundary of capability; a degraded path names a concrete repair action.
- **Art. XI** — the published contract must not drift from what the daemon serves.
- **Art. XVI** — Business is a **governed extension**; the kernel holds a thin contract only; scope creep as facade is forbidden.
- **Art. XXI** — telemetry is **opt-in**, consent explicit, fully offline-capable. Observability records structure only — kind, name, ids, outcome — **never payloads**.
- **Art. XXIII** — every migration reversible, no silent loss.
- **Art. XXIX.1** — **no cloud-only lock-in**.
- **Art. XXX** — local mode stays complete and sovereign.
- **Cmdts 2, 6, 11, 13** — no success without a verified effect; one source of truth per concern; startup lazy and bounded; default to the restrictive decision.

**Phase 30 in one sentence of constitutional law:** the Business tier may only *add*
cloud coordination. It may never subtract a local capability, and it may never
make a local capability's correctness depend on the cloud answering.

## 3. The honest gaps between brief and tree

These are recorded because the phase brief asserted things the tree does not show.
None of them block the phase; all of them change how it is built.

1. **"Phases 0–29 built/merged."** `main` is at the merge of PR #180,
   `phase/28-mobile-pwa`. There is no `phase/29` branch on the remote, and no
   multi-window work is merged. Phase 30 therefore branches from the Phase 28
   merge. Nothing in Phase 30 depends on Phase 29's multi-window polish.
2. **"Website … probably currently a landing page."** It is an 20-route site with
   a working `/pricing`, `/security`, `/enterprise` and a generated marketplace.
   The brief's "extend with Pricing + Billing portal + SSO callback routes" is
   therefore *rewrite + add*, not *create*.
3. **"silver/black/cyan brand language; no new palette."** The marketing site's
   tokens are currently **violet** (`--color-xr: #7c5cff`, `--color-accent:
   #ffffff`) on `#0a0a0b`, with 72 hardcoded `violet-*` / `rgba(124,92,255,·)`
   references across 24 files. The *canonical* brand in `docs/THEME-SYSTEM.md`
   and `docs/DESIGN-SYSTEM.md` — and the one in the shipped logo/avatar
   artwork — is XR Native: `--accent #00E5FF` cyan, `--metal #B7C2CF` silver, on
   `--bg-void #03070D`. So the brief is right about the *brand* and wrong about
   the *site*. Phase 30 builds its surfaces in the canonical palette and adds the
   brand tokens; the legacy-violet reconciliation of the 20 pre-existing routes
   is **flagged as a follow-up, not silently half-done** (§6).
4. **"Desktop Settings gets a Billing card between General and About."** Settings
   is tab-based; "between General and About" is a sidebar position, so it lands as
   the `billing` tab in the `account` group, directly after `general`.

## 4. Where each Phase 30 concern lands (one source of truth per concern)

| Concern | Home | Never |
| --- | --- | --- |
| Cloud account/billing service | `cloud/` (own deployable, own `package.json`) | `satellites/` (those are user-self-hosted extensions) |
| Cloud HTTP client, session state, license verify | `src/cloud/` (new) | `src/daemon/routes/business.routes.ts` |
| Managed-model passthrough | `src/cloud/models-proxy.ts` + one daemon route file | the provider adapters (they must not learn about billing) |
| Team memory scope | `src/context/memory/team.ts` + `sync.ts` | the local `store.ts` (it stays cloud-ignorant) |
| Billing tab | `desktop/src/screens/Settings/tabs/BillingTab.tsx` | a bespoke screen |
| Team workspaces section | `desktop/src/screens/Workspaces/` | the local workspace list itself |
| Pricing / trust / legal / auth / dashboard | `website/src/app/{pricing,security,legal,auth,dashboard}` | the cloud service (server-renders nothing) |

## 5. Reference UX read

Admin console density is modelled on Vercel/Linear/Stripe dashboards: 13px base,
tabular numerals, monospace ids, small status dots, no decorative motion, no
floating orbs, tables that stay readable at 1280px. The Orb is a *product*
surface, not a *work-tool* surface, and stays out of the dashboard (per brief).

## 6. Follow-ups this phase deliberately does NOT do

- Site-wide violet → brand cyan reconciliation of the 20 pre-existing marketing
  routes (mechanical, 24 files, zero Phase 30 value, real regression risk).
- Ed25519-signed local audit checkpoints pushed to the cloud (the local anchor
  already exists and is egress-gated; wiring it is post-v1).
- SCIM/HRIS provisioning, per-message E2E for team chat, SOC 2 Type II, Helm/k8s
  operator, native mobile shells — all explicitly out of scope in the brief.
