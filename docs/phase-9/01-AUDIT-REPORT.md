# Phase 9 — STEP 1 Audit Report

**Phase:** 9 · Packaging, Cross-Platform, Release Engineering & Public Beta
**Baseline audited:** `main` @ `2ec994a` (merge of PR #40, Phase 8) — matches the
expected Phase-8 head.
**Audit date:** 2026-08-04 · **Auditor:** autonomous coding agent (Agent Mode)
**Method:** every claim below is produced from the live repository, not from
reports. Reports (Deep Audit, phase completion reports, roadmap) were treated as
historical evidence only (Global Rule 1/2).

Each item is **VERIFIED** (present and proven against live evidence),
**CHANGED** (present but materially different from report), **NOT-FOUND**
(expected surface absent), or **REGRESSED** (present but broken).

---

## 1. Phase 0–8 floor re-verification

| Phase | Item | Command / evidence | Status |
|---|---|---|---|
| 0 | Truth & release identity — one release manifest stamps 6 surfaces; `release:check` + `claim-lint` green | `bun run release:check` → `all 6 surfaces in sync at 7.0.1 (Truth)`; `bun run claim-lint` → `no unsupported claims · 8 evidenced claims` | VERIFIED |
| 0 | Golden path (install → first answer → restart → resume → second answer → uninstall) | `HOME=/tmp/xr-audit-home XR_HOME=/tmp/xr-audit-data bun run golden-path` → `{"ok":true,"version":"7.0.1", …17 checks, chainValid:true}` | VERIFIED |
| 0/1 | Typecheck + full suite | `bun run typecheck` exit 0; `bun test` → 2684 pass / 13 skip / 0 fail (see 1.1) | VERIFIED |
| 1 | Single-writer persistence / atomic update-Uninstall machinery | `src/update/atomic-updater.ts`, `src/update/selfheal.ts`, `src/install/uninstall.ts` present; `test/reliability/update-uninstall.test.ts` green within full suite | VERIFIED |
| 2 | Unified substrate (one envelope/tool-registry/router/planner/context store; enforced L0–L6 boundaries) | `bun run ci` full composite exit 0 (boundaries cruise 521 modules, 0 errors; size-gate ok; hot-path-lint ok; ownership-map ok) | VERIFIED |
| 3 | Compiled runtime + budgets | `scripts/build-matrix.ts` builds `xr-linux-x64` (94.0 MiB, 1.3 s, smoke PASS); perf/hot-path gates inside `bun run ci` green | VERIFIED |
| 4 | Enforceable isolation + signed/SLSA/SBOM supply chain | `.github/workflows/supply-chain.yml` (gitleaks + osv + license + CycloneDX SBOM + trivy) present; `release.yml` cosign-keyless + SLSA scaffold present — **but see §2 R1/R2 (SLSA subjects miswired; binaries not in release)** | CHANGED |
| 5 | Explainable/measured routing | in full suite (routing quality tests), `bun run ci` green | VERIFIED |
| 6 | Measured/anti-poisoning context | `test/context/*` green; G6 p95 isolated run 20.8 ms vs 100 ms budget | VERIFIED |
| 7 | Provenance-linked ecosystem + Business OS graduated | full suite + `ci` green; docs/phase7-ecosystem/COMPLETION_REPORT.md | VERIFIED |
| 8 | Versioned API + privacy observability + WCAG 2.2 AA | `api:schema:check`, `client:check`, `api:compat` in `ci` green; a11y tests green | VERIFIED |

### 1.1 Known suite flake (recorded honestly, not masked)

The first full-suite run failed exactly one test:
`test/context/performance.test.ts > Phase 6 · G6: retrieval p95 < 100ms … at 100,000 stored items [1640 ms]`.
Isolated re-run: **12/12 pass, p95 = 20.80 ms** (≈5× headroom). In-suite the same
measurement spiked under CPU contention of 211 parallel test files inside a
constrained sandbox. This is the *already-documented* suite-shared-process flake
class (see git history `711cb61 fix(test): close performance-test store handles`).
The subsequent full `bun run ci` (which embeds `bun test`) passed end-to-end.
Status: **VERIFIED with recorded flakiness signature** — not a product regression.

---

## 2. Phase 9 surface audit (packaging / release / channels / CI / updater)

| # | Item (hypothesis from the prompt) | Reality in `main` @ 2ec994a | Status |
|---|---|---|---|
| P1 | Compiled binary (`scripts/build-matrix.ts`, Phase 3) — default distribution? | Build matrix exists and works locally. `bin/xr` launcher prefers `dist/<platform>` binary; `install.sh`/`install.ps1` try binary first, fall back to git checkout. **But** see R3: no release has ever published the binaries, so in production the binary path 404s and every install falls back to source. | CHANGED |
| P2 | `release.yml` automated from tag? cosign/SLSA/SBOM per-target? | Tag-triggered (`v*`) + workflow_dispatch; gate runs `release:check` + `claim-lint` + typecheck + test subsets; builds **npm tarball + source archive only**; SHA256SUMS; CycloneDX SBOM; cosign keyless `sign-blob` on tarball+SBOM+sums; SLSA generator job. **Per-target binaries: NOT built, NOT signed.** **SLSA subjects miswired (R2).** | CHANGED |
| P3 | Native channels: Homebrew/winget/scoop/deb/snap/npm/Docker | npm: publish job exists (real). Docker: Dockerfile exists, **no registry publish anywhere** — no image is published to any registry. Homebrew/winget/scoop/.deb/.rpm/snap/flatpak: **zero configs in repo** (grep-verified; the only `winget` occurrences install Ollama/FFmpeg dependencies, not XR). | NOT-FOUND (except npm = partial) |
| P4 | Cross-platform CI parity (macOS/Windows full or subset?) | `cross-platform.yml` runs macOS + Windows with **explicit subsets** (e.g. Windows excludes `test/execution`; both exclude most of `test/reliability`; several suites pre-skipped on win32). Linux runs everything. → **subset, not full parity.** | CHANGED |
| P5 | Atomic updater — channels covered? | `runAtomicUpdate` covers exactly three layouts: `binary` (direct GitHub-release download, **no checksum/signature verification**), `git`, `npm`. No homebrew/scoop/winget/deb channel awareness; no install-channel record. `xr update` reads target version from the *local* manifest (self version), no release feed. Uninstall: launcher+checkout+data only. | CHANGED |
| P6 | Known-limitations register | `docs/release/7.0.1/known-limitations.md` — current, reviewed 2026-08-03, honest. Its §1 "Releases are not signed / no SBOM or SLSA" and §4 "CI is Linux-only" entries are **stale** relative to Phase 4's `release.yml`/`supply-chain.yml` and Phase 1's `cross-platform.yml` (accurately reflecting, however, that no signed release has ever shipped — see R3). | CHANGED |
| P7 | Support matrix | Only `docs/release/3.1.6/SUPPORT_MATRIX.md` (historical). **No current support matrix at 7.0.1.** | NOT-FOUND (current) |
| P8 | Changelog generator (conventional-commits / git-cliff) | No generator, no cliff config. `CHANGELOG.md` is hand-written and opens with the historical "Supremacy" release header. Release notes on GitHub = `generate_release_notes: true` (auto blob, no convention). | NOT-FOUND |
| P9 | Prerelease channel | `release.yml` triggers on `v*` (matches `-*` tags) but never marks prereleases; no stable/beta channel semantics anywhere; no release feed. | NOT-FOUND |
| P10 | Public-beta machinery (label, install-success metric, feedback loop) | No beta label anywhere; website downloads page shows unsupported claims + dead cards (below); no install-success metric; `.github/ISSUE_TEMPLATE/false_claim.yml` exists (feedback path partially present). | NOT-FOUND |
| P11 | Website downloads page | Dead `href:"#"` cards for macOS/Windows/Linux downloads **and** five fictional editor integrations (VS Code/Neovim/JetBrains/Zed/Cursor never shipped); false environment claim "Requires Node 20+" (XR is Bun-only); unverified "≈40MB". | REGRESSED (claim-governance defect) |

## 3. Root-cause findings (R1–R6)

- **R1 — The compiled binary is not part of any release.** `build-matrix.ts`
  itself records the deferral: *"Signing is NOT performed here (Phase 9); the
  binary ships unsigned."* The release workflow never invokes it. The "default
  distribution" is therefore **aspirational**: present in install scripts,
  absent from every release.
- **R2 — SLSA provenance in `release.yml` cannot work as written.** The
  `provenance` job consumes `needs.build-and-sign.outputs.digests`, but
  `build-and-sign` declares **no `outputs:` at all** — the generator receives
  empty `base64-subjects`. On a real tag this fails or produces provenance for
  nothing. The Phase-4 claim of "SLSA build level 3" was never exercised on a
  real release (consistent with R3) and is non-functional scaffolding today.
- **R3 — No release has ever shipped at the current identity.** GitHub Releases
  contains exactly one release: `v3.0.0` (verified via API). There is no `v7.0.1`
  tag, no `v7.0.0` release object, no published binary/checksums/bundle assets,
  no published Docker image. Every "verify a release" instruction in
  `docs/release/VERIFYING_RELEASES.md` currently 404s for a user. Also the doc
  references a `provenance.json` asset; the SLSA generic generator uploads
  `*.intoto.jsonl` attestations — the doc describes an asset shape the pipeline
  never produced.
- **R4 — Integrity is not enforced at install/update time.** `install.sh`,
  `install.ps1`, and the binary update plan download artifacts and run them
  without verifying `SHA256SUMS` (available) or the cosign bundle. Art.
  XXII/Part-20 require checksum verification at install/update.
- **R5 — npm publish job is token-based, contradicting its own comment.** It
  says "no long-lived npm tokens" while injecting `secrets.NPM_TOKEN`.
- **R6 — One release manifest governs identity but not distribution.** There is
  no machine-readable record of targets/channels/support tiers/stability, so
  nothing enforces "one canonical build → many channels, versions in sync", and
  `release:check` cannot catch channel drift because no channel manifests exist.

## 4. Inventory (packaging/release/channel/CI)

**Exists:** `scripts/build-matrix.ts` (5 targets incl. smoke), `scripts/sbom.ts`
(CycloneDX w/ SPDX file), `scripts/verify-release.ts` (integrity+SBOM+SLSA+cosign/
Ed25519), `scripts/release-manifest.ts` (stamp/check), `scripts/claim-lint.ts`,
`install.sh`, `install.ps1`, `bin/xr` (binary-first launcher), `Dockerfile`,
`docker-compose.yml`, workflows `release.yml` + `supply-chain.yml` +
`cross-platform.yml` + `nightly.yml` + `ci.yml`, updater (`atomic-updater.ts`,
`selfheal.ts`), known-limitations (7.0.1, current-ish), release notes
(docs/release/7.0.1).

**Missing:** channel configs (Homebrew tap formula, scoop manifest, winget
manifests, .deb/.rpm builders, snap/flatpak), registry image publish, changelog
generator, prerelease/stable channel semantics, install-channel record,
checksum-verified install/update paths, current support matrix, beta program
(label/metric/feedback), release feed, distribution section of the manifest,
cross-platform full-parity CI, package-manager update/delegation semantics,
honest downloads page.

## 5. Gaps carried to STEP 2

Given live reality vs Constitution Art. XXII/XXIII/XXVIII/XXIX + Part-5 exit
architecture, the gap list (mapped to tasks) is:

- **G-T1:** binaries in release + per-target cosign/SLSA/SBOM + fixed SLSA
  subjects + verification path that matches reality → **T1**
- **G-T2:** one-command automated release-from-tag incl. changelog + prerelease
  semantics + gate hardening → **T2**
- **G-T3:** native channels (Homebrew/scoop/winget/.deb/.rpm/npm/Docker) stamped
  from one manifest, install-verifiable, versions in sync → **T3**
- **G-T4:** full-parity cross-platform CI + generated support matrix → **T4**
- **G-T5:** per-channel update semantics (XR-owned vs PM-owned) + checksum
  verification at install/update + rollback tests per channel → **T5**
- **G-T6:** beta label + prerelease channel + golden-path nightly extension +
  install-success metric + feedback loop + honest downloads page +
  known-limitations refresh → **T6**

*(Full STEP-2 gap→task→test mapping in `02-GAP-ANALYSIS.md`.)*
