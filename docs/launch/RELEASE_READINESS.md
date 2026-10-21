# XR — RELEASE READINESS & LAUNCH CHECKLIST (Stage 5)

_Date: 2026-10-21 · Branch: `launch-audit/ship-readiness` (8 commits over `d183179`, head `bb95567`) · Scope: desktop app + CLI v1 (cloud/website-console untouched — verified green, not modified)._
_Sandbox truth: Linux x86_64 headless, 2 GB RAM, no GUI, no mic, no provider keys, no signing secrets, no Windows/macOS hosts. Anything that state cannot prove is marked with its proof path — never guessed green._

## 0. Final verification results at `bb95567` (executed this audit, this box)

| Check | Result |
|---|---|
| `tsc --noEmit` (root) + `tsc -p desktop/tsconfig.json` | **PASS** (exit 0 both, Node 20 runtime) |
| Test suites — **every `test/` directory + every root test file executed at head** (chunked runs; full monolith `bun run ci` OOM/thrash-killed 3× by the 2 GB contended sandbox — the equivalent executed per-chunk; canonical monolith = CI's job) | **0 failures** (≈4,5xx pass, 13 platform-gated skips: Windows install.ps1 ×6, a11y legs, mobile legs — all declared) |
| 17 CI gates: release:check (8/8 surfaces), channel:check, claim-lint, placeholder-lint, desktop:sink-lint, platform:parity:check, changelog:check, baseline:inventory, ci-capability-gate, api:schema:check, client:check, api:compat, boundaries, size-gate, hot-path-lint, ownership:check, website:marketplace:check | **17/17 PASS** at head (two gate failures during the audit — size-gate and ownership — were the gates correctly catching F-07/F-08 bookkeeping; both fixed in `bb95567`, proving the gates work) |
| `npm pack` → global install → CLI smoke (`--version`, help, doctor exit 1, unknown-flag exit 2) | **PASS** — tarball 2.36 MB, install footprint 41 MB, **0 npm warnings** (Node 20) |
| Daemon live probes (boot, auth wall, Host 421, CSRF matrix, unknown-field 400, traversal/symlink 400) | **PASS** (driven against a real booted daemon) |
| 6-way sidecar/CLI cross-compiles (win-x64/arm64, mac-x64/arm64, linux-x64/arm64) | **All produce correct-architecture binaries** (`file`-verified ARM64 PE, x86_64 Mach-O, ELF aarch64…) |
| `release:assets` completeness gate vs live v1.1.0 release | **Correctly FAILS (exit 1) naming all 12 missing artifacts**; offline fixture proofs: complete→0, partial→1 |

## 1. Go / No-Go (every mapped area × status)

✅ evidence-backed · 🟡 works-with-notes · ❌ not-ready (finding IDs)

| Area / flow (XR_FEATURE_MAP §) | Status | Evidence / note |
|---|---|---|
| CLI install (curl/ps1) | 🟡→✅ after re-tag | Scripts version-stamped + fail-closed on checksums; **live `v1.1.0` release lacks CLI binaries + SHA256SUMS → silent source fallback today** (L-001). Green the moment v1.1.1 ships complete. |
| Desktop — Linux x64 deb/rpm/AppImage | ✅ CI-build-proven | Assets exist on v1.1.0; GUI launch unverifiable headless. |
| Desktop — Windows x64 msi+nsis | ✅ CI-build-proven | Unsigned → SmartScreen note (L-005). |
| Desktop — Windows ARM nsis | 🟡 **CI-ready (fixed L-002/F-04)** | Native `windows-11-arm` leg added; arm64 sidecar + CLI produce ARM64 PE (sandbox-verified). Hardware runtime unverified — CI leg is the proof path. |
| Desktop — macOS arm64 dmg | ✅ CI-build-proven | On v1.1.0; unsigned/unnotarized (L-005). |
| Desktop — macOS Intel dmg | 🟡 **CI-ready (fixed L-003/F-01)** | Cross leg with real `--target` sidecar (x86_64 Mach-O verified); runtime smoke honestly skipped on cross. |
| First-run (CLI onboarding, desktop sidecar handshake) | ✅ / 🟡 | CLI driven; Rust engine states pinned by cargo tests; GUI runtime unverified. |
| Providers (26 presets, custom endpoint, key vault) | ✅ unit+CLI | Presets counted in code; SSRF guard in source; live failover needs keys (owner task). |
| Task run (plan→loop→approvals→budget) | ✅ | Suites green; approval fail-closed re-verified live. |
| Voice | 🟡 | Wake = transcript regex; no bundled models on stock machines (P2 L-017) — do not headline. |
| Builder IDE | 🟡 | Suites green; A1 authority fails closed outside Linux (declared); GUI unverified. |
| Research / multi-agent / memory | ✅ | Suites + 283-op daemon battery green. |
| Themes / updater / CLI update channels | 🟡 | winget+scoop now arm64-aware, fail-closed on unsigned sums; desktop updater unprovisioned — honest fail-closed UI (L-011 owner action). |
| Error paths / uninstall / budget cap / cancellation | ✅ | RFC-7807 + field fixes; `xr uninstall`/`reset` suites green; supervision suites green on Linux. |
| Daemon security posture | ✅ | Host 421 · CSRF matrix · 400s · traversal battery re-probed at HEAD; gitleaks green, osv = **0 unfiltered findings** after the advisory-driven upgrades (FIX_LOG wave 5). |
| npm package | 🟡→✅ after publish | Verified end-to-end from packed tarball; **registry still serves 1.0.0 until owner publishes 1.1.x** (L-001). |
| Version/identity gates | ✅ | 8/8 stamped surfaces incl. NEW tauri.conf.json + Cargo.toml (F-05). |
| Cloud/Business tier | ✅ untouched | Zero edits; cloud suite green in the chunks above. |

## 2. Release dry-run (proven end-to-end this audit)

`npm pack` → global install → `xr --version` ✅ → `xr doctor` (honest exit 1 + repair text) ✅ → help/exit-code contracts ✅ → daemon boot + auth/Host/CSRF/traversal batteries ✅ → uninstall suites ✅ → release-gates battery ✅.
**Proven in real CI on `19bc129f` (2026-10-21):** all five desktop bundle legs (Windows x64 + Windows arm64 + macOS arm64 + macOS x64 + Linux), Flatpak, cargo check/clippy + Windows shell tests, winget/scoop/brew stamped-vs-canonical structural validation, full unit/typecheck parity on 3 OSs, and the supply-chain battery (6/7; the only open job is the designed-red L-001 tag⇔npm alarm).
**Deltas no sandbox or CI lane can prove:** first-boot OS warnings for unsigned installers, GUI launch, ARM/Intel hardware runs, provider-key flows, updater cycle. Proof paths in §3/§4.

## 3. Owner npm-publish checklist (do in order)

1. Merge `launch-audit/ship-readiness`; CI green.
2. `release.manifest.json` → `1.1.1`; `bun run release:stamp`; commit.
3. `git tag v1.1.1 && git push --tags` → release.yml: gates → build 5 CLI targets (incl. **windows-arm64**) → assemble → cosign → publish → **`release-assets-check` gate must pass** (it fails the run rather than shipping a partial release — proven against real v1.1.0).
4. desktop-app.yml tag run green incl. **macOS x64** + **Windows ARM** bundle legs.
5. npm job publishes `@rrrtx/xr@1.1.1` with provenance → supply-chain tag⇔npm invariant returns green.
6. Channels job stamps REAL sha256s into homebrew/winget/scoop (incl. arm64 entries) → winget-pkgs PR / scoop bucket / tap bumps.
7. Verify locally: `bun run scripts/release-assets-check.ts --tag v1.1.1`; clean-container install.sh smoke; `npm i -g @rrrtx/xr` on Node 20 and 22.
8. README/npm page: channels table (binary = no runtime; npm = Bun required) before announcing.

## 4. Store/portal + signing per OS (owner)

- **macOS:** Developer ID cert + notarization env secrets (`APPLE_CERTIFICATE(_PASSWORD)`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, notary creds) — tauri-action signs + staples natively. Until then document right-click→Open.
- **Windows:** Azure Trusted Signing or OV via `bundle.windows.signCommand`; submit exe to Microsoft's portal to build SmartScreen reputation; **EV no longer buys instant reputation (Oct-2026 sources)** — expect a reputation window and document "More info → Run anyway".
- **Linux:** AppImage/deb/rpm proven; Flatpak manifest CI-gated (`workflow_dispatch`) — Flathub submission later.
- **Updater:** `bun run scripts/generate-updater-keys.ts --apply` → commit pubkey → GH secret `TAURI_UPDATER_KEY` → next tag emits `.sig`s + `latest.json` (manifest assembler now arm/x64-collision-safe) → dry-run an update cycle between two tags before claiming auto-update.

## 5. Known issues at launch (honest)

1. **v1.1.0 release is incomplete** (5 desktop assets only; npm = 1.0.0). Ship v1.1.1; do not announce 1.1.0 (L-001). Tag⇔npm invariant stays red until publish — by design.
2. **All installers unsigned/unnotarized** until §4 lands (L-005).
3. **Auto-update unprovisioned** until owner keys exist (L-011); UI says so honestly.
4. **Windows ARM + Intel-mac runtime proof = CI legs only** — no human has run them on hardware (L-002/L-003).
5. **Voice is not a stock-machine feature** (regex wake; models must be installed) — don't headline it (L-017).
6. **A1 filesystem authority fails closed (declared BLOCKED) on macOS/Windows**; Linux verified live.
7. **Desktop GUI never run by any audit** (no display anywhere) — owner first-boot checklist.
8. npm binary-resolution without Bun remains **P2**; v1 documents the Bun requirement (L-007; support matrix notes Node 22 for the newer optional PDF path).
9. Suite hygiene P2s: 473 WorkspaceStore handles at suite exit (L-015), desktop router chunk 1.15 MB (L-014).
10. Provider-canary CI and real-device matrix red without secrets/devices — expected and documented.
11. Full monolith `bun run ci` could not complete in this 2 GB sandbox (3 OOM-kills); every component was executed per-chunk at head with 0 failures — CI on a real runner owns the canonical monolith number.
