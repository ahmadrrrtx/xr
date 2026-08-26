# Phase 12 — Implementation Matrix (Phase A/B deliverable)

**Date:** 2026-08-26
**Repository state inspected:** `main` @ `cc37607` (787 commits) — cloned fresh, not assumed.
**Baseline runner:** Bun **1.3.14** (the version pinned in `.bun-version`).

This matrix was produced **before** any modification, per the Phase 12 absolute
rule. Its central finding is that the audit documents supplied with the brief
were written against `9680298` (755 commits) and are **stale**: 32 commits
covering Phases 01 and 03–11 landed afterwards and remediated most of the P0
findings those documents describe.

---

## 1. Stale-audit reconciliation (verified, not assumed)

| Audit claim (doc 01/14, @9680298) | State at `cc37607` | Evidence |
|---|---|---|
| `detectAllRuntimes` sequential → 25s | **FIXED** (Phase 01) — fingerprint-keyed cache | `src/local/runtimes.ts` `detectAllRuntimes` → `runtimeCache.getOrStart` |
| `providers.list` unbounded 120s health + N+1 catalog | **FIXED** (Phase 04) — `providerGateway.healthAll`, bounded/cached, no per-row rebuild | `src/daemon/routes/providers.routes.ts:34-56` |
| Chat non-streaming `fullText` once, 16.5s TTFT | **FIXED** (Phase 05) — real token deltas via canonical sink | `src/daemon/routes/chat.routes.ts:158-193`; route header documents the change |
| `skills.api` / `plugins.api` 404 v1 mismatch | **FIXED** (Phase 02) | canonical v1 mount; 3401 tests pass incl. dashboard route contract |
| Workspace switch bypasses lifecycle | **FIXED** (Phase 03) — chat route is an HTTP adapter over `AgentService` | `src/daemon/routes/chat.routes.ts:1-22` header |
| Dashboard first paint blocked by 7 heavy endpoints | **FIXED** (Phase 01) — two-stage `loadDashboard` | `src/daemon/dashboard/client-core.ts:133-210` |
| Design tokens duplicated CLI vs dashboard | **ALREADY UNIFIED** — CSS vars interpolate `COLOR.*` from `src/ui/tokens.ts` | `src/daemon/dashboard/style-tokens.ts` |
| CLI fast paths slow / heavy imports | **NOT A PROBLEM** — measured 34–42ms `--version`, 35–38ms `--help` | this session, warm runs |
| No command palette | **EXISTS** on both surfaces | `src/interfaces/shell/app.ts:853`; `client-panels-c.ts:629` |
| No Esc interrupt | **EXISTS**, truthful ("at the next checkpoint") | `src/interfaces/shell/app.ts:825-848` |

**Conclusion:** re-fixing these would have been wasted work and would have
violated "do not rewrite working systems unnecessarily."

---

## 2. The real, verified gap

`grep -c "tool_call\|tool_result" src/daemon/dashboard/client-chat.ts` → **0**

The three surfaces do not share one state model. For a single run:

| Surface | Mechanism | Verdict |
|---|---|---|
| Core loop | Canonical `ChatStreamEvent` sink (`status`/`token`/`tool_call`/`tool_result`/`usage`/`done`/`error`) — declared in the OpenAPI contract at `src/daemon/routes/schemas.ts:277` | Source of truth ✓ |
| Dashboard chat | Consumes `token`/`done`/`error`; **silently drops `tool_call`, `tool_result`, `usage`**; renders one **fabricated** card `addToolEvent('AI chat prompt','Call provider hot-path routing','running','Streaming...')` → `'done','Completed execution'` | **Fakes progress** — violates brief §7 and §10 |
| TUI Shell | **Ignores `onStreamEvent` entirely** (0 references); parses ANSI `say()` lines by heuristic (`includes("◆")`) and hardcodes its own vocabulary (`busyLabel`: `"connecting to X"`, `"planning"`, `"reading"`, `"thinking"`) | **Duplicate state** — violates brief §2, §31 |

Supporting gaps:

* `ChatStreamEvent.status` is typed bare `string` (`src/core/types.ts:191`) and
  `z.string()` in the OpenAPI schema — an **unconstrained vocabulary**. Only
  three values are ever emitted in practice: `provider_selection`
  (`chat.routes.ts:143`), `provider_ready` (`agent.ts:596`), `cancelled`
  (`chat.routes.ts:238`). Brief §7's truthful states do not exist as a contract.
* A good execution-state vocabulary **already exists** and is unused by the
  interactive surfaces: `STATE_LABEL` / `OUTCOME_LABEL` / `STATE_COLOR` /
  `RECOVERY_STATE_LABEL` in `src/execution/inspection.ts`. Reused, not
  duplicated.
* `docs/ux/XR_UX_ARCHITECTURE.md` and `docs/ux/SURFACE_PARITY.md` **do not
  exist** (verified by `ls`).

---

## 3. Matrix

| # | Requirement (brief §) | Current implementation | Reusable infra | Gap | Required change | Files | Tests | Regression risk |
|---|---|---|---|---|---|---|---|---|
| 1 | Shared status vocabulary (C, §4/§7) | `status: string`; 3 ad-hoc values; TUI hardcodes its own | `src/execution/inspection.ts` label maps; `src/ui/tokens.ts` `StatusKind` | No canonical run-status contract | New kernel module `src/core/ux-status.ts`: ids, labels, tones; zero imports | `src/core/ux-status.ts` (new) | vocabulary completeness + tone map | Low (additive) |
| 2 | Emit truthful states from the loop (§7) | `say()` only; one status event | `deps.onStreamEvent` sink already threaded to runner + route | Loop never emits generating/tool/compact/budget states | Emit canonical statuses at **verified** points only | `src/core/agent.ts` | event-sequence test | Med — touches hot loop; additive sink calls |
| 3 | Chat tool transparency (§10) | Fabricated single card | `addToolEvent`/`updateToolEvent` already build accessible collapsible cards | Real `tool_call`/`tool_result` dropped | Render real tool cards keyed by event `id`; delete the fabricated card | `client-chat.ts` | static gate: `tool_call` handled; fabricated string gone | Med — must preserve `tool-head` a11y substring pinned by `test/a11y/static.test.ts:104` |
| 4 | Chat truthful status line (§7) | Statuses other than 2 dropped | `announceStream` polite live region | No status line | Drive one status line from the shared vocabulary | `client-chat.ts`, `client-core.ts` (vocabulary interpolation) | vocabulary present in served script | Low |
| 5 | TUI consumes canonical state (§16) | Hardcoded `busyLabel` | Shell `state.busyLabel`, `addTimeline` | TUI invents vocabulary | Feed `busyLabel` from `onStreamEvent` statuses via shared labels | `shell/app.ts`, `shell/types.ts` | label-parity test | Med — TUI hot path |
| 6 | Docs (§41) | Absent | rich `docs/ux/01–12` corpus | No architecture/parity doc | Author both docs from verified code | `docs/ux/*.md` (new) | n/a | None |
| 7 | Cross-surface state consistency (§31) | Chat header read `chatState.provider/model/workspace` from `localStorage` with fake defaults `"Auto"`/`"Auto"`/`"Default"`; `approval`/`budget` were dead fakes; `mode` cycled a non-existent `Research` value and was never sent | `/api/providers` → `primary`/`model`; `/api/overview` → `project`; `ChatBody.mode` already accepted | Header could contradict the CLI/Shell; the mode control was a no-op | Hydrate from the daemon, validate mode against `Mode`, send it, drop dead fakes, render unknown as `detecting…` | `client-chat.ts` | 4 static gates | Low — no markup change, so the HTML SHA pin holds |
| 8 | Performance verification (§37/§40) | Harnesses exist but unmeasured this cycle | `scripts/perf/dashboard-bench.ts`, `scripts/perf-daemon-routes.ts` | No numbers | Run both; record p50/p95/max | n/a (docs) | n/a | None |

**Explicitly out of scope this pass** (would require inventing unsupported
functionality, which the brief forbids): `@file/@folder/@session` mentions
(no backend mention resolver exists), research/source **stream** events (no
such event type is emitted by the loop), `retrying`/`provider_switching`
statuses (`executeWithFallback` in `src/providers/gateway.ts:316` is not on the
loop's streaming path), diff-staged per-hunk approval.

---

## 4. Constraints that shaped the design (all verified)

* **Layering** — `kernel-stays-kernel` (`.dependency-cruiser.cjs:99`) forbids
  `src/core/*` from importing runtime/surface layers. The new module therefore
  has **zero imports** and lives in the kernel, which every surface may import.
* **Dashboard client is a string** — `client-*.ts` export template literals
  concatenated into one served `/assets/dashboard.js`
  (`client-script.ts:17`). It cannot `import`. The vocabulary is therefore
  **interpolated** into it, following the existing `style-tokens.ts` pattern.
* **HTML SHA-256 pin** — `test/daemon/dashboard-split.test.ts` pins
  `dashboardHtml()`. Verified `dashboardHtml` renders markup only; the script is
  an external asset (`src/daemon/dashboard.ts:31-38,61-63`), so client-script
  edits do **not** invalidate the pin. Markup files were left untouched.
* **Emoji gate** — `test/daemon/honesty.test.ts` bans U+2600–27BF except
  ⚠ ✓ ✕. Only those three plus geometric shapes are used.
* **API call-site gate** — `test/api/dashboard-routes.test.ts` validates every
  `api("…")` literal against real routes. **No new endpoints were added.**
* **Parse gate** — `test/daemon/phase-c.test.ts` syntax-checks the served
  script.

---

## 5. Baseline recorded before any change

| Check | Result (Bun 1.3.14, pinned) |
|---|---|
| `bun run typecheck` | **pass** |
| `bun run boundaries` | **pass** — 0 violations, 608 modules / 1995 deps |
| `bun test` | **3401 pass / 19 skip / 13 fail** |
| `--version` / `--help` | 34–42ms / 35–38ms |

The 13 failures are **pre-existing and not caused by Phase 12**: all are in
`test/security/egress-proxy.test.ts`, and that file passes **16/16 in
isolation** on the same runtime. They are order/environment-dependent (DNS
behaviour under a 293-file parallel run). Recorded so the post-change run can be
compared like-for-like.

> Note on tooling: an initial run under Bun **1.4.0** produced the same 13
> failures plus a genuine assertion mismatch
> (`expected "timed out"`, got `"connection error: socket hang up"`). Switching
> to the pinned **1.3.14** made the isolated file fully green, confirming a
> runtime-version artefact rather than a code defect. All measurements in this
> phase use 1.3.14.
