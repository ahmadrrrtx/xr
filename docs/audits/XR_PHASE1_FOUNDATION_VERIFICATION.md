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
| 2 | Win32 store constructs correctly under all path spellings | **PASS (unit + falsification)** | `test/state/migration-lock-self-deadlock.test.ts` 11 pass; pre-fix a self-hold cost **20 008 ms**, post-fix the same condition **throws in < 1 ms**. Honesty note: this deadlock was real, but it was **not** the cause of the win32 hang (row 3). |
| 3 | `approvals-durable` real suite restored on win32 and green | **CORRECTED 2026-09-19 — see §5b** | The earlier "PASS" here was a Linux run of the file; the Windows parity lane had been cancelled by every subsequent push and never confirmed it. When it finally ran (run 35464595934) the file still died at exit 124 with zero output. The Windows lab (run 35467925776) then named the true mechanism — an approval wait whose only wake-ups were unref'd timers, which Bun on win32 never services once nothing ref'd remains — fixed in `src/control/approval-store.ts`. Proof is the Windows parity lane on the fix commit (§5b). |
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

**Before/after, measured on the running app** (`PROBE_TOUR=runs`, 40 s window, same probe, the
previous commit checked out for the "before"):

| Sitting on **Runs** | requests/min | `sessions` | `agents` |
|---|---|---|---|
| before — Runs owned its own 5 s poller | **82.5** | 24/min | 18/min |
| after — Runs is a hub subscriber | **58.5** | 12/min | 6/min |

−29% total, the duplicated endpoints halve, and sitting on Runs now costs **zero** extra requests
over idling on Home — which is the property that matters: a screen no longer re-fetches what the
hub already owns.

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

## 5. Runtime verification status (updated 2026-09-19 on `phase1/foundation-hardening`)

The paragraph this section replaced said: *"W-1, W-2, W-3, W-5 and W-6 are IMPLEMENTED and
COMPILE-VERIFIED, but NOT RUNTIME-VERIFIED."* That was true when written. It is no longer the
state of the branch, and the evidence now lives in CI jobs rather than in this container:

| Item | Implemented | Runtime evidence (job · result) |
|---|---|---|
| W-1 `CREATE_NO_WINDOW` | sidecar spawn sets the flag (cfg(windows)) | `Desktop App · Rust shell — cargo test on Windows (W-1/W-2 runtime proof)` builds and runs the shell crate's tests on `windows-latest`; the Windows sidecar smoke (compile + boot + `/api/v1/health`) passes in the same workflow. No console-flash assertion exists yet (needs a desktop session on the runner) — **flag proven, flash absence not**. |
| W-2 Job Object kill-on-close | `win.rs` creates the job, arms `KILL_ON_JOB_CLOSE`, assigns the child; handle closed on Exit | `win::tests::w2_closing_the_last_job_handle_kills_the_assigned_child` (child dies when the handle closes) and `w2_control_an_unassigned_child_is_untouched_by_a_job_closing` (control) — **pass on `windows-latest`** (13/13, two consecutive runs). |
| W-3 single instance | `tauri-plugin-single-instance` registered first; a second launch hands its argv to the running shell, which unminimizes/shows/focuses `main`, and the second process exits. The hand-written named-mutex guard (which could only exit silently) and its `w3_*` tests were retired with it. | Compile-verified for Windows/Linux/macOS by the three `tauri bundle` jobs. The focus hand-off itself is **not** runtime-tested (needs an interactive desktop session on the runner). |
| W-5 sidecar stderr captured | stderr piped into a bounded tail, returned with the link status and shown by the S0 boot splash (`.boot[data-state="failed"]`) | `engine_state.rs` tests (tail cap, banner parsing) pass on Linux and Windows; the boot splash binds to `engineLinkSnapshot().stderr` (desktop/test/boot tests). |
| W-6 cached reachability probe | 1.5 s TTL cache in front of the blocking connect | TTL expiry, per-port isolation and clock-skew cases under test; pass on Linux and Windows. |
| Windows installers | NSIS per-user (`installMode: currentUser`) **and** MSI both built; the release job asserts both flavours exist | `Desktop App · Windows — tauri bundle` **success** at `2f5d380` with the msi+nsis assertion. |
| SEC-12 engine never outlives the shell | Windows: W-2 job. Linux: `PR_SET_PDEATHSIG` armed in `pre_exec` (`unix.rs`). macOS: engine-side parent watch. All OSes: `xr serve --parent-pid <shell pid>`; clean quits send SIGTERM first (Unix) | `unix::tests::pdeathsig_is_bound_to_the_spawning_thread` + control + two `terminate_gracefully` tests (Linux reference, `cargo test`); `test/daemon/parent-watch*.test.ts` (decision table on every OS; SIGKILLed-parent process tree on Linux/macOS); `test/e2e-blackbox/parent-watch.test.ts` — the real CLI, spawned by a stand-in shell that is SIGKILLed: port stops answering and the process is gone within seconds, `daemon.parent_gone` on stderr. `engine_link` reports `containmentMode`. |

### 5b. The win32 parity hang — what the lab measured

The `approvals-durable` hang collected three explanations over its life ("flake", leaked
pollers, migration-lock self-deadlock) and code for each, none of which was checked against a
Windows kernel — a killed bun loses its stdout on win32, and every Cross-Platform run on this
branch was cancelled by the next push. `.github/workflows/win-lab.yml` (manual, run
35467925776) wrote kill-surviving markers from a `--preload` and settled it in one run:

| Experiment (windows-latest, bun 1.3.14) | Result |
|---|---|
| whole file, 300 s cap, `--timeout 20000` | markers: `preload → beforeAll → START #1`, then nothing; the preload's 2 s heartbeat **never ticked once**; exit 124 |
| first test only (`-t "TTL default-deny"`) | identical |
| plain `bun run` script: open Store → `request()` → `await outcome` | `request()` returned at +0.11 s; the await never settled in 90 s |
| `fixtures/raise-approval.ts` alone | exit 0 immediately (it `process.exit`s) |
| `fixtures/raise-and-wait.ts` alone, ttl 2000 | **exit 0 in 2 s** — the one process that also owned a **ref'd** timer (its guard) |
| `migration-lock-self-deadlock.test.ts` alone | 10 pass · 1 fail — `rmSync` on a directory symlink → `EFAULT` (Bun on win32); test cleanup fixed with `rmdir` |

Mechanism: `ApprovalStore.request()`/`waitFor()` unref'd **both** the TTL timer and the poller —
the promise's only wake-up sources. Bun on win32 does not service unref'd timers once no ref'd
handle remains while a pending await keeps the process alive; bun test's per-test timeout is the
same kind of timer, which is why it never reported the test by name. Bun on Linux/macOS runs
unref'd timers regardless — the whole reason this read as "Windows only". Fix: the TTL timer is
ref'd (a process waiting on a human is legitimately alive; the wait is bounded by construction)
and settlement clears both handles; the poller stays unref'd. `bun test` exits at the end of a
run regardless of live timers (measured locally: a ref'd 60 s timer left behind → exit in 38 ms),
so the old "unref for test hygiene" bought nothing.

The Cross-Platform diagnostics step was also rewritten: its previous form piped an unbounded
`bun test` into `tail` and itself hung for 29 minutes after the suite step timed out.

### 5c. The win32 `EBUSY` class — a zombie connection in the product, not a test quirk

With the hang gone, the Windows parity job on the merge commit (run 35469011949, job
105966453349) ran the whole suite in 7.5 minutes and left twelve failures, all of one shape:
`rmSync(tmp)` right after `store.close()` → `EBUSY: resource busy or locked`. This was
reproduced on Linux by reading `/proc/self/fd` after `close()` in the failing test
(`test/services/agent-service.test.ts`, happy path): `xr.db`, `xr.db-wal`, `xr.db-shm` were
still open, and a strict `db.close(true)` threw `database is locked`.

Cause, measured against bun 1.3.14 in isolation:

| Distinct `db.query()` strings before `close()` | strict close | fds still open |
|---|---|---|
| 20 | ok | 0 |
| 21 | `database is locked` (SQLITE_BUSY) | 3 (db, -wal, -shm) |
| 40 | `database is locked` | 3 |
| 40 + `clearQueryCache()` | `database is locked` | 3 |
| 40 + `finalize()` on every statement | ok | 0 |

`Database.query()` caches at most **20** statements and finalizes only those when the database
closes; every statement past the cache is returned un-cached and never finalized. `sqlite3_close`
refuses while any statement is live, Bun's default `close()` (`sqlite3_close_v2`) reports success
anyway, and the connection lives on as a zombie until the garbage collector finalizes the
orphans. The store runs far more than twenty distinct queries in any real session, so
`WorkspaceStore.close()` had **never** released the file after real traffic. POSIX hides it
(an open file can be unlinked); Windows reports it as `EBUSY` on the next delete or rename —
workspace removal, backup `restoreFrom()` (whose comment already said "Windows may hold handles
briefly"), and test cleanup.

Fix (product, trusted layer): the write gate now **owns** every statement on the connection —
`prepare()` and `query()` both compile through one bounded LRU keyed by SQL (512 entries;
eviction finalizes) — and finalizes all of them before the connection closes;
`WorkspaceStore.close()` uses the strict `close(true)` and, if it still fails, records
`WorkspaceStore.lastCloseError` and emits a `XR_STORE_ZOMBIE_CLOSE` warning instead of
swallowing it. Two designs were measured and rejected on the way: the previous strong
`Set` of `prepare()` statements (124 call sites prepare per call, so a daemon's set grew
without bound) and `WeakRef` tracking (JSC clears the ref at mark time but finalizes the
statement at sweep time — under the full suite's GC pressure 19 closes still failed, none in
isolation). `test/state/close-releases-file.test.ts` pins the contract: 40 distinct
queries → close → zero open fds under the store directory (Linux, via `/proc/self/fd`), zero live
statements, and the directory removable at once (the assertion Windows was failing).
Pre-fix the test fails on exactly the three open handles.

Two of the twelve were test defects and are fixed as such: `signed-audit-migration` reassigned
a store without closing the first (refcount never reached zero), and the parity manifest test
walked the test tree once per included file (~300 full walks, 5.4 s on the Windows runner —
past the 5 s budget; now one walk into a `Set`).

Not done here, recorded honestly: a Linux-side sweep with an `afterEach` fd probe shows 65 test
files that remove their temp dir without ever closing their store and swallow the error
(`try { rmSync } catch {}`) — `test/context` alone accumulates ~370 open handles per process.
That hides the same defect class on Windows (the runner's temp fills instead of the test
failing) and is queued as test hygiene for Phase 2; it does not affect the product fix above.

Still **not** runtime-verified anywhere: the no-console-flash observation itself (W-1), the
install → launch → taskkill → engine-dead sequence as one scripted run on the Windows runner
(the pieces are proven separately), and the NSIS n→n+1 upgrade with data intact.

The historical record of *why* this could not be verified from this container is kept below,
because "we could not check here" is itself a fact worth carrying.

The structure that made this verifiable at all: banner parsing, the stderr tail and the probe
cache live in `src/engine_state.rs`, which has no Tauri, OS or network dependency and therefore
compiles AND executes here. The Win32 calls live in `src/win.rs` (five kernel32 entry points,
hand-written FFI, explicit `repr(C)` layouts). Only the Tauri glue in `lib.rs` is unbuildable in
this container — and `rustfmt` still parses it, which is the strongest check available without the
`windows` crate.

The Windows shell was *attempted* three times, and the attempt is recorded because "we could not
check" is itself a fact worth carrying:

| Attempt | Toolchain | Outcome |
|---|---|---|
| `--target x86_64-pc-windows-msvc` | Rust 1.98.1, all crates fetched | `ring v0.17.14` build script fails: *"GNU compiler is not supported for this target"* / *failed to find tool `lib.exe`* — the MSVC linker does not exist on Linux, and `cc-rs` refuses a GNU compiler for an MSVC target. **Environmental, not a code finding.** |
| `--target x86_64-pc-windows-gnu` | mingw-w64 + nasm installed | `rustc` compiling `windows v0.61.3` was **SIGKILLed (signal 9)** — the OOM killer. 58 crates in before it died. |
| same, retried with `CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 -C debuginfo=0 -C strip=debuginfo` | — | **SIGKILLed again on the same crate.** The generated Win32 surface needs more than this sandbox's 1.9 GB for a single rustc process, and the machine has no swap. |

So the cross-check is blocked by the *environment* at two different points, and no amount of
retrying changes that. What IS committed from this work is `desktop/src-tauri/Cargo.lock` (531
packages) — the resolution needed for a reproducible build — and the finding that a Linux host
check also cannot run here, because `gdk-3.0`/`webkit2gtk` development packages are unavailable
from this image's package mirrors (the download 404s).

A Windows `cargo check` therefore still has to happen on a real Windows runner (the CI lane) or a
machine with more memory. Until then, treat W-1…W-6 as specification, not as shipped behaviour.
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
