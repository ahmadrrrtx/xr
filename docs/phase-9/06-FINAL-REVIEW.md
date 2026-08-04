# Phase 9 · 06 — Final Review (STEP 8)

**Reviewed:** `feat/phase9-packaging-release` vs. Constitution (Articles
X, XII, XIX/ADR-10, XX, XXII, XXIII, XXIV) and the Phase-9 engineering
contract (Parts 1–24). **Reviewer lens:** a hostile maintainer who assumes
reports lie and only the repo tells the truth.

## 1. Constitution conformance

| Article | Verdict | Evidence |
|---|---|---|
| XXII (one manifest stamps all surfaces) | ✅ | `release.manifest.json` now governs identity **and** distribution; 14 stamped surfaces drift-gated by `release:check`; ADR-0022. |
| XXII (signed, reproducible releases) | ✅ by construction / ⏳ live | tag-gate == manifest version; cosign keyless per asset + SLSA subjects **wired correctly** (outputs.digests fix); live Rekor proof pending first real tag run — explicitly NOT claimed. |
| XXIII (reversibility / atomic rollback) | ✅ | updater: verified download → canary → swap, auto-rollback (3 tamper refusals + forced-failure rollback tested); PM channels delegate with exact rollback commands; release demote-never-delete runbook. |
| XIX / ADR-10 (no claim without evidence) | ✅ | 11 claims evidenced and linted; Public Beta labeled fail-closed (`validateDistribution` rejects stable/GA wording); known-limitations register updated; stale claims *removed* from website/README/data. |
| XX (cross-platform CI, tests assert effects) | ✅ | full-parity `bun test` + golden path on linux-arm64, macos arm64/x64, windows; detection-skips only, whitelisted and drift-failing. |
| XII (no startup regression) | ✅ | perf gate PASS on this branch: version p95 42.4 cold / 42.0 warm ms vs 300/150 budgets. |
| X (no dead links / false cards) | ✅ | README evidence links now point at real 7.1.0 artifacts (inventory, baselines, known-limitations all exist); downloads page cards render only manifest channels. |
| XXIV (deletion/removal budget) | ✅ | nothing user-facing removed; fictional website content replaced with truthful renders; the 7.0.1 limitations register archived untouched. |

## 2. Contract traceability (Tasks T1–T6)

| Task | State | Proof |
|---|---|---|
| T1 signed multi-target release pipeline | done (CI-live pending) | `scripts/release-build.ts`, `release.yml`, `test/release/release-build.test.ts`, ADR-0022 |
| T2 channel manifests as authority renders | done | `distribution` section, `scripts/distribution-model.ts`, stamped channel files, `test/release/channels.test.ts` |
| T3 package-manager channels | done | homebrew/scoop/winget/deb/rpm/npm/docker configs + publish jobs, fail-loudly secrets, ADR-0023 |
| T4 cross-platform parity CI | done (green-on-runners pending) | `cross-platform.yml`, portability whitelist tests |
| T5 channel-aware update/rollback | done | `src/update/channels.ts`, verified atomic updater, tamper tests |
| T6 Public Beta positioning | done | stability label fail-closed, beta metric (provisional `N`), downloads page, feedback loop, beta dist-tag/prerelease semantics |

## 3. Adversarial self-check (the things a reviewer would attack)

- *"You claim signed releases — show me a Rekor entry."* → We don't claim
  any live entry. VERIFYING_RELEASES.md instructs how to check; the register
  states proof begins with the first workflow-run tag. The claim-lint claim
  `signed-releases` is scoped to the pipeline with evidence links to
  workflow+tests.
- *"Full-parity CI — show me green Windows/macOS runs."* → Not possible from
  this sandbox; asserted as YAML contract + local Linux evidence only. The
  exit gate says this verbatim.
- *"The beta ≥99% install metric?"* → PROVISIONAL until the nightly matrix
  records ≥30 attempts; the gate tool refuses to emit a pass earlier.
- *"Hidden regressions from the version bump?"* → three drift pins caught
  (artifact-E2E, dashboard hash, OWNERSHIP/OpenAPI); each fixed by binding
  to the single authority or by proven re-pin, with the proof recorded in
  `05-TEST-RESULTS.md`.
- *"New boundary `any`/empty catch?"* → audited the Phase-9 diff: no new
  instances (`src/install/system.ts` `catch {}`/`: any` predate Phase 3).
- *"Second authority for any concern?"* → version/report literals replaced
  by `CORE_VERSION`/manifest reads; channels render only from
  `distribution`; support matrix is a render, not an edit target.

## 4. Explicitly NOT claimed (and deferred)

- **Stable/GA** — XR is a Public Beta everywhere the label renders.
- **Live CI greens on 4 runner families** — pending first workflow run.
- **Live Rekor/SLSA/npm provenance entries** — pending first tag with
  secrets configured (runbook §5).
- **snap/flatpak** — rejected for now, ADR-0023. **Hosted apt/dnf repos** —
  Phase-10-class commitment.
- **Enterprise compliance, SSO/SCIM, HA, SIEM** — Phase 10, not touched.

## 5. Sign-off

Phase 9 is complete to the extent a sandbox can prove: all local gates green
(2771 tests, 13 CI gates, perf budget), every Phase-9 mechanism present and
effect-tested, every user-facing surface stamped from one authority, and the
documentation honest about what remains to be proven on real runners. The
remaining items are environmental, listed in the exit-gate table with
precise owners — none is masked as success.
