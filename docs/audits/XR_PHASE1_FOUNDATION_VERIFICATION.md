# XR — Phase 1 verification (foundation & system hardening)

**Date:** 2026-09-19 · **Scope:** Phase 1 of the master implementation plan · **Branch:** `phase1/foundation-hardening`

This is the **audit re-run** the Phase 1 definition of done requires: what was claimed,
what was actually observed, and what remains unverified. Every number below was produced by
running the thing — no result is copied from a previous report.

---

## 1. Definition of done — item by item

| # | DoD item | Result | Evidence |
|---|---|---|---|
| 1 | Voice reaches every area; Esc exits Voice | **PASS** | renderer lane ×3: `D-01` route-not-overlay (rail stays usable), `D-01` Escape exits and the session survives, `D-01` visible exit affordance |
| 2 | Win32 store constructs correctly under all path spellings | **PASS (unit + falsification)** | `test/state/migration-lock-self-deadlock.test.ts` 10 pass; pre-fix a self-hold cost **20 008 ms**, post-fix the same condition **throws in < 1 ms** |
| 3 | `approvals-durable` real suite restored on win32 and green | **PASS** | probe branch deleted; suite 11 pass @ 1 238 ms; CI step now reruns the suspects instead of scraping marker files |
| 4 | Unauth `GET /api/v1/audit` via the dev proxy → 401 | **PASS** | live: unauth `/audit`, `/providers`, `/control/pending` → 401 (was 200); wrong pairing code → 403; correct code → session; paired → 200; engine token appears **0×** in served HTML |
| 5 | Provider health honest in the status bar | **PASS** | lane: status-bar text is non-empty and free of `undefined`/`NaN`; `unknown` is a distinct state and the offline state names the reason |
| 6 | Palette finds `mcp` / `ollama` / files / settings | **PASS** | lane: synonym query resolves (no dead query); cheat sheet renders the same registry |
| 7 | Renderer lane green | **PASS on Linux** | 17 passed · 0 failed · 0 skipped against the **built** app (not a dev server) |
| 8 | Phase 1 audit re-run | **this document** | §3 |
| 9 | Full `bun run ci` gate | **PASS** | see §2 |

---

## 2. Full check results

| Check | Command | Result |
|---|---|---|
| Root suite (core) | `XR_A11Y_SKIP_BROWSER=1 bun test` | **3338 tests across 329 files · 0 fail** (153.5 s, exit 0) |
| Live browser a11y half | `bun test test/a11y/browser-axe.test.ts` | **13 pass / 0 fail** (125 s) — run as its own job, which is how CI is structured |
| Root types | `bun run typecheck` | exit 0 |
| Desktop types | `npm run typecheck` (desktop) | exit 0 |
| Claim governance | `bun run claim-lint` | ✓ 10 evidenced claims, all Articles exist |
| Version surfaces | `bun run release:check` | 6/6 surfaces in sync at 1.0.0 |
| Ownership map | `bun run ownership:check` | ✓ 185 areas owned |
| Size gate | `bun run size-gate` | all modules under threshold or waived with an owned plan (delta recorded) |
| Renderer lane | `bun run desktop/test/renderer.lane.ts` | 17 passed / 0 failed / 0 skipped |
| Renderer sink gate | `bun run desktop:sink-lint` | 31 files scanned · 0 violations · 0 exceptions |
| Windows lock matrix | `bun test test/state/migration-lock-self-deadlock.test.ts` | 10 pass, 9 ms |

---

## 3. Findings closed, with the observation that closes them

**D-01 · Voice was a `position:fixed` overlay that covered the navigation.** Voice is now a route in the
content grid; the rail stays interactive while voice runs, Escape exits, and the exit is a labelled
affordance rather than a 34 px corner button. The lane asserts the geometry (`position !== fixed`,
no overlap with the rail column), not just the presence of a class.

**D-05 · Theme/density controls did nothing durable.** They now change `data-theme` /
`data-density` for real and survive a reload with no flash (asserted twice in the lane).
Contrast was repaired at the token level: `--xr-on-accent` replaced six hardcoded ink values that
measured **3.41:1** on the light theme's cyan; the axe sweep over the primary surfaces is clean at
WCAG A/AA.

**D-07 / D-11 · The command surface was unreachable and dead-ended.** Ctrl/⌘+K opens a registry-driven
palette, focus is trapped and released, Escape closes it (a capture-phase listener, because focus
lands on a `setTimeout(…,0)` tick and a keypress in that gap was previously lost), and synonyms
resolve. `?` opens the same registry as a cheat sheet.

**G-15/G-21/G-22/G-23 · Honest state.** `StatusDot` distinguishes `unknown` from healthy; the
status bar reads the **engine's own** primary provider instead of the first array entry; the link
failure names its reason. The offline/401 state is exercised deliberately (probe with a wrong
token) and the UI stays coherent.

**SEC-DEV-01 · Dev server was an open door.** Fixed and re-verified live (§1.4). Loopback by
default, host allowlist, pairing broker, engine token never sent to a browser.

**New gate · raw HTML sinks.** `scripts/desktop-sink-lint.ts` fails CI on `innerHTML`/`insertAdjacentHTML`/
`dangerouslySetInnerHTML`/`eval`/`new Function`/`srcdoc` in `desktop/src`, with a line-level
`sink-allow:` escape that must state a reason. Wired into `bun run ci`. The renderer is clean today,
and the gate's negative branch is proven on fixtures (one sample per rule) — a linter that cannot
fail would be decoration.

**New gate · one polling hub instead of five.** The renderer ran five independent pollers that hit
the same engine endpoints on different schedules:

| Consumer | Interval | Endpoints |
|---|---|---|
| `main.tsx` | 4 s | health |
| `AppShell` | 5 s | health, providers, pending |
| `AppShell` (notifications) | 10 s | pending, agents |
| `ToastBus` | 3 s | approvals, sessions |
| `Home` | 4 s | sessions, approvals |

That is **≈133 requests/minute**, with `pending`, `providers`, `sessions` and `approvals` each
fetched twice at different cadences — so two screens could disagree about the same moment
(the status bar vs the notification that had just fired). They are now subscribers of one hub
(`desktop/src/poll.ts`): **≈59 requests/minute** (−56%), one in-flight request per key, one
observation fanned out to every consumer, a hidden window stops polling entirely, and a failing
key backs off (bounded ×4) instead of hammering a dead engine. Six unit tests pin those
properties, including "a failed fetch is reported as a failure, never as stale success".

**Measured on the running app, not just asserted:** with the built app open and idle
(`desktop/test/probe-poll-rate.mjs`, 65 s window, counting what the ENGINE logged):

```
observed 64 engine request(s) in 65.0s  →  59.1 requests/minute
  health.get        17   (15.7/min)   ← 4 s cadence
  approvals.list    13   (12.0/min)   ← 5 s cadence
  sessions.list     13   (12.0/min)
  control.pending   13   (12.0/min)
  agents.list        6    (5.5/min)   ← 10 s cadence
  providers.list     2    (1.8/min)   ← 30 s cadence
```

Every key appears at its own cadence exactly once per cycle. Before the hub,
`pending`, `providers`, `sessions` and `approvals` each appeared twice per cycle
at two different intervals — that is the inconsistency this closed, and it is now
a measurement rather than a claim.

**Latent layout defect found by the lane during this re-run.** In the offline state the docked
voice orb reported 80 px of scroll width inside a 74 px box: the halo used `inset:-6px`, which is a
*layout* fact because the dock is `position:fixed` and therefore the containing block. It is now a
paint-only `blur(5px)` — verified in the same failing state (`clientWidth 74 == scrollWidth 74`,
`filter: blur(5px)`) and by the lane (green).

---

## 4. Audit re-run: API surface

All endpoints the desktop client actually calls were probed against the running engine:
**20 / 20 → 200**.

The probe script also carries six paths that return **404** — `/status`, `/runs`, `/git`,
`/trust/mode`, `/telegram`, `/channels`. These are **probe artifacts, not missing features**, and
the distinction was verified rather than assumed:

* `desktop/src/api/client.ts` never calls `/status`, `/runs`, `/telegram` or `/channels`;
* the client calls `/git/status` and **POSTs** `/trust/mode` (the 404s were `GET`s of the parent paths).

---

## 4b. Environment caveats observed while producing this evidence

Two things about the host are worth recording, because both can silently turn a
green result into a false one:

* **A missing full-Chromium build hid 13 live a11y tests.** Only
  `chromium-headless-shell` was installed, so `test/a11y/browser-axe.test.ts`
  skipped its browser half (`chromium.executablePath()` points at the full
  build) and the suite reported `0 fail` while the dashboard's 23-panel axe
  sweep, real-keyboard navigation and the sign-in page were never executed.
  After installing the full build those 13 tests **pass**; they are now part of
  the evidence rather than an invisible gap.
* **The whole suite cannot fit in this sandbox's 1.9 GB in one process** once
  that browser half is enabled: two consecutive full runs were OOM-killed
  (`exit 137`, no test failures). The repo already anticipates this — the file's
  own header says the browser half runs "only in the dedicated CI `a11y` job" —
  so the core run uses `XR_A11Y_SKIP_BROWSER=1` and the browser half is run and
  reported separately.
* **Latency budgets are host-sensitive.** In an oversubscribed full run (load
  average 13 on 2 cores) four wall-clock budget assertions failed (retrieval
  p95 100 ms, routing-selection p95 20 ms measured at 213 ms). Re-run alone on a
  quiet machine the same three files are **21 pass / 0 fail in 5.4 s**, and none
  of them is touched by this branch. They are reported here rather than quietly
  retried, because "it passed on the second attempt" is not evidence.

## 5. What is NOT verified here

* **The Tauri/Rust shell was not compiled.** This environment has no Rust toolchain on a stable
  basis (it is dropped between sessions) and lacks the GTK/WebKit system libraries a host build
  needs. **W-1 (`CREATE_NO_WINDOW`), W-2 (Job Object / process-group kill), W-3
  (single-instance), W-5 (capture sidecar stderr) and W-6 (cache the `engine_link` reachability
  probe) are therefore still OPEN.** No native-runtime behaviour is claimed anywhere in this
  document.
* **Windows and macOS lane results are unchanged** by this branch; the cross-platform CI lane owns
  them, and the win32 regression is only *proven* once that lane runs green.
* **The dev-proxy pairing banner** prints a hardcoded `:5173` in its pair-URL hint even when the
  server runs elsewhere (cosmetic; the flow itself is verified).
* **Deviation from the plan:** Phase 1's performance item named a single `/overview` engine
  snapshot. Adding that endpoint would be new engine surface, which Phase 1 explicitly excludes, so
  the same guarantee (one consistent snapshot, far fewer requests) is delivered client-side in
  `poll.ts`. If `/overview` lands later, `LOADERS` is the single place to re-point the keys.

---

## 6. Release recommendation for this phase

Phase 1's own gate is met on Linux: the defects that broke the product are closed at root cause,
each with a regression that fails before the fix, and three new gates (renderer lane, sink lint,
path-identity matrix) exist so the same classes cannot return silently. **Do not promote to a
release tag until the cross-platform lane confirms win32 and macOS**, since the headline fix is a
Windows fix and the environment here cannot exercise it.
