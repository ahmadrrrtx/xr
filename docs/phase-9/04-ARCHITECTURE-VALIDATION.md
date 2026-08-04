# Phase 9 — STEP 4 Architecture Validation

Each task validated against the Constitution *before code*. The twelve ADR
decision rules (Part Five) are applied; a violation would redesign the task.

## T1 — Signed per-target default distribution

- **ADR-2 single authority:** signing/verification logic lives in ONE place
  (`scripts/release-build.ts` for the pipeline, `scripts/verify-release.ts` as
  the only verifier). The workflow is a thin caller. PASS — no second release
  pipeline.
- **ADR-3 substrate:** the Phase-3 build matrix and Phase-4 cosign/SBOM/SLSA
  scaffolding are real and green; Phase 9 *completes* them (fixes SLSA subjects,
  adds binaries). PASS.
- **ADR-4 authority-isolation:** signing uses the reusable GitHub OIDC identity
  (no long-lived keys); only maintainer tags reach signing identity. PASS.
- **ADR-10 evidence:** "signed per-target" claim links to the release workflow
  run + Rekor entries; until the first real tag ships, the claim carries the
  Phase-0 honesty marker (machinery proven by local dry-run + tests; live Rekor
  proof pending *by definition* — Art. IX.4). PASS with recorded caveat.
- **Verification test:** per-target `cosign verify-blob` (CI, on tag) +
  `scripts/verify-release.ts` (sha256/SBOM/SLSA/local-Ed25519 in tests).

## T2 — Automated release-from-tag

- **ADR-2:** one `release.yml`; no separate "prerelease pipeline" (prerelease is
  a property of the tag + manifest channel). PASS.
- **ADR-5 local-first:** releasing requires GitHub (the forge), install/run do
  not. PASS.
- **ADR-7 complexity:** reuses `build-matrix.ts`, `sbom.ts`, `verify-release.ts`,
  `release-manifest.ts`, `claim-lint.ts`; adds one generator
  (`scripts/changelog.ts`, conventional-commit grouping). PASS.
- **Gate hardening:** adds `golden-path` + the `test/release` suite to the
  release gate (above the Phase-0 floor of release:check + claim-lint +
  typecheck). **Fail-closed on tag mismatch** (tag version must equal manifest
  version — else abort; prevents shipping an unstamped identity).
- **Verification test:** `test/release/release-build.test.ts` (local end-to-end
  release to a temp dir) + `test/release/release-gate.test.ts` (seeded drift /
  seeded prohibited claim fail the gate).

## T3 — Native channels (one canonical build → many channels)

- **ADR-1 boundary:** `packaging/` is build/distribution config, not product
  code (L-outside concern; equivalent to `scripts/`). No new product module.
  PASS.
- **ADR-2 single authority:** the manifest `distribution` section stamps every
  channel manifest; `release:check` fails on channel drift. This *closes* a
  current unauthored surface rather than adding an authority. PASS.
- **ADR-6 outcome:** install per channel ≤ 2 commands; versions provably in
  sync. PASS.
- **Decisions recorded (ADR-0022, ADR-0023):**
  - **Homebrew tap + Scoop bucket:** own repos updated by the release workflow
    with a cross-repo token — gated: if `TAP_TOKEN`/`SCOOP_TOKEN` secrets are
    absent the jobs **fail the release loudly** (never silently skip; a channel
    the manifest lists must publish). Repository secrets are operator setup
    (documented), not code.
  - **WinGet:** submission PR to `microsoft/winget-pkgs` via `wingetcreate`
    (that's how the ecosystem works); manifest templates shipped in-repo and
    stamped; submission job gated on `WINGET_TOKEN`. Honest: winget availability
    lags one PR review.
  - **.deb/.rpm:** built by `scripts/package-linux.ts` (`.deb` natively —
    deterministic ar+tar, no external tooling; `.rpm` via `rpmbuild` on the CI
    runner). Same canonical binary inside; postinst adds no magic (binary to
    /usr/bin/xr via the xr wrapper-free layout — the compiled binary *is* the
    payload; no Bun dependency).
  - **Snap/Flatpak:** **rejected for Phase 9** (ADR-7: confinement manifests
    need per-distro confinement validation infra we do not have; "supported"
    means validated, and we cannot validate them this phase; recorded as a
    deferred channel with re-entry criteria). Rejection documented in
    known-limitations.
  - **Docker:** GHCR publish with digest signing (R7).
  - **npm:** OIDC trusted publishing (R4).
- **Verification test:** `test/release/channels.test.ts` (manifest-driven
  validity of every channel file; real `.deb` build + structural inspection;
  hash wiring against SHA256SUMS; formula/manifest parse).

## T4 — Cross-platform full parity

- **ADR-9 performance/scope:** full suite on 3 OSes costs CI minutes, not user
  startup; parity is the roadmap's meaning of "supported." PASS.
- **Skip discipline:** whitelisted skips move **into** tests via runtime
  detection (POSIX-only crash injection; POSIX-path policy corpus; win32
  cli-spine note) with a portability guard test listing the only allowed skips
  (fail-closed: an unlisted skip fails the guard). PASS (Art. XX.5).
- **Support matrix:** generated (`scripts/support-matrix.ts`) from manifest
  tiers + CI job names as evidence links; hand-editing is a `release:check`
  failure. PASS (one truth).
- **Verification test:** `test/release/portability.test.ts` +
  `test/release/support-matrix.test.ts`; CI itself is the tier-green evidence
  (recorded in the completion report as PR-run evidence).

## T5 — Per-channel atomic update/rollback/uninstall

- **ADR-2:** ONE updater (`src/update/`) extended, never duplicated;
  channel-delegation is a mapping, not a second updater. PASS.
- **ADR-11 compatibility (+ Art. XXIII):** existing binary/npm/git contracts
  unchanged; new: install records `install.json` (channel, layout, version,
  installedAt) — additive, defaulted absent → treated as legacy binary/git
  (reversible, no data migration; CLI grammar unchanged). PASS.
- **PM-owned channels:** Homebrew/Scoop/WinGet/apt own their own
  atomicity+rollback (brew pin / `winget install --version`, snap revert etc.);
  XR's `xr update` detects the channel and **delegates with the exact printed
  command, and prints the exact rollback command** (tested as command
  generation, never by invoking a user's PM in tests). XR-owned channels
  (direct binary, npm, git) keep the atomic blue-green with canary+rollback.
- **Integrity at update (R4):** the binary update plan now downloads
  `SHA256SUMS` first and refuses a candidate whose hash is absent or
  mismatched; `install.sh`/`install.ps1` verify the binary against the release
  checksums when present (fail-closed where the sums exist; the source-checkout
  fallback remains for *platforms without a binary*, honestly stated).
- **Verification test:** `test/release/channel-update.test.ts` (happy path,
  forced-failure rollback, tampered-hash refusal, per-channel command mapping,
  uninstall-mode matrix).

## T6 — Evidence-bound Public Beta

- **ADR-10 evidence:** "Beta" label everywhere; **every** counter-claim
  (install-success, golden-path) is generated from recorded metrics; the
  register and matrix are stamped artifacts. No GA language; claim-lint's
  supervised terms catch "stable/production-ready" drift. PASS.
- **Downloads page honesty (P11):** fictional editor cards and dead `#`
  downloads are REMOVED (deletion budget, Art. XXIV.1 — removing fabricated
  surface before adding real surface); the page shows only channels that exist
  in the manifest, each with its real install command and the verification
  section. False "Node 20+" claim removed (Bun).
- **Prerelease channel:** semver `-*` tags → GitHub prereleases; release-feed
  script resolves stable/beta channels for updater + docs.
- **Feedback loop:** `.github/ISSUE_TEMPLATE/beta_feedback.yml` +
  `docs/beta/FEEDBACK.md` (triage → acceptance criteria; mirrors the
  false_claim.yml precedent).
- **Staged rollout:** within GitHub Releases the stages are: prerelease
  (`-*` tags, beta channel) → stable (`v*`); per-channel publish jobs run in
  the same pipeline after the signed GitHub release exists (canary-in-pipeline:
  a channel that fails publishing fails the release, blocking `latest`
  promotion for Docker/npm). Documented in RELEASING.md.
- **Verification test:** `test/release/beta.test.ts` (label consistency from
  manifest; metric aggregation + threshold gate math; feedback template
  presence) + `test/release/downloads-page.test.ts` (page ⟷ manifest channels).

## Phase-0–8 regression re-check (plan-level)

- No change to runtime/agent/kernel surfaces except: `src/update/` (additive),
  `src/install/uninstall.ts` (channel-aware modes), `src/install/system.ts`
  (`xr update` delegation). All covered by existing suites + new tests.
- `release:check`/`claim-lint` stay the truth gates; new stamped surfaces make
  them *stronger*, not weaker (more drift caught).
- Perf: `install.json` write is off hot path; the CLI's `--version` budget
  untouched (no new eager imports — update/import paths stay dynamic; hot-path
  lint stays green — proven by `bun run ci`).

**Validated.** No plan item violates an Article; exceptions: none (the
snap/flatpak deferral is a *rejection*, recorded with rationale/owner/review —
not an exception to an Article).
