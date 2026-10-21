# XR — LAUNCH FINDINGS (Stage 3)

_Repo `ahmadrrrtx/xr` @ `d183179` (2026-10-20). Every finding carries reproduced evidence from this sandbox or public CI/API. Severity: **P0** launch-blocker · **P1** release-quality · **P2** polish. Status legend: OPEN / FIXED(in this pass) / ESCALATED(owner action with exact steps)._

## 0. Prior-audit disposition (the attached master audit audited `662ac98d`, 20 commits back)

Its in-scope P0/P1s were **fixed by the owner since** and **re-verified by me live** on HEAD:

| Prior ID | Item | Re-verification on d183179 |
|---|---|---|
| P0-1 / P0-2 | legal identity + deletion copy (website) | fixed in `1d34563`, `dd96bf7` — out of launch scope, CI `placeholder-lint` green |
| P1-1 | mobile routes unwired / `--lan` ignored | fixed `edca982` — mobile routes wired; serve-lan real; probe: anon `/api/mobile/*` → 401 (not 404) ✓ |
| P1-2 | fabric approval gate fail-open | fixed `c9d712d`+`3d1a349` — fail-closed matrix tests in suite (green) ✓ |
| P1-3 | localhost origin 403 | fixed `19af69d` — live matrix: 127.0.0.1/localhost/[::1] → 200, evil → 403, no-origin → 403 ✓ |
| P1-4 | unknown flags exit 0 | fixed `b801543` — live: `--nonsense-flag`/`--yolo` → exit 2 + Why/Fix ✓ |
| P1-5 | no Host-header check | fixed same commit — live: `Host: evil.example` → **421** ✓ |
| P1-6 | unknown write fields phantom 200 | fixed `b451651` — live: 400 + accepted-field list ✓ |
| P1-11 / P2-15/16/17 | docs-drift gates, branch/workflow hygiene | addressed `9c92a34`, `b801543` (see L-014 residue) |

Still-standing prior items relevant to launch: voice bundling (P1-12, P2-log), A1 authority macOS/Windows BLOCKED (self-declared, fails closed — documented), SmartScreen/signing (rolled into L-005/L-011), desktop bundle chunk 1.15 MB (P2), 473 open WorkspaceStore handles at suite exit (test-hygiene P2), bot/personal-assistant peer gaps (out of v1 scope).

## 1. P0 — launch blockers

### L-001 · P0 · packaging/release · the v1.1.0 release is materially incomplete — npm 1.1.0 was never published; no CLI binaries or Windows desktop installer exist for it
- **Evidence:** GitHub Releases API (2026-10-20): `v1.1.0` assets = `XR-1.1.0-1.x86_64.rpm`, `XR.app.tar.gz`, `XR_1.1.0_aarch64.dmg`, `XR_1.1.0_amd64.AppImage`, `XR_1.1.0_amd64.deb` — **nothing else**. Compare v1.0.0 (full set incl. CLI binaries + SHA256SUMS + npm tgz). Release run `38663173550` (tag v1.1.0): **gates job FAILED** ("Identity + claim + channel gates" → typecheck needed desktop deps, fixed later by `79ba88f`) → assemble/sign/npm/release/channels all skipped. npm registry: `@rrrtx/xr` latest = **1.0.0** (2026-09-08). Repo consequence: supply-chain job **"tag ⇔ npm invariant" is RED on main today** (run `39444949724`).
- **User impact today:** `install.sh` v1.1.0 → `releases/download/v1.1.0/SHA256SUMS` 404 → silently falls back to **source checkout** (slow path, needs Bun); `npm i -g @rrrtx/xr` installs **1.0.0**, not the tree's 1.1.0; Windows users have **no v1.1.0 installer at all**; winget/scoop/homebrew 1.1.0 in-repo manifests point at URLs that 404.
- **Leader note:** leaders gate releases on completeness before publish (Claude/Codex attach per-arch binaries atomically).
- **Fix:** (a) repo-side (this pass): Wave-1 fixes below make main green-ready; (b) **OWNER ACTION**: cut tag `v1.1.1` (not re-tag 1.1.0 — npm invariant + winget version churn) from fixed main; verify asset completeness checklist in `RELEASE_READINESS.md`; then `winget`/`scoop`/`homebrew` submissions (channels job stamps real SHA256s only after sign succeeds).
- **Effort:** S (owner) after repo waves land. **Status: ESCALATED (owner tag action) with repo-side fixes in this pass.**

### L-002 · P0 · packaging · no Windows ARM desktop installer leg exists
- **Evidence:** `.github/workflows/desktop-app.yml` bundle matrix = only `x86_64-pc-windows-msvc`; `scripts/compile-sidecar.ts` TRIPLES has no `windows-arm64` mapping (emits "unsupported host" on an arm64 runner).
- **Comparison:** `windows-11-arm`/`windows-11-vs2026-arm` native runners are GA (Aug 2026); Tauri ARM64 bundling = NSIS; native legs are the current best practice (sidecars match arch). Verified in sandbox: `bun build --target=bun-windows-arm64` produces a valid ARM64 PE32+ engine today — the gap is purely wiring.
- **Fix:** Wave-1 — add TRIPLES entry + real `--target` cross-compile, native `windows-11-arm` bundle leg with ARM-scoped assertions. **Status: FIXED (this pass, F-04 in FIX_LOG) — runtime smoke on real ARM hardware remains documented-unverified (CI proof-path).**

### L-003 · P0 · packaging · no Intel macOS desktop build
- **Evidence:** bundle matrix = `aarch64-apple-darwin` only; v1.1.0 dmg is aarch64-only. CLI binaries do cover darwin-x64 (asymmetry).
- **Fix:** Wave-1 — cross-compile leg `x86_64-apple-darwin` on `macos-latest` (Apple toolchain cross + real bun `--target=bun-darwin-x64` sidecar — compile-sidecar previously did rename-only cross, silent-mismatch hazard); assertion step already exists. **Status: FIXED (this pass); x64 sidecar runtime smoke skipped-on-cross, documented (Rosetta optional follow-up).**

### L-004 · P0 · packaging · no windows-arm64 CLI binary
- **Evidence:** `scripts/build-matrix.ts` TARGETS lacks it; `release.yml` windows leg builds only `windows-x64`; verified bun 1.3.14 builds `bun-windows-arm64` fine in sandbox (102 MB ARM64 PE).
- **Fix:** Wave-1 — add target + release.yml targets + arm64 zip + winget/scoop arm64 installer entries (channel-manifest). **Status: FIXED (this pass).**

### L-005 · P0 · packaging · installers unsigned; macOS notarization absent; SmartScreen/Gatekeeper first-run reality undocumented
- **Evidence:** desktop-app.yml header ("code-signing/notarization keys are owner secrets… artifacts are honest 'CI builds'"); only `TAURI_SIGNING_PRIVATE_KEY` (updater) secret is plumbed; no `APPLE_*` / Windows signCommand wiring; tauri.conf.json has no signing config. Late-2026 sources: EV no longer buys instant SmartScreen reputation; notarization remains mandatory for Gatekeeper.
- **Fix (owner, secrets):** Apple Developer ID + notarization creds as env secrets (tauri-action picks them up natively); Windows: Azure Trusted Signing or OV cert + `bundle.windows.signCommand`; submit to Microsoft portal; publish bypass docs. Repo-side (this pass): launch docs + readiness checklist + verified unsigned-first-launch behavior write-up. **Status: ESCALATED with exact steps (RELEASE_READINESS §4).**

## 2. P1 — release quality

### L-006 · P1 · npm · tarball ships `docs/` — 20 MB of 27.8 MB unpacked (72%)
- **Evidence:** `npm pack --dry-run` 2026-10-20: 16.9 MB tgz / 27.8 MB / 2,268 files; `du` docs=20 MB. Runtime reads of repo-root `docs/`: none (grep-verified; only virtual-FS writes & comments). Leaders ship few-MB wrappers.
- **Fix:** Wave-1 — remove `docs` from `files` (README/LICENSE stay); verified via real `npm i -g` of new tarball + suite. **Status: FIXED (F-06).**

### L-007 · P1 · npm · `@rrrtx/xr` needs Bun at runtime; leaders resolve a native binary — plus install-time footprint 61 MB
- **Evidence:** clean `npm i -g` of tarball: works (bin shim OK, actionable 127 w/o bun, `v1.1.0 (Graphite)`, doctor honest exit 1); footprint 61 MB (docs 20, nested deps 29 incl. `playwright`+`playwright-core`, src 8.2). Browsers are NOT auto-downloaded (lazy) — verified.
- **Comparison:** Claude Code npm: downloads native binary, Node never used; Codex/Gemini: binary or Node.
- **Fix:** v1 = docs-trim (L-006) + README matrix stating the two channels plainly. P2 recommendation (owner): postinstall/platform-optionalDeps binary resolution. **Status: partially fixed (size); runtime-model logged as P2-L-007b.**

### L-008 · P1 · versioning · desktop identity surfaces are not in the sync gate — Cargo.toml is drifted right now
- **Evidence:** `release:check` covers 6 surfaces only; `desktop/src-tauri/Cargo.toml` = **0.2.0** vs 1.1.0 everywhere; `tauri.conf.json` (the value users actually see on installers) is correct *by luck*, unguarded.
- **Fix:** Wave-1 — add `tauri.conf.json` + `Cargo.toml` as stamp/check targets; align Cargo to 1.1.0. **Status: FIXED (F-05).**

### L-009 · P1 · npm/engines · `unpdf` resolves to 1.9.1 under npm (requires Node ≥22) while root `engines.node` says ≥20 → EBADENGINE noise; bun.lock pins 1.8.1 (drift between channels)
- **Evidence:** clean npm install log (EBADENGINE unpdf@1.9.1 vs node v20.20.2); `bun.lock`=1.8.1.
- **Fix:** pin `unpdf` to `1.8.1` exactly (matches lockfile; its engines cover Node 20). **Status: FIXED (F-06).**

### L-010 · P1 · release-gate · no CI proof that a tag's GitHub Release gained the required asset set (the L-001 failure mode is invisible until users hit 404s)
- **Fix:** Wave-1 — extend `scripts/verify-release.ts`/release.yml "Verify signed artifacts" with an **asset-completeness assertion** (required pattern list incl. windows-arm64 + both mac arches) so an incomplete release fails loudly in the tag pipeline. **Status: FIXED (F-07).**

### L-011 · P0-escalate · desktop · updater never provisioned (no pubkey, TAURI_UPDATER_KEY secret never referenced to exist)
- **Evidence:** `updates.rs` honest unprovisioned state (`configured_pubkey()` none); tauri.conf has no `plugins.updater.pubkey`; workflow comment says empty secret ⇒ honest no-sig.
- **Owner steps:** `bun run scripts/generate-updater-keys.ts --apply` → commit pubkey → set `TAURI_UPDATER_KEY` GH secret — dry-run a real update cycle pre-launch (RELEASE_READINESS §3). **Status: ESCALATED; fail-closed UX verified in code.**

## 3. P2 — polish (logged, not chasing in this pass)

- **L-012 · daemon/auth copy** — `?token=` bootstrap mints a session cookie equal to the bearer token, valid for daemon lifetime; code comments call it "one-time". Risk: low (loopback, Host-gated, hidden-by-default token since Phase 2.5). Fix: comment/docs honesty (+ real per-session ids as follow-up). **Status: FIXED (comment honesty, F-08).**
- **L-013 · hygiene** — `.github/workflows/zz-authority-probe.yml` leftover (branch-scoped to stale `Stage-1`; inert on main). **Status: FIXED (removed, F-09).**
- **L-014 · desktop** — router chunk 1.15 MB (prior P2-23): lazy-route Builder/Research/Brain. P2 recommendation.
- **L-015 · engine** — 473 WorkspaceStore handles at suite exit (prior P2-8, grew +2). P2 test-hygiene.
- **L-016 · versioning doc** — `mobile` (28.0.0) / `cloud` (1.0.0) are independent version lines; manifest should SAY that to prevent "drift" misreading. **Status: FIXED (manifest comment, F-05).**
- **L-017 · voice** — nothing bundled on stock machine; wake = transcript regex (prior P1-12). Logged P2 for v1 scope; recommend `xr models install`-driven default pack for v1.1.
- **L-018 · engine** — zip/archive extraction surfaces enumerated by prior audit remain untested (their §21). Not probed in this pass either — carried as open verification task.
- **L-019 · old-OS minimums** — repo claims broad support; true minimums (WebView2 evergreen offline-bundled ✓ config; macOS floor = Tauri default) are hardware-unverifiable here — documented in readiness.

## 4. Security sweep status (launch-critical subset — all re-run on HEAD)
| Probe | Result |
|---|---|
| Unauth battery, 283 ops | 282×401 + health 200 ✓ |
| Host gate / Origin CSRF / rate limits | 421 / matrix pass / 429 wiring intact ✓ |
| Unknown write fields | 400 fail-closed ✓ |
| Traversal / encoded / absolute / symlink | 400 ✓ (Linux; A1 mac/win fail-closed-unsupported by declaration) |
| Approval fail-closed under no approver | suite-pinned (green) ✓ |
| Prompt-injection battery `xr attacks` | re-verified green in suite ✓ |
| Secrets (gitleaks) + vulns (osv + bun audit) in CI | green on HEAD run `39444949724` ✓ |
| SmartScreen/Gatekeeper unsigned UX | L-005 (owner) |
| Supply-chain posture | `--ignore-scripts` CI, SBOM, cosign, SLSA wiring present; v1.1.0 never used it (L-001) |

## 5. Cross-map coverage
Every F-01…F-18 flow and §1 inventory row in XR_FEATURE_MAP.md was either driven (CLI/daemon/install/packaging legs scripted above), suite-verified (engines/trust/execution), or explicitly marked sandbox-limited (GUI, mics, real OS hardware, provider keys, devices) — the full per-area status lives in `RELEASE_READINESS.md` go/no-go table.
