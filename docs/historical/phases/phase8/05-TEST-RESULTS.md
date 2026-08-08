# Phase 8 · Step 8 — Test Results & Verification Evidence

**Build:** 7.0.1 + Phase 8 branch · **Date:** 2026-08-03 · **Runner:** bun 1.3.14, Node 20.20.2, Linux x86_64
**Method:** every number below is a measured output of a listed command; nothing is estimated. Reproduce with the same commands.

---

## 0. Full-suite results (the battery)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bunx tsc --noEmit` | **0 errors** |
| Full suite (final, committed tree) | `TMPDIR=<persistent-disk> XR_HOME=$(mktemp -d) bun test` | **2685 pass · 13 skip · 0 fail · 11997 expects** across 211 files — incl. the post-commit `model-class-contract` gate (§6) |
| Truth gate | `bun run release:check` | ✓ all 6 surfaces in sync at 7.0.1 |
| Claims | `bun run claim-lint` | ✓ no unsupported claims · 8 evidenced claims |
| API schema | `bun run api:schema:check` | ✓ `docs/api/openapi.json` matches registry (**100 operations**) |
| Typed client | `bun run client:check` | ✓ matches registry |
| API compat | `bun run api:compat` | ✓ no breaking changes |
| Boundaries | `bun run boundaries` | ✓ 0 errors (2 pre-existing warnings), 521 modules |
| Size gate | `bun run size-gate` | ✓ all ≤800 LOC or waived |
| Hot path | `bun run hot-path-lint` | ✓ no sync I/O on CLI fast path |
| Capability gate | `bun run ci-capability-gate` | ✓ 56 bundled capabilities, no reject-level findings |
| Ownership map | `bun run ownership:check` | ✓ 142 areas owned, doc in sync |
| Profile gate | `bun run profile:gate` | ✓ CPU profiles within budgets (doctor 398.9/3500ms) |
| Unit tier | `bun run unit-tier` | ✓ 279 tests / 19 files / **1377 ms** (budget 5000 ms) |
| Golden path | `bun run golden-path` (XR_HOME tmp) | ✓ 17 checks, `ok:true`, chain intact, uninstall correct |
| First-task survey | `bun run scripts/first-task-survey.ts` | ✓ **20/20** (rate 1.0 ≥ 0.95), p50 385 ms · p95 404 ms |
| Workflow YAML | python yaml.safe_load | ✓ ci.yml (14 jobs) · nightly.yml (3 jobs) parse |
| Dashboard SHA pin | `test/daemon/dashboard-split.test.ts` | ✓ composed-HTML hash matches deliberate pin |

---

## 1. T1 — Versioned public API (acceptance evidence)

| Acceptance | Evidence |
|---|---|
| All routes under `/api/v1` | `test/api/v1-versioning.test.ts` green; legacy paths retained as aliases per `docs/api/COMPATIBILITY.md` |
| Generated OpenAPI + JSON-Schema | `docs/api/openapi.json` **byte-compared in CI** (`api:schema:check`); 100 operations across routes incl. Phase-8 `context.undo` |
| Typed client generated from schema | `src/clients/daemon-client.generated.ts` (555 LOC) regenerated; `client:check` green |
| Compat policy + breaking-change detection | `docs/api/COMPATIBILITY.md`; `api:compat` diffs committed vs live schema and fails on removals/tightening |
| Tests | `test/api/` **30 pass** (client, compat, openapi, v1-versioning) |

## 2. T2 — Privacy-first observability (acceptance evidence)

| Acceptance | Evidence |
|---|---|
| Opt-in, off by default | `test/observability/` posture tests green; defaults require `xr telemetry on` or `XR_TELEMETRY=1` |
| Structural-by-default (NO prompt/tool content) | Attribute allowlists; `redaction.ts` processor in pipeline; redaction suite proves emails/keys/Authorization never leave |
| Cardinality budgets | `budgets.ts` whitelist label sets + series caps, test-pinned |
| `/metrics` live locally | daemon route green in tests; documented in `docs/observability/MODEL.md` |
| Trace-correlated logs | traceparent/span ids threaded into structured logs (tests) |
| E2E trace with tool & LLM children | composition test green (OTel GenAI semconv attrs) |
| Local-first viewer | `docs/observability/LOCAL-VIEWER.md`; no cloud dependency |
| Startup budget holds | `profile:gate` green (telemetry wiring present) — CPU within band |
| Tests | `test/observability/` **23 pass** + telemetry command **3** · `test/perf/profile-gate.test.ts` **3** |
| Privacy proof | Art. XXI conformance row in `06-FINAL-REVIEW.md` §exit-gate |

## 3. T3 — WCAG 2.2 AA (acceptance evidence)

| Acceptance | Evidence |
|---|---|
| Automated axe sweep (2a/2aa/21aa/22aa) | `test/a11y/browser-axe.test.ts`: **13 live tests** — auth page + **all 26 panels** + open palette = **ZERO violations** (real Playwright chromium 1.60 headless shell) |
| Contrast 4.5:1 / 3:1 | `contrast.test.ts`: real WCAG relative-luminance math over every token pairing (9 tests); fixes: `--muted→#7A8FB0` (≥5.04), `--border-strong #5C7194` (≥3:1) |
| Keyboard-only operation | real key events: tab order, skip link, palette focus-trap + return-focus, panel focus handoff, Enter/Space bridge for `[role=button]` (live tests) |
| Focus visible ≥3:1, not obscured | `:focus-visible` 2px ring after resets; scroll-margin guard (2.4.11); statics pin it |
| Landmarks/ARIA/live regions | 21 static tests: one `<main>`, labelled nav, `role=status`/toasts, palette combobox semantics, all inputs labelled, all SVGs hidden |
| Target size ≥24px (2.5.8) | min-heights 24/26px pinned; icon buttons ≥24px |
| Accessible auth (3.3.8/2.4.9) | `src/daemon/auth-page.ts`: labelled password, paste allowed, show-toggle, `role=alert` errors; 7 auth-server tests + axe clean |
| Manual procedure recorded | `docs/a11y/MANUAL-TESTING.md`; honest scope in `docs/a11y/CONFORMANCE.md` (SR/zoom **pending-human**, NOT claimed — exception E-1) |
| CI gate | `ci.yml` job `a11y` installs chromium and hard-fails (`XR_A11Y_REQUIRE_BROWSER=1`); constrained envs opt out ONLY via `XR_A11Y_SKIP_BROWSER=1` |
| Tests | `test/a11y/` **50 pass** (21 static · 9 contrast · 7 auth-server · 13 browser) |

## 4. T4 — Progressive disclosure UX (acceptance evidence)

| Acceptance | Evidence |
|---|---|
| First-task ≥95% | `scripts/first-task-survey.ts`: **20/20 fresh-machine attempts** install→first-answer (rate 1.0, gate target 0.95); p50 385 ms. **Scope:** automated proxy — human study protocol in `docs/ux/FIRST-TASK.md`, pending (E-1) |
| Honest readiness | live-computed banner (Degraded/Setup required/Your call needed/Ready/Unreachable) from `/api/overview`+`/api/models`+`/api/context`; screen-verified verdict on fresh machine: “Setup required … provider ollama” (`docs/ux/evidence/t4-dashboard-readiness.png`); recomputes on load + init (tests) |
| Undo first-class | `POST /api/v1/context/undo` + `↶ Undo last change` on memory panel; `test/ux/undo.test.ts` **7 pass**: exact before-image restore, append-only undo op, honest 404s, double-undo refusal |
| Progressive disclosure | only “Start here” expanded by default; area toggles (`aria-expanded`, localStorage `xr.nav.areas.v1`); palette/shortcut auto-reveal; 26 panels remain reachable (browser sweep confirms) |
| Five-area dashboard | governed areas + start-here overlay (sidebar evidence `t4-sidebar-disclosure-*.png`) |
| Mode-colored TUI | one canonical `modePaint()` — agent cyan / plan violet / ask dim — used by header, composer, session rows (was inconsistent before Phase 8); colourless terminals keep full information (10 tests) |
| Capability badges | four states from real lifecycle+cert data with WHY tooltips; visual: `t4-capabilities-badges.png` (WORKS-NOW green, SETUP-REQUIRED amber on live 153-capability store) |
| SUS ≥80 | instrument `scripts/sus.ts` (canonical items, pinned scoring, n≥5 ∧ mean≥80 claim gate); methodology + protocol `docs/ux/SUS.md`; **study pending — not claimed** (E-1) |
| Tests | `test/ux/` **40 pass**; survey smoke embedded in nightly CI job `first-task-survey` |

## 5. T5 — DX (acceptance evidence)

| Acceptance | Evidence |
|---|---|
| Ownership map public | `docs/OWNERSHIP.md` generated from `CODEOWNERS` (**142 areas**); `--check` in CI + `bun run ci`; explicit entries for Phase-8 boundaries (observability, API contract, a11y/UX) |
| ADRs public | `docs/adr/0017…0021` (API contract, privacy observability, a11y gate, disclosure/readiness, unit tier) follow house format |
| First-PR <1 day path | CONTRIBUTING “Your first day: the fast loop” — orient ≤1h (own­ership map + ADRs), unit-tier in loop, full gates at push |
| Unit tier <5s | `scripts/unit-tier.ts`: 19 curated files, **measured 1377 ms** (279 tests), budget gate 5000 ms fails otherwise; curation guarded by `test/architecture/unit-tier.test.ts` (no browsers/installers/subprocess installers/container builds in tier) |
| CI wiring | new `unit-tier` job (ownership check + measured budget); added to `quality-gate.needs`; nightly `first-task-survey` |
| Tests | `test/architecture/` **47 pass** (12 new T5) |

---

## 6. Failure analysis (honest record)

### 6.1 `model-class-contract` (expected failure, pre-commit only)
`test/…model-class-contract.test.ts` asserts `git diff --name-only HEAD` over
`src/core`, `src/services/agent-service.ts`, `src/core/execution` is **empty** —
a guard that Phase-8 kernel-touching work is reviewed-and-committed as one unit.
It fails while the Phase-8 working tree is dirty and **turns green after commit**.
Verified: file tree beyond those paths does not affect it; no code change was made
to satisfy it (that would defeat its purpose).

### 6.2 Interim failures were ALL environmental (ENOSPC), root-caused and closed
Intermediate full-suite runs in this sandbox reported 1–3 auth/evaluation
failures (e.g. `evaluation/integration › invalidation preserves the original
result and digest`, `evaluation/harness › verifyArtifact`). Isolated re-runs
passed 5/5, and full-run logs showed `ENOSPC: no space left on device` inside
fixture writers: /tmp is a shared **993 MB tmpfs** where the suite's hundreds
of `mkdtemp` fixtures (up to 45 MB each) compete for space — digest/integrity
assertions then failed on partially-written fixtures. This is §6.3 by another
symptom, not a code flake. **Proof:** final run with `TMPDIR` redirected to
persistent disk (19 GB free) is **fully green: 2685/13/0** on the committed
tree (§0). The files involved were never touched by Phase 8; no test was
modified, skipped, or softened to obtain the green.

### 6.3 Environmental disk exhaustion (sandbox-only)
The sandbox's /tmp is a 993 MB tmpfs shared by every `mkdtemp` fixture. Full
suite runs must either clean between runs (`find /tmp -mmin +30 -delete`) or —
the reliable fix used for the record run — set `TMPDIR` to a workspace-disk
directory. Not a product defect; CI runners (real disks) are unaffected.

---

## 7. What is explicitly NOT evidenced (and therefore not claimed)

1. Human screen-reader / 200% zoom passes (procedure only — E-1).
2. Human first-task success rate (automated proxy only — E-1).
3. Any SUS score (instrument only — E-1).
4. Hosted observability/SIEM, enterprise SSO, remote telemetry transport — **Phase 10 scope, deliberately not built** (`docs/release/7.0.1/known-limitations.md` §7b).
