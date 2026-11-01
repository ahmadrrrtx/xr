# Implementation Prompt — XR-P01, revision r1

**Phase ID:** `XR-P01`
**Title:** Engine contract, readiness and recovery truth *(runtime seam)*
**Prompt revision:** r1
**Generated:** 2026-11-02
**Supersedes:** nothing (first prompt for this phase)
**Baseline commit:** `4adcec2b881dd163f35196eef62cc9228bfba29e` (`main`, after PR #206)
**Master plan revision:** R1 (`docs/implementation/v1-release/MASTER_PLAN.md`)
**Prompt author:** Plan Owner (Principal Architecture / Release Gatekeeper)

---

## 0. Relationship to `MASTER_PLAN.md` §P01 — read this before anything else

`MASTER_PLAN.md` §P01 was written before anyone had read the daemon's health route
alongside its own anti-fingerprinting test. One instruction in it is **not executable as
written**, and this prompt replaces it. Everything else in §P01 stands.

**The conflict.** §P01.5 says: *"Extend `GET /api/v1/health` with engine/schema/contract
versions + capability list"*. That cannot be done:

- `src/daemon/routes/system.routes.ts:25-31` serves `{ok, ts}` and carries an explicit
  Phase 34 · R1 (audit P2-21) comment: the unauthenticated probe must not carry
  name/version/host/binding because those are service fingerprints an attacker can
  harvest from a loopback bind.
- `/api/health` and `/api/v1/health` are the **only** open data paths in
  `src/daemon/server.ts` (`if (path !== "/api/health" && path !== "/api/v1/health" && …)`).
- `test/daemon/origin-host-guard.test.ts:169-171` **pins that invariant** for both mounts:
  *"unauth health returns {ok, ts} only — no name/version/host/binding/configCache"*.

So §P01.5 as written would (a) reverse a deliberate security decision and (b) turn an
existing test red. An executor that "follows the plan" here produces a regression.

**The replacement (this prompt governs; §P01.5 is superseded).** Split the concern along
the auth boundary that already exists:

| Concern | Endpoint | Auth | Change |
|---|---|---|---|
| Liveness | `GET /api/health`, `GET /api/v1/health` | **open** | **Unchanged — `{ok, ts}` only.** `origin-host-guard.test.ts` must stay green, untouched. |
| Identity + capability + readiness | `GET /api/v1/meta/version` | **session** (401 anon / 200 paired) | **Extended, additively** with `contractVersion`, `minDesktopVersion`, `schemaVersion`, `capabilities[]` |

`/api/v1/meta/version` is the correct home for three reasons, all verifiable: it is
already the session-gated reachability probe the desktop and the mobile companion poll;
it already returns `{version, host, lan, deviceName}` and is already behind the auth wall;
and it is **absent from `API_CONTRACT`**, so it is excluded from OpenAPI
(`src/daemon/routes/registry.ts` — `if (!meta || meta.surface) continue;`) and does not
perturb `api:schema:check`, `client:check`, or `api:compat` until you deliberately add it.

**You must not** add fields to `/api/health` or `/api/v1/health`, and you must not edit
`test/daemon/origin-host-guard.test.ts` or the `server.ts` open-path list. If you believe
the split is wrong, **stop and escalate** — do not implement around it.

---

## 1. Agent identity and objective

You are the **execution agent for `XR-P01` only**. You are not the plan owner and you do
not decide scope. You are responsible for making the desktop **incapable of silently lying
about its engine**: it must be able to state *which* engine it is talking to, *whether*
that engine can serve it, and *why not* when it cannot — and every one of those statements
must be backed by an observed probe, never by an assumption.

You must preserve XR's global architecture and every engineering constraint in `AGENTS.md`
and `docs/CONSTITUTION.md`. You may not weaken a gate, delete or skip a test, reduce a
budget, loosen a permission, or edit a governance document's *content*.

**Hardest constraint of this phase: no state may be entered without an observed probe.**
The desktop currently *derives* readiness from a `fetch` that never times out. Replacing
that with a five-state machine that can enter `ready` on optimism would be worse than the
status quo. Every transition is a function of (last probe result, elapsed time, observed
handshake) and nothing else.

**This phase is additive and reversible.** No migration, no protocol change, no spawn-argument
change. If you find a bug outside §4, record it and do not fix it.

---

## 2. Authoritative inputs — read these before changing anything

Read, in this order.

| # | File | Why |
|---|---|---|
| 1 | `docs/implementation/v1-release/MASTER_PLAN.md` §A, §E, §F (XR-P01), §G, §I — **with §0 of this prompt overriding §P01.5** | Scope, boundaries, global invariants |
| 2 | `docs/implementation/v1-release/AUDIT_VERIFICATION.md` — **`XRD-001`** (release-blocking, owner phase = this one), `AUD-001` (cause c), `AUD-002` | The verified findings this phase closes |
| 3 | `docs/implementation/v1-release/EVIDENCE_LOG.md` — **E-36 … E-42** (recorded 2026-11-02 for this phase), plus E-01 and §8 | The measurements this prompt is built on. **Do not re-derive what they already establish; do verify they still hold.** |
| 4 | `docs/implementation/v1-release/DECISIONS.md` — **D-008** (readiness vocabulary, APPROVED), **D-005** (precedence), and D-001/D-020/D-022/D-023 (context for what is still blocked) | Approved decisions. D-008 binds your vocabulary exactly. |
| 5 | `/home/user/uploads/XR_Release_Readiness_Audit_and_Roadmap.md` (or the in-repo copy) — the engine-readiness findings | The originating audit prose |
| 6 | `AGENTS.md` (whole file) and `docs/CONSTITUTION.md` (evidence, release identity, CI articles) | Binding rules; you may not edit either |
| 7 | `src/daemon/routes/system.routes.ts`, `src/daemon/routes/meta.routes.ts`, `src/daemon/routes/contract.ts`, `src/daemon/routes/registry.ts`, `src/daemon/server.ts` (the open-path list only) | The daemon seam you are extending — and the two you must not touch |
| 8 | `desktop/src/engine/transport.ts`, `desktop/src/stores/engineStore.ts`, `desktop/src/engine/types.ts`, `desktop/src/components/engine/EngineDownBanner.tsx` | The renderer seam |
| 9 | `test/daemon/origin-host-guard.test.ts` (**:169-171**), `test/api/v1-versioning.test.ts` (**:74-82**), `test/desktop/frontend-stores.test.ts` (**:33,43,56**) | Tests that already constrain this phase. Read before you form a design. |
| 10 | `desktop/src-tauri/src/engine.rs` (**:343-360, :387-412**), `desktop/src-tauri/src/engine_state.rs`, `desktop/src-tauri/src/lib.rs` (**:261-266**) | The sidecar handshake and the stderr tail you will surface |

**Do not** take the endpoint list from `AGENTS.md` prose. Derive behaviour from the code
above and from the live probe in §3.

---

## 3. Preflight inspection (required before any edit)

Report every answer in your final report. If any answer contradicts the expectations below,
**stop and escalate** — do not invent an alternative scope.

1. `git rev-parse HEAD` → expect `4adcec2b881dd163f35196eef62cc9228bfba29e`;
   `git status --porcelain` → expect **clean**. If dirty, stop.
2. Confirm the health invariant still holds and still has a test:
   `bun test test/daemon/origin-host-guard.test.ts test/api/v1-versioning.test.ts` → expect
   green. Record the exact test names that pin `{ok, ts}`.
3. **Probe the live daemon** (this is the phase's ground truth — do it before designing):
   ```bash
   XR_HOME=$(mktemp -d) bun run src/index.ts serve --port 0   # note the port+token off the banner
   curl -sS  http://127.0.0.1:$PORT/api/v1/health                       # expect {"ok":true,"ts":…}
   curl -sS  http://127.0.0.1:$PORT/api/v1/meta/version                  # expect 401
   curl -sS -H "Authorization: Bearer $TOKEN" \
             http://127.0.0.1:$PORT/api/v1/meta/version                  # expect {version,host,lan,deviceName}
   ```
   Record all three verbatim. `E-36`/`E-37` predict exactly this; confirm or contradict.
4. Confirm the desktop's health consumer surface is **dead**: `EngineHealth`
   (`desktop/src/engine/types.ts:216-224`) declares `name`, `host`, `binding`, `auth`,
   `version`, `ts`, `ok` — the engine sends only `ok` and `ts`. Record the actual reference
   count for each field (E-39 predicts 0 for `name`/`host`/`binding`/`auth`).
5. Confirm `engineFetch` has **no timeout** and `refresh()` therefore cannot bound a
   hung engine (E-40). Search for `AbortSignal`/`AbortController`/`timeout` in
   `desktop/src/engine/transport.ts` and record the (empty) result.
6. Confirm the Rust side **already exposes** what you need: `engine_logs_tail`
   (`engine.rs:409-412`), registered in `lib.rs:261-266`, backed by a bounded `StderrTail`
   (`engine_state.rs:52-93`). **You must not add or change a Rust command** — that is
   out of scope (§5.2) and unnecessary.
7. Confirm `EngineDownBanner.tsx` already models the dev/prod split you must not break:
   `endpoint?.via === 'sidecar'` at :34, :92 (E-42; MASTER_PLAN §P01.15's
   `via: 'sidecar'|'vite-proxy'` and `EngineDownBanner.tsx:31` are **stale** — the type is
   `'sidecar' | 'dev-proxy'` at `transport.ts:17`).
8. Record baseline exit codes for the phase's gate set (§8). All are expected **0** at
   `4adcec2b` (`E-41`):
   `bun run typecheck`, `bun run api:schema:check`, `bun run client:check`,
   `bun run api:compat`, `bun run boundaries`.
9. `bun test test/desktop/` → record. Expect green; `frontend-stores.test.ts:43` already
   sets `status: 'starting'` and passes today only because of an `as never` cast.
10. Confirm `bun run changelog:check` still exits **1** (D-020 undecided, E-27/E-34). This
    is **not** yours to fix; it means `bun run ci` cannot be your phase gate (§8).

---

## 4. In-scope changes

Five work items. Nothing else.

### 4.1 The engine handshake on the session-gated probe

Extend `GET /api/v1/meta/version` **additively**. Existing fields keep their names, types
and meanings; no field is removed, renamed, or made required.

Add:

| Field | Type | Meaning |
|---|---|---|
| `contractVersion` | `string` (semver) | The desktop↔engine contract this engine implements. Introduce **one** exported constant in `src/daemon/routes/contract.ts` (e.g. `ENGINE_CONTRACT_VERSION`) and serve it — never a second literal. |
| `minDesktopVersion` | `string` (semver) | Oldest desktop build this engine will serve |
| `schemaVersion` | `string \| number` | The persistence/schema generation the engine is on. **Read it from the engine's existing authority** (inspect `src/core/version.ts`, the store/migration modules, `release.manifest.json`); if no such authority exists, omit the field and record that fact — **do not invent one.** |
| `capabilities` | `string[]` | Stable operation/capability ids this engine serves. Derive from the existing registry (`apiRegistry()` / `API_CONTRACT`), not a hand-written list. |

Rules:
- **Single source of truth.** The version strings come from `versionInfo()` /
  `release.manifest.json` / the one new constant. A hardcoded literal in the route is a
  defect (`CONSTITUTION` Art. XXII.1; the file `src/core/version.ts` is GENERATED).
- Keep the response **cheap**: no disk scan, no provider probe, no network. `meta/version`
  is polled; it must stay O(registry), like the existing `apiRegistry().length` read.
- Register the operation in `API_CONTRACT` **only if** you want it in OpenAPI. If you add
  it, you must regenerate (`bun run` the openapi + client generators) and the
  `api:schema:check`, `client:check`, `api:compat` gates must be green on the regenerated
  artifacts. If you leave it out of `API_CONTRACT`, say so explicitly and justify it. Either
  choice is acceptable **if green and stated**; hand-editing `docs/api/openapi.json` or
  `src/clients/daemon-client.generated.ts` is not.
- `GET /api/health` and `GET /api/v1/health` are **untouched**.

### 4.2 The desktop handshake and a typed incompatibility error

In `desktop/src/engine/transport.ts`:

- Perform the handshake **once per endpoint link**, after the session is established and
  before the store may declare `ready`. Reuse the existing `engineEndpoint()` cache and the
  existing `EngineDown` error family.
- Add a typed error — `EngineIncompatible` (or equivalently shaped) — carrying the observed
  `contractVersion`/`version` and the reason (`missing-contract-version`,
  `contract-too-old`, `contract-too-new`, `desktop-too-old`). It must be distinguishable
  from `EngineDown('unreachable')` and `EngineDown('unauthorized')` at the call site, the
  same way `kind` already distinguishes those two.
- **Legacy rule:** an engine that answers `/meta/version` **without** `contractVersion` is
  *legacy*, not healthy. It must produce `degraded` with an actionable message — the
  `MASTER_PLAN` §P01.8 test is explicit that this must **not** be `ready`. Do not guess a
  contract version from the package version.
- Every request in this file gets a **bounded timeout** (`AbortSignal.timeout(...)` or an
  `AbortController` with a single exported constant). `engineFetch` currently cannot fail
  by timeout (E-40) — that is the bug behind "infinite `starting`". Propagate `AbortError`
  as a distinct, typed failure, not as `EngineDown('unreachable')`.

### 4.3 The readiness state machine (D-008)

Adopt D-008 exactly. `EngineStatus` becomes:

```
starting | ready | degraded | disconnected | failed(reason)
```

with `reason` a bounded union that **must** include, at minimum,
`unauthorized` (session rejection), `incompatible`, `crashed`, `timeout`, `unreachable`
— D-008: *"`unauthorized` preserved as a distinct `failed` reason (session rejection is not
a crash)"*.

Required properties, each of which is a test in §4.5:
- **Bounded:** no state is entered without an observed probe; `starting` has a deadline
  after which it becomes `failed(timeout)` carrying the captured stderr tail.
- **Single source of truth:** exactly one function computes the next state from
  `(probeResult, elapsed, handshake)`. The banner and every other consumer *read* it; none
  recomputes it.
- **Mapping table, written down:** `unknown→starting`, `checking→starting`, `up→ready`,
  `down→disconnected`, `unauthorized→failed(unauthorized)`. Put it in the file's header
  comment **and** in your report.
- `degraded` is for *connected but not fully usable* (legacy/incompatible contract, failed
  catalog load). It must not become a catch-all for "something felt off" — a single
  over-eager `degraded` masks a healthy engine (MASTER_PLAN §P01.15) and fails this phase.

**Blast radius you must handle, not avoid.** ~22 files under `desktop/src/` consume
`useEngineStore` and there are ~30 `status === '…'` comparisons (E-38). Every one must be
migrated in **this** phase — D-008's trade-off row says so explicitly. Use a total
mapping, not a mechanical find/replace: several matches (`ProviderConfigModal.tsx`,
`PaletteQuickAsk.tsx`, `CompromisedModal.tsx`) are *unrelated* statuses on other stores and
must be left alone.

### 4.4 Diagnostics export — redacted by construction

Replace the "Diagnostics" affordance's dead end with a real, copyable export:

- Source the sidecar stderr tail from the **existing** `engine_logs_tail` command
  (`engine.rs:409-412`, `lib.rs:261-266`). **No Rust change.** If `isTauri()` is false, the
  export says so honestly rather than pretending a tail exists.
- **Allow-list, not deny-list.** Build the export by *constructing* an object from a fixed
  set of named fields (timestamp, app version, engine version, contract version, readiness
  state + reason, endpoint `via`/port/reason, failure count, last error text, stderr tail
  lines). Never take an existing object and delete keys from it. A key you forgot to add is
  invisible; a key you forgot to deny is a leak.
- The token must never appear. Note that `transport.ts`'s header comment states the token
  never touches disk or logs and that `engine_state.rs:155` deliberately refuses to parse
  `?token=…` dashboard lines — preserve both properties, and treat the stderr tail as
  **untrusted input** that may still contain a token from a future change. Redact
  (`<redacted>`) any `Authorization`/`token`/`Bearer`/`api[_-]?key`/`sk-` shaped substring
  in the tail lines, and prove it with the specimen test in §4.5.

### 4.5 Tests

Create `test/desktop/engine-readiness.test.ts` (a new file; do **not** bury this in
`frontend-stores.test.ts`) plus one daemon-side test. Everything here is offline and
deterministic — no sockets, no timers longer than a few ms, no sleeps.

| # | Test | Asserts |
|---|---|---|
| 1 | Contract present and matching | handshake ⇒ `ready` |
| 2 | **Legacy payload** (no `contractVersion`) | ⇒ `degraded` **and** an actionable message; **never** `ready` (§P01.8) |
| 3 | Older/newer contract | ⇒ `failed(incompatible)`, blocking and actionable |
| 4 | Each of the five states reachable | one test per state, each arriving via an observed probe |
| 5 | No state without a probe | the machine cannot enter `ready`/`degraded` from `starting` absent a probe result |
| 6 | **Bounded boot** | a sidecar that never prints a banner yields `failed(timeout)` within the bounded window with the captured stderr tail — *never* an infinite `starting` (§P01.8) |
| 7 | Unauthorized ≠ crashed | 401 ⇒ `failed(unauthorized)`; a non-401 transport error ⇒ a different reason |
| 8 | **Redaction specimen** | export built from a fixture whose tail contains a planted `Bearer <token>`, `?token=…`, and `sk-…`; assert none of the three appear in the serialized export, and assert the allow-list field set exactly |
| 9 | Daemon: `/api/v1/meta/version` shape | 401 anon; 200 paired; new fields present; existing four fields unchanged |
| 10 | **Guard: liveness stays minimal** | both health mounts still return exactly `{ok, ts}` — a regression test that fails if a future phase re-adds fingerprints |

Test 10 is the one that keeps §0's split honest. Do not delete it to make a later change
pass.

---

## 5. Explicit non-goals — do not do these

### 5.1 Scope
1. **Do not change the readiness of `/api/health` / `/api/v1/health` or the open-path list
   in `server.ts`.** No new fingerprints, no new open paths.
2. **Do not touch Rust.** No new `#[tauri::command]`, no `engine.rs` spawn-argument change,
   no change to `StderrTail`. If you believe a Rust gap exists, prove it and record it —
   MASTER_PLAN §P01.7 says *read-only unless a real gap is proven*.
3. Do not touch provider-list semantics (`XR-P03`), onboarding (`XR-P02`), sidecar
   containment, the SSE protocol, or `engine_state.rs`'s parser.
4. Do not fix anything you find outside §4 — record it in your report. In particular: the
   `previousTagFor` prerelease mis-range (`scripts/changelog.ts:95-108`, E-35) is
   **owner-scope, D-020, not yours**; and `bun run changelog:check` stays red.

### 5.2 Gates and governance
5. **Do not weaken, skip, quarantine, or delete a test.** Not to get green.
6. Do not add a quarantine entry or extend an existing one.
7. Do not edit `test/daemon/origin-host-guard.test.ts`, `test/api/v1-versioning.test.ts`,
   or `test/architecture/gate-enforcement.test.ts`.
8. Do not hand-edit `docs/api/openapi.json`, `src/clients/daemon-client.generated.ts`, or
   `src/core/version.ts` (GENERATED — `bun run release:stamp` owns it).
9. Do not edit `AGENTS.md`, `docs/CONSTITUTION.md`, `CHANGELOG.md`, `CODEOWNERS`, or the
   ruleset. **P00's owner actions are still outstanding** — do not attempt them here.

### 5.3 Claims
10. Do not claim a native Windows/macOS/display result. There is no Rust, no display and no
    audio device in the verification environment (E-01 §8).
11. Do not present a *static reading* of a `.tsx` file as evidence that a screen works.
    Screens need renderer-under-test evidence; if you cannot produce it, say `Not run`.

---

## 6. Required implementation approach (this order)

1. **Probe first.** Complete §3 including the live curl transcript. If the live daemon
   disagrees with §0/§4.1, escalate before writing code.
2. **Daemon half.** Constant + additive fields in `meta.routes.ts`; decide and *state* the
   `API_CONTRACT` question; regenerate if you add it. Daemon test (#9, #10). Run the three
   API gates.
3. **Transport half.** Timeout + handshake + typed incompatibility. Unit-test the parsing
   and error typing before touching the store.
4. **Store half.** Implement the state machine and the written mapping table; migrate all
   `status` consumers; run `bun run typecheck` for the desktop project after **every**
   consumer group — the type change is your migration checklist.
5. **Banner + diagnostics half.** Copy/actions per taxonomy; allow-list export.
6. **Tests 1-8**, then the full gate set (§8).

**Do not** start from the UI. A banner that renders five states it cannot distinguish is
worse than the current one, because it looks like progress.

---

## 7. Hard constraints (violating any one fails the phase)

1. `/api/health` and `/api/v1/health` respond with exactly `{ok, ts}` to an anonymous
   request, on both mounts, with `origin-host-guard.test.ts:169-171` untouched and green.
2. No readiness state is entered without an observed probe; no unbounded wait remains on any
   path that gates `ready`.
3. The diagnostics export is constructed from an allow-list; a planted secret in the stderr
   tail does not survive it.
4. One source of truth per fact: one contract-version constant, one state-computation
   function, one version authority. No second literal.
5. Nothing outside §4 is modified. `git diff --stat` must contain only files listed in §4
   plus your test file(s) and the doc updates in §9.
6. No gate is weakened; no test is skipped, deleted, quarantined, or made conditional.
7. Every claim in your report maps to a command, an exit code, an API response, or a diff.
   Intent, code reading and READMEs are not evidence.

---

## 8. Acceptance criteria (each must be mapped to evidence)

At `4adcec2b` the shared baseline is: parity suite **5122 pass / 0 fail / 41 skip across
474 files** (E-41), `typecheck` 0, `api:schema:check` 0, `client:check` 0, `api:compat` 0,
`boundaries` 0. Your final commit must not regress any of it.

| ID | Criterion | How it is verified |
|---|---|---|
| `P01-AC1` | `/api/v1/meta/version` returns `contractVersion`, `minDesktopVersion`, `capabilities[]` (and `schemaVersion` **or** a stated reason it is omitted) additively; the four pre-existing fields are unchanged | Live curl: anon 401, paired 200, full JSON; pre/post field-by-field table |
| `P01-AC2` | `/api/health` and `/api/v1/health` still return **exactly** `{ok, ts}`; no field added; the pinning test is untouched | `git diff` on `system.routes.ts` + `server.ts` (empty); `bun test test/daemon/origin-host-guard.test.ts` green; new guard test #10 |
| `P01-AC3` | `EngineStatus` is `starting\|ready\|degraded\|disconnected\|failed(reason)` with `unauthorized` as a `failed` reason | Type declaration + the written mapping table + `grep` showing zero surviving `'up'`/`'down'`/`'checking'`/`'unknown'` **engine** comparisons |
| `P01-AC4` | Each of the five states is reachable and **no state is entered without an observed probe** | Tests #4 and #5, output pasted |
| `P01-AC5` | A legacy payload (no `contractVersion`) yields `degraded` with an actionable message, never `ready` | Test #2 |
| `P01-AC6` | A sidecar that never prints a banner yields `failed(timeout)` within the bounded window **with** the stderr tail — never infinite `starting` | Test #6 + the timeout constant and its value |
| `P01-AC7` | Incompatibility is typed, blocking, and actionable; `unauthorized` is distinguishable from a crash | Tests #3, #7 + the error class |
| `P01-AC8` | The diagnostics export is redacted **by construction** (allow-list) and a planted secret does not survive | Test #8 specimen + the allow-list field set enumerated in the report |
| `P01-AC9` | Every `engineStore` consumer is migrated; `typecheck` (root **and** desktop) exits 0 | `bun run typecheck` EXIT 0 + the consumer list with its before/after status expression |
| `P01-AC10` | `api:schema:check`, `client:check`, `api:compat`, `boundaries` exit 0 — regenerated by generator if the contract changed, never hand-edited | Four exit codes + the generator command you ran |
| `P01-AC11` | No Rust change; `git diff --stat` shows only §4 files + tests + §9 docs | `git diff --stat` with a justification per file |
| `P01-AC12` | Parity not regressed: full segmented suite ≥ **5122 pass / 0 fail**, and `test/desktop/` green | Suite totals, compared to the E-41 baseline |
| `P01-AC13` | `bun run ci` is **not** claimed as green; its only red sub-gate is `changelog:check` (EXIT 1, D-020 undecided) — an owner blocker, not a phase defect | `changelog:check` exit code + an explicit statement of every other sub-gate's exit code |
| `P01-AC14` | What remains `Not run` is stated explicitly (native Windows/macOS, display, audio, live provider) | A `Not run` section in the report |

**You may not mark any criterion "passed" on the basis of intent, code inspection, or a
README.** Only a command, an API response, or a diff. If a criterion cannot be satisfied,
report it unmet — do not redefine it.

---

## 9. Git, docs and commit policy

- **Branch:** `phase/P01-engine-readiness` from `4adcec2b`. Never push to `main`
  (PR-only, GH013 — E-33).
- **Commits:** one logical step per commit, imperative subject. Suggested chain:
  daemon contract → transport handshake → store state machine → banner → diagnostics →
  tests → report. Keep the state-machine migration in **its own** commit so it can be
  reviewed or reverted as a unit.
- **PR:** open against `main`, title `XR-P01 — engine contract, readiness and recovery
  truth`. **Do not merge it.** The ruleset requires a review and none of P00's owner
  actions are applied yet; the owner merges.
- **Docs you must update** (only these):
  - `docs/implementation/v1-release/PHASE_STATUS.md` — `XR-P01` → `IMPLEMENTATION_REPORTED`,
    with your head SHA and the `Not run` list.
  - `docs/implementation/v1-release/EVIDENCE_LOG.md` — append `E-43…` for **your** new
    measurements only, dated, referencing E-36…E-42 where you confirmed or contradicted
    them. Append-only; never edit an earlier entry.
  - `docs/implementation/v1-release/DECISIONS.md` — **only** if you must record a new
    decision (e.g. the `API_CONTRACT` choice in §4.1). Number it `D-024`+, mark it
    `PROPOSED` unless the owner approves it, and justify it in one table.
  - `docs/implementation/v1-release/phase-reports/XR-P01-report-r1.md` — your report.
- Do **not** edit `MASTER_PLAN.md` to match what you built. If §P01 was wrong, that is a
  finding for the Plan Owner (`§0` of this prompt already supersedes §P01.5).

---

## 10. Final verification and report

Run and record, in this order, with exit codes:

```bash
bun run typecheck                 # root + desktop must BOTH be reported separately
bun test test/desktop/engine-readiness.test.ts
bun test test/desktop/
bun test test/daemon/origin-host-guard.test.ts test/api/v1-versioning.test.ts
bun run api:schema:check
bun run client:check
bun run api:compat
bun run boundaries
bun run ci:policy
bash scripts/parity-suite-runner.sh linux --exclude '^test/e2e-blackbox/'
bun run changelog:check            # EXPECT 1 — record, do not fix
```

**On `bun run ci`:** do **not** run it as your phase gate and do not report it green. It is
red at `4adcec2b` on `changelog:check` alone (E-27/E-34), and monolithic `bun test` is
OOM-killed in a 1.9 GiB sandbox (EXIT 137). Use the segmented parity runner for test
coverage and state the substitution explicitly (E-41).

Your report must contain: the preflight answers; a field-by-field before/after table for
`meta/version`; the state machine's transition table; the allow-list field set; every AC
mapped to its evidence; the `git diff --stat` with one line of justification per file; and
an explicit **`Not run`** section.

---

## 11. Definition of done

- Five states reachable and tested; **no state without an observed probe**; no unbounded
  wait on any path to `ready`.
- The handshake is explicit, versioned, and a legacy or mismatched engine is **blocking and
  actionable**, never silently `ready`.
- Diagnostics are redacted **by construction**, sourced from the existing
  `engine_logs_tail`, with no Rust change.
- `/api/health` and `/api/v1/health` are byte-identical in shape to the baseline and their
  pinning test is untouched.
- Every `engineStore` consumer migrated; `typecheck` green in both projects.
- `api:schema:check`, `client:check`, `api:compat`, `boundaries` green; generated artifacts
  regenerated, never hand-edited.
- Parity ≥ 5122 pass / 0 fail; nothing skipped, quarantined or weakened.
- `changelog:check` recorded as the sole red sub-gate, attributed to D-020, not papered over.
- `Not run` stated explicitly (native Windows/macOS, display, audio, live provider).

---

## 12. What this phase unlocks

`XR-P02` (onboarding) and `XR-P03` (provider single source of truth) both consume readiness
and are **disjoint in files** (MASTER_PLAN §G) — parallel only with owner authorization.
`XR-P05`/`XR-P06` consume the same seam later.

**Unblocks nothing in P00's governance debt.** The ruleset is still shallow (approvals 0,
code-owner false, `Quality Gate` required twice vs the six contexts declared in
`.github/required-checks.json`) and D-020 is still undecided. Those remain owner actions
recorded in `PHASE_STATUS.md` §obligations and are **not** re-attempted here.
