# XR — FIX LOG (Stage 4)

_Branch: `launch-audit/ship-readiness` off `d183179`. One finding = one commit. Cloud/control-plane untouched (only verified green, per scope fence). Commits are local; pushing/tagging is the OWNER's action (no repo creds in sandbox)._

## Wave 1 — Install & packaging (v1 blockers)

| Commit | Finding | Change | Regression test | Evidence |
|---|---|---|---|---|
| `4e9e9af` | L-002, L-003 | compile-sidecar real `--target` cross-compile + windows-arm64 triple; honest cross smoke skip; desktop-app.yml gains Intel-mac + native Windows-ARM legs; per-leg artifact slugs; arch-assert covers Windows triples; updater manifest arch-aware keys | `test/desktop/sidecar-targets.test.ts` (5), updater-manifest arm/x64 collision case | all 6 triples compiled locally → `file` confirms each arch (arm64 PE, x86_64 Mach-O, ELF aarch64…); native smoke PASS / cross SKIP exit 0; YAML parses; 126 release+desktop tests green |
| `b7a6a8a` | L-004 | bun-windows-arm64 CLI target end-to-end (build-matrix, release.yml zips + assemble assertion, bin/xr map, winget arm64 installer, scoop arm64 + autoupdate); channels restamped | `channels.test.ts` two-arch fixture + fail-closed-on-missing-arm64 case; arm64 build run: 97.3 MiB PE | `bun test test/release test/supply-chain test/update` 120→ green; `channel:check` ok |
| `4515b24` | L-008, L-016 | `json-version-only` + `toml-version` stamp kinds; tauri.conf.json (installer-visible identity) + Cargo.toml declared & converged (0.2.0→1.1.0); manifest comment declares mobile/cloud independent lines | `test/release/desktop-identity.test.ts` (5) incl. shipped-drift pin | `release:check` = **8/8 surfaces in sync at 1.1.0** |
| `ee9a75d` | L-006, L-009 | npm `files` drops `docs/`; unpdf pin 1.7.0 | clean-install proof + PDF extraction proof | tarball 16.9 MB→**2.4 MB**; install footprint 61→41 MB; **0 npm warnings**; `xr --version/help/doctor/skills` work from installed copy; doctor exit 1, unknown-flag exit 2; real PDF text extraction ("launch audit works") |
| `75781b3` | L-010 | `scripts/release-assets-check.ts` canonical-17 live gate; wired into release.yml after publish | `test/release/release-assets-check.test.ts` (4) | live vs v1.1.0 → exit 1 naming all 12 missing assets (the alarm that didn't exist) |
| `7e6b833` | L-012, L-013 | honest `?token=` bootstrap semantics (comment-only; behavior accepted & unchanged); remove `zz-authority-probe.yml` | behavior already suite-pinned (`test/daemon`) re-verified green | preamble verified by live probes in this audit |

**Wave-1 suite state: closed green at `bb95567` — typecheck (root+desktop) PASS; every `test/` directory + root files executed (0 failures, 13 declared platform-gated skips); 17/17 CI gates PASS.** Full monolith `bun run ci` was OOM-killed 3× by the 2 GB contended sandbox; the equivalent was executed per-chunk at head — CI on a real runner owns the canonical monolith number (see RELEASE_READINESS §0).

Two gate failures occurred during the audit and were the gates *working*: `size-gate` caught the F-08 docblock growth (waiver re-synced with dated reason), `ownership:check` caught F-07's unregistered script (map regenerated). Fixed in `bb95567`. The `release-assets-check` gate itself was proven in both directions: live vs real `v1.1.0` → exit 1 with all 12 missing artifacts named; offline complete fixture → exit 0; partial → exit 1.

## Wave 2 — Backend & security
All launch-critical backend/security items were already fixed by the owner between `662ac98d..d183179` and **re-verified live in this audit** (HOST 421, origin matrix incl. localhost, unknown-field 400, mobile wiring, fail-closed approvals, 282/283×401, traversal/symlink 400, gitleaks+osv green in CI). No code change needed in this pass; the evidence table is in XR_LAUNCH_FINDINGS §4.

## Wave 3 — Feature functional
CLI/daemon/install/packaging flows all driven with evidence (see READINESS go/no-go). Desktop GUI/mic/provider-keys/hardware items are sandbox-limited by physics, not by effort — each is marked with its CI/hardware proof path. Nothing in wave-3 scope was found broken beyond Wave-1 findings.

## Wave 4 — UX polish (P1-grade only)
No P1 polish defects found on the driven surfaces: CLI errors carry the ✗/Why/Fix contract, doctor is honestly exit-1 with the next action, npm install is warning-free post-F-06, error bodies are RFC-7807 with field fixes. P2s stay logged (L-014…L-019).

## Escalated (owner action required — never silently dropped)
- **L-001** — cut tag `v1.1.1` from fixed main; supply-chain tag⇔npm invariant will stay red until npm 1.1.x publishes (by design; steps in READINESS §3).
- **L-005** — Apple Developer ID + notarization env secrets; Windows signing (Azure Trusted Signing or OV); SmartScreen/Gatekeeper comms.
- **L-011** — `generate-updater-keys.ts --apply` + `TAURI_UPDATER_KEY` secret; dry-run an update cycle pre-launch.
