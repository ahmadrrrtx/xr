# XR — Production Readiness Report (Phase 10 gate)

**Version:** 1.0.0 · **Date:** 2026-09-07 · **Gate:** Phase 10 "Production Certification"
**Evidence culture:** every row cites an artifact. A row with no linked artifact is
`PENDING` — never asserted. This report applies the claim-lint culture to the
readiness claim itself: it says exactly what is and is not covered.

> **Header claim (honest):** XR is *architecturally production-shaped and now
> evidentially exercised* on the dimensions below. It is **not** a claim of
> SOC 2/ISO certification and **not** an "external-firm pentested" claim (no such
> engagement has occurred). Use of "production-ready" in the README links here,
> and this report bounds that claim.

---

## Gate summary

| # | Dimension | Status | Evidence | Acceptance |
|---|---|---|---|---|
| 1 | Independent security review | **DONE** (independent-style) / external engagement **PENDING** | [`docs/security/PENTEST_REPORT.md`](security/PENTEST_REPORT.md) · [`PENTEST_REGISTER.md`](security/PENTEST_REGISTER.md) | Criterion 1 |
| 2 | Guard canonicalization fuzz | **DONE** (local ~800k clean) + **weekly CI job ships**; "2 clean weeks" = calendar window | [`scripts/fuzz-canonic.ts`](../scripts/fuzz-canonic.ts) · `.github/workflows/fuzz-guard.yml` · [`canonical-bypass.test.ts`](../test/security/canonical-bypass.test.ts) | Criterion 2 |
| 3 | Soak / load | **Harness DONE + validated** (171 tasks/30s bounded); full 24h×2wk = scheduled calendar window | [`scripts/soak.ts`](../scripts/soak.ts) · `.github/workflows/soak.yml` | Criterion 3 |
| 4 | Provider matrix + canaries | **Matrix + fixtures DONE** (26 presets, 6 fixtures, 0 drift); live hosted canaries **PENDING** (0 repo secrets) | [`PROVIDER_MATRIX.md`](release/1.0.0/PROVIDER_MATRIX.md) · `test/providers/capability-fixtures.test.ts` · `.github/workflows/provider-canaries.yml` | Criterion 4 |
| 5 | Readiness report published + claim-lint | **DONE** | this file + `bun run claim-lint` | Criterion 5 |

---

## 1. Independent security review

**Status:** independent-style review performed; external third-party engagement PENDING.
**Findings:** no critical/high reproduced; 2 LOW risk-accepted (documented); adversarial
cases committed as regression tests. Full method + evidence in
[`PENTEST_REPORT.md`](security/PENTEST_REPORT.md). The published register is updated to
record this review while keeping the external item honestly PENDING.

## 2. Guard canonicalization fuzz (crown jewel)

**Status:** genuine no-crash + invariant fuzz of the guard core. Local evidence:
5 deterministic seeds, ~800,000 checks, **0 crashes / 0 invariant breaks**. A
companion bypass regression suite (107 cases) confirms policy cannot be dodged by
re-encoding secret paths. `.github/workflows/fuzz-guard.yml` runs this weekly in CI.
The Phase 10 gate's "2 consecutive clean weeks" requires the scheduled job to pass
for two consecutive Monday runs — a calendar outcome, not a code gap.

## 3. Soak / load

**Status:** soak harness implemented and validated (drives the real CLI as a pool of
concurrent task processes against the deterministic in-tree stub — no network/keys).
Validated run: 171 task runs in ~30s, persistent store ~3.2 KB/task (flat per-op
cost), peak worker RSS bounded, **no leak trend**. `.github/workflows/soak.yml`
schedules the full 24h soak nightly. The "2 consecutive weeks clean, baselines
published" criterion is a calendar outcome of that scheduled window.

## 4. Provider capability matrix + canaries

**Status (catalog + fixtures):** 26 catalog presets with a published per-preset
capability matrix (streaming / tool-use / native-tool-calls / json / vision /
usage-reporting) and 6 offline VCR contract fixtures; the fixture gate fails on any
drift from the catalog (catalog truth). Evidence:
[`release/1.0.0/PROVIDER_MATRIX.md`](release/1.0.0/PROVIDER_MATRIX.md).

**Status (live hosted canaries): PENDING — 0 provider secrets configured in the
repository.** `.github/workflows/provider-canaries.yml` and `scripts/provider-canaries.ts`
probe a hosted provider **only when its API key is configured** and never fabricate a
pass (a sweep of only skips fails unless explicitly allowed). The maintainer must
provision real keys for ≥3 hosted presets + a local-runtime endpoint
(`XR_CANARY_BASEURL_OLLAMA`) to turn the weekly canary rows green. This is a
secret-provisioning action, not a code gap.

## 5. Claim-lint / evidence integrity

`bun run claim-lint` passes over the repository including these documents (no
unsupported claim, no prohibited label). Every evidence link above resolves to a
committed, reproducible artifact.

---

## What is NOT covered (stated, per honesty exception)

- **macOS / Windows confinement:** high-risk tool isolation degrades by host;
  outside Linux it is **fail-closed by refusal** unless an isolation backend is
  present (unchanged from the support matrix; `xr env capabilities --json` reports
  the real backend). This is a documented limitation, not a silent gap.
- **External third-party pentest / paid engagement:** not yet performed.
- **SOC 2 / ISO 27001 / HIPAA / PCI / FedRAMP:** XR holds none; not claimed.
- **Live hosted-provider canary green rows:** blocked on secret provisioning.
- **The two-week fuzz and soak calendar windows:** scheduled, awaiting elapsed time.

## Regression-test vehicles shipped in this phase

- `test/security/canonical-bypass.test.ts` (guard canonicalization bypass, 107 cases)
- `test/providers/capability-fixtures.test.ts` (catalog-truth fixture gate)
- `scripts/fuzz-canonic.ts` (no-crash + invariant fuzz, deterministic-seed)
- `scripts/soak.ts` (soak baseline + leak-trend harness)
- `scripts/provider-matrix.ts` (published capability matrix, catalog-truth)

---

## Phase 5 addendum (2026-09-19) — quality-gate adjectives, evidenced

The master plan's DoD names eleven adjectives; each row below cites the
artifact that evidences it THIS release. Rows that cannot be evidenced in
this sandbox say so and point at the owning lane (honesty exception).

| # | Adjective | Evidence | Honest bound |
|---|---|---|---|
| 1 | **Trustworthy** | approvals durable + default-deny (`test/control/*`), trust modes gate-enforced, standing grants audited; claim-lint green | external pentest PENDING (see §1) |
| 2 | **Auditable** | hash-chained + Ed25519-signed audit; NEW `GET /api/audit/export` signed bundle verified in-shell (WebCrypto) + `xr audit export` CLI; anchor push optional | — |
| 3 | **Safe** | computer-control pause/stop honored per-action BEFORE permissions (`src/control/pause.ts`); payments/high tiers always-ask; egress allowlist; fuzz-guard weekly | native OS hardening = reference builds |
| 4 | **Reliable** | reliability tier 66/66; SIGKILL mid-write WAL drill (`test/reliability/crash-injection.test.ts`); migration lock re-entrant; golden-path restart-recovery green | Windows approvals flake tracked (known-flakes list) |
| 5 | **Recoverable** | golden-path uninstall/restart semantics (data kept, launcher removed); kill-9 chain intact; write-gate SQLITE_LOCKED retry | — |
| 6 | **Fast** | `perf:gate` PASSED this phase (version 24 ms warm vs 150 budget; dashboard 3.9 ms vs 1000; retrieval 27 ms vs 250); main chunk 264 kB; route-level lazy routes | real-browser first paint not measurable headless here — labelled PENDING |
| 7 | **Accessible** | `test/a11y/*` (axe browser suite in CI, contrast, static); new screens ship aria labels/roles (Model Center/Control Room/Memory/Research) | palette focus-trap only in browser lane |
| 8 | **Honest** | claim-lint CF-1 gate; every screen renders engine data only; empty/error states state their cause; BLUEPRINT-STATUS observed-first | — |
| 9 | **Local-first** | voice STT/TTS offline; local runtimes probed live; cloud only via explicit BYOK (secret store) | — |
| 10 | **Governable** | budgets engine-computed; triggers pausable; automations surfaced; control cockpit single call | — |
| 11 | **Releasable** | release.yml: cosign keyless + SLSA provenance + SHA256SUMS; NEW updater wiring (plugin + manifest job, inert until operator keys — `docs/release/UPDATER.md`); updater dry-run test | code-sign/notarization keys = owner secrets (documented) |

## Phase 5 QA matrix (fresh install → work → resume), per OS

| OS | Lane | Evidence this release | Label |
|---|---|---|---|
| Linux | `ci.yml` ubuntu + `desktop-app.yml` bundle (deb/rpm/AppImage) + sidecar smoke (real boot + health probe) | green on PR CI | EXERCISED |
| macOS | `desktop-app.yml` bundle (dmg/app, arm64) + cross-platform.yml | green on PR CI | EXERCISED (CI runners) |
| Windows | `desktop-app.yml` msi + cross-platform.yml parity | green except known approvals/reliability flakes (tracked) | EXERCISED w/ known flakes |
| Native updater E2E (all OS) | requires operator secrets | `docs/release/UPDATER.md` | **BACKLOG — provision-gated, honest** |
| Tray/notification/autostart UX (all OS) | CI compiles (cargo check/clippy -D warnings); runtime UX needs packaged app | shell-check green | **BACKLOG — reference builds** |

Satellites (`satellites/`) are documented as OPTIONAL enterprise add-ons:
they are excluded from the npm publish surface and from the golden path; the
engine runs fully without them (see `docs/PLUGINS.md` + README wording).
npm/CLI/TUI parity: `bun run platform:parity:check` green in `bun run ci`.
