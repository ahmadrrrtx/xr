# Phase 7 — Approvals & Notifications · Plan

Trust UI primitives: the Approval Modal, a cross-surface approval queue, the
notification bell, Sonner wiring, and persisted "remember" rules. Real
permission enforcement is Phase 12 (Shield) / 14 / 20 — this phase ships the
UI plumbing and stub events a real backend will consume.

## 0. Context & deviations (read first)

- All frontend paths live under `desktop/src/…` (the Tauri app), not `src/…` —
  same adjustment as Phases 3–6 (vite root is `desktop/`).
- **Reference images lost:** `/home/user/previews/*.png` (incl. the primary
  `19-approval-modal.png`) were lost to a workspace snapshot rollback before
  this phase started. Visuals are matched against the prompt's detailed spec +
  SCREEN-BRIEFS OV-4/OV-5 + DESIGN-SYSTEM §5.6/5.9 + THEME-SYSTEM (all in
  `docs/`). Noted wherever a pixel-level call was needed.
- `src/components/ui/checkbox.tsx` **did not exist** (prompt assumed it) — a
  new shadcn-style Checkbox is added, built on the already-installed `radix-ui`
  package (no new dependency).
- Rules persist as **JSON in a Tauri Store** (`approvals.json`, localStorage
  fallback in browser) per this phase's prompt. The master plan's "SQL store"
  arrives with Phase 12's Shield database; the Rust command surface
  (`load_rules`/`save_rules`) is the seam it will migrate behind.
- Event names follow this phase's prompt: `approval:requested`,
  `approval:decided`, `notification:new` (master plan's `approve:request`
  naming is superseded).
- ApprovalRule gains `effect: "allow" | "deny"` — the prompt's `checkRules`
  requires auto-deny on deny rules; the modal only creates allow rules in v1
  (deny rules arrive with Shield/bots).
- mockLLM approval triggers are **deterministic keyword matches** (send-email
  / delete-file / write-file / shell), not random — the test checklist needs
  reproducible triggers ("send an email to sarah saying hi"), and the house
  rule bans flaky tests.
- The bell already lives in `Topbar` via `NotificationBell.tsx` (Phase 1
  placeholder with a static "3" badge) — it is rewritten in place; `Topbar.tsx`
  itself needs no change.

## 1. Files

**Created**
- `desktop/src/lib/approvalCore.ts` — pure, dependency-free: types
  (ApprovalRequest, ApprovalRule, PendingDecision, Notification), rule
  matching (incl. 1h expiry + session filtering), risk copy map, relative
  time + day-grouping helpers, queue-advance reducer, dev overrides
  (`xr.approval.autoDenyMs`). Unit-tested by bun.
- `desktop/src/lib/approvalRules.ts` — persistence around approvalCore:
  `loadRules()`/`saveRules()` via the Rust command (Tauri) with localStorage
  write-through fallback (browser + pre-hydration reads).
- `desktop/src/lib/approvalEvents.ts` — the surface-facing API:
  `requestApproval(req): Promise<PendingDecision>` (rule check → queue/modal →
  promise), `sendNotification(n)` (store + OS notification when unfocused +
  `notification:new` emit), Tauri event emits with a dev-only
  `xr-approval-seam` CustomEvent mirror (the Phase-6 e2e pattern).
- `desktop/src/stores/approvalStore.ts` — Zustand: `pending[]`, `activeId`,
  `rules[]`, session decisions, promise resolvers; actions `requestApproval`,
  `decide(id, status, remember?)`, `activate(id)`, `withdraw(id)`,
  `hydrate()`.
- `desktop/src/stores/notificationStore.ts` — `items[]` (cap 100, session-only
  v1), `unreadCount`, `add/markRead/markAllRead/remove/clear`.
- `desktop/src/components/ui/checkbox.tsx` — shadcn-style, radix-ui Checkbox.
- `desktop/src/components/approvals/ApprovalModal.tsx` (+ `ApprovalInfo.tsx`
  info-row subcomponents) — mounted once at app root.
- `desktop/src/components/notifications/BellPopover.tsx` (+
  `NotificationItem.tsx`) — the real feed behind the bell.
- `desktop/src-tauri/src/commands/approvals.rs` — `load_rules`, `save_rules`,
  `send_os_notification` (+ unit tests: serde roundtrip, bad durations
  rejected).
- `test/desktop/approval-core.test.ts` — bun units for approvalCore.

**Modified**
- `desktop/src/lib/mockLLM.ts` — approval-gated tool scripts; new
  `requestApproval?` callback on StreamOptions (absent → tool auto-continues,
  so HUD quick-ask keeps today's behavior).
- `desktop/src/stores/chatStore.ts` — pass the approval gate into streamChat;
  tool cards enter real `waiting-approval`; deny → tool `error` + denial
  after-text; generation abort withdraws the pending request.
- `desktop/src/components/palette/CommandPalette.tsx` — main-window quick-ask
  passes the same gate (HUD window does not — the modal lives in main).
- `desktop/src/components/layout/NotificationBell.tsx` — real popover: unread
  badge (dot at 1, count ≤99, "99+"), last 20 items, day separators, inline
  APPROVE/DENY on pending approval items, Mark all read, Open Control Room.
- `desktop/src/hooks/useOrb.ts` — `orb:approvals-requested` now activates the
  oldest pending approval (or toasts "no pending approvals") instead of the
  Phase-7 placeholder toast.
- `desktop/src/lib/paletteCommands.ts` — dev-only "Trigger Test Approval"
  command (the master plan's dev-menu trigger; also drives e2e/screenshots).
- `desktop/src/App.tsx` — mount `<ApprovalModal />` at root (main window
  only; appears above every route).
- `desktop/src-tauri/src/commands/mod.rs`, `src/lib.rs` — register the three
  commands.
- `desktop/src/styles/globals.css` — `approval-pulse` keyframes (glow themes
  only — keyed off `--accent-glow`, which Paper/Arctic set to `transparent`)
  + reduced-motion off-switch.

## 2. Data shapes (approvalCore.ts)

```ts
type ApprovalRisk = 'low' | 'medium' | 'high';
interface ApprovalRequest {
  id: string; skillId: string; skillName: string; skillVersion: string;
  skillIcon: string;              // lucide icon key, resolved in the modal
  action: string;                 // "Send email"
  resource: string | null;        // "sarah@company.com" | null (generic)
  subject?: string;               // optional title/subject line
  bodyPreview?: string;           // collapsed by default
  risk: ApprovalRisk; justification: string; createdAt: number;
  rememberOptions?: { label: string; key: RememberKey }[]; // custom labels
}
type RememberKey = 'always' | '1h';   // "once" = neither checked (default)
type RuleDuration = 'forever' | '1h' | 'session';
interface ApprovalRule {
  id: string; skillId: string; action: string; resource: string | null;
  effect: 'allow' | 'deny'; duration: RuleDuration; createdAt: number;
}
interface PendingDecision {
  status: 'approved' | 'denied'; remember?: RememberKey; ruleId?: string;
  auto?: boolean;                  // decided by a rule, not the user
  reason?: string;                 // "Timed out (you were away)" etc.
}
type NotificationType = 'approval-request' | 'approval-decided' | 'success'
  | 'error' | 'warning' | 'info';
interface Notification {
  id: string; type: NotificationType; title: string; body?: string;
  createdAt: number; read: boolean; data?: { approvalId?: string; … };
}
```

## 3. Flow, queue, rules, countdown

- `requestApproval(req)`: ① `checkRules` — matching allow rule (forever, or
  1h unexpired — expired rules are pruned on check) → silent auto-approve +
  "Auto-approved (rule)" notification; deny rule → auto-deny. ② else enqueue,
  open modal for the oldest, emit `approval:requested`, orb →
  `waiting-approval`, OS notification when unfocused, Sonner toast ("needs
  your approval", persistent, action buttons Approve/Deny). ③ returned
  promise resolves on decide/withdraw.
- Queue: one modal at a time (oldest first). `activate(id)` (bell click / orb
  menu) brings any buried request to the front. After a decision the next
  pending opens immediately. Pending queue is session-only (restart drops it;
  rules persist).
- `decide(id, status, remember?)`: store decision, save rule when remember ∈
  {always, 1h} (session rules stay memory-only), resolve promise, emit
  `approval:decided`, toast "Approved/Denied: {action}", approval-decided
  notification, orb back to idle (unless a stream is mid-speaking).
- Escape / backdrop click / focus-loss timeout → **DENY** (safe default).
- Countdown: 60s (dev override `xr.approval.autoDenyMs`), shown as a pill in
  APPROVE. Starts only when the window is blurred/hidden while the modal is
  open; refocus cancels; 0 → auto-deny, reason "Timed out (you were away)".
- Cross-surface: main modal + bell badge (+N) + orb waiting-approval + OS
  notification + `notification:new`/`approval:*` broadcasts for future
  surfaces (bots Phases 24/26, Voice Theater 16). No new surfaces consume
  them yet — they fire anyway.

## 4. Modal anatomy (from prompt + OV-4)

520px max-w, radius 16px, `bg-bg-ink`, 2px `--border-accent` border, pulsing
cyan glow in glow themes (Paper/Arctic: static border — the pulse shadow uses
`--accent-glow`, which those themes set to transparent). Backdrop
`--bg-overlay` + blur, click = deny. Header: 40px shield in accent/10 square,
"Permission required" 20px bold, subtitle "{skillName} wants to take an
action." Info cards: skill row (+ verified badge), action row (bold),
resource row (mono), optional subject, collapsible body preview (collapsed
default, height-animated), risk chip (Low green / Medium amber / High red,
one-line human explanation), justification quote (italic). Remember
checkboxes: "Always allow {skill} to {action}{resource}" / "Allow for 1 hour"
(mutually exclusive; "Allow once" is the default = neither). Buttons equal
width: DENY (danger outline, left) / APPROVE (accent fill, right, countdown
pill when blurred). Footer: "(i) XR will never auto-approve without your
consent."
Accessibility: `role="alertdialog"`, aria-modal, labelled + described,
aria-live assertive announce on open, focus trap (Radix), **initial focus
DENY**, Enter approves only when APPROVE focused, Esc = deny, risk chips have
text+icon.

## 5. Test checklist

bun: approval-core units (rules ×5, queue advance, notification cap/unread,
relative time, risk copy). tsc (both) + eslint + vite build (3 entries) +
cargo check/clippy/test. Playwright (dev server, DOM assertions only):
trigger→modal (roles/labels/DENY focus), expand/collapse, checkbox exclusivity,
approve+always→rule persisted (localStorage) + next request auto-approved,
deny→tool card error + toast, countdown (autoDenyMs override + blur) →
auto-deny + refocus cancel, Esc/backdrop deny, bell badge/popover/inline
decide/mark-all-read/empty/Open Control Room, two queued → sequential modals,
orb seam waiting-approval↔idle, 5 themes render, palette still green.
Screenshots: 8 implementation captures (`previews/implementation/phase-07/`).

## 6. Out of scope (v1)

Real backend enforcement (12), full Shield screen (12), bot surfaces (24/26),
Voice Theater overlay (16), approval sounds (silent by default), notification
persistence across restart (rules persist; feed is session-only), OS
notification click-to-focus (plugin API check at implementation; skip if
non-trivial).

## Research notes (Step 2, 3 searches)

- Radix Dialog: modal mode traps focus; `onOpenAutoFocus` (preventDefault +
  focus target) sets initial focus on DENY; `onEscapeKeyDown` /
  `onInteractOutside` gate Esc/backdrop → both map to DENY here.
- Tauri v2 notification: JS `sendNotification` / Rust `NotificationExt`
  builder (title/body/show); macOS requests permission on first send —
  denial must degrade to in-app only. Rust-side use via our command keeps
  capabilities untouched.
- Countdown: 1s interval + React state is the standard Framer-adjacent
  pattern; the pill/progress tween uses framer-motion (reduced-motion →
  plain text).
