# Phase 9 — Audit Report (STEP 1)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Audited at:** `main` @ `2ec994a` (merge of PR #40, Phase 8) · **Audited by:** Phase 9 execution
**Rule applied:** the repository is the source of truth; every claim below was verified by reading
the code/config or running it locally (Bun 1.3.14, Linux x64).

---

## A. Phase 0–8 re-verification (the floor)

Mechanical evidence gathered locally on this checkout:

- `bun install --frozen-lockfile --ignore-scripts` → clean (52 packages)
- `bunx tsc --noEmit` → **PASS**
- full suite `bun test` → **2685 pass / 0 fail / 13 skip** (skips = live browser/a11y probes, skip cleanly) across 211 files
- `bun run release:check` → all 6 stamped surfaces in sync at 7.0.1 (Truth)
- `bun run claim-lint` → green, 8 evidenced claims
- `baseline:inventory`, `ci-capability-gate`, `api:schema:check`, `client:check`, `api:compat`,
  `boundaries` (dependency-cruiser), `size-gate`, `hot-path-lint`, `ownership:check` → **all PASS**
- `golden-path` (hermetic HOME/XR_HOME) → all 17 checks PASS, chain intact, uninstall effects verified
- `build:binary:local` → 94.0 MiB linux-x64 binary built, smoke (`--version`/`--help`/`doctor --json`) PASS

| Phase surface | Verdict | Evidence / note |
|---|---|---|
| Phase 0 — truth/release (`release.manifest.json` → 6 stamped surfaces, claim-lint) | **VERIFIED** | release:check/claim-lint green locally; `src/core/version.ts` generated file matches |
| Phase 1 — single-writer persistence + atomic updater + golden path | **VERIFIED** | `src/update/atomic-updater.ts` (binary/git/npm layouts), `src/update/selfheal.ts`; WriteGate busy-retry landed in `adeb2bd`; golden-path green; CI workflows exist |
| Phase 2 — unified substrate, acyclic boundaries | **VERIFIED** | `boundaries` + `size-gate` green; one execution path tests in `test/phase0/` |
| Phase 3 — lazy runtime + budgets + build matrix | **VERIFIED** | `scripts/build-matrix.ts` builds all 5 targets (linux-x64/arm64, darwin-arm64/x64, windows-x64); smoke runs natively; perf gates exist |
| Phase 4 — isolation + supply chain (cosign/SBOM/SLSA) | **VERIFIED with defect** | `supply-chain.yml` complete (gitleaks/osv+bun audit/license/SBOM-drift/trivy); `release.yml` signs — **but the SLSA job is broken (wire-less `outputs.digests`), see C.** |
| Phase 5 — routing | **VERIFIED** | `docs/phase5-routing/`, routing tests in suite (green) |
| Phase 6 — context | **VERIFIED** | `docs/phase6/`, context tests green |
| Phase 7 — ecosystem + Business OS graduated | **VERIFIED** | `docs/phase7-ecosystem/`, `extensions/business-os/`, ecosystem tests green |
| Phase 8 — versioned API + observability + WCAG 2.2 AA | **VERIFIED** | `api:schema:check`/`client:check`/`api:compat` green; nightly first-task survey; a11y gates (skips cleanly without browser) |

No Phase-0–8 regression detected. This is the floor Phase 9 must not break.

## B. Packaging / release / channel / CI inventory (current state)

| Surface | State | Verdict |
|---|---|---|
| `scripts/build-matrix.ts` | Builds 5 targets + native smoke; **not invoked by any workflow** | VERIFIED — orphan |
| `.github/workflows/release.yml` | Tag `v*` → gates → npm tarball + source archive → SHA256SUMS → SBOM → cosign keyless → GitHub Release → npm publish | PARTIAL — **broken: `provenance` job consumes `needs.build-and-sign.outputs.digests`, but `build-and-sign` defines no `outputs:`**, so `base64-subjects` is empty and the SLSA generator (which requires it, per slsa-github-generator docs) fails; `publish-npm` `needs: […, provenance]` is then skipped. **No tagged release has ever completed.** No per-target binaries, no changelog generation (`generate_release_notes: true` only), npm publish still references a long-lived `NODE_AUTH_TOKEN` secret despite its own comment claiming trusted publishing |
| `.github/workflows/cross-platform.yml` | macOS + Windows: typecheck + **unit subset** + golden path; honest skip notes for POSIX-only tests | VERIFIED — **subset, not full parity** |
| `.github/workflows/supply-chain.yml` | gitleaks + osv-scanner (pinned hash) + bun audit + license-check + SBOM drift + trivy | VERIFIED |
| `.github/workflows/nightly.yml` | golden path on Linux + inside container image; first-task survey (N=20 ≥ 0.95, Linux only) | VERIFIED — Linux-only |
| `.github/workflows/ci.yml` | typecheck, truth-gate, baseline, website, test, reliability, aggregate | VERIFIED |
| Native channels: Homebrew / WinGet / Scoop / .deb / .rpm / Snap | **none exist** anywhere in the repo | NOT-FOUND |
| npm channel | `publish-npm` job exists in release.yml | **REGRESSED** — npmjs.org latest is **3.1.5**; source is 7.0.1 (Art. XXII's exact failure mode) |
| Docker channel | `Dockerfile` + `docker-compose.yml`; image **built+scanned but never published** to any registry | PARTIAL |
| GitHub Releases feed | one release exists — **v3.0.0 with zero assets**; tags `v3.0.0/v4.3.0/v4.5.0/v7.0.0`, none with completed releases | **REGRESSED** |
| Binary-as-default distribution | `install.sh`/`install.ps1` download `xr-<os>-<arch>` from `releases/download/v7.0.1/` then fall back to source | **REGRESSED in practice** — the binaries are never attached to any release, so the default path always falls back to source; README claims binary is "the default distribution path" |
| Atomic updater (`src/update/`) | binary / git / npm layouts, blue-green swap + canary + rollback; `test/reliability/update-uninstall.test.ts` green | PARTIAL — **binary layout downloads without any checksum/signature verification** (Part 20 violation); channel-managed layouts (brew/winget/scoop/apt) not detected |
| Uninstall (`src/install/uninstall.ts`) | launcher + install dir + keep-data/purge modes, effect-tested | VERIFIED for install.sh/ps1 layout; channel layouts not detected |
| Known-limitations register | `docs/release/7.0.1/known-limitations.md`, reviewed 2026-08-03 | **STALE** — still claims "Releases are not signed … signing is not implemented" and "CI is Linux-only", contradicting `release.yml`/`cross-platform.yml` |
| Support matrix | `docs/release/3.1.6/SUPPORT_MATRIX.md` (old 3.1.6 era) + environment capability matrix (5.1 era) | **STALE/no current release-level matrix** |
| `CHANGELOG.md` | head is "XR 7.0.0 — 'Supremacy' (Phase 13)"; no 7.0.1 entry; no generator/convention | **STALE** |
| Beta/prerelease channel | none: README has no Beta label; no `-xxxx` tag handling in release.yml; no feedback template beyond `false_claim.yml` | NOT-FOUND |
| `docs/release/VERIFYING_RELEASES.md` | cosign `verify-blob` + sha256 + Rekor instructions for the npm tarball | VERIFIED (content) — needs per-target binary coverage |

## C. Gaps (ordered, mapped to Phase-9 tasks)

1. **G1 → T2/T1** — Release pipeline broken end-to-end (SLSA outputs wiring, npm skip). A tag push today cannot produce a complete signed release.
2. **G2 → T1** — Per-target compiled binaries (the declared default distribution) are never built, signed, or attached to a release; install.sh's default path is dead in practice.
3. **G3 → T5** — No integrity verification anywhere on the binary download path (install.sh, install.ps1, binary updater). Part-20 violation.
4. **G4 → T2** — npm channel generations behind (3.1.5) and release job can't complete to fix it; no prerelease dist-tag concept.
5. **G5 → T3** — Zero native package-manager channels (Homebrew/WinGet/Scoop/.deb/npm-verified/Docker-published); no channel-sync gate.
6. **G6 → T4** — macOS/Windows CI is a subset; not "full parity" (Phase-9 definition: typecheck + full unit + golden path).
7. **G7 → T6** — No honest Public-Beta label, no current support matrix, stale known-limitations, no prerelease channel, no install-success metric beyond Linux, nightly golden-path Linux-only, no beta feedback loop docs.
8. **G8 → T1.T2** — `CHANGELOG.md` stale; no conventional-commit changelog automation.
9. **G9 → T5** — Updater doesn't detect channel-managed installs; `xr update` on a brew/scoop/apt install would do the wrong thing or nothing.
10. **G10 → T2** — channel/claim gates in release.yml gate *some* steps; nothing enforces channel-version sync with the release manifest (no `channel:check`).

## D. Naming note

`docs/phase9/` (root) is the **historical XR 5.2 "Capability Ecosystem" phase** from the old numbering
— *not* this phase. Phase 9 (packaging/release) records its work in `docs/phase9-release/` to avoid
overwriting historical evidence.
