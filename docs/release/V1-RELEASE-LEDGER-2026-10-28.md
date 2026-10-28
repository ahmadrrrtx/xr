# XR V1 Release Stabilization Ledger — 2026-10-28

> **What this document is.** The single anti-drift control for the Version 1
> release-readiness pass. Every phase, decision, defect and verification result
> for this pass is recorded here (or in a file this ledger links). Work that is
> not in this ledger did not happen; work recorded here without evidence did
> not pass. It follows the repo's status vocabulary and closure policy
> (§9) and the constitution's evidence rule (AGENTS.md rule 1).
>
> **How to use it.** Before starting any task: find its phase gate (§4) and
> scope fence (§2). After any task: update the defect ledger (§5), the
> verification log (§7) and the phase status. If a task is blocked, record the
> exact blocker — never convert a blocked check into a pass.

## 1. Session identity and authority

| Field | Value |
|---|---|
| Date opened | 2026-10-28 (Asia/Karachi) |
| Repository | `https://github.com/ahmadrrrtx/xr` (local clone `/home/user/xr`) |
| Baseline HEAD | `d04011eca88934f9a75b1f8e5eaf8c58c4393800` — `main`, merge of PR #200 (`work/npm-coding-agent-readiness`) |
| Working branch | `work/v1-release-stabilization-2026-10-28` (created from clean `main`; no uncommitted user work existed at branch time — verified `git status --porcelain` empty) |
| Release identity in tree | `1.1.1-rc.1` / codename `Graphite` / `developer-preview`; public channel authority `1.0.0` (`release.manifest.json`) |
| Mandate | Version 1 release readiness: preserve all desktop features, fix real defects, honest verification. Full brief: mission statement in §2. |
| Authorization boundary | Local branch + local commits only. **No push, no tag, no release, no package publish, no channel promotion** without explicit owner authorization (repo rule + brief Phase 8). |

## 2. Mission and scope fences (drift guards)

**Mission:** make the existing XR Desktop application, its existing mobile
companion, connectors and supporting integrations reliable and installable for
Version 1. Preserve all current desktop features. No redesign, no new
features unrelated to release readiness.

| Surface | Fence | Anti-patterns this ledger exists to prevent |
|---|---|---|
| DESKTOP | Primary release surface. Preserve **every** existing screen, window, route, workflow, command, provider/connector/MCP capability, permission, settings page. 16 screens + 4 windows are enumerated in the preservation matrix (§6). | Deleting/hiding screens or flows to make release easier; treating mocked renders as OS proof. |
| CLI / shared engine | **Frozen** for feature work. Keep the implementation — the desktop sidecar, agent loop, daemon, tools, providers, security controls all depend on it. | "Cleanup" that breaks the sidecar; CLI feature creep delaying desktop. |
| MOBILE | Audit, research, **fix defects**. It is a PWA — keep it a PWA. Keep pairing, session restrictions, fail-closed auth. | Native-app rewrite; weakening the mobile-session prohibition on file/terminal/Git/MCP endpoints. |
| CLOUD | **Frozen.** Touch only if a verified dependency is necessary for desktop/mobile release. | Migrations, deployment changes, unrelated cleanup. |
| CONNECTORS | Inventory and preserve **all** — even hard-to-configure or test-missing ones. | Removing a connector because its integration test is missing. |

Hard rules carried from AGENTS.md and the brief (all CI-enforced, none may be
waived in this pass):

1. Claims need evidence; never hand-edit stamped surfaces (run `bun run release:stamp`).
2. Never weaken a security property or silence a failing test; approvals, policy, budget, audit are fail-closed.
3. One computation authority — all surfaces use the same engine; no per-surface forks.
4. Layering pinned (`bun run boundaries`).
5. No destructive git operations; no hard resets, no force, no retagging.
6. Every fix ships a regression test; one reviewable conventional commit per issue.
7. Root causes over masks: no error swallowing, no fake-success fallbacks, no broad CSS overrides.

## 3. Environment capability register (what "verified" can mean here)

Observed sandbox: Linux 6.x x64, 2 CPUs, ~1.98 GiB RAM (no swap), ~20 GB free
disk, Debian-ish with passwordless `sudo` + `apt`. Node 20.20.2, npm 10.8.2,
Python 3.13. Bun **1.4.4** installed to `~/.bun` (repo pins 1.4.2 in
`.bun-version`; install with frozen lockfile succeeded — deviation noted, same
1.4 line). Rust/cargo **not yet installed** (assessed below).

| Capability | Status | Consequence for evidence claims |
|---|---|---|
| Linux x64 source tests, typecheck, renderer build | AVAILABLE | Can be claimed PASS/FAIL with logs |
| Segmented `bun test` (low memory) | AVAILABLE | Full suite must be run in segments; segment list recorded |
| Desktop renderer build (`cd desktop && bun run build`) | AVAILABLE | Build ≠ native GUI proof |
| Tauri Rust shell `cargo check` | FEASIBLE-ATTEMPT | GTK3/WebKit2GTK4.1 dev packages absent but installable via sudo apt; RAM-bound, single job. Attempt in Phase 4; if it fails, record BLOCKED with exact error. |
| Linux native packaging (AppImage/.deb build) | FEASIBLE-ATTEMPT | Requires full Rust + system deps; bounded by RAM |
| Windows x64 builds/install | NOT AVAILABLE (no Windows) | BLOCKED — native CI runners only; never claim from cross-compile |
| macOS builds, notarization | NOT AVAILABLE | BLOCKED — owner action |
| Code signing (Apple/Windows certs), updater keys | NOT AVAILABLE (owner secrets) | BLOCKED — owner action with exact steps |
| Live provider APIs (paid keys) | NOT AVAILABLE | Deterministic fixtures only; live canaries NOT RUN |
| Real mobile devices (Android/iOS browsers) | NOT AVAILABLE | Browser-automation + PWA build checks only; device matrix BLOCKED |
| Real display server (GUI screenshots of native app) | NOT AVAILABLE | Renderer-level screenshot verification in existing browser test env, honestly labeled |

Status vocabulary (matches repo convention): **PASS** (executed, exit 0,
logged) · **FAIL** (executed, defect found) · **BLOCKED** (environment/owner
prerequisite missing — record exact prerequisite) · **NOT RUN** (deliberately
deferred, with reason) · **N/A**.

## 4. Phase gates

Each phase has entry criteria, a checklist, and exit criteria. Status column
uses §3 vocabulary. Nothing moves to a later phase's "COMPLETE" until its exit
criteria are met or its residue is recorded in §5 with dispositions.

### Phase 0 — Safe baseline  ·  **IN PROGRESS (opened 2026-10-28)**

- [x] Read AGENTS.md, README, package manifests, `release.manifest.json` (done — key facts in §1)
- [x] Read prior evidence: `docs/release/RELEASE_CANDIDATE_REPORT.md`, `RELEASE_CANDIDATE_NOTES.md`, `IMPLEMENTATION_PLAN.md`, `PROGRESS.md`, `docs/launch/XR_LAUNCH_FINDINGS.md`, `docs/release/DESKTOP-SUPPORT-MATRIX.md`, `docs/mobile/PWA.md` + `SECURITY.md` (heads; deep-read per phase as needed)
- [x] Real git state: `main` @ `d04011ec`, clean tree, no uncommitted user work; work branch created before any edit
- [x] Toolchain: bun installed, `bun install --frozen-lockfile` (root) PASS — 82 pkgs, 0.75s
- [ ] Root dependency install evidence re-verified for desktop + mobile
- [ ] Baseline gate battery at HEAD executed and logged (§7) — release:check, channel:check, claim-lint, placeholder-lint, boundaries, typecheck, unit-tier
- [ ] Prior-audit-vs-HEAD delta reviewed: RC report described **uncommitted** work on `audit/release-candidate-2026-10-26`; that branch merged via PR #199, then PR #200 landed. Which RC changes actually reached `main`, and did anything regress in the merge? (Evidence: git diff of merge commits; gates at HEAD.)
- [ ] This ledger written, committed, linked from release docs index

**Exit:** ledger committed; baseline gates logged with honest statuses; HEAD
delta vs prior audits understood.

### Phase 1 — Complete feature inventory  ·  **PENDING**

Deliverable: canonical feature-coverage matrix (§6 pointer) covering every
desktop screen/window/route/workflow, connector/provider/MCP/skill, mobile
feature set, platform behaviors, shared engine deps — each with location,
intended behavior, dependencies, status (implemented / tested / verified-on-real-OS /
unverified / not-implemented), coverage and blockers.

- [ ] Desktop: 16 screens (Onboarding, Chat, Brain, Workspaces, WorkspaceLanding, Builder, Research, Agents, SkillsStore, Shield, Runs, Memory, Budget, Integrations, Voice, Settings) + 4 windows (main, HUD, Orb, Theater) + tray/shortcuts/updater/crash-recovery — traced to source, matrix filled
- [ ] Connectors/providers/MCP/plugins/skills inventory (from `src/`, `extensions/`, `plugins/`, `skills/`, capabilities/)
- [ ] Mobile feature set (pairing, sessions, approvals, notifications, offline, reconnect, a11y, restrictions)
- [ ] Windows/Linux platform behaviors + package assets
- [ ] Shared engine/daemon/runtime dependency map; single-execution-authority confirmation

**Exit:** matrix file exists with a row per feature, no "assumed" rows, statuses
distinguished from test evidence.

### Phase 2 — Fix the real defects  ·  **PENDING (opens as Phase 0/1 evidence lands)**

Prioritized: launch-blocking correctness, security regressions, startup, broken
desktop flows, connector failures, installer defects, missing platform wiring,
persistence/upgrade. Each fix: root cause, regression test, small commit.

**Exit:** every ledger defect has disposition fixed / not-reproducible /
retained-with-rationale / blocked; regression tests green.

### Phase 3 — Desktop quality  ·  **PENDING**
First-run journey (fresh install → config → engine/sidecar start → successful
agent task) as far as this environment honestly allows; providers, key
management, approvals (allow+deny), cancellation, budget exhaustion,
persistence-across-restart, provider errors, recovery. Renderer-level evidence
labeled as such.

### Phase 3.5 — UI/UX bug bash and visual polish  ·  **PENDING**
Inspect `previews/` assets; audit **all** screens (not just Research/Builder);
sidebars expanded/collapsed/narrow/reopened; typography/design-token
consistency; before/after screenshots at 1440×900, 1280×800, 1024×768, light/dark,
empty/populated/loading/error, long content. Defect ledger §5 with dispositions.
No redesign, no new framework, no decorative additions; reuse tokens.

### Phase 4 — Windows/Linux packaging  ·  **PENDING (Linux portion feasible-attempt; Windows BLOCKED → native CI)**
Repeatable CI-driven builds; Tauri packaging retained; Windows NSIS/MSI via
native runners (BLOCKED locally); Linux AppImage + .deb attempt locally;
sidecar bundling verified; artifact manifest + hashes. A normal end user must
not need Bun/Node/Rust/source.

### Phase 5 — Mobile audit and repair  ·  **PENDING**
Actual mobile source/deps/scripts/network contracts; official-doc research
recorded; pairing/expiry/QR/TLS-fingerprint/authn/logout/reconnect; approvals +
daemon-confirmed success only; offline queue/retry; Android/iOS browser layout,
installability, keyboard, safe areas; tokens-not-in-localStorage; mobile-session
endpoint prohibitions; `npm --prefix mobile run build/typecheck` + existing
`mobile:test:*` tools. No hosted-service/telemetry additions.

### Phase 6 — Connector and cross-surface regression  ·  **PENDING**
Deterministic fixtures for supported providers/integrations; authn failures,
malformed responses, rate limits, retries, timeouts, cancellation;
desktop/mobile same-contract confirmation; capability docs match behavior;
tested vs unverified providers distinguished.

### Phase 7 — Tests and release gates  ·  **PENDING**
Run the AGENTS.md battery to the extent the environment allows (§7 command
list); fix regressions; record exact limitations. No gate-loosening, no
silent skips.

### Phase 8 — Version 1 release verification  ·  **PENDING (publication is owner-only)**
Manifest/workflow authority; artifact metadata/triples/checksums/SBOM;
installability from candidate artifacts; updater across two versions (BLOCKED
until owner provisions keys — never enable unprovisioned); signing/provenance
gates = owner steps documented; final release checklist + honest verdict.

## 5. Defect ledger (living)

Severity: **P0** launch-blocker · **P1** release-quality · **P2** polish.
Disposition: FIXED(+commit) / NOT-REPRODUCED / RETAINED(rationale) / BLOCKED(owner/env).

| ID | Date | Phase | Area | Severity | Finding + evidence | Disposition |
|---|---|---|---|---|---|---|
| — | — | — | — | — | *(none recorded at HEAD yet — Phase 0 baseline running)* | — |

### Carried-in items from prior audits — must be re-verified at HEAD before reuse

Prior registers (`docs/launch/XR_LAUNCH_FINDINGS.md` L-001…L-016;
`docs/release/IMPLEMENTATION_PLAN.md` RC-101…RC-603) describe **older trees**.
Per the brief, older audits are not proof of the current state. Re-verification
happens per phase; until then they are *leads, not findings*.

## 6. Feature-coverage and preservation matrix (Phase 1 artifact)

Target file: [`V1-FEATURE-MATRIX-2026-10-28.md`](V1-FEATURE-MATRIX-2026-10-28.md)
(same directory). Bootstrap evidence already captured in this session:

- **Desktop routes** (from `desktop/src/router.tsx`, hash router):
  `/onboarding`; `/chat/:sessionId?`; `/brain/:runId?`; `/workspaces`;
  `/workspaces/:id`; `/builder/:workspaceId?`; `/research`; `/agents`;
  `/skills`; `/shield`; `/runs`; `/memory`; `/budget`; `/integrations`;
  `/voice`; `/settings`; catch-all → `/chat`. Dev-only `/__brand` gallery
  (stripped from production builds).
- **Desktop windows**: main shell (`desktop/src/App.tsx`), HUD
  (`hud/App.tsx`), Orb (`orb/App.tsx`), Theater (`theater/App.tsx`).
- **Version surfaces stamped**: package.json, version.ts, site.ts, README,
  install.sh, install.ps1, tauri.conf.json, Cargo.toml (10 targets per RC report).

## 7. Verification log (living)

| # | Date (UTC) | Command | Exit | Result / note |
|---|---|---|---|---|
| 1 | 2026-10-28 | `git clone https://github.com/ahmadrrrtx/xr.git` | 0 | HEAD `d04011ec`, `main`, clean |
| 2 | 2026-10-28 | `bun install --frozen-lockfile` (root) | 0 | 82 packages, 753 ms |

## 8. Decision log (living)

| # | Date | Decision | Rationale |
|---|---|---|---|
| D-1 | 2026-10-28 | Work on local branch `work/v1-release-stabilization-2026-10-28`, never on `main` | Brief forbids destructive ops and unauthorized pushes; keeps baseline reproducible |
| D-2 | 2026-10-28 | Keep Bun 1.4.4 despite `.bun-version` 1.4.2 | Same 1.4 line; frozen-lockfile install green; swap to 1.4.2 only if a gate is version-sensitive |
| D-3 | 2026-10-28 | Attempt GTK/WebKit dev install + `cargo check` in Phase 4, single job, only after lighter gates are green | Prior pass deemed it heavy for 2 GiB; sudo apt is available so attempt is legitimate, but it must not crowd out cheap evidence first |

## 9. Closure policy and drift controls

- A phase is **COMPLETE** only when its exit criteria hold with executed,
  logged evidence. "Implemented" ≠ "verified".
- **BLOCKED** items record: exact missing prerequisite, why it matters, exact
  owner/infrastructure steps to resolve. They are never reported as passes.
- Any scope addition beyond §2 fences requires a dated decision-log entry
  justifying release relevance — otherwise it is drift and must be reverted.
- This ledger is updated in the same commit as the work it records (or the
  immediately following evidence commit), with UTC timestamps.
- The final V1 verdict in Phase 8 restates every BLOCKED/NOT-RUN item; a
  generated binary alone is not acceptance.
