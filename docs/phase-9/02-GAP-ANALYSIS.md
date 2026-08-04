# Phase 9 — STEP 2 Gap Analysis

Ordered by dependency. Every gap maps to a task (Part 8) and to the test that
proves closure. Constitution checks pre-applied: no gap may be closed by an
unsigned path, a second source of truth, or a false “supported” claim.

| # | Gap (audited reality → required state) | Task | Proving test |
|---|---|---|---|
| 1 | Release builds only npm tarball + source archive → per-target compiled binaries are the default signed distribution (R1) | T1 | `test/release/release-build.test.ts` (local pipeline produces 5 targets + checksums + SBOM + sig bundles; verifier passes) |
| 2 | SLSA subjects miswired (`outputs.digests` absent) (R2) → subjects emitted from the build job and consumed by the generator per target | T1/T2 | `test/release/release-workflow.test.ts` (workflow contract test asserts subjects wiring + per-target sign steps exist) |
| 3 | No release has ever shipped (R3); installer binary path 404s | T2 | automated tag dry-run + `test/release/release-build.test.ts` end-to-end smoke; GitHub-side proof lands on next real tag (recorded, not claimed) |
| 4 | No checksum/signature verification at install or update (R4) | T5 | `test/release/install-verify.test.ts` (tampered artifact refused by `install.sh` verify step + binary update plan) |
| 5 | npm job claims keyless while using a token (R5) | T2 | workflow contract test; comment corrected to match mechanism |
| 6 | Manifest governs identity only (R6) → adds `distribution` (targets/channels/tiers/stability), one canonical build → many channels | T3 | `test/release/channel-sync.test.ts` (drift in any channel manifest fails `release:check`) |
| 7 | Zero native channel configs except npm (P3) → Homebrew tap, Scoop, WinGet, .deb/.rpm, Docker(GHCR) stamped from the manifest | T3 | `test/release/channels.test.ts` (schema-validate formula/manifests; build+inspect real `.deb`; assert sha256 wiring) |
| 8 | macOS/Windows CI = subsets (P4) → full `bun test` + golden path per OS; portable skips only via runtime detection | T4 | `test/release/portability.test.ts` (win32/darwin exclusions are detection-based, whitelisted); cross-platform workflow runs the full tier |
| 9 | No current support matrix (P7) → generated from manifest with per-OS tiers and evidence links | T4 | `test/release/support-matrix.test.ts` (generated file in sync; tiers reference CI evidence) |
| 10 | Updater covers 3 layouts, no PM channels, no release feed (P5) → channel-aware update: XR-owned channels atomic; PM-owned channels delegate with rollback instructions | T5 | `test/release/channel-update.test.ts` (binary update happy/forced-failure/tamper; PM channel returns correct delegate command — no side effects asserted in-place) |
| 11 | No prerelease channel semantics (P9) → `v*-*` tags publish marked prereleases; release feed distinguishes stable/beta | T2/T6 | `test/release/release-feed.test.ts` (stable/beta channel resolution from tags + manifest) |
| 12 | No changelog generator (P8) → conventional-commit generator feeds the GitHub release body; convention documented | T2 | `test/release/changelog.test.ts` (generated notes group typed commits; empty range produces explicit marker) |
| 13 | No beta label / install-success metric / feedback loop (P10) → manifest-declared Beta status stamped to surfaces; nightly beta install matrix records success rate; issue template + acceptance loop doc | T6 | `test/release/beta.test.ts` (label consistency from manifest; metric collector aggregates JSONL results; threshold gate math) |
| 14 | Website downloads page: dead cards + fictional editors + “Node 20+” (P11) | T6 | claim-lint stays green; `test/release/downloads-page.test.ts` (every card/steps on the page corresponds to a real channel in the manifest) |
| 15 | `release.manifest.json` `$schema` points to a non-existent file (audit §findings) | T1 | schema file created; release build test asserts manifest validates |
| 16 | Known-limitations stale entries (P6: “unsigned”, “CI Linux-only”) | T6 | register rewritten against post-Phase-9 reality; claim-lint green |
| 17 | VERIFYING_RELEASES.md describes an asset set the pipeline never produced (`provenance.json`) (R3) | T1/T2 | doc rewritten to the exact shipped assets; verification doc test asserts referenced filenames exist in the local pipeline output |
| 18 | No way to prove “release gate fails on drift/unsupported-claim” | T2 | `test/release/release-gate.test.ts` (seed version drift → `release:check` exit≠0; seed prohibited claim → `claim-lint` exit≠0) |

Constitution pre-checks on the plan:
- Art. XXII/XXIX — one manifest extended (not replaced) as the channel authority; no new claim surfaces outside it. PASS.
- Art. XXIII — every new update path keeps rollback (XR-owned: atomic; PM-owned: documented reversible instructions). PASS.
- Art. III.2 — support matrix *generated from* the manifest (one truth), not hand-maintained. PASS.
- Scope — no product features; packaging/release machinery only. PASS.
- Phase 10 — explicitly excluded (enterprise identity/HA/remote, snap/flatpak
  deferred by decision with rationale — see STEP 4).
