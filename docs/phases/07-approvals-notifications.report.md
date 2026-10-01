# Phase 7 — Approvals & Notifications · Implementation Report

Branch `phase/7-approvals-notifications` (based on merged `main` @ 490c7e4, PR #144).
Plan: `docs/phases/07-approvals-notifications.plan.md`.

## What shipped

**The Approval Modal** (`components/approvals/`) — one modal at the app root,
controlled by the approval store, above every route:

- 520px card, 16px radius, 2px accent border with a breathing cyan glow
  (2s cycle; Paper/Arctic automatically get the static-border treatment —
  their `--accent-glow` is `transparent`).
- Full anatomy per OV-4: 40px shield header, "Permission required", skill
  row (+version +verified badge), bold action, mono resource/subject,
  collapsible body preview (height-animated, collapsed by default), risk
  chip with human explanation, italic justification quote, three remember
  options (Always allow / Allow for 1 hour / Allow once — exclusive,
  "once" default), equal-width DENY (danger outline) / APPROVE (accent
  fill), trust footer.
- Safe defaults: **initial focus DENY**, Escape = deny, backdrop click =
  deny, Enter approves only when APPROVE is focused, "Allow once" default,
  60s auto-deny countdown **only while the window is blurred/hidden**
  (refocus cancels; dev override `xr.approval.autoDenyMs`).
- Accessibility: `role="alertdialog"`, aria-modal, Radix-labelled title +
  description, assertive aria-live announcement on open, focus trap,
  labeled risk chips, reduced-motion variants.

**The queue** (`stores/approvalStore.ts` + `lib/approvalEvents.ts`) —
promise-based `requestApproval()` any surface can call; oldest-first modal
(buried requests surface via bell/orb/click — `activate`); after a decision
the next pending takes over in place; generation cancel **withdraws** the
request quietly (no orphaned modals).

**Remember rules** (`lib/approvalCore.ts` + `lib/approvalRules.ts` +
`src-tauri/src/commands/approvals.rs`) — exact skill+action+resource
matching; forever / 1h (auto-expiring, pruned on check) / session
(memory-only); deny-rule support for future surfaces; persisted via a Rust
command pair into the `approvals.json` Tauri Store (localStorage mirror in
browser). The Shield DB takes this seam over in Phase 12.

**Notifications** (`stores/notificationStore.ts` +
`components/notifications/`) — feed (cap 100, session-only), unread badge
(dot at 1, count ≤99, "99+"), Bell popover (360px: day-separated history,
inline APPROVE/DENY on pending rows, Mark all read — opening marks read —
Open Control Room → /runs); Sonner wired to the same queue (persistent
review toast when a request queues behind another); OS notifications via a
Rust bridge (`tauri-plugin-notification`) whenever the app is unfocused.

**Cross-surface events** — `approval:requested` / `approval:decided` /
`notification:new` broadcast to every webview (bots Phases 24/26 and Voice
Theater 16 subscribe later; the events fire now) + a dev-only
`xr-approval-seam` mirror for browser e2e.

**Integrations** — chat tool cards: permission-gated mock tools (send-email
medium / write-file medium / delete-folder high / shell high — deterministic
keyword matches) park the stream on the real modal, yellow shield while
waiting, ✗ + "User denied this action" when denied, stream continues on
approve; main-window quick-ask passes the same gate (HUD keeps
auto-continue); orb goes `waiting-approval` while anything is pending and
back to idle when the queue empties (skip while a stream is mid-speaking);
orb menu "Pending Approvals" surfaces the oldest request; dev palette
commands: **Trigger Test Approval**, **Reset Approval Rules**, plus the
`__xrTriggerTestApproval` window hook for e2e/demos.

## Plan deviations (all benign — details in the plan doc §0)

Paths under `desktop/src/`; reference PNGs lost to a snapshot rollback
(matched to the written specs); `checkbox.tsx` was created (radix-ui
package, no new dep) — remember options ended up as exclusive radio-style
inputs dressed as checkboxes per the spec's mutual-exclusion rule; rules
persist as JSON in a Tauri Store (master plan's SQL arrives with Shield);
event names follow this phase's prompt; mockLLM triggers deterministic, not
random (reproducible tests); `NotificationBell.tsx` became a re-export shim
so Topbar's import stayed stable; OS-notification click-to-focus not
available in the plugin's Rust API (limitation, not scope creep).

## Verification (all local, pre-PR)

| Gate | Result |
|---|---|
| `tsc --noEmit` (root + desktop) | clean |
| `eslint .` | clean |
| `vite build` (3 entries) | ✓ 3.3s |
| `cargo check` / `clippy -D warnings` / `cargo test` | clean / clean / **15/15** (4 new: rule serde roundtrip, null resource, bad enum rejection, session duration) |
| Desktop suite `test/desktop/` | 45/45 (26 new approval-core units) |
| Full root lane `bun test` | **3432 tests / 340 files, 0 fail** (19 platform skips; perf suite re-verified idle after a contention-only flake) |
| Playwright e2e | **55/55 ×2 runs** — modal anatomy (12 checks), preview expand/collapse, remember exclusivity, DENY-first focus + Tab→APPROVE→Enter, Esc/backdrop deny, bell badge + aria, seams (approval + orb waiting-approval), chat trigger → card waiting → approve-with-always → card done + rule persisted, rule auto-approve (no modal) + auto seam, bell popover history + inline decide + mark-all-read + empty state + /runs navigation, two-deep queue (next shows in place), countdown pill on blur → refocus cancel → no deny while present → auto-deny when away, high-risk chip, denied card body + assistant acknowledgment, 5 themes, zero page errors |

## Screenshots

`previews/implementation/phase-07/`: 01 modal · 02 modal expanded ·
03 high-risk (delete folder) · 04 bell popover · 05 bell empty · 06 denied
toast · 07 approved toast · 08 chat tool card waiting (element capture).
All real browser captures, PIL-verified. Refinement previews:
`previews/refinement/07-approval-modal-detail.png`,
`07-bell-popover.png` (AI-generated mocks from the written specs — the
original reference PNGs were lost, see deviations).

## Known limitations (by design, v1)

- No real backend enforcement — rules are checked client-side; the Phase 12
  Shield gateway is the enforcer (events/commands here are its stubs).
- Bot surfaces (Telegram/Discord/WhatsApp) don't consume the events yet;
  Voice Theater overlay comes in Phase 16.
- Pending queue and notification feed are session-only (rules persist);
  OS-notification clicks don't focus XR (plugin limitation noted); no
  approval sounds (silent by default, a11y-first).
