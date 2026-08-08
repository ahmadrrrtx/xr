# XR Phase 8 — STEP 1 Audit Report

**Repo:** github.com/ahmadrrrtx/xr @ `main` (`e30c2d4`, merge of PR #39 — Phase 7)
**Audited:** 2026-08-03 · Audit method: live code inspection + live gate execution (typecheck, full suite, release/claim/boundary/size/hot-path/capability gates, golden path) — no reliance on historical reports.

---

## 1. Live baseline evidence

| Check | Command | Result |
|---|---|---|
| Typecheck | `bunx tsc --noEmit` | **PASS** (0 errors) |
| Full test suite | `bun test` | **2540 pass / 0 fail** · 192 files · 10,294 expects · 45.76s |
| Version truth | `bun run release:check` | **PASS** — all 6 surfaces in sync at 7.0.1 |
| Claim governance | `bun run claim-lint` | **PASS** — 8 evidenced claims, no unsupported claims |
| Architecture boundaries | `bun run boundaries` | **0 errors, 2 warnings** (pre-existing orphans: `src/security/policies.ts`, `src/integrations/oauth.ts` — nothing imports them) |
| Module size gate | `bun run size-gate` | **PASS** — 16 over-threshold modules, all with owned dated waivers |
| Hot-path lint | `bun run hot-path-lint` | **PASS** |
| Capability gate (P7) | `bun run ci-capability-gate` | **PASS** — 56 bundled capabilities, no reject findings |
| Golden path (P0/1 journey) | `XR_HOME=/tmp/xrgp bun run golden-path` | **PASS** — 18 checks, chain valid, both outcomes succeeded (fails fast with `FAIL env: XR_HOME must be set` when XR_HOME unset — honest) |

Environment used for audit: Bun 1.3.14 (matches `.bun-version`/`packageManager`), Node 20.20.2, Linux x64.

## 2. Phase 0–7 re-verification

| Phase (guarantee) | State | Evidence |
|---|---|---|
| **P0 Truth & release hygiene** | **VERIFIED** | `src/core/version.ts` stamped from `release.manifest.json`; `release:check` gates 6 surfaces in CI; `claim-lint` green; CHANGELOG present. |
| **P1 Reliability & single-writer persistence** | **VERIFIED** | ADR 0001; `test/reliability/` suite (concurrency/crash/idempotency/RPO-RTO) present and green in CI; atomic updater; durable store; golden-path chain-intact checks pass after restart. |
| **P2 Unified substrate (one registry/router/planner/context/engine; enforced boundaries)** | **VERIFIED** | ADRs 0002–0009; dependency-cruiser L0–L6 rule set + `test/architecture/*` enforce acyclic/L0–L6; `scripts/size-gate.ts` + `docs/phase2/SIZE-WAIVERS.json`. Dashboard split (markup/styles/client-script) from P2 T7 present. |
| **P3 Lazy compiled runtime + perf budgets** | **VERIFIED** | `scripts/perf-gate.ts` (budget gate + same-host 30% regression band + waiver ledger), `scripts/perf/budgets.json`, `scripts/perf-baseline.ts`, `scripts/hot-path-lint.ts`. Startup budgets are absolute Constitution Art. XII ceilings. |
| **P4 Enforceable isolation + signed/SLSA/SBOM + daemon hardening** | **VERIFIED** | TrustService wired into daemon (`src/runtime/trust/*`: credential broker, authority registry, environment backends in-process/restricted/namespace/container/gVisor/Firecracker); strict CSP with external dashboard assets only; HttpOnly SameSite=Strict session cookie + one-time bootstrap; CSRF/origin guard; 429 rate limits; 2 MiB body caps; SBOM/license scripts + supply-chain workflow. |
| **P5 Explainable, measured routing** | **VERIFIED** | `src/intelligence/{router,service,slo,metrics,degradation}.ts`; SLO measurement at selection; fallback diversity playbook; behavioral metadata docs. |
| **P6 Measured context quality, one store, anti-poisoning** | **VERIFIED** | `src/context/**` single store, `UndoLedger` (`src/context/undo.ts`), integrity gate, measured-recall benchmark (`docs/phase6/measured-recall.json`), conflict resolution. |
| **P7 Capability ecosystem + Business OS graduated** | **VERIFIED** | Provenance graph, TUF updates, evidence trust scorer, manifest security scan, MCP signed allowlist, typed skills, CI capability gate (green live), Business OS decoupled to `extensions/business-os` (10.8k LOC out of kernel), effect-verified 15/15, default-excluded. |

**REGRESSED items:** none found.
**CHANGED vs. Phase-7 report:** none material (test count identical: 2540).
**Pre-existing debt noted (not Phase-8 scope):** 2 dependency-cruiser orphan warnings (`src/security/policies.ts`, `src/integrations/oauth.ts`).

## 3. Phase 8 surface inventory

### 3.1 API surface (T1)

| Item | State | Evidence |
|---|---|---|
| Daemon routes | **UNVERSIONED** | 66+ `DaemonRoute`s at `/api/*` (`/api/chat`, `/api/overview`, `/api/context/*`, …) + page routes (`/`, `/dashboard`, `/chat`) + 2 asset routes. Router is custom (`route()` helper: `path`/`prefix` exact-match, ordered dispatch). |
| OpenAPI/JSON-Schema | **NOT FOUND** | Zero matches for openapi generation; no schema registry. |
| Typed clients | **NOT FOUND** | No client SDK; dashboard client calls raw `fetch(BASE + path)`. |
| Compatibility policy | **NOT FOUND** | No policy doc; no deprecation mechanics. |
| Request validation | Minimal/ad hoc | e.g. chat route hand-parses JSON and returns `{error:"…"}` 400 strings. |
| **Gap (hypothesis CONFIRMED)** | The prompt predicted "likely unversioned" — confirmed in full. | |

### 3.2 Observability surface (T2)

| Item | State | Evidence |
|---|---|---|
| OpenTelemetry/OTLP | **NOT FOUND** | 0 OTel/OTLP deps; 0 references in `src/`. |
| `/metrics` endpoint | **NOT FOUND** | Only cache-metrics file note (`XR_HOME/cache/metrics/streaming.jsonl`, "metrics are never sent anywhere") and internal SLO collectors. |
| trace_id/span_id correlated logs | **NOT FOUND** | 0 references in `src/`. Logging = ad-hoc `console.log` + file writes; no structured logger contract. |
| Telemetry/content capture | None (nothing emitted) | Compliant with Art. XXI *by absence* — but there is no observable plane at all; `xr logs` reads audit rows only. |
| Profiling in CI | **PARTIAL** | `perf-gate` = latency budgets + regression band (benchmarks). **No CPU/flamegraph profiling gate** exists. |
| Existing useful signals | Present | Intelligence SLO metrics, stream-metrics JSONL, audit ledger — all *internal*, none exported or correlated. |
| **Gap (hypothesis CONFIRMED)** | "likely minimal" — confirmed: no trace plane, no metrics endpoint, no correlated logs, no profile gate. | |

### 3.3 Accessibility surface (T3)

| Item | State | Evidence |
|---|---|---|
| Keyboard operability | **FAILING** | 26 primary nav items are `<a class="nav-item" data-panel>` **without href** → not tabbable, not Enter/Space activatable; only global handlers (palette, composer). Cards/rows with `data-xr-action` are click-oriented. |
| Focus visibility (2.4.7/2.4.11) | **FAILING** | `outline: none` used on inputs/composer; focus shown by border-color change only (often 1px `var(--border)` → `var(--cyan)`); no `:focus-visible` style; no focus-not-obscured handling. |
| Contrast (1.4.3/1.4.11) | **AT RISK** | Dark theme; `--muted`/`--textDim` used for substantial text — ratios unverified (no check existed). Measured during audit: see test `test/a11y/a11y-static.test.ts` (several pairs < 4.5:1 pre-fix). |
| ARIA semantics | **MINIMAL** | 2 `aria-*` attributes in 1,298 LOC of markup; 0 in client script; decorative SVGs not `aria-hidden`; no live regions; toasts not announced. |
| Landmarks/skip link | **ABSENT** | No `<nav>` landmark label, no `<main>`, no skip link; title exists. |
| Target size (2.5.8) | **AT RISK** | Small icon buttons/dots unmeasured; several < 24px. |
| Accessible auth (3.3.7) | **FAILING** | Unauthenticated browser GET `/` → raw **401 JSON**; no accessible token-entry form at all. |
| axe/pa11y tests, CI gate, unit tests | **NOT FOUND** | No a11y infra of any kind. |
| **Gap (hypothesis CONFIRMED)** | "likely minimal" — confirmed, and a measurable keyboard focus-order failure exists. | |

### 3.4 UX surface (T4)

| Item | State | Evidence |
|---|---|---|
| Progressive disclosure | **ABSENT** | All 26 panels in 4 sidebar groups shown to every first-run user. No first-run success path; no "getting started". |
| Honest readiness | **PARTIAL** | `xr doctor` reports per-subsystem state; dashboard shows provider dots; no unified *Ready / Setup-required / Degraded* readiness banner with one next action. |
| Undo | **PARTIAL** | `UndoLedger` exists for context (P6) + audit undo in CLI; not surfaced in dashboard; no API route. |
| Authority legibility | Present (P4/P7): approvals panel, authority diff, capability badges data | Dashboard approvals exist; badges exist in capabilities data (works-now/setup-required/experimental surfaced as text, not standardized badges). |
| Calm defaults / failure repair | PARTIAL | Errors are `{error:string}` JSON; no structured "failure + repair command" pattern in dashboard. |
| Mode-colored TUI | Present historically (`src/ui/theme.ts`) | retained. |

### 3.5 DX surface (T5)

| Item | State | Evidence |
|---|---|---|
| CODEOWNERS | **PRESENT** | Full directory→owner map. |
| ADRs | **PRESENT** | 16 ADRs (0001–0016), all ratified format. |
| Ownership map (doc) | **NOT FOUND** | CODEOWNERS exists but no generated, readable ownership map with stability levels. |
| CONTRIBUTING/onboarding | **PRESENT (unmeasured)** | `CONTRIBUTING.md` exists; no first-PR <1 day evidence trail or quickstart ladder. |
| Unit tier <5s | **NOT FOUND** | One monolithic `bun test` = 45.76s; no fast tier split. Typecheck 13.7s. |
| Public interfaces/stability | Partial | ADRs + CODEOWNERS; no per-module stability map. |

## 4. Confirmed gaps (pre-implementation)

1. **G-API** Daemon API unversioned; no OpenAPI/JSON-Schema; no typed client; no compatibility policy or breaking-change detection. → **T1**
2. **G-OBS** No OTel/OTLP traces/metrics/logs; no `/metrics`; no trace-correlated logs; no redaction/cardinality machinery; no local viewer path; no CPU profiling gate. → **T2**
3. **G-A11Y** Keyboard-inoperable primary nav; failing focus visibility; unverified contrast; no landmarks/skip-link/live regions; no accessible auth screen; no automated/manual/CI a11y testing. → **T3**
4. **G-UX** No progressive disclosure; no honest readiness banner; undo not surfaced end-to-end; failures not repair-path structured; badges not standardized. → **T4**
5. **G-DX** No generated ownership map; onboarding unmeasured; no <5s unit tier; observability/a11y/contract docs absent. → **T5**

## 5. Files/directories that Phase 8 will touch (audited → planned)

- `src/daemon/routes/*` — version mount `/api/v1` + contract metadata + legacy deprecation.
- `src/daemon/server.ts` — health path handling, observability hooks, `/metrics`, `/api/v1/openapi.json`.
- `src/daemon/dashboard/{markup,styles,client-script}.ts` — a11y conformance + progressive disclosure + readiness + undo + badges.
- `src/observability/**` — NEW (single home for the observability plane; L1 per §2.2 — runtime observability is explicitly an L1 concern).
- `src/clients/**` — NEW typed client (generated from contract).
- `scripts/*` — openapi generate/check, api compat, profile gate, unit tier, a11y gate, first-task survey, ownership map.
- `.github/workflows/ci.yml` + `nightly.yml` — new gates.
- `test/{api,observability,a11y,ux,dx}/` — NEW suites.
- `docs/{api,observability,a11y,phase8}` + `docs/OWNERSHIP.md` + ADRs 0017–0021.
