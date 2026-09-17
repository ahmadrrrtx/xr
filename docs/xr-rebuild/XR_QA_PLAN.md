# XR — QA & Test Strategy (rebuild)

> Heritage: 3,242-test suite, gates (boundaries, size, hot-path, api:compat, claim-lint, perf, fuzz, soak, mutation 0.6), a11y live-gates, cross-platform CI [OBSERVED]. Strategy: extend, never fork.

## 1. Layers
| Layer | Contents | Gate |
|---|---|---|
| Unit (engine) | existing 317 files | CI (unchanged) |
| Unit (shell) | components, state machines (voice/approvals UI), reducers | CI new pkg |
| Contract | generated client ↔ OpenAPI; SSE event schema; PTY/voice WS schemas | api:compat + new ipc:compat |
| Integration | desktop↔daemon: pairing, respawn, resume, approvals E2E, budget UI↔governor | nightly |
| Runtime/agent | golden-path script heritage + task fixtures across providers (fixtures matrix heritage) | nightly |
| Security | prompt-injection bench (`xr attacks`) + MCP pinning tests + approval-integrity negatives + egress fuzz | CI + fuzz-guard |
| Desktop native | tray/notifications/deeplinks/autostart/updater-rollback per OS | cross-platform CI |
| UI/a11y | axe WCAG 2.2 on shell (heritage dash a11y suite ported), keyboard maps, focus traps, reduced-motion | CI (playwright) |
| Responsive/compact | breakpoint matrix (1280/1024/820/640) visual snaps | CI visual |
| Performance | shell start <1.5 s, SSE→paint p95 <100 ms, idle RAM budget; engine perf gates unchanged | perf:gate extended |
| Failure recovery | sidecar kill→respawn→resume; crash mid-run→checkpoint resume; provider drop→fallback chain UX; tool fail→retry classification UX | nightly chaos job |
| Offline | engine-only mode (no internet): local provider flows, library cache, update deferral | nightly |
| Voice | state-machine corpus, barge-in negatives, latency p95 harness | CI + device matrix manual/quarterly |
| Computer control | sandbox drill matrix (browser-isolated/container/host), stop-kill switch, category blocks | nightly (VM lab) |
| MCP/plugins | pinning diff re-approval, quarantine, unsigned-block, worker crash isolation | CI |
| Skills | 65-skill load parity, manifest upgrade tooling, permission badge snapshot | CI |
| npm/CLI/TUI | consumer-smoke heritage + tarball-invariant + TUI pty snapshots | CI |
| Migration | parity matrix capability×surface; deprecated-surface banner states | P4+ CI |

## 2. Evidence & honesty rules
- Every new gate gets an owner row in OWNERSHIP map heritage; flaky quarantine w/ public issue link (claim-lint spirit).
- Visual regression baselines stored per component; diffs require human approve.
- Windows approval transport (SEC-06) gets dedicated parity job before desktop GA on Windows.

## 3. Release certification (per phase)
DoD = phase tests green + parity matrix delta zero + security bench no-regression + docs updated + rollback drill passed.
