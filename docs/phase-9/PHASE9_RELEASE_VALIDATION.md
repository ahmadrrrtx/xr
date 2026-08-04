# Phase 9 Release Validation — XR 7.1.0 (Truth) · Public Beta

- **Release prepared:** XR 7.1.0 · **stability: Public Beta** (not stable, not GA)
- **Branch:** `feat/phase9-packaging-release` (deliverable; sandbox cannot push)
- **Baseline:** XR 7.0.1 — Phase 8, main @ `2ec994a`, verified green before
  work began (2684 tests / 13 skip / 0 fail, typecheck 0 errors,
  `bun run ci` green, golden path ok, release:check 6 surfaces, claim-lint 8 claims)
- **Date:** 2026-08-04
- **Verdict:** **PHASE 9 COMPLETE — with environmental items pending on real CI**,
  itemized in §5 and never masked as success.

---

## 1. Validation environment (disclosed)

Sandbox: Linux x64, Bun 1.3.14, Node 20.20.2, `dpkg` present.

| Tool | Present | Consequence |
|---|---|---|
| GitHub-hosted runners (win/mac/arm64) | no | full-parity CI green is pending the first real run; workflow is YAML-contract-tested |
| cosign / network Rekor | no | local Ed25519 self-verify tested; keyless path contract-tested; live Rekor entry requires the first tag run |
| Docker daemon | no | container build/push is CI-only |
| rpmbuild | no | detection+skip verified; `XR_REQUIRE_RPM=1` fail-closed verified; workflow installs `rpm` |
| npm/tap/bucket/winget credentials | no | publish steps contract-tested; secrets + fail-loud behaviour wired, first publish on first tag |

## 2. Mandatory workflow — executed in order

1. **Audit** → `01-AUDIT-REPORT.md` (R1–R6 pipeline findings, P3/P4/P7/P11).
2. **Gap analysis** → `02-GAP-ANALYSIS.md` (18 gaps → tasks → tests).
3. **Research** → `03-RESEARCH-NOTES.md` (R1–R7 with URLs: cosign keyless,
   SLSA generic-generator contract, npm trusted publishing, tap/bucket
   ownership, full-parity CI, public-beta readiness).
4. **Architecture validation** → `04-ARCHITECTURE-VALIDATION.md` (T1–T6 vs
   ADRs; snap/flatpak REJECTED with rationale).
5. **Implementation** → T1–T6 (per-area conventional commits).
6. **Tests** → +86 `test/release/` tests; tamper/rollback/refusal effects.
7. **Final validation** → §3 numbers.
8. **Final review** → `06-FINAL-REVIEW.md`.
9. **Exit gate** → §5.
10. **This declaration** → §4–§8.

## 3. Final measured validation (this branch, this host)

| Step | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | ✅ 0 errors |
| Full suite | `bun test` | ✅ **2771 pass / 13 skip / 0 fail** (2784 tests, 222 files; +87 net vs baseline) |
| Local CI (13 gates) | `bun run ci` | ✅ exit 0 — incl. release:check, claim-lint, inventory, capability gate, api checks, boundaries (0 errors / 2 owned warns), size-gate (16 waived, 0 new), hot-path-lint, ownership:check |
| Identity surfaces | `bun run release:check` | ✅ **14 surfaces in sync at 7.1.0** (was 6 at 7.0.1) |
| Claims | `bun run claim-lint` | ✅ 11 evidenced claims, 0 unsupported |
| Golden path | `bun run golden-path` | ✅ `{"ok":true,"version":"7.1.0"}` · 17 checks · `chainValid:true` |
| Startup/perf (Art. XII) | `bun run perf:gate` | ✅ PASS — version p95 42.4 cold / 42.0 warm ms (budgets 300/150); all 9 scenarios under budget; **no startup regression** |
| Fresh baselines | `bun run baseline:measure` + `perf:baseline` | ✅ `docs/release/7.1.0/BASELINE_MEASUREMENTS.*`, `docs/perf/baseline-7.1.0-source.*` regenerated and committed |
| Shell/PowerShell installers | `bash -n` / effect tests | ✅ checksum verify fail-closed; cosign-when-present; channel records |

## 4. Contract evidence map

| Item | Where |
|---|---|
| T1 signed multi-target release | `scripts/release-build.ts`, `scripts/verify-release.ts`, `.github/workflows/release.yml`, `test/release/release-build.test.ts`, ADR-0022 |
| T2 distribution authority | `release.manifest.json → distribution`, `scripts/distribution-model.ts`, schema `docs/phase-9/release-manifest.schema.json`, `test/release/channels.test.ts` |
| T3 channels (9) | `packaging/{homebrew,scoop,winget,rpm}`, `scripts/channel-render.ts`, `scripts/package-linux.ts`, publish jobs, `docs/release/CHANNELS.md`, ADR-0023 |
| T4 parity CI | `.github/workflows/cross-platform.yml` (linux-arm64, macos arm64+x64, windows — full `bun test` + golden path each), `test/release/portability.test.ts`, `test/reliability/platform-guards.ts` |
| T5 update/rollback per channel | `src/update/channels.ts`, `src/update/atomic-updater.ts` (mandatory SHA256SUMS), `src/install/system.ts` delegation, `test/release/channel-update.test.ts` (3 tamper refusals + auto-rollback) |
| T6 Public Beta | manifest stability label (fail-closed validated), `scripts/beta-metric.ts` (PROVISIONAL until N≥30), nightly beta-install job, honest downloads page, `docs/release/7.1.0/known-limitations.md`, `.github/ISSUE_TEMPLATE/beta_feedback.yml`, `docs/beta/FEEDBACK.md` |
| Docs/runbooks | `VERIFYING_RELEASES.md`, `INSTALLATION.md`, `RELEASING.md`, `CHANNELS.md`, `CHANGELOG-CONVENTION.md`, ADR-0022, ADR-0023, known-limitations 7.1.0 |

## 5. Exit gate — with honest live-proof status

| # | Condition | Status |
|---|---|---|
| 1 | Tag-triggered pipeline builds all 5 targets + npm + deb/rpm + SHA256SUMS + SBOM and self-verifies | ✅ local-effect-tested end to end; ⏳ first **live** run pending (no runners here) |
| 2 | Every asset cosign keyless-signed + SLSA provenance, verifiable from Rekor | ✅ pipeline + verification tooling + contract tests; ⏳ live Rekor entry pending first tag |
| 3 | Channels publish from one hash authority; a broken/absent credential **fails** the release | ✅ contract-tested (fail-loudly secrets, evidence job); ⏳ first live publish pending |
| 4 | Cross-platform CI at full parity (4 runner families, same tier) | ✅ defined + enforced + locally green on Linux; ⏳ green checkmarks on win/mac/arm64 pending first CI run |
| 5 | Per-channel update/rollback with verified atomic updater; PM channels delegate with exact commands | ✅ effect-tested (loopback release feed, tamper refusals, rollback) |
| 6 | Public Beta labeled everywhere; no stable/GA wording; ≥99% install metric gated honestly | ✅ label fail-closed; downloads/roadmap truthful; metric PROVISIONAL until window fills |
| 7 | Floor intact: all pre-existing gates green, perf budgets met, work log complete | ✅ §3; flake recorded; incidents disclosed in `05-TEST-RESULTS.md` |

## 6. Claims NOT made (per contract + Art. XIX)

- **"stable"/"GA"** — nowhere; the tooling refuses the words in the label.
- **"signed releases" as a live fact for existing tags** — scoped to the
  pipeline and to tags it actually runs; VERIFYING_RELEASES.md says how to
  confirm per tag.
- **Windows/macOS/arm64 "supported" without CI evidence** — support matrix
  names this workflow as evidence; the live greens are owed by first run.
- **Enterprise compliance, SSO/SCIM, HA, SIEM** — Phase 10, untouched.

## 7. Phase-10 deferrals (recorded, owned)

Hosted apt/dnf repositories · snap/flatpak (rejected for now — ADR-0023,
review at 9.0.0 planning) · vendor certificates/notarization (Apple ID,
Authenticode/EV) · post-publish container smoke · provider canaries ·
enterprise identity/compliance/HA · human-moderated UX/a11y studies.

## 8. Constitutional sign-off

> I built this against the **XR Architecture Constitution**, not around it.
> The release manifest stamps every surface (Art. XXII); releases are signed
> and reversible by construction, with live proof scoped to evidence
> (Art. XXII/XXIII/IX.4); no claim exists without a mechanism and a test
> (Art. XIX); CI runs the same full suite on every tier-1 platform with
> detection-only exceptions (Art. XX); startup did not regress (Art. XII);
> no surface shows a card or link to something that does not exist
> (Art. X); and the label everywhere is **Public Beta**, because that is
> what is true.
