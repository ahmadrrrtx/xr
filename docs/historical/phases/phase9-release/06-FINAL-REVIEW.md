# Phase 9 — Final Review (STEP 10)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Reviewed:** `feat/phase9-packaging` @ 7.1.0 stamp · reviewer: Phase 9 execution
**Scope guard (PART 4):** packaging, cross-platform distribution, release engineering,
Public Beta only. No net-new product features; no Phase-10 enterprise work.

---

## 1. Part-24 final review checklist

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Repo is source of truth; Phases 0–8 re-verified before work | ✅ | `01-AUDIT-REPORT.md` §A — every phase VERIFIED by re-running its gates locally; the only pre-existing breakage found was in release distribution itself (C) |
| 2 | Constitution obeyed (XXII/XXIII/XIX/IX.4/XX) | ✅ | Signed per-target default distribution (XXII); "supported" = validated, tiered support matrix, partial never rounded up (XXIII); no claim without evidence — `claim-lint` green, 10 evidenced claims (XIX); honest labeling — Public Beta stamped from the manifest (IX.4); known-limitations register refreshed per release (XX) |
| 3 | No unsigned distribution path remains | ✅ | `install.sh`/`install.ps1` fetch SHA256SUMS first, fail closed (unavailable/missing entry/mismatch) — `test/release/installer-verify.test.ts`; `xr update` binary path verifies via `downloadVerified` |
| 4 | One canonical build → many channels | ✅ | ADR-0023; release.yml builds the 5-target matrix once → SHA256SUMS → sign → channels stamped FROM the signed sums; `channel:check` drift gate in `bun run ci` |
| 5 | Tests assert effects; no boundary `any`; no empty catches; fail closed | ✅ | 65 new tests; failure modes are asserted (integrity mismatch refused, missing sums refused, forced canary failure → pinned rollback dispatched, undeclared exclusion fails parity) — `05-TEST-RESULTS.md` §1–2 |
| 6 | No TODOs/placeholders shipped | ✅ | grep of the phase diff: no `TODO`/`FIXME`/`XXX` markers introduced |
| 7 | Incompleteness never masked | ✅ | §3 below + known-limitations register + SUPPORT_MATRIX asterisks + README status column carry the honest state of every channel/tier |
| 8 | The 4 forbidden claims absent | ✅ | (a) no "supported" without parity CI+golden path — SUPPORT_MATRIX/README tiers; (b) "signed releases" claim bound to the from-tag workflow + verifying docs, first Rekor entry honestly dated to the first tag; (c) no "stable/GA" — manifest `identity.stability: "public-beta"` with a validator that refuses `stable` for prereleases; (d) no enterprise/compliance claims — Phase 10 |
| 9 | Refactor pass on the phase diff | ✅ | shared checksum logic extracted once (`scripts/sums.ts`) reused by survey/update/installers; channel logic isolated in `src/update/channels.ts` behind the existing atomic-updater facade (Phase-1 selfheal/rollback reused, not re-implemented) |
| 10 | Docs coherent with code | ✅ | README install table + Compatibility tiers regenerated-consistent with SUPPORT_MATRIX; VERIFYING_RELEASES/RELEASING/CHANNELS/BETA written; stale "releases unsigned / CI Linux-only / 7.0.0 head" entries corrected |

The ADAPTER-ONLY gate fix (encoding matched to intent, porcelain-based, strictly stronger
on untracked files, exactly one excluded stamp constant) is recorded in `05-TEST-RESULTS.md` §2.

## 2. Part-13 exit gate, item by item

| Gate item | Verdict | Evidence |
|---|---|---|
| **G1 — T1: signed per-target default distribution (cosign keyless/SLSA/SBOM)** | ✅ machinery + local proof | release.yml: 5-target matrix → SHA256SUMS over every publishable artifact → SBOM (CycloneDX) → cosign keyless sign-blob (Rekor) → SLSA provenance consuming the assemble job's REAL `outputs.digests` (the wire-less predecessor bug is fixed and covered by `test/release/release-workflow.test.ts`); VERIFYING_RELEASES.md gives the exact verify commands. Live Rekor entry: first tagged release (stated, not masked). |
| **G2 — T2: automated release-from-tag** | ✅ | tag push → gates (`release:check` + `claim-lint` + `channel:check` + `platform:parity:check` + `changelog:check`) precede any artifact; GH Release prerelease-aware (`-beta.N` → prerelease → npm beta dist-tag, `latest` untouched); npm OIDC trusted publishing (NODE_AUTH_TOKEN removed); GHCR + cosign; channel stamp last, from signed sums |
| **G3 — T3: native package-manager channels** | ✅ bounded | Homebrew tap (gated on `HOMEBREW_TAP_PUBLISH`+secret), WinGet, Scoop, .deb generated+drift-gated; .deb real `dpkg -i`/`-r` on every PR (tier-1) and weekly real channel installs (tier-2); npm + Docker wired. **.rpm/Snap/Flatpak deferred** with written closure requirements — never claimed |
| **G4 — T4: cross-platform full-parity CI** | ✅ | `cross-platform.yml`: one matrix (ubuntu/macos/windows), typecheck + FULL suite (`--os`-resolved, 4 documented win32 exclusions guarded by `platform:parity:check`) + golden path per OS, `shell: bash` uniformity; suite's own OS-guards keep skips honest |
| **G5 — T5: per-channel atomic update/rollback/uninstall** | ✅ | `src/update/channels.ts` detects the install channel and delegates (`brew upgrade`/`scoop update`/`winget upgrade`/`apt-get --only-upgrade`/npm pinned), binary/git layouts keep the Phase-1 atomic swap; canary failure dispatches the pinned rollback of the channel (`brew install xr@<prev>` etc.); uninstall summary reports channel + manager delegation; golden path asserts install→answer→audit-chain→restart→recovery→uninstall-effects green @ 7.1.0 |
| **G6 — T6: Public Beta** | ✅ | manifest `stability: "public-beta"`; BETA.md (label semantics, prerelease channel, promotion rule, feedback loop + issue template); SUPPORT_MATRIX.md (evidence-bound tiers); known-limitations register @ 7.1.0; nightly beta-install survey metric (≥99% target) — locally 3/3 @ p95 795 ms; feedback → work loop documented |
| **G7 — the floor stays green** | ✅ | full suite 2750 pass / 0 fail / 13 skip (segments; §1 of 05); all 14 ci gates PASS; perf gate PASS (9/9 budgets); supply:check PASS; golden path PASS; binary build+smoke PASS |

## 3. Explicitly not validated here (requires first tagged release / hosted runners)

1. Real Rekor transparency-log entries + real SLSA provenance for v7.1.0 (no tag pushed
   from the sandbox; workflow + verify docs + fail-closed consumers are in place).
2. Real macOS/Windows suite executions and native smokes (parity gate validated locally;
   runner evidence lands on merge/tag).
3. Real `brew`/`winget`/`scoop`/`apt` installs against published assets (weekly tier-2
   job + stamped manifests + local dpkg validation cover the mechanics).
4. npm trusted-publishing OIDC exchange (first tag is the first live run).

## 4. Deferred to Phase 10 (recorded, not started)

- Enterprise identity (SSO/SCIM), HA, remote execution, compliance certifications.
- `.rpm` (needs rpmbuild + `dnf install` CI validation) and Snap/Flatpak (needs
  snapcraft/flatpak-builder + store/local install test).
- Native arm64 Linux lane (needs an arm runner), macOS x64 native smoke.

## 5. Constitution-compliance statement

> This phase shipped distribution, release-engineering, cross-platform parity, and Beta
> evidence machinery only. Every distributed artifact path verifies integrity and fails
> closed (Art. XXII); every "supported" statement is bound to named CI evidence, with
> partial tiers never rounded up (Art. XXIII); every public claim passed `claim-lint`
> against committed evidence, and the absence of sandbox-producible evidence (real Rekor
> entries, hosted macOS/Windows runs, vendor-channel installs) is stated openly rather
> than implied (Art. XIX, IX.4, XX). No enterprise capability is claimed or shipped.
> — Phase 9 execution, `feat/phase9-packaging`, 7.1.0 (Truth), Public Beta
