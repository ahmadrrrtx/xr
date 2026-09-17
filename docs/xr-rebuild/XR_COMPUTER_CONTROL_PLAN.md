# XR — Computer Control UX Plan

> Base: `src/control/computer-use.ts` (capture→vision→action schema), `classify`, approvals tier2, environment sessions, browser (Playwright), seccomp assets [OBSERVED]. Research: permission-first + category blocks (Anthropic), isolation-first (MS Agent Workspace), visibility/stop affordances [RESEARCH-BACKED].

## 1. Principles
1. Never weaken existing boundary: tier2 + fail-closed placement stay engine-side.
2. Always answer: WHAT is controlled · WHAT action · WHY · WHICH app · WHICH permission · STOP where?
3. Isolation-first defaults: prefer browser-isolated profile / container backend when available [OBSERVED backends]; host control = explicit grant.
4. Category blocklist default-ON: trading/crypto/banking/payments/health-portal/gov-auth pages → refuse w/ explanation (user may allow per-site in Trust→Network, logged). [RESEARCH-BACKED default list]

## 2. Surfaces
- **Acting Indicator:** system-wide slim bar (top edge) w/ mark pulse: "XR is controlling <App> — <verb> <target>" + STOP button; also tray presence swap.
- **Control Cockpit sheet:** live action feed (verb/target/reason), screenshot thumbnails w/ redaction hints (password fields blurred engine-side before display), permission chips, app scope list, session timeline, STOP (red, sticky).
- **Pre-flight card (before first use):** what computer control can do, what it refuses, sandbox choice (isolated browser / container / host), test action.
- **History:** control sessions in Runs anatomy (actions, approvals, captures retained per retention policy, default 7d local).

## 3. Approval integration
- Every new app scope = ApprovalSheet (what/why/risk); within-scope repetitive actions follow current Mode (Careful=every action, Balanced=first-per-pattern, Autonomous=audit-only) — mapping to trust tiers engine-side.
- Voice barge-in cannot approve control actions (confirmation integrity [RESEARCH-BACKED]).

## 4. Safety instrumentation
- Kill switch: ⌘. and tray "Stop XR control" → immediate input release + audit event.
- Watchdog: stall-detector [OBSERVED] halts loops repeating same action >N.
- Screenshot hygiene: captures never leave machine unless user-enabled cloud vision (existing visionCloudDecision [OBSERVED]) w/ explicit per-session consent + redaction.

## 5. Platform notes
- Linux: xdotool/wmctrl helpers (doctor-guided install); Wayland path via portal where available (P5).
- macOS: Accessibility/ScreenRecording permission flows w/ guided panes. Windows: UIA-first, input synthesis guarded.

## 6. Phasing
P4: indicator+cockpit+pre-flight+category blocks+history. P5: Wayland/portals, per-site memory of grants, session replay scrubber.
