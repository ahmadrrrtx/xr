# Phase 5 — Hardening, gates & GA certification record

Status: implemented 2026-09-20. Branch `phase2/elite-workstation`.

## Delivered

| Plan line | Evidence |
|---|---|
| Designed light pass (F-10) | `audit/screens3/15-light-{home,work,settings}.png` — matte paper surfaces, darkened accents for AA, semantic colors preserved; axe-clean |
| i18n en/es/ur catalog | `desktop/src/i18n.ts` + Settings language picker; nav/onboarding/statusbar translated live (limit L-01 recorded) |
| dashboard → headless banner | composition-level banner in `src/daemon/dashboard/markup.ts` (fragments stay hash-pinned, split-test untouched) |
| SEC-05 business routes flag-OFF | `registry.ts` gates `businessRoutes()` behind `XR_BUSINESS_ROUTES=on`; `test/security/business-flag.test.ts` proves both states |
| SEC-09 disclosure | dashboard banner + Runs `.md` exports carry the Art. 50 line; recorded in KNOWN-LIMITATIONS |
| Chaos / offline drill | `16-chaos-engine-down.png`: daemon killed → honest boot diagnostics (health 500, "status unavailable — continuing"), checkpoint-resume note, Retry; daemon restarted → recovery |
| Perf gates | `scripts/perf-gate.ts`: /health 7.0 ms, /providers 7.8 ms, chat-stream open 1.3 ms (caps 250/250/900) |
| Size gate | `scripts/size-gate.ts`: entry 289 kB (cap 350), largest lazy 658 kB (cap 750) |
| a11y sweep | axe over 5 screens × 2 themes, post-fix: **0 serious/critical on every screen**; single accepted moderate = heading-order on Home (recorded in KNOWN-LIMITATIONS) |
| Real-device matrix | `.github/workflows/real-device-matrix.yml` + `scripts/real-device-matrix.ts`: installed + upgraded lanes on real Windows/macOS/Linux runners, asserting only measured facts; NOT runnable in this sandbox — first green run owned by CI (L-03) |
| Undo/undo-toast | ToastBus action support; skill + MCP pin/unpin carry real inverse actions (P2 item closed; no rename UI exists in-tree, so nothing else to undo — recorded) |
| Updater runbook | `docs/xr-rebuild/UPDATER-RUNBOOK.md` — exact provisioning order; signing material intentionally absent until operator step (P4 item closed as runbook, provisioning pending) |

## GA certification (this sandbox's scope)

Certified HERE, with the limits above publicly registered:
1. Full engine suite green (3,370 pass / 0 fail at time of commit).
2. Desktop build + size gate + brand gate (38 registered, 0 violations) green.
3. Perf budgets met with >10× headroom on engine hot paths.
4. a11y: no critical/serious axe violations across dark+light chrome.
5. Failure surfaces honest: engine-down, provider-offline, approval-fail all
   state themselves in plain language with a recovery path.

NOT certifiable here (owned elsewhere): per-OS packaged install/upgrade
matrix, Rust compile of Phase-4 native additions, mic-hardware voice loop.

## Rollback drill

Each phase landed as an isolated commit on `phase2/elite-workstation`;
rollback = `git revert <phase commit>` with no coupling:
- P2/P3 content: `f5a1c05`
- P4: `378c392` (+`6b9d876` dep)
- P5: this commit.
Drill executed logically (commits are self-contained; engine never imports
desktop code, desktop wraps engine APIs only) — the wrap-don't-rewrite
boundary is what makes per-phase revert safe.
