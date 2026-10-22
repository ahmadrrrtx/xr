# Changelog

## Unreleased

### Known limitations

- **Linux arm64 (launch CI, 2026-10-22):** the CLI and the `linux/arm64` image install and run, but the file tools fail closed (`blocked:filesystem-unsupported`). Reading and writing workspace files needs Linux x64, macOS or Windows x64 for now. The Linux arm64 npm, binary and Docker journey legs are reported in the support matrix but no longer gate a merge. The refusal message now says so instead of implying any glibc Linux works.

### Changed

- **daemon (contract change):** `--lan` is now flag-only — the `XR_DAEMON_LAN` env var is removed; LAN mode is too loud to switch on implicitly. The operator-set `XR_DAEMON_TOKEN` is honored by the shipping daemon (wins over the generated token without being ever printed) so scripts/harnesses can drive `xr serve --lan`, where the banner deliberately shows the certificate fingerprint and pairing URL but no token material.
- **daemon:** §15#10 — the desktop bootstrap session cookie gains `; Secure` **iff the listener is LAN TLS**, and its `Max-Age` is now 2,592,000 s (30 days) in both modes; `HttpOnly`/`SameSite=Strict` are unchanged. Paired-device cookies are `HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` throughout.

- **execution (security):** the approval fabric no longer silently allows approval-requiring capabilities when the caller wires no `approve()` hook. The gate now refuses at policy evaluation — before environment admission or any side effect — pushing both `requires_approval` and `denied` policy decisions (code `approval_unavailable`, by `system:approval-gate`), recording outcome `{kind: "denied", stoppedReason: "approval"}`, transitioning the ledger to `deny` and persisting first, with an `execution.approval_unavailable` audit event. Approval need is now declarable: `CapabilityIdentity.requiresApproval?: boolean` wins over the kind rules and the legacy hardcoded core-tool list in both directions; the tool adapter passes `tool.requiresApproval` through and the control adapter declares it from its risk tier (safe actions still run unauth'd — now explicitly, in the fabric). Guarded by `test/execution/approval-default.test.ts` (10-test matrix incl. fail-before proof: 8 failures against the dormant gate) plus pre-existing lifecycle/golden/crash-recovery suites rewired with explicit approvers. Closes audit finding P1-2 (approval gate fail-open).
- **execution:** repaired two latent idempotency-record blind spots the flip exposed (probe-verified end-to-end): the `ON CONFLICT` upsert now refreshes `capability_kind`/`capability_name` (a row first persisted before action assembly kept `model_call`/summary-fragment defaults forever, so capability-keyed dedupe missed it permanently), and the pending public approval slot class is documented and enforced non-replayable at idempotency-claim time. Part of P1-2 follow-through.
- **daemon (contract change):** unknown request fields on mutating routes are no longer silently dropped — the versioned `/api/v1/*` mount now rejects them with a precise **400** problem envelope (`errors[]` names each dotted/`[i]` path and the accepted field set), while the legacy `/api/*` mount keeps its 200 and reports the dropped fields in a new **`x-xr-ignored-fields`** response header (≤10, sorted, deduped, plus an `api.ignored_fields` audit event) until the documented legacy sunset **2027-08-01** (`LEGACY_SUNSET_ISO`). Detection is a bounded schema walker (`body-strictness.ts`): declared objects and arrays are descended, optional/nullable/default unwrapped, unions/records/maps/catch-all bags treated as opaque so no legitimate body ever 400s; capped at 20 paths/depth 8 and it can never break a request. Response schemas stay loose for forward-compat. Sweep of handler-read-vs-declared fields (the gap class that made this dangerous) declared the real ones — `budget.set.autoFallback`, chat `mode/sessionId/model/provider/context`, onboarding `setDefault`, and a dedicated `agents.custom.import` schema that honestly round-trips exported-agent echo fields. The audit case is closed end-to-end: `{"usd": 50}` on `budget.set` can never again masquerade as 200 while persisting a phantom all-null `budget.update` event. Guarded by `test/daemon/body-strictness.test.ts` (20 tests, 12-fail stash proof) and `test/daemon/budget-audit-null-regression.test.ts` (2 tests — pre-fix they observe the phantom event, post-fix zero). OpenAPI + generated client regenerated (additive only; `bun run api:compat` passes). Closes audit finding P1-6 (phantom success).
- **daemon:** request-trust boundary — a Host gate now runs before auth and open paths and refuses any authority outside the loopback set (`resolveBindHost()` ∪ {`localhost`, `127.0.0.1`, `::1`, `[::1]}`) with **421 Misdirected Request** (RFC 9110 §15.5.21); a missing Host fails closed. Bearer tokens no longer defeat a spoofed Host. Closes audit finding P1-5 (DNS-rebinding posture).
- **daemon:** `originAllowed` now compares the Origin hostname against the same allowed-host set as the Host gate, so a session POST with `Origin: http://localhost:PORT` is accepted identically to `127.0.0.1` — port semantics, GET/HEAD/OPTIONS and bearer/bootstrap exemptions unchanged; missing or foreign Origin still fails closed (403). Closes audit finding P1-3.
- **daemon:** the per-IP rate-limiter keys on the real socket peer (`server.requestIP`, `"local"` in-process) — `x-forwarded-for` is only honoured when the operator opts in with `XR_TRUST_PROXY=1`. Closes audit §15 #27 (rate-limit bypass via spoofed forwarding header).
- **daemon (contract change):** the unauthenticated health probe (`/api/health` + `/api/v1/health`) now returns `{ok, ts}` only — `name`, `version`/`versionInfo`, `host`, `binding`, `auth` and `configCache` fingerprints are removed from the unauthed surface (`HealthResponse` schema, OpenAPI and the generated client regenerated; `bun run api:compat` passes). Closes audit finding P2-21. Guarded by the new `test/daemon/origin-host-guard.test.ts` (Host matrix ×3 auth kinds, Origin matrix 200/200/403/403, open-path latch, §15#27 both modes; 12 tests with a `git stash push -- src/` fail-before proof).

### Added

- **daemon (contract change):** mobile & LAN control path (`P1-1`) — `xr serve --lan` opens an explicit, fail-closed TLS LAN server with a full pairing and push companion protocol. The CLI prepares the material in `src/cli/serve-lan.ts` (`prepareLan`: zero-dep self-signed LAN cert with TOFU SHA-256 fingerprint in `src/daemon/lan-tls.ts` — SANs cover LAN IPs, hostname, `.local`, `xr.local`; VAPID warmed; optional `qrcode` renderer installed through the daemon's seam) and hands a typed `LanInput` into the shipping `serve()`, which stays the ONE daemon (unified `Bun.serve` + conditional TLS); a cert/VAPID failure exits non-zero, never an insecure fallback dressed as LAN. Pairing is a 6-digit on-demand code (10-minute TTL, single use, 10 attempts/min/peer, generic 401s) issued over QR/URL by the desktop; paired sessions ride an HttpOnly+Secure+SameSite=Strict cookie with SHA-256-hashed tokens in the device registry (`src/daemon/mobile-devices.ts`); revocation rotates the hash. At the EXISTING auth seam, bearer/desktop cookies tag `desktopPrivileged` while a paired-device cookie yields the narrow `mobile` kind (never a bearer bypass); the canonical mobileGate 403-walls files/terminal/git/mcp on BOTH mounts before any handler effect. Anonymous `/api/mobile/*` falls through with per-op roles (the TOFU fingerprint GET is public — `security: []` — everything else keeps its documented 401/403). All 11 ops register through the one router (`mobile.routes.ts` + `schemas-mobile.ts` + `contract-mobile.ts`): the same canonical mount, Phase-2.2 body validation, registry derivation, OpenAPI doc and generated client — 283 operations total, api:compat additive-only. After the real bind, `printLanBanner` shows the fingerprint (compare-your-phone TOFU), pairing URL and LAN addresses; off-LAN the group answers 404. Guarded by `test/daemon/mobile-lan-integration.test.ts` (6 tests incl. the §15#10 cookie matrix against real TLS `serve({lan})`), the shipping harness `tools/test-lan-flow-shipping.mjs` (25 checks against a real CLI child, token redacted), and the Web Push crypto crosscheck vs the reference implementation (A–D). Size-gate: server.ts waiver recorded with a dated split plan (`src/daemon/server-lan.ts`, review 2027-01-15); tree 171,997/172,000, 18 waivers.
- **daemon:** Web Push from the daemon to the browser's push service, no relay (`src/daemon/web-push.ts`): VAPID/JWT (ES256), RFC 8291+8188 aes128gcm, plus a second AES-GCM layer keyed by the device-generated pairing key so FCM/APNS relay ciphertext only; the keep-awake advisory stays honest (the desktop asleep = no push — the app says so in the banner and settings copy). `SanityFixtureAdapter` harness shapes for models/budget reads are now truthful (`selected.model`, `config.perTaskUsd`) after the fixture-drift fix (`P2-3`).

- **website:** `/accessibility` — an honest accessibility statement scoped to the Control Center surfaces the CI record covers (WCAG 2.2 AA target; status `automated-verified · manual-pass-pending-human`; verified vs pending split; `support@xr.rrrtx.ai` reporting route). Closes half of P2-10.
- **website:** `/imprint` — the legal-notice page, built verbatim from the identity Phase 1.1 published (publisher, entity, registered office, contacts, DPDP grievance officer); no new legal facts. Both routes are static and linked from the site footer. Closes P2-10.

### Fixed

- **installers (Windows):** `install.ps1` staged the downloaded binary as `.<name>.partial`, which Windows will not execute, so the "does it run" check always failed and every compiled-binary install fell back to the source archive. The candidate is now `.partial-<name>` (the `.exe` extension stays last). Found by the first Windows clean-machine journey run.
- **Windows (Bun 1.4 runtime):** Bun 1.4 refuses to spawn `.cmd`/`.bat` files without a shell (Node's CVE-2024-27980 hardening), and on Windows `npm`, `npx`, the npm `xr` launcher and npm-installed `bun` are all `.cmd` shims. `xr update` and `xr uninstall` on npm installs, the post-update `xr --version` check and `npx`-style MCP servers now go through one helper (`src/util/win-spawn.ts`), which runs a batch shim via an explicit `cmd.exe /d /s /c` with verbatim arguments and refuses (rather than escapes) any argument containing a cmd.exe metacharacter.
- **release (launch audit XR-LAUNCH-001):** release ⇔ channel coherence. `release.manifest.json` gains a `channels` block: `publicVersion` (1.0.0, the version every install path serves), the `claimed` channels, and `withdrawnTags` (v1.1.0: its release run failed in gates, so nothing was published). The installers, the README identity block and the site's "available" label are stamped with `publicVersion`, not the development line. New `bun run channel:live` (`scripts/channel-live-check.ts`; daily `channel-live.yml`) checks every claimed channel (GitHub Releases, npm, Homebrew, WinGet, Scoop, GHCR) against the live registry and the release's signed `SHA256SUMS`. New `publish-channels.yml` publishes Homebrew/WinGet only after cosign-verifying the sums and the stamped channel files (`scripts/channel-publish-verify.ts`); the tag run no longer pushes the tap. The tag ⇔ npm invariant honours withdrawn tags and fails if one reaches npm. The WinGet path is now `manifests/a/…`, not `r/`. `channel-install.yml` tier-2 now installs the public version and fails on missing assets instead of exiting 0. `VERIFYING_RELEASES.md` uses `--certificate-identity-regexp`; the documented `--certificate-identity '…v*'` never matched. Image tags have no `v` prefix.
- **installers (launch audit XR-LAUNCH-002):** `install.sh` / `install.ps1` install one pinned, published release (`--version` / `-ReleaseVersion` to choose). They verify the binary, or that release's `xr-source.tar.gz`, against `SHA256SUMS` in a private staging directory. They **never** fall back to cloning `main`. When the release or its sums are missing they exit non-zero with nothing created. A checksum mismatch is fatal, and a directory that is not an XR install is refused. Bun is only needed for source installs. Under `curl … | bash`, prompts now read from the terminal (`/dev/tty`); previously stdin was the script pipe, so the documented one-liner always answered "no" and printed "Cancelled". Covered by `test/release/installer-behavior.test.ts` (11 cases against a fake release server) and `test/release/channel-coherence.test.ts` (27 cases).
- **uninstall (launch audit XR-LAUNCH-006):** `install.sh` now appends a marked `# >>> XR launcher >>>` … `# <<< XR launcher <<<` block, and `xr uninstall` removes only that block (plus the single legacy line older installers wrote). Previously it deleted every line containing `.local/bin:$PATH`, which broke Ubuntu's default `~/.profile` (dangling `if`/`fi`) and removed users' own PATH lines. Ubuntu `.profile`, `.bashrc` and `.zshrc` fixtures are byte-identical after install → uninstall (`test/reliability/uninstall-rc.test.ts`). The confirmation prompt also works again (it always printed "Cancelled.").
- **update (launch audit XR-LAUNCH-007):** `xr update` works on npm/bun global installs: it asks the npm registry, delegates to `npm i -g` / `bun add -g`, verifies the installed version and re-installs the previous version on mismatch. It no longer crashes with ENOENT (`release.manifest.json` is now in the npm `files`, and is optional at runtime) and no longer says "already on the latest version" when the check never ran. New `xr update --check [--json]` reports the running and published versions without changing anything; on binary/git installs it only counts complete GitHub releases (published, not pre-release, with `SHA256SUMS`). Packed-tarball smoke: `scripts/npm-pack-smoke.ts`, CI on Linux/macOS/Windows. **1.0.0 npm users must run `npm i -g @rrrtx/xr@latest` once** — 1.0.0's own `xr update` cannot update itself.
- **desktop (launch audit XR-LAUNCH-009):** release builds no longer seed demo data — scripted run history, ~220 spend events, a 204-entry audit chain and three quarantined skills. Seeds run only in development builds (`import.meta.env.DEV` / Rust `debug_assertions`) and are absent from the production bundle (CI: `scripts/desktop-seed-gate.ts`). A one-time cleanup removes seed-marked rows earlier builds wrote (`sp_seed_NNNN`, `aud_NNNNNN`, the three demo skills); real audit entries are re-chained, the removal is recorded on the chain, and the original rows are kept in `shield_audit_archive_009`.
- **docs (launch audit XR-LAUNCH-010, decision D2):** the release label is **Public beta** (`identity.stability`) until every gate in `docs/release/launch-gates.json` is green. claim-lint gate 8 refuses stable-production wording while the label is beta and refuses `stable` while a gate is open; gate 9 checks the README install table against the claimed channels, and `claim-lint --live` (daily in `channel-live.yml`) against the live registries. The README states the Bun prerequisite for npm/source installs and that desktop builds are unsigned.
- **security (launch audit XR-LAUNCH-004):** the Linux raw-`unshare` sandbox fallback no longer leaves `/home` readable and writable. It now pivot_roots into a minimal root (system dirs, the granted roots, a private `/tmp`, a read-only skeleton), checks every mount step and refuses the command if one fails, and is only offered after a detect-time self-check proves the confinement on the host. New escape tests: `test/trust/namespace-confinement.test.ts`.
- **security (launch audit XR-LAUNCH-003, decision D3):** experimental macOS Seatbelt and Windows AppContainer sandboxes for shell commands, **off unless `XR_OS_SANDBOX=experimental`** and self-checked before use; without the opt-in, Tier-2 work is still refused (never run unsandboxed). The blocked-command remediation now fits the OS (no more "install bubblewrap" on macOS/Windows). Not hardware-verified; CI smoke in `os-sandbox.yml`; security review required before it leaves experimental.
- **platform (launch audit XR-LAUNCH-005, decision D4):** the file authority accepts Windows ARM64 behind a once-per-process FFI self-test that fails closed. Phase 3 raised the CLI's Bun pin to 1.4.2, the first line with `bun:ffi` on native Windows ARM64; Windows ARM64 stays **unverified** and non-gating until `windows-arm64.yml` runs (`windows-arm64.yml`).
- **desktop (launch audit XR-LAUNCH-008, decision D5):** code signing, notarization and the updater feed are wired in `desktop-app.yml` but gated on owner secrets — without them builds stay honestly unsigned with a notice, and tag builds that would ship half-signed fail. The OS tools verify every signed leg (`codesign`/`spctl`/`stapler`, `signtool verify`), and `scripts/verify-updater-signatures.ts` checks every signature in `latest.json` against the committed pubkey before it is published (stable on the tag, beta on the rolling `updater-beta` release). Fixed: `generate-updater-keys.ts` minted keys Tauri cannot use (keys now come from `tauri signer generate`), and the manifest job crashed on every tag reading `--notes` as a file path. Runbook: `docs/release/DESKTOP_SIGNING.md`.
- **cli (launch audit XR-LAUNCH-011, found by the clean-machine journey):** `xr uninstall` was unreachable — the router sent it to the task runner, which exited 0 without uninstalling anything. It now routes to the uninstaller (`test/cli/command-routing.test.ts`). On Windows, uninstall now removes the `HKCU\Environment\Path` entry `install.ps1` added (case/trailing-slash insensitive; everything else is kept in order). When Windows locks the running `xr.exe`, the install directory is removed by a detached cleanup a few seconds after `xr` exits, instead of being silently left behind. The Windows changes are not verified on Windows hardware.
- **release (launch audit XR-LAUNCH-011):** clean-machine journeys for every claimed target: install → launch → agent smoke → update → uninstall, plus build and package evidence, on a fresh runner with every remote served from loopback fixtures (no network, keys or paid calls). They cover the CLI (`scripts/journey/cli-journey.ts`, installer binary and npm channels, 8 hosted runners), the desktop app (`desktop-journey.ts`: .deb, NSIS or dmg install; the GUI window via tauri-driver on Linux and Windows; the bundled engine against the fixture provider; uninstall) and Docker (`docker-journey.ts`, amd64 and arm64). Supporting changes:
  - test-only endpoint overrides that accept https or loopback only: `XR_INSTALL_BASE_URL` for both installers, `XR_UPDATE_RELEASES_URL`, and the npm scoped-registry key `@rrrtx:registry`;
  - the root `Dockerfile` now pins `oven/bun:1.4.2-alpine`;
  - desktop auto-update stays de-scoped until the XR-LAUNCH-008 key exists, and `latest.json` is assembled and verified as a dry run.
- **docs (launch audit XR-LAUNCH-022):** the *Launch journeys* table in `docs/release/SUPPORT_MATRIX.md` is now generated by `bun run support-matrix` from journey evidence and `docs/release/support-targets.json`. Each cell is ✅ (CI or LR evidence), ➖ (explicit de-scope with a reason), ⏳ or ❌. The Quality Gate fails on a stale or hand-edited block. `--require-complete` is the launch criterion. Stale narrative fixed: the Windows ARM64 row now reflects the Bun 1.4.2 pin.
- **ci (launch audit XR-LAUNCH-012, decision D7):**
  - **Required checks.** Six aggregate gate jobs: Quality Gate, Cross-Platform, Supply Chain, npm Pack Smoke, Desktop (bundles + `latest.json` + journey) and Clean-Machine Journey. They are listed in `.github/required-checks.json` and `docs/ci/REQUIRED_CHECKS.md`. `scripts/apply-branch-protection.sh` prints the owner-run `gh api` command and never runs it.
  - **Release gating.** `release.yml` now runs the journeys and supply-chain checks on the tagged commit, and npm and GHCR publishing need them.
  - **CI policy.** `bun run ci:policy` enforces gate shape, no `paths:` filters on required workflows, scoped `continue-on-error`, full-SHA action pins, the `.bun-version` source and the Dependabot config. All actions are now SHA-pinned, and Dependabot watches them.
  - **Flaky tests.** No retries: the egress-proxy one-retry exception and the parity runner's crash retry are gone. A crashed segment is now bisected to name the culprit file, then the lane fails. Flaky files go in `test/quarantine.json` with an owner, an issue and an expiry of at most 45 days. They run in a non-blocking lane, and the gate fails once an entry expires. The daemon approval test is quarantined.
  - **Daemon approval flake mitigation.** `XR_NETWORK_PROBES=off` in the test preload stops off-machine daemon probes (the internet check and hosted-provider health); loopback probes are unchanged. The approval wait now fails fast with the request's own status instead of an opaque timeout.
  - **Report-only workflows.** Provider Canaries, Real-Device Matrix, Soak, OS sandbox and Windows ARM64 are marked `(non-gating)`, and each now completes:
    - Canaries run a keyless fixture leg that must pass;
    - Real-Device Matrix downloads the `xr-desktop-<slug>` artifacts that actually exist (it failed on every run looking for `xr-desktop-<runner>`);
    - Soak runs 5 h, so it finishes and writes its report instead of being cancelled at the 6 h hosted-runner limit.
  - **Bun 1.4.2.** The Bun pin is raised to 1.4.2 (`packageManager`, `.bun-version`, Flatpak, Docker).
- **desktop (launch audit XR-LAUNCH-026):** first frontend tests (`test/desktop/frontend-stores.test.ts`):
  - the Runs store's production empty state (no fabricated history when the engine is offline; covers XR-LAUNCH-009);
  - the settings and chat stores;
  - the `xr://oauth/callback` deep-link listener (only well-formed callbacks, never stacked; covers XR-LAUNCH-013's handler).
  
  A line-coverage ratchet for `desktop/src/stores` (`desktop/coverage-floor.json`, `bun run desktop:coverage`) runs in CI, and `cargo test` runs on every desktop bundle leg.

- **cli (contract change):** unknown global flags are now rejected before any task or kernel work: `xr --yolo` previously booted the synced-corpus worker and exited 0 (the §15#16 reproduction); it now exits 2 with a structured `unknown option` usage error that points at the `--` end-of-options escape, which still preserves explicitly dashed task text. Policy is global-slot only: dashed tokens AFTER the first positional reach the command/task verbatim (command-local options are never rejected), the catalog is the single declarative source for command-local options (`xr serve --lan` from Phase 2.4 is consumed by the same parser, no second `--lan` path), and serve-local validation rejects only non-declared serve options. `xr daemon` is not a command: any spelling (incl. `daemon --help`) exits 2 with the precise `xr serve` relocation, never a task, never help. Closes `P1-4` + `§15#16` (audit's `--nonsense-flag=x` class included). Guarded by `test/cli/unknown-flags.test.ts` (12 tests; 8-fail worktree proof against HEAD).
- **daemon (contract change):** the ordinary `xr serve` startup banner no longer prints bearer material — terminal output is shoulder-surfable and the 2.x local secret no longer lands in scrollback/asciinema/agent transcripts. Two channels: the HUMAN banner shows the token-free URLs plus one honest recovery line (dashboard paste sign-in, or `XR_PRINT_TOKEN=1 xr serve` on a private terminal); the PRIVATE handshake keeps the byte-stable legacy `Token: <48hex>` / `?token=` lines exactly as the desktop Rust banner parser consumes them (sidecar `--parent-pid` launch, or the operator's explicit `XR_PRINT_TOKEN=1` opt-in). Rust parser and its tests untouched by design; auth-page/OpenAPI copy updated to the truthful recovery path. Closes `P2-17`. Guarded by `test/daemon/banner.test.ts` (5-fail worktree proof).
- **ci (census truth):** the capability gate now scans the WHOLE bundled capability tree — 54 manifest skills, 11 legacy Markdown skills (via the loader's established `SKILL.md` fallback), 2 plugins — instead of pre-filtering on `xr-skill.json` and silently declaring "scanned 56" while the README claims 65. The headline prints labelled categories, and a directory that is neither format fails the gate honestly. Closes `P2-15`. Guarded by `test/release/capability-census.test.ts` against the one computation authority (`src/skills/counts.ts`).
- **contrib:** first-contributor `bun run typecheck` no longer explodes into 12,191 misleading desktop TS errors — a portable preflight (`scripts/typecheck-preflight.ts`, runs before either `tsc`) checks the real prerequisite (`desktop/node_modules/typescript/package.json`), prints exactly `cd desktop && bun install`, exits 3, installs/repairs nothing, and needs no POSIX shell. Closes `P1-16`. Guarded by `test/release/onboarding.test.ts` (worktree-staged absence proof).
- **architecture:** `src/bots/types.ts` no longer produces a `no-orphans` boundary warning — the [DERIVED] audit classification was mechanized exactly as prescribed: the module joins the SAME documented type-contract exception family in `.dependency-cruiser.cjs` (never a wildcard or new family). The zero-warning bar now holds (762 modules). Closes `P2-16`. Guarded by `test/architecture/bot-types-contract.test.ts`.
- **release metadata:** the Node engine conflict is settled by evidence, not invention — the website downloads page (3 statements), CI matrices (node 20/22) and the runnable `node bin/xr --version` proof under v20.20.2 all agree the floor is 20+; `package.json` now declares `engines.node: ">=20"` alongside the Bun floor, and the stale `Node 18+` strings in `bin/xr` and `docs/SCREEN-BRIEFS.md` are reconciled. Pinpointed by §15#21. Guarded by `test/metadata.test.ts` (3/3-fail worktree proof).
- **deduction census (line neutrality):** 17 dead exports removed across util/providers/context/plugins/skills/files (fs-async helper cluster, provider capability/fallback/gateway helpers, context memory guards, etc.) — each verified zero referees across src/test/scripts/desktop/website before deletion. Src tree lands at **171,955** (−42 vs the 171,997 start), 45 under the 172,000 ceiling.

- **website:** `DashboardPreview` — the marketing dashboard mock now labels itself: a `Sample data` chip in the header, a caption under the card, and an aria-label that states the truth; the green "Live" pill now reads "Preview". The illustrative numbers stay — the fix is the label, not a redesign. Closes P2-9.
- **test:** `test/ux/website-surface.test.ts` — Phase-1.4 regression guard: the two new routes exist with metadata, imprint values are asserted cross-file against the Phase-1.1 identity sources, over-claiming patterns fail, the demo label is pinned, and the footer links resolve to real route dirs.
- **website,cloud:** deletion copy now describes the request-based erasure path (P0-2) — no automation promised that isn't shipped: console-delete, automatic-purge, purge-date and soft-delete claims replaced across privacy, terms, security, pricing and the dashboard, and in the customer-visible cancellation message. Export claims (backed by `memory.ts:381` / `audit.ts:114`) kept verbatim.
- **test:** `test/website/legal-capability-alignment.test.ts` — P0-2 regression guard: forbidden automation claims fail the suite, the real request path must be stated, and console-deletion claims need a matching route.
- **website:** filled the legal identity on the privacy policy and every page footer — entity RRRTX Labs, registered office Remote-first · Chiniot, Punjab, Pakistan, and a named India (DPDP) grievance officer (Muhammad Ahmad, ahmadrrrtx333@gmail.com, available 24 hr). Closes audit finding P0-1 (GDPR Art. 13 controller identity; DPDP named grievance officer).
- **scripts:** `placeholder-lint` — fails the build (exit 1) on any `TO FILL` or `[[…]]` placeholder marker under `website/src`; runs in `bun run ci` immediately after `claim-lint`.
- **test:** `test/website/legal-placeholders.test.ts` — P0-1 regression guard: no markers on the public surface, the real identity present, and the gate provably fails on an injected marker.
- **desktop (launch audit XR-LAUNCH-013):** an OAuth sign-in that returns via `xr://oauth/callback` now reaches the running app on Windows and Linux. There the browser starts a second process for every link; `tauri-plugin-single-instance` is now built with its `deep-link` feature, so the URL is handed to the running instance's `onOpenUrl` listener. A link that starts XR (a cold start) is read with `getCurrent()`, and the same URL is never processed twice. AppImage and dev builds register the `xr` scheme at runtime, since nothing installs them. Not verified on Windows or Linux desktops.
- **desktop (launch audit XR-LAUNCH-014):** per-window IPC allow-lists. `build.rs` declares the app's command manifest (`desktop/src-tauri/app-commands.rs`, pinned to `generate_handler!`), which turns on Tauri's app ACL: a window can call only the commands its capability grants. The grants in `capabilities/ipc-*.json` are generated from each window's own import graph (`bun run desktop:ipc-acl --write`; CI `--check`). The HUD palette, Orb and Theater never get data import/export/reset, keychain, path-opening, security-policy, update or destructive workspace/budget commands. Workspace windows get the main bundle without import/export/reset; the Settings screen says "Open the main XR window to do this" instead of failing silently. 13 commands no window uses are no longer callable at all. Release builds drop the Tauri `devtools` feature, `set_devtools_enabled` works only in debug builds, and the toggle is hidden. `reveal_path` opens only XR's own folders (app data/config/log/cache, the engine home), canonicalized so `..` and symlinks cannot leave them; inert documents open, while executables and other files are only shown in their folder, never launched. The desktop journey's WebDriver step now probes the ACL. Not run on desktop hardware here.
- **desktop (launch audit XR-LAUNCH-021):** import no longer unzips over the live database. Previously that tore the open WAL and could lose or corrupt data, and a damaged archive showed "Import cancelled". The archive is now validated (unsafe paths, size and entry limits, `PRAGMA integrity_check` on every database) and staged. It is applied at the next launch before any database opens; the previous data is kept in `.import-backup-<ts>/` (two kept) and any failure rolls back. A damaged file is reported as an error and nothing changes. Export snapshots databases with `VACUUM INTO`, so rows still in the WAL are included. A damaged or unopenable `xr.db` no longer crashes at startup: the `.expect` calls in the workspace, Shield and budget inits are gone, the file is moved to `xr.db.corrupt-<ts>` (never deleted), a fresh database is created (or the session runs in memory), and the app shows what happened. The export scope (the desktop data folder, not the engine's `~/.xr`) is documented in `desktop/README.md`. Covered by 13 Rust tests in `data_safety.rs` (plus 7 in `reveal_policy.rs`), run by `cargo test --lib` in CI and here in a standalone crate.
- **security (launch audit XR-LAUNCH-015):** the OS keychain is now the primary secret store. Every write (sync CLI paths included) goes to macOS Keychain, Linux Secret Service or Windows DPAPI first and is verified by reading it back. The sealed `~/.xr/.env` is written only when that fails, which is announced once on stderr; `XR_SECRET_BACKEND=keychain` refuses the fallback and `=file` chooses it. Keys never travel on a child's argv: macOS writes go through `security -i` on stdin, and PowerShell now reads the key from stdin instead of an environment variable. A names-only index (`~/.xr/secrets/index.json`) lets sync readers make a single memoized keychain read; the daemon warms its cache before serving and never blocks on one. Existing file entries are moved into the keychain at daemon start and by `xr repair`; the sealed pre-move file is kept until a later run verifies every key. `xr doctor` no longer reports `linux-secret-service` when `secret-tool` is missing. An audit signing key that is stored but unreadable (e.g. a locked keyring) is reported as unavailable instead of being replaced. See `docs/migration/secrets-keychain-first.md`; the residual limits are rows #22–#24 of the known-limitations register. The macOS and Windows backends are covered with mocked processes only.
- **privacy (launch audit XR-LAUNCH-016):** `~/.xr` is created 0700, and XR's databases (with their WAL/SHM files) and `config.json` 0600, whatever the umask. Existing installs are tightened on start: the home and its direct children lose group/other access (owner bits, symlinks and other users' files are left alone, and the user's home directory is refused). Changes are logged to `logs/permissions-migration.log`. The process umask is not changed, so files XR writes in your projects are unaffected. Windows keeps its profile ACLs.
- **uninstall (launch audit XR-LAUNCH-017):** `xr uninstall --purge` now deletes XR's keychain entries before removing the data home: the indexed names, every id XR writes, and whatever Secret Service or DPAPI can enumerate. It reports how many it removed and names any that survived. `--keep-data` never touches the keychain.
- **daemon (launch audit XR-LAUNCH-018, 027 partial):** `xr serve` no longer dead-ends at a JSON 401. Any unauthenticated page request (including `curl /`) gets the accessible sign-in page, which says where the token is: the running daemon keeps it in `~/.xr/daemon/token` (0600, rewritten each start, removed on shutdown), and the banner names that file. The form now POSTs the token in the request body to `/auth/login` (same-origin only), which sets the existing HttpOnly SameSite=Strict session cookie and returns to the page you asked for, so the token no longer lands in browser history. API paths keep the JSON 401. Every daemon-token comparison (bearer header, session cookie, `?token=` bootstrap) is now constant-time. The cookie value is still the token and the bootstrap link stays valid until restart; session ids and single-use links are Phase 5 (known-limitations row #25).
- **update (launch audit XR-LAUNCH-019):** `xr update` on a binary layout (a release binary inside the package's `dist/`) no longer re-downloads the version it is already running. It first resolves the newest complete GitHub release (published, not a pre-release, with `SHA256SUMS`, the same source `xr update --check` uses), says "up to date" or "newer than the published …" and downloads nothing unless that release is newer; an unreachable release feed is reported as such, never as up to date. A successful update reports the version, not a staging path, and channel-managed upgrades no longer label themselves with the old version. Installer-placed binaries keep pointing at the verified installer when an update exists (they have no package root to swap in place).
- **docker (launch audit XR-LAUNCH-020):** the container image is now built on `oven/bun:1.4.2-slim` (Debian, glibc) instead of Alpine. XR's file tools load glibc's `libc.so.6`, so on the musl image every `read_file`/`write_file` failed closed. The required Supply Chain gate now runs `xr --version` and a real write → read → escape-refusal smoke (`scripts/container-file-smoke.ts`) inside the built image, and the Docker journey does the same. Build-time patching moved from `apk upgrade` to `apt-get upgrade`. Alpine/musl source installs still cannot use the file tools (known-limitations row #26).
- **coder (launch audit XR-LAUNCH-024):** a failed tool no longer shows a bare "failed". When a tool ran and failed, the stream event dropped its message, so `xr` printed `✕ read_file: failed` and `--json` emitted `"output":"failed"`. Failed `tool` lines now carry the tool's own message, a stable `reason` code (`denied:escape`, `denied:secret-path`, `blocked:isolation-unavailable`, …) and a `next` step; the terminal UI prints the code and next step under the `✕` line, and the daemon chat stream forwards the same fields. Codes are documented in `docs/cli/CODING_CONTRACTS.md` and never contain paths or secret material. The text the model sees is unchanged.
- **vscode (launch audit XR-LAUNCH-034):** the VS Code extension survives a daemon restart without re-pairing. It now re-reads the running daemon's owner-only token file (`~/.xr/daemon/token`) on every refresh and immediately on any 401/403, tries every token source in order (a stale setting or stored token falls through instead of blocking), and retries a chat message once when the daemon rejected the token before the run started. This also fixes **XR: Start XR**, which could not connect since `xr serve` stopped printing its token. The file is used only when it is a regular, owner-only file. Failed tools in the chat panel show their reason code and next step. New owner-run `publish-vscode.yml` packages, tests and checksums the `.vsix`, and can attach it to an existing release and publish to the Marketplace/Open VSX, each only when ticked and its secret (`VSCE_PAT`/`OVSX_PAT`) exists. The Quality Gate now runs the extension's typecheck, tests and packaging. README labels the extension "preview — install the .vsix from Releases" (claim-lint gate 10) until it is listed (known-limitations row #27).
- **installer (launch audit XR-LAUNCH-025):** the installers no longer put program files in `XR_HOME` (XR's data home). `XR_INSTALL_DIR` chooses the install directory (default `~/.xr-agent`, Windows `%USERPROFILE%\.xr-agent`); an install directory that is your home, a drive root, the data home, inside it or a parent of it, a relative path, or a path with quotes/`$`/backticks is refused before anything is downloaded. A missing, empty, relative, read-only or `/` HOME stops `install.sh` with a clear message (it used to crash on `set -u` or install into `/.xr-agent`); `install.ps1` no longer falls back to the current directory without a profile. The launchers export `XR_INSTALL_DIR`, and `xr uninstall` follows it, still recognises the old in-data-home layout by its marker, and never deletes your home, a root or a parent of the data home. Every curl download is https-only for redirects too (`--proto-redir`), and the source fallback installs the Bun version the release was built with (its `.bun-version`). Known-limitations row #28.
- **docs (launch audit XR-LAUNCH-022):** final docs pass. The support matrix no longer hand-copies test-file counts (it said "239 files" while the suite had 443, and "5 documented exclusions" where Windows skips 16 files from 7 patterns); it points at `test/platform/exclusions.json` and `bun run platform:parity:check`, and `claim-lint` now rejects a typed count on that page. The stale Phase 9 "first green runs land with the merge" note is replaced by where the evidence actually lives; the deferred `.rpm` is clarified as the CLI package (the desktop `.rpm` bundle is listed separately); the installer, Docker and new VS Code `.vsix` rows reflect XR-LAUNCH-025, -020 and -034. The desktop support matrix gains rows for the per-window IPC allow-lists, `reveal_path`/DevTools, WAL-safe import and `xr://` handoff (XR-LAUNCH-013/014/021), each with what was not verified.
- **npm (launch audit XR-LAUNCH-023):** the 3.x builds from before the version rebaseline still sort above 1.x (`npm i @rrrtx/xr@'>=1'` picks 3.1.5), and their deprecation message says "install @rrrtx/xr@beta". New read-only `bun run npm:ghosts` probes the registry: every version above the `latest` major must be deprecated with a message pointing to `@latest`. `bun run channel:live` (npm channel, daily in `channel-live.yml`) now runs the same check, so it reports the five 3.x versions until the owner fixes them. `bun run npm:ghosts -- --print-commands` prints one `npm deprecate` command per version for the package owner; nothing in CI or this repo runs a registry write. Documented in `docs/HISTORY.md`.
- **build (Phase 4C close):** the `size-gate` tree ceiling moves once, 174,100 → 174,500 LOC, for the core code 4C added under `src/` (sign-in page and token file +215, tool reason codes +141, updater comparison +17, uninstall install-dir rules +30; measured 174,068, +403 over 4B). The reasons are recorded beside `TREE_CEILING` in `scripts/size-gate.ts`; needs maintainer sign-off. The published test baseline is refreshed from a full local run on Linux x64: 4,912 pass / 29 skip / 0 fail across 445 files (bun 1.4.2).
- **tests (launch audit XR-LAUNCH-033):** the test suite no longer rewrites the tracked `benchmarks/memory-recall/suite-latency.json`. The latency test writes its measurement to `$XR_BENCH_OUT_DIR` (kept) or the suite's own temp root (deleted after the run). Every CI test lane (core, security, reliability-spawn, e2e-blackbox) now ends with `scripts/assert-clean-tree.sh`, which fails the job when a test run modified, deleted or created any file in the checkout.
- **cli (launch audit XR-LAUNCH-028):** argument-handling polish.
  - Usage errors no longer print two blank lines to **stdout**: under Bun, a `console.error()` with no arguments writes to stdout, and the error printer used it for spacing. Errors now go to stderr only.
  - `xr doctor`, `status`, `update`, `repair` and `uninstall` check their own options. An undeclared option (`xr update --nope` used to run the update), a value on a boolean option (`--check=1`) or a `--dry-run` the command does not support now exits 2 with the command's usage line, before anything runs.
  - The global `--dry-run` now reaches the commands that implement it (`memory`, `control`, `agents`, …). Before, the shared parser consumed it and never passed it on, so `xr memory summarize --dry-run --yes` applied the summarization for real.
  - `xr uninstall --dry-run` prints what would be removed and stops, even with `--yes`.
  - An unknown `--name=value` after a command is passed to the command instead of disappearing.
- **daemon (contract change, launch audit XR-LAUNCH-027):** browser sessions no longer carry the API token. The `xr_session` cookie (HttpOnly, SameSite=Strict, Secure on LAN TLS) is now a random 256-bit session id kept in daemon memory as a SHA-256 digest, with a 7-day `Max-Age` (this supersedes the 30-day desktop-bootstrap cookie noted above; paired-device cookies are unchanged), cleared when the daemon restarts. A new **Sign out** button in the dashboard (`POST /auth/logout`) revokes the session and clears the cookie. `?token=<API token>` links are retired: they now land on the sign-in page and set no cookie. Dashboard links are single-use `?bootstrap=` codes accepted only on a page GET. `POST /auth/bootstrap?next=<path>` (bearer or dashboard session, never a paired phone) mints a 60-second code, and VS Code's **Open Dashboard** now uses it instead of putting the token in the URL. With `XR_PRINT_TOKEN=1` the banner's Dashboard and Chat links carry their own 10-minute codes. The `Token:` line the desktop sidecar reads is unchanged, and bearer API clients (desktop, CLI, scripts) are unaffected. Session and code stores are bounded (256 and 64, oldest evicted first). Guarded by `test/daemon/session-auth.test.ts` (single-use and expiry, session id ≠ token, logout, the retired `?token=`, a real `serve()` banner link that works once) and the extension's `daemon-client.test.ts`. Known-limitations row #25 now lists only what remains.
- **daemon (launch audit XR-LAUNCH-030):** approval decisions now record who actually made them, as worked out by the daemon from how the caller signed in. Before, the identity was whatever the client sent, falling back to `admin`, so VS Code always recorded `"vscode"` and any caller could claim any name. The server derives `actor` at its auth seam: `local:token` for a bearer token, `browser:<12-hex label>` for a dashboard session, `mobile:<device id>` for a paired phone, otherwise `anonymous`. The browser label is the first 12 hex characters of the SHA-256 of the session id, so it never contains the id itself. Routes receive `actor` on their context, and `/api/approvals/:id/decision`, `/api/control/approve` (whose audit row now carries `by`), Control Room stop, the workflow human-check decision (which used to record a hard-coded `desktop`) and the Business OS approval and worker enable/disable routes all record it. A body `userId`/`decidedBy`/`actorId` is still accepted but ignored (the OpenAPI description says so), and the VS Code extension no longer sends one. Guarded by `test/daemon/approver-identity.test.ts` (spoofed body identities on every route, labels never containing the session id), the updated `test/phase2/daemon-approvals.test.ts` and an extension client test.
- **security (launch audit XR-LAUNCH-031):** the secret-path check on shell commands now splits the command into words before deciding (new `src/security/shell-words.ts`). It removes quoting the way a shell does and splits on operators and redirects, and it also checks `NAME=value`, `--flag=value` and curl-style `@file`. Each word is resolved where the command runs (`PolicyContext.cwd`, passed by the agent's shell tool), so the raw command is no longer treated as one path. Refusals now name the real file (`/tmp/…/secret.txt`, not `<cwd>/cat /tmp/…/secret.txt`). False positives are gone (`git commit -m "….env…"`, `grep box-shadow`, `cat .env.example`), and quote/escape splitting no longer hides a credential file (`cat ~/.n''etrc`, `~/.s""sh/config`, `~/.a\ws/config` are refused). Every path candidate is also checked in its NUL-truncated form. Free-text arguments keep their old scan, except that `.env.example`/`.sample`/`.template` are no longer treated as secrets. The denial still maps to `denied:secret-path`. For shell commands the check is labelled **advisory**: a computed path (`~/.ne*`, `$(…)`) is invisible to any static check, so the boundary is the OS sandbox (new known-limitations row #29; THREAT_MODEL updated). Guarded by `test/security/shell-words.test.ts`, which pins those limits too.
- **voice (launch audit XR-LAUNCH-035):** `xr voice status` and `xr doctor --deep` no longer show ✓ for speech-to-text or text-to-speech without checking. Before, the sync `describe()` answered "available" for any backend ("run describeAsync() for live probe"). Status now uses the real probes: local binaries (whisper, whisper.cpp, piper, kokoro, espeak/say/PowerShell) and the native sherpa-onnx library. An HTTP endpoint (`XR_STT_URL`/`XR_TTS_URL` or the voice settings) is contacted **only on loopback** (`localhost`, `127.x`, `[::1]`), once, with a 1.5 s timeout, and gets ✓ only if it answers. A non-loopback endpoint is never contacted and shows the new neutral `?` state ("not probed"). Cloud STT/TTS is never contacted: a present key shows `?`, a missing key `!`. `xr voice status --no-probe` (also `xr voice --no-probe`) skips the STT/TTS probes and shows `?`. `VoiceHealthCheck.state` gains `"unknown"`, which doctor reports as `warn` in JSON and `?` in text. Guarded by `test/voice/status-probe.test.ts`, which pins the STT/TTS status lines and proves non-loopback and cloud endpoints are never contacted.
- **Desktop: removed the unused Stronghold plugin and its fixed-salt key derivation** (audit finding 029). `tauri-plugin-stronghold`, the Argon2id `key_derivation` with its hard-coded salt, the `@tauri-apps/plugin-stronghold` npm package and its license entry are gone; no screen ever opened a stronghold (desktop secrets live in the OS keyring). `cargo update --workspace` pruned 86 crates from `Cargo.lock` (nothing else moved), retiring the bincode/paste osv-scanner ignores (RUSTSEC-2025-0141, RUSTSEC-2024-0436) and the zip 8.6.0 copy.
- **CI maintenance debt cleared** (audit finding 032). Every `ubuntu-latest` runner is now `ubuntu-24.04` (64 sites), so the 24.04 → 26.04 migration of the floating label cannot change CI underneath us. First-party actions moved off Node 20 to their first Node-24 majors, SHA-pinned and verified against the GitHub API: checkout v5.1.0, cache v5.1.0, setup-node v5.0.0, upload-artifact v6.0.0, download-artifact v7.0.0, github-script v8.0.0. The truth gate now runs actionlint 1.7.12 with shellcheck 0.11.0 (both sha256-pinned); its 11 shellcheck findings were fixed or annotated. `ci:policy` rule 7 rejects `ubuntu-latest` and Node 20-era majors. A new `Workflow Audit (non-gating)` workflow reports zizmor 1.31.1 findings, and Real-Device Matrix no longer installs bundles from fork-triggered runs. The orphan `zz-probe-native-fs.yml` registration needs an owner-run cleanup (docs/ci/CI.md).
- **docs (Phase 5 close):** the published test baseline is refreshed from a full local run on Linux x64 at `a2b6a735`: 4,972 pass / 29 skip / 0 fail across 450 files (bun 1.4.2). The working tree was clean after the run, which is the audit 033 acceptance.

## 1.1.0 — 2026-10-15

### Features

- **website:** pricing, trust, legal, auth and the ten-page admin console (89fd0ba)
- **desktop:** Billing & Account settings page, and a Team workspaces section (e89c49a)
- **cloud:** offline licence verification and the daemon's cloud routes (fe4fe2f)
- **cloud:** the XR cloud account service — a separate Bun/Hono deployable (c1ad0e0)
- **mobile:** React/Vite PWA companion (chat+voice+approvals+settings tabs, iOS stack nav, 44px targets, safe-area, theming, markdown… (7d2338d)
- **macos:** real traffic lights, and per-OS bundle assertions in CI (Phase 27 §E/§J) (0415fc5)
- **desktop:** recovery screen, update UI, tray bridge, honest run settling (a202713)
- **scripts:** generate tray + MSIX artwork from the master icon (fe6cd65)
- **desktop:** always-alive tray, global shortcuts, crash recovery, OS chrome (3f2c4cf)
- **desktop:** Discord and WhatsApp Integrations UI + Phase 26 mockups (daad761)
- **whatsapp:** WhatsApp surface on the shared chat runtime (81e4781)
- **discord:** Discord surface on the shared chat runtime (7f0fe6d)
- **vscode:** ship the XR extension for VS Code (phase 25) (36ad9cc)
- **telegram:** Phase 24 — UI-paired, daemon-managed Telegram bot (4323a27)
- **cli:** xr coding agent (Phase 23) (fc04ee5)
- **memory:** Phase 21 Memory Explorer (b223f20)
- **skills:** App-store Skills screen — category sidebar, featured hero, 3-col card grid, quarantine-first install modal with trust +… (e248bc8)
- **skills:** quarantine-first install engine — quarantine state, install jobs with SSE progress, promote, permission grants (parked … (89c81cd)
- **agents:** Agents screen — prebuilt gallery, custom-agent editor, React Flow workflow canvas (WIP, typed + linted) (32c3880)
- **custom-agents:** versioned custom-agent store + API; feat(workflows): daemon workflow runtime, canvas compile/lint API, run SSE (d2e7220)
- **research:** Perplexity-style deep research — SSE-streamed plan→search→read→synthesize, 3-col layout, cited markdown report with sup… (376ace1)
- **builder:** 3-pane AI IDE — CM6 editor, file tree, AI chat w/ per-hunk diff apply, live preview iframe with auto dev server, xterm … (c23eb2e)
- **voice-theater:** immersive frameless voice window with star field, animated avatar bust, karaoke transcript, cross-window IPC, global ho… (a6437b3)
- **voice:** desktop — session controller, Voice screen (SCREEN 13), docked pill, Chat mic, orb/PTT IPC; Rust ptt:released, open_mic… (d501ce2)
- **voice:** engine — model catalogue + resumable downloads, multi-voice native binding, durable voice approvals, settings/models/vo… (1cddf1d)
- **chat:** virtualize the session list past 100 sessions (react-window), lift the 100-session cap to 1000; docs for engine lifecyc… (1ddcbb5)
- **providers,palette,orb:** API keys are stored by the engine (setDefault opt-in), Ollama ping through the engine, onboarding choice sets the engin… (9c6877c)
- **desktop:** engine sidecar lifecycle in the Tauri shell — spawn/pair via banner, engine_link/engine_restart/engine_logs_tail, exter… (7c2c4fc)
- **shield,budget,settings:** engine audit rows in Shield, pending-approval sync, engine ledger card, Diagnostics tab with Engine card (d14397a)
- **runs:** Control Room rows are real engine runs when the engine is up (demo history only without a link); Brain shows local-mode… (a2ccea8)
- **brain:** real engine runs — chat turns and Brain 'Start a run' record live traces (spans from the engine stream, honest reload s… (7bd311c)
- **budget:** spend governor UI + real pre-call enforcement (caps, circuit breaker, downshifting, reserve, pause) (990c88d)
- **shield:** trust center — status, approvals, audit log, security settings, emergency revoke (c2a18cd)
- **phase/11:** Control Room — live virtualized runs table, emergency stop, charts, export (e0e6184)
- **phase/10:** Workspaces — launch pad, offline templates, real multi-window spawn (eeb9a1b)
- **phase/9:** Brain — live trace tree + Gantt for agent runs (2032a8f)
- **phase/8:** Settings — 9-tab preference pane, keychain, shortcuts rebinding, provider management (fedaceb)
- **phase/7:** Approval Modal + notification queue + bell popover + remember-rules persistence + cross-surface events + chat tool card… (e865698)
- **phase/6:** Companion Orb desktop widget — 120×120 always-on-top transparent window with drag + position memory and corner clamping… (9871ca8)
- **phase/5:** HUD command palette — shared palette (in-app ⌘K + global HUD window), registry over commands/chats/agents/workspaces/se… (35b0116)
- **phase/4:** chat screen — sessions list, streaming messages, markdown/code/tool-cards, composer, attachments, persistence, keyboard… (b16e9af)
- **phase/3:** splash boot screen + 10-step onboarding wizard (4b58dc8)
- **phase/2:** brand components — original avatar & logo as traced SVG vectors (05dcca7)
- **phase/1:** final app shell — collapsible sidebar, polished topbar, cmdk, toasts, shortcuts, Tauri Store persistence (b0b3660)
- **phase/0:** scaffold Tauri v2 + React 18 + Tailwind v4 + 5 themes + app shell placeholder (db7d50b)
- **desktop:** Phase 3 Agents & Library (d5e46e3)
- **desktop:** V2.1 Operator Phase 2 — Deep Work (aaa9374)
- **desktop:** V2.1 Operator Phase 1 — Foundation & Editor-First Workbench (0cd84e8)
- **desktop:** real terminal pane (engine PTY) + hunk review in the Workspace (719c532)
- **daemon:** hunk-level review over the engine's diff + durable desktop UI state (G-06, G-08) (012061a)
- **daemon:** engine-owned PTY sessions — a real terminal, consent per session (G-05) (a166d77)
- **desktop:** W-3 becomes tauri-plugin-single-instance (focus-existing); check_update names 'not provisioned' precisely (b027ad4)
- **desktop,engine:** SEC-12 — the engine never outlives the shell, on every OS (45949e5)
- **desktop:** approval TTL countdown from the engine's deadline; containment warning in the status bar (35b312d)
- **desktop:** brand asset registry with pose-aware avatar, motion law doc, PR review table (f377b36)
- **desktop:** v3 type identity (bundled), motion law tokens, and an honest S0 boot splash (d83e246)
- **desktop:** Windows runtime proof, per-user NSIS installer, and an updater pipeline that can actually ship (aa2e048)
- **desktop-native:** implement the Windows shell defects W-1/W-2/W-3/W-5/W-6 (efa01de)
- **desktop:** Phase 1 foundation hardening (d156232)
- **desktop:** phase 3 — memory screen, research workspace, capability clarity (a311c8c)
- **workspace:** phase 2 — projects, git panel, run diff review, code splitting (f6fa66f)
- **desktop:** phase 1 — shell truth, onboarding, palette, toasts + win32 hang guards (7025bfb)
- **desktop:** phase 4 — Library depth (skill inspect, marketplace, plugin grants) (31e58b5)
- **desktop:** phase 4 · D-02 — engine sidecar lifecycle + honest transport handshake (9a7ffef)
- **desktop:** phase 4 — Tauri packaging matrix (D-02) + official icon set (D-05) (fb82876)
- **desktop:** phase 3 — Library surfaces live (Skills / MCP / Plugins) (2edd784)
- **phase2b:** editor save (files.write) + workspace terminal (terminal.run) (9dbfcd3)
- **desktop:** phase 2 — Work streaming surface, inline approvals, Model Center, Workspace editor (CM6) (4627439)
- **desktop:** phase 1 foundation — Tauri v2 shell, XR Prism tokens, Home + Runs over engine API (354c90c)

### Fixes

- **cloud:** pin esbuild past GHSA-67mh-4wv8-2f99 through the dev chain (7f911c9)
- **cloud:** stop shipping key-shaped literals in the service tree (fd5eee2)
- **desktop:** the three set-state-in-effect errors that fail the shell job (4d9158c)
- **tools:** clear the supply-chain gate — vite 6.4.4, puppeteer 25, self-contained preview (109f82c)
- **rdm:** the deb lists usr/bin without a ./ prefix, and ships the sidecar there too (85d39dc)
- **rdm:** install the Tauri Linux runtime deps dpkg -i will not pull in (f5f66f4)
- **rdm:** find installers recursively — upload-artifact preserves subdirs (845cd52)
- **msix:** toast activation belongs to desktop:, not uap: — and pin both enums (e2c34c9)
- **msix:** drop the invalid windows.appUserModelId extension + pin the enumeration (3831037)
- **ci/msix:** resolve the engine sidecar from src-tauri/binaries, not target/release (745a164)
- **ci/windows:** hand the MSIX its SecureString in-process, and find MakeAppx (1a1d651)
- **ci:** restore the desktop-app workflow steps that 0415fc5 clobbered (4c249d7)
- **desktop:** don't call useNavigate() outside the Router — it crashed the app (c8f8f8e)
- **ci:** package the MSIX with a real version and a real password (c1712ed)
- **shell:** bring Manager into scope in the macOS menu install (6acf4b8)
- **desktop:** seed the composer from ?prompt= without setState-in-effect (aaa6413)
- **packaging:** flatpak metadata that actually validates; CI that finds it (e285949)
- **whatsapp:** make the Baileys runtime opt-in (license gate) + Windows-safe mode tests (3c87a4c)
- **desktop:** lint-clean the Phase 26 dialogs; carry WhatsApp to main with PR 4 (b8522c1)
- **vscode:** clear osv-scanner findings in the extension lockfile (45a6853)
- **ci:** size gate for Phase 21 (ceiling, contract and client waivers) (46cc0e4)
- **ci:** size gate ceiling for Phase 20, Windows EBUSY in phase19 test, website next 16.3.8 (5f0a9c2)
- **skills:** MCP add, plugin permissions, and plugin visibility (b4483de)
- **workflows:** human checks are human-only; stable selectors; honest duration (18072fd)
- **supply-chain:** bump website sharp override 0.35.4 → 0.35.5 (GHSA-wq5f-xc86-pv6w) — unblocks the osv gate (326d350)
- **voice:** per-voice .onnx.json sizes (Nova/Atlas/Sage downloads failed integrity), stopped downloads stay visible with retry/dism… (e317eed)
- **engine:** exit promptly on SIGTERM; dev Start engine replaces stale child (cabb7cc)
- **engine:** real streaming on the default run path, config reload, keepalive, empty-turn retry, chat history (04ee15e)
- **budget:** drop unused per_output_token helper (clippy -D warnings dead_code) (77f86eb)
- **shield:** satisfy clippy — contains() and exact PRNG parity numerators (c814ed6)
- **phase/11:** Rust test literal — '"#' closed the raw string early (1e73dc7)
- **phase/10:** Windows-safe scaffold file list + test cleanup (18b1528)
- **phase/10:** Windows-safe scaffold file list + test cleanup (78e8106)
- **phase/9:** satisfy CI gates — bun lockfile, sink-allow, vuln policy (fdb886a)
- **phase/8:** enable tauri devtools feature for release builds (9a136e3)
- **main:** three red lanes — next.js RCE bump, clippy allow on chat_save_message IPC, pwsh test budgets (4cc26a9)
- **phase/4:** sink-allow for shiki CodeBlock sink; drop stale RUSTSEC-2023-0071 ignore (10e9cf9)
- **desktop:** regenerate bun.lock with the repo-pinned bun 1.3.14 (5f0d11b)
- **website:** bump brace-expansion overrides to advisory-fixed versions (f5bd5cd)
- **ci:** install desktop deps in the typecheck lane (8459180)
- **desktop:** constrain brand hero, Settings card grid in app.css (545e9a1)
- **desktop:** Phase 3 polish — spacing, detail sheets, brand wiring, audit fixes (1ca8a93)
- **desktop:** VS Code-style resizable panels, CI typecheck fixes, home full-width (227e62f)
- **state:** restoreFrom() requires exclusive ownership of the connection (3b027f5)
- **state:** migration lock survives Windows delete-pending; parity lane gets a per-test budget (169f496)
- **state:** close() releases the file — the gate owns every statement (693a75a)
- **control:** the win32 approvals hang — a pending approval's only wake-ups were unref'd timers (1a3240f)
- **test:** sink-lint compares basenames via node:path, not split("/") — the win32 parity failure (a2a3f2c)
- **dashboard:** restore the skills panel styles — the live axe target-size failure at its root (8f23a09)
- **daemon:** dashboard brand images are external routes of the official renders, not data URIs (2f5d380)
- **test:** e2e-blackbox — every CLI-spawning test gets the budget the lane policy promises (3fb019d)
- **ci:** updater config is inert until provisioned; supply-chain lanes made honest (b50b122)
- **state:** one DB identity before AND after the file exists (macOS max-1-writer hole) (ca9ab79)
- **ci:** make the three red lanes green at their root causes (33be3bf)
- **desktop:** fold the last two duplicate pollers into the hub (5d587b3)
- **desktop:** make the voice orb halo paint-only, not layout overflow (72baafb)
- **desktop:** render the Voice Esc affordance once (77d92ab)
- **control:** browserAvailability tells the truth about the browser (4858236)
- **state:** root-cause the win32 migration-lock hang as path identity (90dcf0a)
- **native:** use tauri_plugin_notification::init() (Builder is private) (deed2c1)
- **state:** root-cause CI lost-write + size waivers (9df8f76)
- **state:** cross-process lock around full migration runs (CF-1 macOS race) (735e3c1)
- **ci:** smoke-sidecar on Windows — NO_COLOR=1 at launch + ANSI-strip before the token-banner grep; dump the log on failure for … (012a0cd)
- **desktop:** E0382 in engine_link — clone token in the match scrutinee so the fallthrough branch keeps ownership (6a102ea)
- **desktop:** repair lib.rs compile errors (doc-block position, deref-copy of MutexGuard, move+Arc-clone for setup/run closures) + cl… (f6ea66f)
- **ci:** compile+smoke the sidecar BEFORE cargo check in shell-check — tauri-build validates bundle.externalBin paths at build-s… (3f0034c)
- **ci:** quote-free step name in desktop-app.yml (YAML parse) + regenerate OWNERSHIP.md for the two new sidecar scripts (b04b83e)
- **ci:** pin bun 1.4.2 in desktop packaging lane — bun.lock is lockfileVersion 2, runner default 1.3.14 cannot parse it (1e413b1)
- **supply-chain:** bump website next 16.3.5, sharp 0.35.4, js-yaml 4.3.2 (GHSA-2883/2xp9/p293/rgj7) — unblocks osv gate on main (a123506)
- **brand:** use official XR logo + avatar renders exactly as provided (D-05); remove derived SVG mark (e290836)
- **dashboard:** honesty pass — 9-area IA, real MCP/agents/automation/approvals surfaces (6013179)

### Performance

- **desktop:** one polling hub replaces five independent pollers (a5cbca7)

### Refactoring

- **bots:** shared chat runtime for Telegram, Discord and WhatsApp (54d95f6)

### Build & CI

- re-trigger the PR workflow matrix (cbbaa4b)
- **flatpak:** validate with a current appstreamcli, share the manifest test (426e758)
- **desktop:** MSIX + Flatpak packaging, xr:// file associations (995d8c1)
- fix size gate and Windows parity failures for Phase 23 (52ba3af)
- green the Phase 14 PR — size gate, root-only desktop tests, osv (6ea46a3)
- **sidecar:** compile-sidecar.ts is cwd-independent and supports --if-missing; desktop dev:tauri/build:tauri compile the sidecar firs… (a9ad82a)
- **desktop:** name the Windows shell job for what it proves (W-1/W-2) (55c6f21)
- **cross-platform:** hang diagnostics that cannot themselves hang (e01ad93)
- **lab:** trigger the Windows lab from a feature branch by bumping its own file (d5692ff)
- **lab:** manual Windows dissection workflow with kill-surviving markers (7f08603)

### Documentation

- **phases:** the Phase 30 PR body, ready to open (3e2f0ee)
- **release:** README pricing statement, CHANGELOG v1.0.0 entry, env reference (6849e30)
- **business:** SSO, billing, security, team memory and self-host guides (5eefa94)
- **phases:** Phase 30 brief-vs-tree notes and implementation plan (7b21ea7)
- **phases:** sync the 28 PR body with the branch as pushed (875528e)
- **phase26:** Discord surface guide, README remotes section, study notes (8896156)
- **phase26:** WhatsApp decisions, README remote-control section (2925062)
- **phase26:** staged plan for the Discord and WhatsApp surfaces (bfc2603)
- **phase-23:** CLI study notes (Claude Code, OpenCode, Kilo, Gemini CLI) (67b60bc)
- **agents:** Phase 19 preview screenshots (XR Native run-through, Shield plane, Paper) (194de6a)
- **voice:** re-capture live-loop screenshot with a real LLM reply after the caption dedupe fix (83d21c6)
- **voice:** phase 15 study notes, plan and reference mock (fb8de16)
- **phase-14:** budget-stop verification via the engine token ceiling, virtualized sessions screenshot (70182ef)
- **phase/8:** add the §20 settings reference render (1205205)
- **phase/6:** actual orb captures — 8 uncomposited browser screenshots of the 120×120 window (pure boot + 7 states, DPR 2, alpha pres… (8f66921)
- **phase/0:** add PR description (b0356e1)
- **phase/0:** copy master docs into docs/, add scaffold plan + hero preview (c61fc29)
- **audits:** Phase 2 slice 1 — ConPTY proven on the Windows lane; lane status on the PR head (80431c5)
- **audits:** Phase 2 slice 1 — what landed, what was measured, what is not proven (8d739e7)
- **audit:** W-1/W-2/W-3/W-5/W-6 implemented, compile-verified, not runtime-verified (304d35b)
- **audit:** record the three blocked attempts to compile the Windows shell (712d9e5)
- **audit:** final Phase 1 numbers, including what the environment hid (7204175)
- record multi-agent-service waiver at 824 (pause/cancel drain guard, +3) (63c1f62)
- regenerate ownership map for test/voice (CI --check) (55a3236)
- amend D-05 — official logo/avatar used exactly as provided, no derived geometry (16d1d69)
- record human approval decisions (D-01..D-06) (f8ce88d)
- create XR desktop rebuild blueprint (24b8d62)
- professional 1.0.0 release documentation — trilingual README, supply-chain sections, stale-state repairs (5a13463)

### Tests

- **cli:** approvals pass through the durable-store consent wrapper (6d8df82)
- **voice:** catalogue/downloader/transcript/session proofs; size-gate ceiling 144,500 → 145,500 with reason (e97fb9b)
- **desktop,core:** engine wire — SSE framing, envelope decoding, approval/model/tool mappers; boundedHistory bounds (73b928e)
- **phase/8:** settings-core units + canonical windows chord order (b1499c5)
- **hunks:** EOL-agnostic line check — git's core.autocrlf rewrites CRLF on the Windows runner (abc9c87)
- **hygiene:** report and close stores still open at the end of a run (6e386ec)
- **desktop:** measure the polling fix on the running app, before and after (f2367f6)
- **security:** gate raw HTML sinks in the desktop renderer (1616474)

### Maintenance

- **previews:** Phase 30 screenshots and the harness that produced them (d1160d3)
- **gates:** amend the claim manifest and the size ceiling for a hosted tier (8cc1be7)
- **size-gate:** generated client waiver 809 → 854 (phase 15 routes), dated (d875438)
- **desktop:** bump transitive source-map-js 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q; Supply Chain gate also red on main) (f30a8d8)
- **desktop:** osv-scanner policy for the scaffold's Cargo.lock (2e1659b)
- gitignore puppeteer audit scripts (a51baba)
- **size-gate:** raise the core tree ceiling 142,500 → 144,000 for Phase 2 slice 1, with the reason (244f70b)
- **desktop:** commit the Tauri Cargo.lock (e44dce5)
- **size-gate:** raise TREE_CEILING 139,000 → 139,500 (Phase 2B consent-plane routes; ADR-0028 deliberate raise, measured 139,162) (7edd4e4)

### Other

- Phase 31 Bucket E: graphite rebuild (AA), faint-text AA sweep, Cmd+1-9 nav, research outline+copy (d199bcb)
- Phase 31 Bucket C: website marketing polish — brand assets, zero broken links, mobile menu, AA contrast, metadata, pric… (1f2c598)
- Phase 31 · Bucket B — legal pages, cookie/privacy/refund, compliance (500a464)
- Phase 31 · Bucket A — security hardening (daemon, dashboard, bots, providers, website) (716dddd)
- add explicit github-token to the cross-run artifact download (5fd8115)
- docs+ci: shell support matrix, crash recovery, Linux packaging, packaging CI (2de36dd)
- Phase 22: integrations — GitHub OAuth (PKCE), Coolify API key, MCP routing (b4e86bc)
- **workflows:** engine run events, templates, branch skipping; canvas compiler + linter (8da57d3)
- **agents:** phase 19 study notes + plan; add @xyflow/react (15d1535)
- **desktop:** chat header, workspace context, quick-ask on the engine, honest error cards, local model detection (31b5c37)
- **desktop:** engine transport, real chat stream, engine store/banner, mode switch, engine-backed model picker (72d5cd9)
- Phase 5b: engine-down banner, onboarding modal, SEC-09 Art.50 disclosure bar (c9094d1)
- Phase 5: hardening, i18n wire-up, global approval bar, light-theme pass (d8c3b54)
- Phase 4: wire Voice, Control Room, Trust + native bridges (694801b)
- fix portable zip step: cargo exe name is xr-desktop.exe (unblocks installer artifacts) (6bfa308)
- portable step: exe is xr-desktop.exe (cargo name), not productName (a55d7d0)
- win silent-death fixes: boot log breadcrumbs, embedded WebView2 offline installer, portable no-install zip (9072530)
- SEC-06 win32: awaitable control-channel close (fixes Windows parity lane) (#130) (27797ca)
- CI fixes: poll-test budget fixtures, size-gate bundle skip without dist, drop stale generated-client waiver, regenerate… (02d9bd4)
- XR elite workstation: Phases 2-5 — elite visual law, nav consolidation, omni palette, agents board v2, voice/control re… (103d041)
- feat(release)+feat(desktop): phase 5 — production hardening (f63ae5c)
- feat(desktop)+feat(agents): phase 4 — Model Center, Control Room, voice state polish (8dd15a0)
- win32 hang diag: finer D4 markers (module/tmpdir/store-open/constructed) + fix marker dump to use the test runtime's tm… (87f11c5)
- templates route plans through PlanningService (T4 architecture: planners are strategies, not entry points) (4f54a81)
- Home mock-02 fidelity + BLUEPRINT-STATUS backlog batch (steer/approve, trust modes, cockpit, templates, semantic endpoi… (211f78c)
- phase4(ui): Library + Trust Center rebuilt to mockups 07/08 against real engine data (b40958e)
- phase4(agents): pause drain must not swallow the A-19 cancel drain (712974b)
- phase4(agents): multi-agent page (mockup 05) + engine team-run control plane (5c7aab6)
- phase4(voice): offline voice pipeline daemon surface + full-screen avatar UI + docked orb (8dca643)
- phase4(security): MCP tool-contract pinning + rug-pull re-approval (SEC-01) & skill pins (SEC-02) (12f0e33)
- phase4(desktop): Settings screen — general/models/local/automations/voice/privacy/advanced over engine routes (4fb581a)
- phase4(desktop): Trust Center — queue/modes/audit/budgets/network/permissions/shield over real engine routes (20a5e12)
- phase6(runs): session drawer renders structured anatomy from the engine record (ab85044)
- phase6(shell): universal search popover — engine-index skills + live runs, ⌘K focus (a80a639)
- phase6(work): Run Inspector transcript notes transport-level facts (5b2be9c)
- phase6(library): permission chips render scope labels (not raw JSON) + stable keys + ellipsis guard (e405431)
- phase6(runs): stabilize edge redraw — memoized task levels + value-equality bail in setEdges (prevents render churn whe… (55e65b8)
- phase6(shell/library): titlebar global search → Library skills query; Skills is the default tab (7525e85)
- phase6(runs): real workflow DAG — dependency-leveled nodes, bezier edges, partition budgets, per-task auditTrail inspec… (99aae98)
- phase6: redesign desktop UI to match product mockups (d8fe830)

## Unreleased

### Business tier — Phase 30 (the final v1.0.0 feature phase)

**The one-line version.** XR can now be used by a team: shared workspaces, shared memory, SSO, an
admin console, pooled cloud models and an audit log — served by a new, separately deployable
service under `cloud/`, with a paid Business tier at **$15 per user / month** on top of a Personal
tier that stays free forever. Personal is not reduced, gated or nagged by any of it, and that is
enforced by tests rather than asserted in a README.

**Cloud service — `cloud/` (new deployable).** Bun + Hono 4 + Drizzle on Postgres, Redis for
rate-limit buckets, `Dockerfile` + `docker-compose.yml` (postgres 16, redis 7, a one-shot `migrate`
gated on `service_completed_successfully`, then `api`). 21 tables / 10 enums, all money in integer
micro-USD, timestamps `timestamptz`. Zod validation on every mutating endpoint, `jose` JWTs, an
Ed25519 licence minter, Stripe 23, `openid-client` (OIDC: Google, Okta, Azure AD, generic),
`samlify` (SAML 2.0 SP, 667-byte metadata with an entity ID derived from `API_URL` at request time),
`@node-rs/argon2`, nodemailer, `rate-limiter-flexible`, `@aws-sdk/client-s3` (R2-compatible audit
exports) and `pino`. Env-only configuration, fail-closed at boot: a missing or malformed
`JWT_SECRET`/`XR_KEY_ENCRYPTION_KEY` refuses to start rather than booting half-configured.

- **Auth:** signup, password login, magic link (SHA-256 at rest, single-use, 10 minutes), 15-minute
  access JWT + httpOnly `SameSite=Lax` refresh cookie rotated on use, family-wide revocation on
  refresh reuse, invite acceptance (14 days) that returns a session for new *and* existing members.
- **Teams:** members, roles (`owner`/`admin`/`member`, re-read per request), invitations, per-member
  cap overrides, team workspaces, policies, API keys (hashed, shown once, scoped, never able to
  administer the team), team memory with a review queue and plaintext export.
- **Billing:** per-seat Stripe subscriptions, 30-day trial with no card and a 5-seat cap, hosted
  Checkout and Customer Portal (**no card data on our servers**), proration through Stripe, and seven
  webhook events consumed raw-body-HMAC verified and deduped by `(source, event_id)`. A handler
  failure returns 200 so Stripe stops retrying a bug instead of amplifying it.
- **Metering:** per-user daily and monthly budgets, an organization ceiling, an approval threshold,
  and a provider allowlist — evaluated subscription → BYOK → allowlist → daily → monthly → team →
  approval. Token counts come from the provider's `usage` when it sends one and are otherwise
  estimated at `characters / 4` and flagged `x-xr-usage-estimated`, so an estimate is never
  presented as a measurement.
- **Relay:** a real WSS hub at `GET /relay/ws` — device-scoped registration, no persistence, opaque
  frames, Business-only, opt-in, off for Personal.
- **Encryption:** a deployment KEK wraps a per-organization key (AES-256-GCM) which is HKDF-derived
  per workspace to encrypt each fact. **Not** end-to-end: the keys are ours, and both the trust page
  and `docs/business/TEAM-MEMORY.md` say so, including what an operator with the KEK and the database
  can read.
- **Audit:** hash-chained (`seq`/`prev_hash`/`entry_hash`) with a verify endpoint, plus POST → 202
  jobId → poll → download CSV export (UTF-8 BOM, CRLF) written to S3/R2 with a short-lived link.
- **Compliance surface:** `/.well-known/security.txt` and `/.well-known/xr-license-pubkey` on both
  the API and the website, `GET /healthz` and `GET /readyz` (per-dependency `ready`/`disabled`/
  `misconfigured`, with only the database driving the status code), OWASP hardening (CSRF on
  cookie-auth mutations, parameterised queries, Zod everywhere, 10/min on auth), and 30-day
  soft-delete retention.
- **Verified in this environment:** `bunx tsc --noEmit` clean, `bun test test/auth.test.ts` 28/28,
  migrations idempotent (applied twice, `--status` reports nothing pending), boot smoke 7/7, SAML
  runtime-verified (a junk certificate is rejected, metadata generated). **Not** run here, and listed
  as operator steps in `docs/business/SELF-HOST.md` instead of claimed: the Docker compose stack, the
  Stripe CLI flow, a real identity provider, and a real S3/R2 bucket — this build environment has no
  Docker, no `stripe` binary and no outbound network.

**Daemon — `src/cloud/`, `src/daemon/routes/cloud.routes.ts`.** Licence verification is **offline and
dependency-free**: `src/cloud/license.ts` verifies an Ed25519 JWT with `node:crypto` against a key
compiled into the binary — no check-in, no heartbeat, no remote disable, and no new runtime
dependency in the file that decides what a customer is entitled to. The client routes every request
through the existing egress proxy (`guardedFetch`), so cloud traffic inherits the allowlist, the
private-range refusal and the size/time caps. Team memory is a bridge, not a store
(`src/context/memory/team.ts`): the Phase 21 sensitivity scanner runs locally *before* upload, an
agent-suggested fact lands in a review queue rather than in shared memory, and a fact awaiting review
or marked private is excluded from recall on both sides. Every cloud route answers usefully with no
network — `available: false` with a reason and a repair, never a 5xx — and `test/cloud/routes.test.ts`
proves it by trapping `node:net` and failing the suite on any connection attempt.

**Desktop.** Settings gains **Billing & Account** between General and About (account group, all four
locales): the free state is a statement of what you have plus exactly **one** card mentioning the
paid tier — no popup, no badge, no "upgrade to use" — and the paid state replaces it with the team's
real rows. Workspaces gains a **Team workspaces** section that renders only when the tier is active,
kept visually and structurally separate from local workspaces because local and shared are different
things and the layout should not flirt with the idea that they are the same.

**Website.** New `/pricing` (three plans, honest comparison), `/security` (trust page, sub-processor
list, SOC 2 status stated as roadmap), `/download`, `/legal/{,privacy,terms}` (with `/privacy` and
`/terms` kept live and canonical to `/legal/*`), `/auth/*` (magic-link-first sign-in, signup,
handoff, and a reason→repair error table that never distinguishes a wrong password from a
non-existent account) and nine admin console routes at `/dashboard/*` — Overview, Members, SSO,
Policies, Workspaces, Team memory, Billing, Audit log, Compliance and API keys — at 13px with mono
identifiers, small status dots and **no cinematic styling and no orbs in the console**. `/legal`,
`/download` and the console extend `sitemap.xml`; the footer links the canonical URLs. When no cloud
service is reachable the console renders read-only example data behind a visible `DemoBanner` instead
of pretending to be live. **No third-party analytics, no advertising pixel, no tracking script** —
server logs are the only telemetry, and they are not person-linked.

**Honesty machinery, extended rather than bypassed.** Five prohibitions in `release.manifest.json`
asserted that a hosted, paid, SSO-bearing product does not exist ("no hosted or per-seat pricing",
"contact sales", "SSO/SAML", "Enterprise SSO", "start a trial"). Phase 30 makes those statements
false, so they were replaced — in a diff, with reasons — by narrower rules that keep the invariants
that still matter: no local feature may be described as requiring Business or an upgrade, nothing
local may be said to require an account, no watermarks or nag screens, no telemetry claim, and
SOC 2/ISO/HIPAA/PCI/FedRAMP stay prohibited as *held* certifications while a roadmap statement is
permitted. Nine new evidenced claims were added (pricing, the trial, SSO, offline licensing,
retention, no analytics, no DRM) and `docs/business/**/*.md` joined the scanned surfaces, so the
business docs are subject to the same linter as the marketing site. The offline-licence design is
also a constitutional tripwire in `test/cloud/license.test.ts`: if a local capability ever appears in
the licence's feature list, the build fails.

**Deliberately not built:** SOC 2 Type II, native mobile apps, an Electron migration, on-prem/k8s/
Helm tooling, VoIP or screen sharing, per-message E2EE chat, SCIM/HRIS, cloud fine-tuning, a plugin
marketplace, any analytics, DRM, and — the one that mattered most — **no paywalling of an existing
local feature and no requirement for the local daemon to reach the cloud.**

### Desktop · Phase 12 — Shield / Trust Center (`/shield`)

- **Status tab**: hero state (protected / needs attention / compromised /
  paused / unknown — never green before a check has run), four stat tiles
  (blocked 24h, pending → Approvals, auto-approved share, quarantined →
  Security), health card sorted fail → warn → pass → planned with re-run,
  recent activity, and the emergency card. Breathing glow only in XR Native and
  Midnight; reduced motion → opacity only.
- **Approvals tab**: pending cards (risk border, justification, Shiki JSON
  payload, remember rules, inline Approve/Deny resolving the same Phase 7
  promise the modal awaits, `A`/`D` on the first card, bulk "Approve all
  low-risk" / "Deny all"), plus approved/denied-last-24h history derived from
  the audit log. No auto-deny timer while the queue is on screen.
- **Audit log**: append-only, SHA-256 hash-chained entries (labelled
  "hash-chained — Ed25519 signatures planned", never "signed"); virtualized
  ARIA grid, `/` search, decision/actor/date filters, time/cost sort, 420px
  slide-over (Detail / Payload / Chain with on-demand verification), CSV/JSON
  export of the filtered view, infinite scroll.
- **Security settings**: every control carries an honest **Enforced** or
  **Planned** badge (Constitution Art. IV.2). Enforced in this build:
  auto-approve low-risk, shell execution off → auto-deny + audit, quarantine
  new skills, PII redaction (applied before the audit write). Planned: egress
  proxy (lists persist, nothing is proxied yet), strictness, biometric prompt
  (shown as unavailable), data sharing (mirrors Settings → Privacy).
  Quarantine list with Trust (confirm + audit) / Remove.
- **Emergency revoke**: `alertdialog` (focus lands on Cancel, required
  acknowledgement), closes the gate first, denies the pending queue, stops
  every active run (Brain + Control Room show "Paused by XR Shield"), writes
  one audit row, broadcasts `shield:emergency-revoke`, and raises the app-wide
  red banner until Resume (which also confirms).
- **Compromised modal**: non-dismissible (no X / Esc / backdrop) when a
  critical check fails; "Quarantine all new skills and restart XR"; Orb blinks
  red once; notification bell badge; dev-only trigger in development builds.
- **Rust shell** (`src/shield/mod.rs`): `shield_audit` table with
  UPDATE/DELETE triggers (append-only), writes serialised under one lock so the
  chain cannot fork, deterministic 204-entry seed byte-identical to the webview
  fallback (cross-language test vectors), `verify_audit_chain`, five real host
  health checks (audit db, keychain probe, chain, settings/data dir, version
  match), policy/pause/quarantine persistence in `shield.json`,
  `revoke_all` / `shield:resumed` broadcasts. Browser preview mirrors all of
  it with WebCrypto + localStorage.
- **Cross-surface**: sidebar/topbar Shield dot, shell tool cards blocked while
  shell exec is off, Runs rows killed by Shield show a shield icon, Settings →
  Privacy "Advanced security controls →", onboarding link, palette command.
- Out of scope (unchanged): real Ed25519 signing, sidecar, injection
  scanning, microVM, real biometric prompt, real egress proxy, rule editor,
  FIDO2, export-and-wipe, remote log shipping, scheduled checks.

### Desktop · Phase 11 — Control Room (`/runs`)

- **Live runs table**: every agent run across chat, builder, research, voice,
  CLI and background surfaces in one virtualized 36px-row table (react-window,
  10k-row stress seed verified) with status/ID/title/agent/workspace/model/
  started/duration/tokens/cost columns, sortable headers, keyboard navigation
  (`/` ↑↓ Enter Space ←→ Delete S R E C Esc 1–5) and a right-click menu
  (View trace, Open workspace, Copy ID, Retry, Archive, Stop run).
- **Emergency stop**: red STOP ALL appears only while runs are in progress,
  always confirms (`alertdialog`, optional reason) and actually halts the mock
  stream; per-row stop; Rust `cancel_run` / `bulk_cancel_runs` commands emit
  `run:cancelled` which the renderer honours.
- **Stats + charts**: today's runs/tokens/cost, in-progress and failed-24h
  tiles with tweened numbers; collapsible hand-rolled SVG charts (runs per
  hour, cost per day stacked by model family, tokens by model donut) themed
  via `--chart-*` tokens — no chart library added.
- **Export**: CSV/JSON of the filtered view (`xr-runs-YYYY-MM-DD-HHmm.*`),
  native save dialog in Tauri via `save_runs_export`, Blob download in the
  browser.
- **Cross-surface**: canonical `runsStore` fed by the Brain store and
  `brain:run-update`; chat tool calls create short live runs; sidebar
  "Control Room" entry, pulsing topbar activity dot → `/runs?status=running`,
  palette commands (stop all / view running / view failed), workspace landing
  shows its recent runs. All five themes, reduced motion, filtered and
  fresh-install empty states.

### Phase 12 · F-2 — Honesty pass: dashboard redesign + real MCP/agents/automation/approvals surfaces

**Daemon (real data behind every panel):**
- **MCP routes** (`GET/POST /api/mcp`, `/api/mcp/add|remove|enable|disable`,
  `GET /api/mcp/health`): the dashboard now manages the SAME registry the
  `xr mcp` CLI persists (`~/.xr/mcp/registry.json`). Before this, the panel
  called `/api/mcp` — an endpoint that did not exist — and silently rendered
  "No MCP connections registered" forever. Add mirrors `xr mcp add` exactly
  (stdio command split, version/source/trust/capability fields, enable flag).
- **`GET /api/agents` is honest:** returns `roles` (the three built-in
  orchestration roles, clearly labelled built-in — never presented as user
  instances), live `workflows` from the unified store, and `health` counters.
  The old route returned three hardcoded "agents" with a status string.
- **Tool approvals carry their real arguments:** `write_file`/`delete_file`/
  `shell` now pass raw `args` to the approval record, so the dashboard (and
  any remote surface) shows WHAT will be written/deleted/run — not just a hash.
- **Audit timestamps fixed:** dashboard rendered `Invalid Date` for every audit
  row (read `e.ts`; the store returns `created_at`). Both render sites fixed.

**Dashboard (9-area IA, tab strips, honest Home):**
- Sidebar collapsed from 26 items / 5 groups to **9 areas** (Home, Chat, Runs,
  Agents, Models, Extensions, Memory, Guardrails, Settings). Secondary views
  are in-panel **tab strips** that reuse the same panel ids and loaders, so
  every surface stays reachable (sidebar default + tabs + palette + `g`-key
  shortcuts + Start-here clones). Progressive disclosure auto-expands the
  target area.
- **Guardrails → Approvals (new):** the durable cross-surface queue
  (`GET /api/approvals`) rendered in the browser for the first time —
  risk tier, surface, reason/preview, TTL countdown, Allow/Deny through the
  canonical `POST /api/approvals/:id/decision`. Sidebar badge shows the live
  pending count; the queue polls every 5 s while open. A decision made in the
  browser releases a waiting CLI run (and vice versa) — verified end-to-end.
- **Home rebuilt honest:** active-model hero, "Needs your attention" strip
  (pending approvals + failed/interrupted runs — rendered only when real),
  4 real KPIs (spend, audit chain, pending approvals, memory), recent runs
  from `/api/sessions`, quick-start shown only while no route is configured,
  and a 6-cell live status strip. The old 12-cell bento hardcoded
  "MCP HEALTH: Healthy" and mislabelled Computer Use as "Authorized".
- **Automation wired to `/api/triggers`:** the old panel was a static "no
  jobs" card; it now lists the live trigger registry (cron/event/watch),
  shows pause-all/in-flight state, and creates triggers with the same
  consent gate as the CLI.
- **Agents panel (new):** live workflow runs (goal, status, task progress)
  + built-in roles with their real purposes + copyable CLI hints.
- **Chat composer:** mode is now a visible Agent/Plan/Ask segmented control
  (default Agent — this is an agent console; approvals still gate every side
  effect) instead of a hidden cycling chip.
- Deleted the five fake/dead panels (Business OS CRM with fabricated
  metrics, Webhooks "Listening", Devices, Downloads, Alerts Hub).
- ~470 KB removed from every dashboard response: avatar/logo PNG data-URIs
  replaced with compact SVG marks (brand palette preserved).
- `g`-then-key area shortcuts (g h Home, g c Chat, g r Runs, …); never fire
  while typing.

**Tooling/infra:**
- `bin/xr` rewritten as pure ESM (works under Node 18+ and Bun; actionable
  install hint instead of a bare stack trace when bun is missing).
- VS Code extension default daemon URL corrected to the real `xr serve`
  default (127.0.0.1:3141).
- Stale `tui2.ts` exclude removed from tsconfig (the file no longer exists).
- Full audit reports + this redesign's plan preserved under `docs/audits/`
  (`XR_V3.1F_*.md`).
- OpenAPI regenerated (127 operations).

### Phase 9 — Channel & Proactivity Maturation

- **Governed trigger table** (`cron` | `event` | `watch`) on the unified store
  (schema v11). Create requires explicit `consentRef` + a budget declaration.
  Every fire is an `executeOnSurface` envelope on `surface: "scheduler"` with
  per-trigger budget, approval mode, quiet hours, and an audit trail
  (`trigger.created|fired|error`, `triggers.paused|resumed`). Fire history
  lives in the audit chain.
- **pause-all kill switch** (`xr triggers pause-all`, `POST /api/triggers/pause`,
  Telegram `/pause-all`): stops **new** fires; in-flight runs keep A-19 cancel.
  Visible on `xr triggers` and `GET /api/triggers`.
- **Telegram:** per-user token-bucket rate limits and per-chat Governor budgets
  (`config.telegram.rateLimit` / `chatBudgets`).
- **Voice v2** behind default-off flags: streaming STT, server VAD, sentence
  TTS, barge-in cancels the run, spoken status via `onStreamEvent`.
- Config **21 → 22** (`triggers`, `telegram`, voice v2 flags).

### Phase 7 — Memory policy layer (F-21)

- **retrieval ACL:** `MemoryStore.recall*` take an optional `principal`
  (`"user"` or `{role, agentId}`; default `"user"`). New `agent_visibility`
  column (JSON role list, default `["*"]` — **existing memories are not
  restricted**); a list without `*` sequesters the row to those roles, and
  coordinators are not exempt. Enforced at `recall*`, in the context assembler
  (grant requester → principal), the agent loop's legacy block, the
  memory-manager task and the plugin host. `xr memory add --visible-to
  <role>,…`. Trust never gates retrieval — it labels the hit `channel:
  "data" | "quarantine"`; recall has no instruction channel by construction.
- **provenance mandatory:** `add()` resolves `{source: user|tool|agent|schedule,
  ref}`; `tool`/`agent`/`schedule` writes without a `ref` are **rejected**.
  Every row stores `provenance_event_id` = the audit hash of its `memory.add`
  event, plus `kind` (fact|preference|episode|procedure|summary) and
  `confidence_score`. New write channels `tool`/`agent`/`schedule` with honest
  trust ceilings; the plugin host now writes as `tool` with `plugin:<id>`.
- **contradiction arbitration:** a write lexically near (cosine ≥ 0.6, same
  scope + category) a current row opens a `memory_conflicts` row (bounded to the
  3 nearest peers) and audits `memory.conflict.detected`; nothing is
  overwritten. `xr memory conflicts` / `xr memory resolve <a> <b> --keep
  a|b|both` (loser superseded, undoable). Honest limit: token overlap, not
  semantic understanding.
- **consolidation:** `xr memory consolidate [--dry-run] [--max-tokens n]` folds
  old, low-importance groups into cited `kind: summary` rows and **supersedes**
  the originals (never deletes; the older `summarize` still deletes and is
  unchanged). Idempotent (run twice ⇒ same state), metered through its own
  `CostGovernor` envelope with an honest budget stop, deterministic summariser
  by default, fully audited (`memory.consolidate.plan|applied|budget_stop`).
- **forgetting & export:** `xr memory forget <id> | --query | --scope` is the
  **irreversible** erase (row, cached vector, undo-ledger images, projection;
  confirmation; `memory.forgotten` audit written last) — `remove` stays the
  undoable delete. `xr memory export [--md] [--scope] [--include-quarantined]
  [--no-redact]` emits `xr-memory` v2 (v1 still imports); quarantined/revoked/
  proposed rows are exported only on request and always carry a
  `quarantineLabel`; secrets masked by default. Privacy contract:
  `docs/privacy/MEMORY.md`.
- **agent tools honour the ACL:** `memory_search` already went through the
  assembler's principal filter; `memory_get` / `memory_navigate` read rows by
  id through the adapter and bypassed it. `ContextService.adaptedMemoryItem`
  now takes the requester and applies the same retrieval gate (ACL → consent →
  lineage → TTL), so a sequestered, quarantined or superseded row is reported
  as absent to an agent that may not see it. Owner reads are unchanged.
- **legacy injection deprecated:** `knowledge.injectionMode` `legacy`/`both`
  still work but raise a `loadConfig()` deprecation warning (pinned by
  `test/config/injection-mode-deprecation.test.ts`) and are flagged in
  `xr context status`; removal in 2.0. The legacy block is principal-filtered
  and drops quarantine-channel hits. `xr doctor` shows the consolidation
  suggestion next to the memory health line.
- **poisoning corpus extended:** `benchmarks/poisoning-corpus.json` grows from
  30 to 41 entries (pois_31–pois_41) with attacks aimed at the policy layer
  itself — ACL widening, provenance forgery, forget/consolidation abuse, export
  exfiltration, role impersonation, quarantine escape — all held to the same
  never-instruction property by the existing gates (no new signatures needed).
- **fix:** the memory→context adapter overwrote stored consent/trust/provenance/
  lineage with the legacy mapping, so a quarantined, revoked or superseded row
  read by id (`memory_get`, assembler extras) was presented as approved, current
  memory. Stored metadata now wins; the legacy mapping is only the fallback for
  rows that predate it (`legacy:4.4` tag is applied only to those).
- **schema:** migration 9 `phase7_memory_policy` (four additive columns +
  `memory_conflicts`), backfill from category/confidence, reversible.

### Phase 6 — Orchestration completion (task runtime, funded trees, resume, verifier)

- **budget (breaking):** a multi-agent workflow now spends **one root envelope for
  the whole tree**, not one per worker. `budget.perTaskUsd`/`perTaskTokens` are
  the ROOT ceiling; the root is partitioned across lanes deterministically
  (largest-remainder over template role weights, floor-guarded — a lane the floor
  cannot fund is DENIED, never zero-funded). Every worker step is admitted against
  its child ceiling AND the shared root in a single ledger transaction; an
  admitted step may overshoot its estimate once, so the hard bound is
  `Σ committed ≤ root + one in-flight step`. **A worker request that passes its
  own `--budget` is ignored on the funded path** — that multiplier is what this
  fixes. Legacy (unfunded) callers keep the old per-request aliases.
- **task runtime:** every workflow task — and every plain run, as a 1-node task
  — moves through an explicit 12-state machine (incl. `recovering`,
  `awaiting_budget`, `awaiting_approval`, `verifying`) with a pure transition
  table; illegal events are swallowed by the loop but the ledger throws, and all
  legal edges are audited (`task.transition` / `agents.task.transition`).
- **durable resume:** per-step checkpoints (transcript + step index + consumed
  meter + tool-call sequence) are hash-chained in `task_checkpoints`;
  `xr run --resume <id>` and `runAgentService.execute({resume})` re-enter the loop
  from the latest checkpoint. Semantics are documented and honest: the SEED is
  durable, the model is **re-asked** (no provider replay); runs with no journal,
  a broken chain, or a truncation envelope are **refused**, never silently
  restarted. Resumed runs re-seed the spend meter, so a resumed worker does not
  get a fresh budget for old work.
- **identities & depth cap:** workers execute under minted identities
  (`role/parent/task/grant/depth`); spawn depth is capped at 1 **by
  construction** — a depth-1 worker attempting to delegate is refused and
  audited. Identity surfaces are framed as data, not instructions.
- **artifact verifier:** research/build/refactor workflows gain a read-only
  verifier lane after synthesis (default on; `orchestration.verifier`). It
  receives the workers' claims plus a deterministic **artifact manifest**
  (claimed files hashed, missing files named, escapes declined) and must answer
  with reasoned strict JSON: anything else — prose assurances included — fails
  the task closed. Deviation from the plan: the plan's verifier toolset listed a
  `grep` tool; the registry has none, so the verifier ships read-only
  `read_file`+`list_dir` scope instead.
- **supervised plan editing (off by default):** for kinds enabled in
  `orchestration.supervisorEditing`, a supervisor fragment may add/rename/skip
  tasks under hard locks: strict schema, roles inside the kind's declared set,
  review/security/verification gates never skippable, completed work immutable,
  adds fundable only from unallocated root headroom, `planVersion` + bounded
  edits per workflow. Every refusal is audited (`agents.plan.edit_denied`).
- **bounded concurrency:** workers run through a gate capped at
  `orchestration.concurrentWorkers`; budget-blocked and approval-waiting lanes
  hold their slot only while live.
- **state:** reversible migration 8 (`phase6_orchestration`) adds
  `budget_partitions`, `partition_reservations` (TTL-swept at admission, so a
  kill between admit and commit can neither double-spend nor wedge) and the
  hash-chained `task_checkpoints` journal.
- **scope:** single-process. Partitions and reservations are enforced against
  the shared workspace DB — not across machines.

### Phase 4 — Evidence Integrity (signed audit, F-08)

- **audit:** the SHA-256 hash chain was tamper-*evident* but a local attacker
  with SQLite write access could truncate and rebuild every link consistently
  (F-08). The chain is now tamper-*resistant*: a per-install **Ed25519** signing
  key is generated on first real boot and stored through the existing secret
  backends (Keychain / secret-service / DPAPI / AES-GCM file fallback); the
  public key is embedded in an `audit.keyed` event, checkpoints are signed
  every N entries, and the latest **signed head** (`audit_head`) cannot be
  forged without the private key.
- **cli:** `xr audit verify --crypto` replays the chain *and* verifies Ed25519
  signatures, head-counter monotonicity and the signed head; `--anchor`
  append-verifies remote anchors; `--crypto-legacy` accepts a pre-keying
  unsigned chain. Exit codes: `0` verified, `1` integrity failure, `2` signing
  key unavailable (limited to chain). New `xr audit anchor` (push one
  checkpoint), `xr audit export-key <file>` (encrypted, passphrase-sealed key
  backup), and `xr audit re-key --yes` (audited key rotation; the old segment
  stays verifiable to the re-key point).
- **anchor (opt-in, default off):** `audit.anchor.{enabled,sink,intervalMs}` —
  pushes a redacted signed checkpoint to an operator-controlled `file://` or
  egress-gated `https://` sink (must be on the egress allowlist; refusals are
  audited and skipped, fail-safe never fail-stop; offline-first preserved).
  Scheduled hourly in long-running processes and on clean exit.
- **state:** reversible migration 7 adds `audit_log.head_counter/sig` and the
  `audit_head`/`audit_anchors` tables, additive only — the hash chain is never
  re-keyed by a migration and existing unsigned chains stay verifiable.
- **docs:** `docs/security/AUDIT-EVIDENCE.md` states the exact threat model —
  the signature protects against silent local rewrite without the key, not
  against an attacker who also exfiltrates the key (the anchor narrows that gap).
- Kill proof: a wholesale truncate + consistent-hash rebuild now fails
  `verify --crypto` (case (b) in the tamper matrix), covered in CI by
  `test/security/audit-crypto.test.ts`, `test/security/audit-anchor.test.ts` and
  the black-box `test/e2e-blackbox/audit-crypto.test.ts`.

## 1.0.0 — 2026-08-13

### Rebaseline

- **identity:** deliberate semver rebaseline — the 7.1.0 (Truth) codebase is
  re-identified as **1.0.0 (Truth)**, the first stable line. No functionality
  was added or removed in the re-identification; the full feature history
  remains under §7.1.0 and below, and the frozen 7.x artifacts stay under
  `docs/release/7.0.1/` and `docs/historical/`. All active surfaces
  (`package.json`, `src/core/version.ts`, README, `install.sh`, `install.ps1`,
  website, packaging channels) are stamped from `release.manifest.json` at
  `1.0.0`.

### Hardening (final release verification)

- **ci:** fixed the cross-platform parity failures at root cause — SQLite
  `database is locked` escaping the retry contract on the connection-open path
  (`write-gate.ts` open retry + new open-churn regression test), macOS `/var`
  vs `/private/var` realpath normalization in the files-list test, and the
  Windows `bun build --compile` panic (documented, evidence-bound win32
  exclusion; the Windows binary is still natively built + smoke-tested by the
  release and channel-install workflows).
- **plugins:** Windows-safe filesystem primitives (bounded retry on
  `renameSync`/`rmSync`) for plugin install/update/rollback/remove.

### Fixed (release-readiness pass)

- **evaluation:** run integrity no longer depends on clock timing.
  `EvaluationRunner.run()` read `Date.now()` twice — once for the stored
  provenance and once for the digest input — so when a millisecond boundary
  fell between the two reads, the persisted digest covered a `finishedAt`
  that differed from the one persisted and every read-back reported
  `integrityValid: false` for an untampered run. A tamper-evidence signal
  that fires on untouched data is worse than none. Now one clock read, one
  frozen provenance object, hashed and stored. Regression-guarded by
  `test/evaluation/integrity-race.test.ts` (ticking-clock, deterministic —
  fails 3/4 against the previous code).

### Security

- **docs:** `SECURITY.md` no longer contradicts the implementation. It
  described XR as a "secure AI Operating System" (a term `release.manifest.json`
  prohibits) and called the `node:vm` realm the "Primary Security Boundary"
  while `src/plugins/sandbox-worker.ts` documents that `node:vm` is *not* a
  security boundary. Both corrected to the real posture: in-process policy,
  `node:vm` as defense-in-depth, OS isolation as the boundary.
- **docs:** vulnerability reports were directed to `security@xr-project.org`,
  a domain with no DNS record — reports would have bounced. Replaced with
  GitHub Security Advisories, a supported-version table, and an effort-based
  (explicitly non-contractual) response process.
- **ci:** `claim-lint` now scans `SECURITY.md`, `CONTRIBUTING.md` and
  `CODE_OF_CONDUCT.md`. Those files were outside `scannedSurfaces`, which is
  why the prohibited claim above was never caught.
- **chore:** `.gitignore` now ignores all `.env.*` variants (previously only
  `.env` and `.env.local`), with negations keeping `.env.example`/`.env.sample`
  committable.

### Added

- **docs:** `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) — previously absent
  and referenced by nothing.
- **docs:** `docs/release/RELEASE_READINESS_1.0.0.md` — evidence-bound
  readiness matrix and the exact release procedure.

### Changed

- **ci:** the parity suite runner now attributes a crash-class segment failure
  to a specific file. A directory-level "exit 3, no test failures" named only
  the directory, which is why the Windows `test/perf/` panic was never pinned
  down. On a crash-class exit that survives the retry, each file is re-run in
  its own process: a real test failure or a file that dies alone fails the
  segment and is named; only if every file passes alone does the segment pass,
  with a loud warning. Real failures still fail immediately without isolation.
- **docs:** README restructured for first-time readers (plain-language opening,
  Mermaid architecture/lifecycle/provider/extensibility/security diagrams,
  long tables behind `<details>`); test counts refreshed to the measured
  3,191 tests across 240 files.

## 7.1.0 — 2026-08-05

### Features

- **phase9:** packaging & release engineering core (T1-T5 machinery) (4896793)
- **phase8:** UX, accessibility, observability & DX excellence (T1-T5) (4f31005)
- **phase7:** capability ecosystem quality + Business OS graduation (T1-T8) (15a805c)
- **intelligence:** Phase 5 — measured, explainable routing quality (c8db271)
- **phase4:** security & trust hardening - enforceable isolation lattice, egress proxy, credential brokering, dashboard hardening, su… (8c43ae5)
- **phase3:** runtime & performance engineering — lazy boot, compiled binary, budgets + regression gate (e401bef)
- **phase2/T7,T8:** giant-file splits + enforced acyclic L0-L6 boundaries (0c53cfb)
- **phase2/T6:** one execution engine — src/workflow/ retired (402967a)
- **phase2/T5:** one context store — src/memory/ retired (e9c14a9)
- **phase2/T3,T4:** one routing authority + one PlanningService (7a1c570)
- **phase2/T1,T2:** execution envelope + single ToolRegistryService (350fb48)
- **reliability:** Phase 1 reliability & persistence core (ab39ff7)

### Fixes

- **state:** retry busy transactions whole in the WriteGate (CI stability) (adeb2bd)
- **test:** close performance-test store handles (suite-shared-process flake) (711cb61)
- **ci:** truth gate, a11y flake, and perf-gate pendulum on phase-8 PR (54996cf)
- **supply-chain:** green secret/license scans on phase-8 PR (c25e11a)
- **phase4:** typecheck - server.port may be undefined; fall back to requested port (549d41e)
- **phase4:** CI round 3 - SARIF upload permissions; dashboard-bench port 0 (EADDRINUSE); regression band 30% (runner noise) (98f2fb9)
- **phase4:** CI round 2 - trivy base-image patch (apk upgrade); osv-scanner binary + bun audit; website dep bumps + overrides (d375cf5)
- **phase4:** CI - valid action versions (trivy v0.36.0, osv v2.3.8); host-agnostic guarantee-matrix tests (2a146b6)
- **golden-path:** spawn wizard via process.execPath (Windows PATH fix) (41de9e9)
- **tests:** async rmrf with event-loop backoff for Windows EBUSY (4d087ce)
- **security:** macOS /private/etc policy bypass + cross-platform CI hardening (3b5c28b)
- **reliability:** race-safe migrations + busy_timeout before WAL (92562cf)

### Refactoring

- **phase2/T9:** no phase-named modules — folded into L0-L6 homes (0dd6be9)

### Documentation

- **phase7:** completion report + audit/gap/research/validation work log (5f237c7)
- **phase7:** ecosystem + Business OS documentation and ADRs (0d6159a)
- **phase2:** final engineering review — gates proven live, honest LOC finding (642fd23)
- **phase2:** ADRs 0002-0008, boundary table, developer + migration guides (93138ff)

### Other

- Phase 6: memory, knowledge & context quality (T1-T8) — progressive lifecycle, hybrid retrieval, memory-as-tools, integr… (56defd6)
- Phase 0 (Truth & Foundation Reset): make every claim and success signal true (bfec891)

## XR 7.0.0 — "Supremacy" (Phase 13: XR OS Supremacy)

**XR becomes a measurable platform.** This release adds no product features. It
adds the layer that proves what XR can do, states plainly what it cannot, and
detects when a change makes it worse.

### Added — evaluation subsystem (`src/evaluation/`)

- **Outcome-based benchmark harness** — 14 suites, 38 versioned scenarios across
  runtime, execution, trust, durability, intelligence, context, workflow,
  environment, capability, business, deployment, enterprise, DX, and UX.
  Scenarios verify artifacts, records, states, policies, and side effects —
  never response text.
- **Nine hard safety gates** evaluated by the runner, not the scenario. A
  scenario that leaks a credential, performs undeclared network access, bypasses
  a policy, or escapes its fixture is `blocked` regardless of how well it scored.
- **Scorecard with un-averageable gates** — a critical safety failure nulls the
  headline score rather than lowering it. `not_applicable` is excluded from
  scoring, never counted as zero. Weights are always published.
- **Append-only result storage** with recompute-on-read integrity. Runs can be
  invalidated but never deleted, so negative results cannot be erased.
- **Longitudinal regression detection** with strict comparability rules, always-
  critical security/privacy regressions, and benchmark-overfitting detection.
- **Evidence-backed certification** for providers, capabilities, workflows,
  deployment profiles, and runtime versions. Certifications expire, are
  revocable, and cannot be granted from self-reported evidence alone.
- **Compatibility contract tests** over public APIs, CLI commands, and data
  schemas.
- **Machine-checked claim/evidence matrix** — every public claim is classified
  and bound to evidence, or labelled product vision. A guard prevents shipping
  any comparative superiority claim as fact.
- **Governance** — scenario semantic fingerprinting rejects unversioned meaning
  changes; discovered gaps must be classified and owned.
- **`xr evaluate` CLI** — run, suites, list, inspect, compare, regressions,
  export, verify, certify, compatibility, claims, limitations, gaps, reproduce.

### Fixed

- **SECURITY: workflow definitions were not tamper-evident for their executable
  content.** `hashDefinition()` covered only node ids and kinds, so a published
  workflow's shell command, target capability, risk tier, or `requiresApproval`
  flag could be modified while `verifyIntegrity()` still returned true. The hash
  now covers the full definition. `hashDefinitionLegacyV1()` is retained and
  `inspectIntegrity()` reports which scheme matched, so definitions published
  before 7.0 keep loading. Found by the Phase 13 benchmark suite.
- **`xr business` was missing from the CLI help catalog** — the Phase 10 command
  worked but was undiscoverable. Found by the CLI compatibility contract test.
- **Contradictory provider counts in README** ("20+" and "12+"). Corrected to
  26 (16 hosted + 10 local), counted from `PRESETS`, with an explicit note that
  provider count is not a quality measure.

### Fixed — cross-platform / CI (post-review)

- **`set-version:check` failed on Windows.** Git for Windows' default
  `core.autocrlf=true` rewrote `src/core/version.ts` to CRLF, so the identity
  check compared LF-generated content against a CRLF file and reported "out of
  sync" on a correctly-versioned file. Added `.gitattributes` pinning text files
  to LF, and made the comparison line-ending tolerant.
- **`no_real_user_data` and `no_workspace_escape` gates were vacuous.** They
  tested for the redaction marker `<home>`, which never appears in the raw
  values gates actually receive. They now compare real paths against the fixture
  root, with an explicit carve-out for the OS temp directory (on Windows the
  temp dir lives inside the user profile, so "under homedir" is not a valid
  escape test). Three regression tests added.
- **Evaluation created the real `~/.xr` directory.** `buildCatalog()` probes the
  OS key store, which creates `XR_HOME` as a side effect — so merely measuring
  XR touched real user state. The intelligence scenarios now short-circuit the
  probe with synthetic key values and restore the environment afterwards.
- **Fixture isolation test assumed a Linux layout.** It asserted the fixture
  root is not under `homedir()`, which is false on Windows. Now asserts
  containment in `tmpdir()` and exclusion from the real XR home.
- **Workflow benchmark used `WorkspaceStore`**, which unconditionally creates
  `XR_HOME`. Replaced with a fixture-local SQLite store.

### Notes

- Verified green under both Linux and a simulated Windows layout (temp inside
  the user profile).
- No new runtime, workflow engine, policy system, or telemetry pipeline.
- No destructive migration. Evaluation storage is created lazily and only when
  `--save` is used.
- The entire benchmark suite runs fully offline with no network.
- Tests: 1636 → **1771 pass / 0 fail**.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [6.1.0] — XR 6.1 Enterprise — Enterprise Trust and Operations (Phase 12)

Makes XR governable, supportable, measurable, and operable by organizations —
**without weakening local autonomy or user trust**. All enterprise features are
additive; `personal_local` continues to operate fully offline with no control plane.

### Added

**Organization policy (`src/enterprise/policy/`)**
- Six-layer policy model: platform default → deployment → organization → workspace → user/task → capability, with separate *privilege* (who may author) and *specificity* (what wins) orderings
- Safety-relevant keys resolve **most-restrictive-wins** across all layers — a privileged layer may tighten but never loosen
- **Non-overridable user-visibility invariants**: `showApprovalRequests`, `showPolicyEffects`, `showDataScope`, `showActionProvenance`, `showCapabilityTrust`, `showIncidentImpact` cannot be disabled by any layer, including platform defaults
- Every weakening attempt is **rejected and recorded**, never silently dropped
- Full decision traces: every candidate value, whether it applied, and why
- Versioned, content-hashed, reversible policy bundles; rollback re-validates the target

**Delegated authority (`src/enterprise/authority/`)**
- Delegation is always a **strict subset** of the delegator's authority — unheld scopes are stripped, not granted
- Risk-tier ceilings only narrow down a chain; depth bounded at 4
- Immediate revocation that **cascades** to all descendant delegations
- Periodic access reviews that may only reduce scope
- Policy restrictions on authority are recorded with reasons, so users can always see why an action was blocked
- **No new identity system** — subjects reference existing Phase 11 `RemoteIdentity` and business `Member`/`AIWorker` ids

**Audit export, redaction, retention (`src/enterprise/audit/`)**
- **Verifiable redaction**: redacted fields carry a SHA-256 digest of the original value and the record's chain hashes are preserved, so a redacted export still verifies
- `proveRedactionFaithful()` detects forged digests *and* records that claim redaction while retaining the value
- Controlled export with access control, integrity manifest, chain verification, and access logging
- Truncation, withholding, and source failure are **always explicit** — never a silent short export
- Retention schedules per event class; legal hold **blocks** deletion and reports the conflict; dry-run by default
- `WorkspaceStore.auditChainRange()` — ascending audit reader that includes `prev_hash`

**Operations and SLOs (`src/enterprise/operations/`)**
- Ten SLOs, each declaring whether XR can actually measure it and from which signal
- No samples ⇒ `unmeasurable`, never a fabricated "meeting"; profile-inapplicable SLOs report `not_applicable`
- Error budgets, aggregate operational status, and alert-worthy conditions

**Incident response (`src/enterprise/incidents/`)**
- Seven-state lifecycle with an enforced transition table and fast paths for contain-first response
- Hash-committed, verifiable evidence
- Response actions bridged to real subsystems via injected handlers
- Data leakage, credential exposure, isolation failure, and audit failure **always** set user-visible impact, which an administrator cannot clear

**Capability supply chain (`src/enterprise/supplychain/`)**
- Revocation by capability, semver version range, or entire publisher
- **Evidence is snapshotted before quarantine**, so a malicious capability cannot erase its own trail
- Install/update blocking, affected-deployment notices, safe-version restore that refuses revoked versions
- Organization capability catalogs (allowlist/denylist/open) evaluated *after* revocation

**Backup and disaster recovery (`src/enterprise/recovery/`)**
- Backup verification: digest recomputation, component checks, and credential-safety scanning
- **Restore preflight gate** — a restore is refused unless the backup verifies (anti restore-poisoning)
- Cross-deployment compatibility rules; partial-restore consistency reporting
- RPO/RTO measured against declared targets; unmeasured values report `unknown`
- Recorded restore drills as evidence that backups actually work

**Release and support (`src/enterprise/release/`)**
- Channels: `stable`, `lts`, `beta`, `edge` with computed support windows
- Compatibility checks across plugin API, capsule, backup, policy, and audit-export schemas
- **Rollback validation** enforcing six invariants: local operation, policy safety, audit integrity, backups, incident evidence, capability revocation
- Release artifact digest recording and verification

**Certification evidence (`src/enterprise/certification/`)**
- 36 controls, each declaring assurance as **technical** / **operational** / **external_required**
- Eight-entry threat model with residual-risk ratings
- `assertNoFalseCertificationClaim()` — a CI-enforced guard against compliance theater
- Source and test paths in the catalog are verified to exist by test

**CLI**
- `xr enterprise` (alias `xr ent`) covering status, policy, authority, audit, slo, incident, supplychain, recovery, release, evidence

**Documentation** — `docs/phase12/`: enterprise trust architecture, policy/authority, audit export, incident response, supply-chain response, backup/recovery, SLO/observability, release/support, certification evidence, governance

### Changed
- Version 6.0.0 → 6.1.0; codename "Hybrid" → "Enterprise"
- `test/daemon.test.ts` now derives the expected version from `CORE_VERSION` instead of a hardcoded string

### Fixed
- **Redaction-claim bypass**: `proveRedactionFaithful()` verified digests but not that the redaction was actually applied, so a record could claim a field was redacted while still carrying the plaintext. Found by the adversarial suite; fixed with regression tests.
- **False audit chain break**: the CLI export read via `recentAudit()`, which omits `prev_hash` and returns newest-first, producing a spurious `partial` status. Fixed by adding `auditChainRange()`.

### Security
- Organization policy cannot silently override user-visible safety information — enforced at every layer and tested adversarially
- Task-level least privilege (Phase 3) is preserved; delegation can only narrow it
- Adversarial coverage for all nine roadmap attack classes: privilege escalation, tenant leakage, hidden policy override, audit tampering, redaction bypass, compromised capability, compromised worker, restore poisoning, revoked identity reuse
- Local/private deployments verified to require no network and no control plane

### Not included — stated explicitly
- **XR holds no external certification.** No SOC 2, ISO 27001, HIPAA, PCI-DSS, or FedRAMP. No independent security assessment or third-party penetration test has been performed. The evidence pack is a self-assessment prepared *for* such an assessment.
- Controls EX-01, EX-02, EX-03 are `not_implemented` and say so.
- No Phase 13 supremacy benchmarks or comparative performance claims.

### Testing
- **1636 tests pass, 0 fail** (from 1256 at 6.0.0) — 380 new tests, 6004 assertions, 113 files
- Zero regressions in prior phases

## [6.0.0] — XR 6.0 Hybrid — Local, Cloud, and Hybrid Operating Plane (Phase 11)

### Added
- **Deployment Profiles**: Five canonical profiles (Personal Local, Private Local Server, Team Private, Managed Cloud, Hybrid) with explicit capabilities, limitations, identity models, and recovery semantics
- **Portable Task Capsules**: Versioned, integrity-hashed (SHA-256), secret-free capsule format for portable work across deployment modes
- **Placement Policy Engine**: Weighted multi-factor placement decisions with explainability, user overrides, residency gates, and hardware scoring
- **Worker Registry**: Secure worker registration, attestation, admission, heartbeat, drain, revoke, quarantine, and stale detection
- **Control/Data Plane Separation**: Control plane handles identity/placement/policy/status; data plane handles execution; local plane handles offline operation
- **Synchronization Engine**: Bidirectional sync with conflict detection, multiple resolution strategies, offline support, and retry/backoff
- **Offline Mode Service**: Full local operation when disconnected with task queuing, priority ordering, and safe resynchronization
- **Data Residency Policy Engine**: Classification-based residency enforcement, retention policies, region restrictions
- **Remote Identity Service**: Scoped time-limited revocable identity tokens, organization management, tenant boundary definitions
- **Backup Service**: Local backup/restore with pre-restore safety, retention-based cleanup, export
- **Deployment Status**: Comprehensive status reporting for CLI/daemon/dashboard

### Changed
- Version bump from 5.3.0 to 6.0.0
- Codename from "Work" to "Hybrid"
- Updated package description

### Security
- Capsule integrity verification prevents tampering
- Control plane redaction prevents sensitive data exposure
- Worker attestation and identity verification
- Tenant/workspace isolation enforcement
- Data residency policy enforcement
- Secret non-transfer in capsules
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.3.0] - 2026-07-27 — Personal and Business Operating Layer (Work)

XR now runs durable, governed, evidence-linked intelligent work for individuals, developers, researchers, operators, and organizations via outcome-oriented journeys. This is not more modules — it is complete journeys through canonical workflow, execution, trust, intelligence, context, capability contracts.

### Added

- **Personal and Business Operating Layer (`src/business/core/operating-layer.ts`)**: Central orchestrator that makes business modules use canonical workflow/execution/trust/intelligence/context/capability contracts. Outcome-oriented journeys, governed workers, authoritative records, artifacts/evidence, organization/role authority, human approval/escalation, measurable outcomes, local/private operation, audit/provenance, CLI/daemon/dashboard.
- **Operating Types (`operating-types.ts`)**: Outcome, RecordMutation, WorkerAuthorityProfile, BusinessArtifact, ApprovalRequest, PrivacyPolicy, JourneyDefinition, OperatingLayerStatus — all typed, no placeholders.
- **Record Mutation Authority (`record-mutation.ts`)**: Canonical mutation contract per spec 6.3 — every consequential mutation links actor/worker, workflow/task/execution, policy/approval, source/evidence/context, timestamp/version, previous value/change history, reversibility/restore path. Model output is proposal until policy/workflow/human commits. No direct DB mutations outside contract. Propose→commit→revert with hash chain.
- **Outcome Tracking (`outcome.ts`)**: VerifiedOutcome with journeyId, workflowRunId, recordsChanged, artifacts, evidenceRefs, metrics, cost (est/actual, tokens, duration), verifiedAt, reversibility. Measurable business outcomes.
- **Worker Governance (`worker-contract.ts`)**: Narrow authority per spec 6.2 — role/identity, org/workspace scope, allowed workflows, context scope, capabilities/tools, model/provider scope (local-first, local-only, cost-constrained), budget per task/day, risk/placement tier0-3, approval/review requirements, data access field-level, success criteria, escalation channels, revocation/disable behavior (disable removes authority, revokes credentials, audits, no silent restoration). Effective authority = declared ∩ policy ∩ grants - denied.
- **Authority Boundaries (`authority-boundaries.ts`)**: Organization/workspace/role/worker delegated authority, record/data scope, approval authority, audit visibility — reuses existing RBAC/business foundations, no second identity system.
- **Artifact & Evidence (`artifact-evidence.ts`)**: Documents, research reports, meeting notes, communications, analytics, records use existing context/artifact/provenance contracts (WorkflowArtifact, EvidenceRef). Create artifact with SHA-256 hash, provenance (actor, sources, contextPackageIds, executionRefs, workflowRef), linkedRecords, sensitivity public/internal/confidential/restricted, content preview. Verify hash, list by workspace/run.
- **Approval/Escalation (`approval-escalation.ts`)**: Human attention — what requires approval (high-value finance >$5k, deal >$10k, external write, sensitive data, public KB), what auto (low-risk), what review (low confidence <0.7, delete), what informational (KPI, forecast). Grouping/deferral 5min window max 20 per group, avoid fatigue, uncertainty display confidence/reasons/budget/evidence. ApprovalRequest with expiry, channels dashboard/cli/webhook/email/telegram, recipients user/role/webhook_url, evidence, artifacts, context summary.
- **Local/Private (`local-privacy.ts`)**: Sensitive journeys operate locally/private where providers support it, cloud transfer requires policy/consent. Privacy modes local (no cloud), private (restricted deny, confidential require approval), hybrid (allow with policy). Sensitivity public/internal/confidential/restricted. Default rules per mode, checkPrivacy returns allow/deny/require_approval/require_consent/localOnly/remediation/redactedFields. Enforces context scope before retrieval/injection, isCloudProvider heuristic, intelligence router local-only policy.
- **Execution Bridge (`execution-bridge.ts`)**: Bridges business events to ExecutionService and WorkflowEngine — records execution per business operation, leases prevent duplicate mutation, checkpoints for recovery, trust classification, idempotency keys prevent duplicate record mutation. Persist to biz_execution_records, biz_execution_leases, biz_execution_idempotency.
- **Journeys (`journeys.ts`)**: 8 representative journeys — personal-knowledge-capture, developer-project-delivery, research-evidence-report, customer-support-triage, sales-deal-progression, project-meeting-to-doc, scheduling-meeting-coordination, finance-invoice-from-deal. Each defines trigger/intent, context package (tiers, locality, sensitivity, memory), workflow version (nodes, capabilities, authority), outcomes (metrics, verifiedOutcomeType, costBudget, successCriteria), artifacts, privacy, version, active.
- **Workflow Templates (`workflow-templates.ts`)**: Canonical workflow definitions for each journey using WorkflowDefinition types — trigger→deterministic→agentic→human_approval/human_review→business_record→tool_action→notification→artifact_output→branch/join→completion. Versioned, content hash FNV-1a, entryNodeIds, retry/backoff/timeout/cost/tags, active, published via WorkflowEngine. No visual editor.
- **Operating Layer Migration (`migration.ts`)**: 9 new tables — biz_record_mutations, biz_outcomes, biz_worker_authority, biz_artifacts, biz_approvals, biz_privacy_policies, biz_execution_records, biz_execution_leases, biz_execution_idempotency — total 42 tables. Idempotent, extends biz_audit with workflow_id, execution_id, context_package_ids, evidence_refs, policy_decision, reversible via ALTER TABLE.
- **Business DB Integration (`database.ts`)**: ensureOperatingLayer, getOperatingLayerStats, 42 tables migration, preserves existing 33.
- **BusinessOS Wiring (`index.ts`)**: Initializes operating layer services first, then modules, sets business modules into operating layer, sets governance into workers module. initialize() calls operating layer initialize which migrates and publishes templates and subscribes to events (deal.created→sales, deal.won→finance, ticket.created→support, etc).
- **AI Workers Governed (`ai-workers/index.ts` + 11 roles)**: Deploy creates both biz_workers and governance profile via WorkerGovernanceService. Toggle via governance revokes authority and audits. Chat checks enabled, budget, context scope maxItems/sensitivity. inspectWorker returns effective authority, budget status, risk status. List inspections. narrowDefaultsForRole defines sales_director single-workspace $0.50/day, ceo_advisor org-read $2/day tier0, financial_analyst local-only private, hr_manager restricted etc. 11 roles now.
- **Daemon Business Routes (`daemon/routes/business.routes.ts`)**: 13 routes — /api/business/status (workspace view), /api/business/journeys list, /api/business/journeys/:id/start, /api/business/outcomes list/:id, /api/business/approvals list/:id/decide, /api/business/artifacts, /api/business/workers list/:id/:id/disable|enable, /api/business/mutations, /api/business/privacy/:workspaceId. Uses canonical `route({ id, path/prefix, method, handle })`, no Phase 11 control plane. Wired in routes/index.ts.
- **CLI Business Commands (`commands/business.ts`)**: Outcome-centered views — status (health, tables 42, journeys 8, outcomes stats, pending approvals, privacy mode, cost), journeys list/start/show, outcomes list/show, approvals/work-queue with grouping and uncertainty, workers list/inspect/enable/disable with narrow authority, artifacts with hash/sensitivity/provenance, mutations with workflow/execution/evidence/reversible, privacy, audit verify. JSON mode via --json/-j, workspace/org flags, non-TTY machine readable, progressive disclosure, keyboard operation, accessibility via output.ts theme.
- **Tests (`test/business/operating-layer.test.ts`)**: 23 new tests — module inventory journeys complete + workflow templates valid, record mutation propose/commit/deny/revert with provenance, outcome create/update/verify cost/time, worker governance narrow authority + enable/disable revokes + budget, authority boundaries RBAC+isolation+sensitivity, artifacts creation+provenance+hash verification, approvals create/list/decide expiry + classify attention avoids fatigue, privacy enforcement local/private/hybrid + context leakage prevented, execution bridge lease+idempotency, complete journeys end-to-end personal/developer/research/finance with artifacts/outcomes/approvals, security unauthorized access denied + worker escalation + context leakage, reliability checkpoint recovery.
- **Docs (`docs/phase10/`)**: AUDIT_DELIVERABLE.md 41KB, ARCHITECTURE_DESIGN.md 26KB, AI_WORKER_CONTRACT.md, ORGANIZATION_RBAC_DATA_SCOPE.md, OUTCOME_JOURNEY_GUIDES.md, BUSINESS_WORKFLOW_INTEGRATION.md, EVIDENCE_ARTIFACT_PROVENANCE.md, APPROVALS_ESCALATIONS.md, LOCAL_PRIVATE_PRIVACY.md, DEVELOPER_INTEGRATION_GUIDE.md, USER_GUIDES.md, MIGRATION_BACKUP_RESTORE.md, README.md, RELEASE_VALIDATION.md — covering personal/business operating architecture, worker contract, org/RBAC/data scope, journey guides, workflow integration, evidence/artifact/provenance, approvals/escalations, local/private privacy, developer integration, user guides, migration/backup/restore, changelog/release/validation. No enterprise control plane claims.
- **Version Bump**: package.json 5.2.0 → 5.3.0, description XR 5.3 Personal and Business Operating Layer, src/core/version.ts 5.3.0 Work, codename Work, DISPLAY_VERSION.

### Changed

- BusinessDatabase now 42 tables (33+9), ensureOperatingLayer idempotent
- BusinessOS now exposes operating layer services: recordMutations, outcomes, workerGovernance, authority, artifacts, approvals, privacy, executionBridge, operatingLayer — plus existing modules
- AIWorkersModule now governed with narrow authority, inspection, budget, enable/disable revokes
- Daemon routes index now includes businessRoutes
- CLI BusinessCommand now outcome-centered with journeys, outcomes, approvals, workers, artifacts, mutations, privacy, audit verify
- daemon.test.ts expects version 5.3.0 (was 5.2.0)

### Security

- Authoritative records protected by RBAC + workflow policy + approval + trust classification + privacy enforcement
- AI workers have narrow declared scope, effective authority = declared ∩ policy ∩ grants - denied, not free-form autonomous
- Model output is proposal/evidence until committed via record mutation contract
- External writes require elevated approval + credential scoping via trust/credential contracts + privacy policy
- Every consequential change attributable: actor/worker, workflow/task/execution, policy/approval, evidence/context, timestamp/version, previous value/change history, reversibility/restore path
- Context scope enforced before retrieval/injection via LocalPrivacyService + context policy
- Capability authority effective, not merely declared, via WorkerGovernanceService.inspect + authority boundaries
- Sensitive business/personal data respects locality/privacy policy — local-only blocks cloud provider, private denies restricted external_write, confidential requires approval
- Disabled/revoked workers cannot execute, credentials revoked, audit preserved
- Audit history tamper-evident and exportable, hash chain SHA-256, mutation chain content hash, outcome verification

### Fixed

- daemon.test.ts version expectation 5.2.0 → 5.3.0
- OutcomeTracker.getStats column cost_duration_ms → duration_ms (bug fix)

### Migration

- Additive migration 5.2 → 5.3, no breaking changes, existing business.test.ts 21 PASS still, total tests 1151 PASS 0 FAIL
- Rollback safe: new tables independent, old code ignores them, audit chain still valid, worker enabled flag respected, no silent authority restoration or record revert

## [5.2.0] - 2026-07-27 — Capability Ecosystem

XR now exposes plugins, skills, MCP servers, providers, tools, workflows, integrations, and artifact transforms through one trusted capability ecosystem. Capability metadata is inspectable, but it never grants authority. Native execution semantics and existing security contracts remain the source of truth.

### Added

- **Capability descriptor layer** (`src/capabilities/`): common schema for publisher identity, provenance, package integrity, compatibility, dependencies, declared permissions, effective authority, data scopes, network/credential/provider requirements, placement/risk, interfaces, certification, lifecycle, support, and cost.
- **Declared vs effective authority resolver**: effective authority is declaration ∩ policy ∩ user/task grants ∩ placement limits, minus denied permissions. Denied always wins.
- **Adapters** for existing planes: plugins, skills, MCP servers, providers, tools, workflows, integrations, and artifact transforms. No second registry or permission engine was introduced.
- **Capability discovery** by task, type, required capability, excluded permissions, max risk tier, locality, publisher/trust, certification, installed/enabled state. Ranking is evidence-weighted and not popularity-only.
- **Certification contract tests** distinguishing `unknown`, `self-tested`, `xr-tested`, `verified`, `quarantined`, and `legacy`.
- **Capability CLI**: `xr capabilities list|discover|inspect|permissions|certify|enable|disable|quarantine|rollback|health` with JSON output; alias `xr capability`.
- **Daemon/dashboard inspection**: `/api/capabilities*` routes and a Capability Ecosystem dashboard panel with inspection, effective-authority visibility, discovery, and quarantine controls.
- **Config v17**: additive `capabilities` policy block (`requireSignedPackages`, `updateRequiresReview`, `quarantineOnVerificationFailure`, `deniedPermissions`, `evidenceWeightedDiscovery`).
- **Tests**: new Phase 9 coverage for authority intersection, descriptors, discovery, plugin update review, rollback without silent authority restoration, and skill package path traversal.

### Changed

- Plugin registry/manager now records lifecycle state, update-review state, rollback snapshots, and quarantine state. Plugin rollback restores files but disables the plugin and clears grants.
- Skill package import is transactional: stage extraction, reject unsafe paths, verify tree hash, re-read manifest, then swap. Skill updates requesting new permissions require explicit grant review. Skill rollback disables and clears grants.
- MCP registry now separates `declaredPermissions` from `grantedPermissions`; enable/load fail closed if authority cannot be determined or the server is quarantined.
- Online skill installs can enforce signed-package policy through `capabilities.requireSignedPackages`; unsigned/invalid/unknown signatures are represented clearly.

### Security

- New permission escalation gates for plugin and skill updates.
- Quarantined plugin/MCP capabilities cannot be enabled or loaded.
- Rollback never restores authority silently.
- Package path traversal is blocked transactionally.
- Capability metadata cannot grant authority or bypass existing execution/trust/context/workflow contracts.

---

## [5.1.0] - 2026-07-27 — Environment Interaction OS

XR becomes able to act in digital environments under one governed contract.
This release does not add "more browser/voice/vision features" — it gives every
environment action one answerable envelope: what it is, what authorizes it, how
certain perception was, whether it can be undone, and what happens when it
fails.

> **Environment interfaces are capabilities, not authority.** Perception is
> evidence, never an instruction; a coordinate is never proof of a target.

Builds on the Phase 7 (Agent and Workflow OS) baseline in `main`.

### Added

- **Environment module** (`src/environment/`): universal typed contract
  (`types.ts`) over the existing control Action union — closed environment set
  (`browser`/`desktop`/`filesystem`/`application`/`voice`/`vision`), session
  lifecycle state machine, target identity (**coordinate targets require
  evidence**), interaction kind, perception confidence (`unknown` is a real
  value), honest reversibility classes (`reversible`/`compensatable`/
  `irreversible`/`unknown`), compensation specs, approval strengths
  (`none`/`standard`/`strong`), and outcome taxonomy including
  **`uncertain` = side effect unknown, always user-visible**.
- **`runEnvironmentAction` gate** (`service.ts`): kill-switch → schema →
  compatibility → target proof → staleness → capability → privacy/consent →
  risk+reversibility+approval → permission → session → execution (via the
  existing `control.runAction`, never a private executor) → bounded recovery →
  recorded history.
- **Session registry**: max-active bound, idle sweep, circuit breaker
  (3 failures / 60 s cooldown / half-open probe), cleanup states, and
  **quarantine on cleanup defects** — a session whose cleanup failed is
  contained, never auto-revived.
- **Bounded recovery** (`recovery.ts`): at most ONE automatic re-observe retry
  for perception-shaped failures, never for irreversible/unknown/unknown-side-
  effect actions. No unrestricted autonomous repair anywhere.
- **Honest capability matrix** (`capabilities.ts`): six environments probed
  (`partial` never rounds up; `unsupported` carries remediation), including a
  real Playwright import probe replacing the legacy optimistic check.
- **Governed browser sessions** (`control/browser.ts`): isolated per-session
  contexts (no cookie/storage import-export), domain allow/block policy,
  private-network navigation blocked by default, per-session downloads root
  with byte cap (oversize deleted), page-crash detection, sandboxed launch.
- **Privacy layer** (`privacy.ts`): structural secret redaction (private-key
  armor first), redacted action echoes, dual-gate cloud consent for
  STT/TTS/vision (settings AND session policy; no ambient or inferred consent),
  retention decisions — screenshots are referenced by path+hash, never copied
  into records; raw transcripts persist only under the existing local-private
  mode-0600 policy.
- **Vision provider**: typed observations with provenance/confidence/
  sensitivity (full screens declared `private` honestly) and staleness; local
  OCR (tesseract-or-nothing, no silent cloud fallback); consent-gated cloud
  routing.
- **Voice gate**: deterministic intent confidence floor (default 0.6, spoken
  refusal below it), `never-execute-risky` extended to deterministic control
  intents, strong-approval actions forced to the text/dashboard channel.
- **Workflow binding** (`workflow-binding.ts`): environment actions compile to
  canonical Phase 7 `tool_action` nodes with risk tier, idempotency class, and
  compensation policy.
- **`xr env` command** (`status`/`capabilities`/`sessions`/`close`/`close-all`/
  `history`/`observations`/`policy`, all `--json`), daemon routes
  `/api/environment/*`, and an `environment` check in `xr doctor`.
- **Config v16**: additive `environment` block — per-modality kill switches,
  browser domain/download policy, cloud-vision consent (default off), image
  size cap (default 5 MiB), observation staleness window, voice confidence
  floor, recovery bounds, session bounds. Automatic migration 15 → 16.
- **Kill switches**: `XR_ENVIRONMENT_DISABLED=1`, `environment.enabled:false`,
  or per-modality `false` — rollback without touching core XR.
- **145 tests** across 11 new files in `test/environment/`, including a
  dedicated adversarial suite (cloud-consent, voice-bypass, instruction-
  injection framing, sandbox posture, filesystem boundary, stale-observation
  protection). Full suite: **1122 pass / 0 fail**.
- **Docs**: `docs/environment/` — contract guide, BROWSER, DESKTOP, VOICE,
  VISION, REVERSIBILITY, RECOVERY, PLATFORM_SUPPORT, TESTING, USER_GUIDE;
  Phase 8 audit report and architecture in `docs/phase8/`; XR 5.0 → 5.1
  migration section in `MIGRATION.md`.

### Fixed (audited pre-existing defects)

- Desktop **`move` no longer clicks** — it was routed through the click
  executor, performing a left-click at the target coordinates.
- Desktop **scroll on macOS/Windows no longer fakes success** — it reports an
  honest unsupported/skip outcome; the capability matrix reports scroll
  injection off-Linux as missing.
- **`xr control computer` (computer-use) bypassed the approval gate entirely**
  — each loop step raw-executed. Now the run requires outer destructive
  approval and every step goes through `runEnvironmentAction` with observation
  references and declared confidence; the loop stops on deny/block/uncertain/
  circuit-open.
- **`computer_use` cloud vision had no consent parameter** — cloud routing is
  now blocked without explicit dual consent (default: blocked).
- **Vision images had no size cap** — captures above
  `environment.vision.maxImageBytes` (default 5 MiB) are deleted immediately
  and reported as failures.

### Changed

- Voice control intents and the computer-use loop route through the
  environment gate; approval channels, trust records, and Phase 7 workflow
  semantics are otherwise untouched. All changes are additive over XR 5.0.

## [4.5.0] - 2026-07-26 — Knowledge and Context OS

XR becomes a trusted long-term intelligence layer. This release does not add
"more memory" — it converts the memory subsystem into a policy-aware context and
knowledge layer governed by one rule:

> **Memory is context, not authority.** A retrieved item never becomes an
> instruction merely because it was stored or ranked highly.

### Added

- **Context taxonomy** (`src/context/types.ts`): seven distinct classes —
  `instruction`, `memory`, `knowledge`, `evidence`, `artifact`, `task_context`,
  `untrusted`. Only `instruction` can ever carry authority.
- **Deterministic authority gate**: `mayActAsInstruction(type, trust)` requires
  BOTH an authority-eligible type and `trusted_instruction` trust. No score,
  similarity, or model classification can widen it.
- **Metadata contract**: typed provenance, freshness, confidence, consent,
  sensitivity, retention, scope, index state, and bounded relationship links.
  `unknown` is a distinct value, never a synonym for approved or true.
- **Eight context tiers** with a static, testable policy table (allowed types,
  trust ceiling, instruction eligibility, item/char bounds, compressibility).
- **Scope-first retrieval** (`src/context/retrieval.ts`): authorization is
  applied *before* semantic ranking, so an unauthorized item is never scored.
- **Deterministic reranking** with an explainable, stable ordering, plus a
  contradiction/confidence stage that reports conflicts instead of hiding them.
- **Safe injection packaging** (`src/context/injection.ts`): three channels —
  `instruction` (system), `data` (system, "context, not authority"), and
  `quarantine` (**user role**, fenced, emitted last so untrusted text cannot
  reframe trusted content).
- **Anti-poisoning** (`src/context/poison.ts`): provenance trust ceilings that
  can only lower trust, self-approval blocking, seven context-specific signature
  families, and deterministic conflict penalties.
- **Evidence-preserving compression** (`src/context/compression.ts`): ten
  required invariants; when one cannot be preserved it returns `ok: false` and
  the originals are kept. Fully deterministic — no model call.
- **Consent lifecycle**: `not_eligible`, `proposed`, `approved`, `limited`,
  `expired`, `revoked`, `deleted`, `quarantined`, `legacy_unknown`.
- **Revocation and correction**: revoking destroys the cached embedding and
  writes an append-only ledger row; correcting creates a new entry and marks the
  original superseded so lineage survives.
- **Durable context packages** with identity, version, and content hash;
  `revalidate()` re-checks consent, revocation, scope, and freshness on resume.
- **`xr context` command**: `status`, `list`, `inspect`, `explain`, `pending`,
  `legacy`, `approve`, `revoke`, `correct`, `export`, `prune` — all with `--json`.
- **Daemon routes**: `/api/context`, `/api/context/items`, `/api/context/policy`,
  `/api/context/pending`, `/api/context/export`, `/api/context/item/:id`,
  `/api/context/approve/:id`, `/api/context/revoke/:id`.
- **Dashboard**: consent counters, a pending-review queue with approve/reject,
  per-entry revoke, and honest residual-data disclosure on removal.
- **Five additive tables**: `context_items`, `context_provenance`,
  `context_revocations`, `context_packages`, `context_summaries`.
- **Config v15** `knowledge` block (enabled, injectionMode, enforceScope,
  quarantineUntrusted, routeEmbeddings, lexicalOnly, rerank, bounds,
  compression, compressionFailSafe, durablePackages, revalidateOnResume,
  disclosure).
- **190 new tests** across taxonomy, security/poisoning, retrieval, compression,
  durable/intelligence integration, migration, user flows, and performance.

### Changed

- **Embedding model selection now routes through the Phase 5 intelligence
  plane.** `src/memory/embed.ts` was a second provider router; it is now the
  transport only. Routing failure degrades to the deterministic lexical vector —
  never a silent cloud call.
- **`MemoryScope` is enforced, not merely declared.** Multi-agent workers now
  receive exactly the tiers their declared scope permits (`none` → immediate
  only); an unknown scope fails closed.
- **Plugin memory writes land as `proposed`, not usable memory.** Third-party
  code can propose but never approve; trust is clamped to `untrusted_external`.
- **Message compaction preserves evidence.** Sentences carrying decisions,
  corrections, questions, uncertainty, sources, scope, or dates are kept up to
  400 chars, so a negation like "must NOT deploy on Fridays" is no longer cut.
- **Research findings are recorded as `generated_synthesis`** with source
  citations linked, never as user facts.
- **Memory read methods return `MemoryEntryWithContext`** (a superset of
  `MemoryEntry`), so existing call-sites keep compiling.
- `user_memory` gains 20 additive nullable/defaulted columns and three indexes.

### Security

- Cross-workspace access is denied by the first check in `authorize()`.
- Untrusted and unknown-trust content is quarantined regardless of tier.
- Instructions cannot be created through the context write path at all.
- Model-authored claims are clamped to `generated_synthesis`.
- Rejection records carry ids and typed reasons but never item content.
- Secrets and out-of-workspace paths are masked before reaching a prompt.
- Resumed tasks revalidate consent and revocation before reuse.

### Compatibility

- All XR 4.4 memory APIs preserved; `buildMemoryBlock()` unchanged.
- `runAgent()` without a context package behaves exactly as in 4.4.
- `knowledge.injectionMode: "legacy"` restores 4.4 injection.
- Legacy memory migrates to `legacy_unknown` consent — **never** backfilled to
  `approved`, because XR cannot verify historical consent.
- Phase 0–5 validation remains green (939 pass; 2 pre-existing sandbox-env fails).

### Known limitations

- Embedding vectors cannot be cryptographically un-learned; XR deletes and
  invalidates them and states this honestly rather than claiming erasure.
- `rag_chunks` still lack a freshness signal (deferred, documented).
- Compression is deterministic, not model-assisted.
- Legacy consent cannot be reconstructed and stays `legacy_unknown` until reviewed.

## [4.4.0] - 2026-07-26 — Universal Intelligence Plane

### Added
- **Universal Intelligence Plane** (`src/intelligence/`): provider-neutral capability
  catalog, task-requirement filtering, deterministic explainable scoring, routing modes,
  safe fallback policy, bounded historical metrics, and durable routing decision records.
- **Capability tri-state** (`supported` | `unsupported` | `unknown`) so unknown is never
  treated as true; legacy boolean presets remain compatible.
- **Model/provider descriptors** with model classes, modalities, context limits, cost,
  latency, quality, locality/privacy, and hardware hints.
- **Routing modes**: manual, preferred_with_fallback, local_only, private_only, automatic,
  cost_constrained, latency_constrained, quality_constrained, disabled.
- **Policy hard gates**: local-only / private-only / no-cloud, credentials, budget,
  health, context limits, capability requirements — applied before scoring.
- **IntelligenceService** registered on the Phase 1 kernel (`Tokens.Intelligence`).
- **Config `intelligencePlane`** block (config version 14) — additive; defaults preserve
  XR 4.3 hybrid behavior. `allowCloudFallback` defaults false.
- **CLI**: `xr providers route`, `explain`, `catalog` (+ status shows selection/why).
- **Daemon**: `GET /api/providers/route`, `GET /api/providers/catalog`.
- **Durable wiring**: optional `ExecutionRecord.routing`, audit `intelligence.route`,
  agent fabric routing evidence.
- **Docs**: `docs/phase5/` architecture, developer, user, migration, validation, checklist.
- **Tests**: 34 new intelligence/routing/privacy/performance tests.

### Changed
- `ProviderRouter` / `buildProvider` delegate selection to the intelligence plane while
  preserving public APIs; explicit provider/model pins outrank automatic preferences.
- Agent service passes tool-use task requirements and records routing decisions.
- Version identity → **4.4.0 (Universal Intelligence Plane)**.

### Security
- Automatic routing cannot move local-only work to cloud without explicit
  `allowCloudFallback`.
- Manual pins cannot bypass locality/security policy.
- Fallback refuses `unknown_completion` to avoid duplicate side effects.
- Decision records are secret-free (no keys, no raw prompts).

### Migration
- See `docs/phase5/MIGRATION_4.3_to_4.4.md`. Config migrates 13→14 automatically.

## [4.3.0] - 2026-07-25 — Durable Agency

### Added
- **Durable checkpoints** (`src/execution/checkpoint.ts`): safe semantic boundaries
  (`task_accepted`, `plan_recorded`, `policy_admitted`, `env_admitted`, `step_started`,
  `step_completed`, `model_turn_completed`, `tool_call_completed`, `cancellation_requested`,
  `review_checkpoint_reached`, `cleanup_completed`, `recovery_decided`) with
  side-effect-safety classification and authority snapshots.
- **Local ownership/leases** (`src/execution/lease.ts`): prevents duplicate execution
  within the same workspace; detects stale process ownership via PID liveness check;
  supports acquisition, renewal, release, takeover, and cleanup.
- **Startup recovery** (`src/execution/recovery.ts`): discovers unfinished work at
  boot, classifies each record as `safe` / `unknown_side_effect` / `authority_expired` /
  `environment_lost` / `cancellation_pending`, decides `auto_resume` / `requires_approval`
  / `blocked` / `quarantined`, and records recovery decisions durably.
- **Durable cancellation** (`execution_cancellations` table): cancellation requests
  survive process restart and are honored before any resume attempt.
- **Environment attachment records** (`environment_attachments` table): persist
  environment identity, lifecycle state, and cleanup status so orphaned environments
  can be detected and quarantined at startup.
- **Recovery-aware execution states**: `recoverable`, `startup_recovery_pending`,
  `resuming`, `resumed`, `recovery_blocked` exposed through the inspection layer.
- **Bounded backpressure constants**: `MAX_ACTIVE_EXECUTIONS` (50), `MAX_RECOVERY_OPERATIONS`
  (5), `MAX_ACTIVE_ENVIRONMENTS` (10), `MAX_QUEUED_WORK` (100), `PER_WORKSPACE_CONCURRENT`
  (20) with explicit capacity reporting.
- **Retry safety reinforcement**: built on Phase 2 idempotency — `non_idempotent` actions
  with unknown side effects are never silently retried; `reconciliation_required` is the
  honest terminal state.
- **Authority revalidation on resume**: policy, credentials, placement, budget, and
  approvals are re-checked before any recovered execution can proceed.
- **CLI recovery commands**: `xr execution --recovery` shows interrupted work;
  `xr execution --resume <runId>` resumes a recoverable execution with user approval
  for unknown-side-effect cases; `xr execution --cancel <runId>` creates a durable
  cancellation.
- **Daemon recovery routes**: `GET /api/recovery` returns all pending/blocked recoveries;
  `POST /api/recovery/resume` triggers resume (with optional `force` for user-approved cases).
- **Kernel startup recovery**: `XRApp.start()` now runs `startupRecovery()` after service
  readiness; interrupted work is classified, safe work auto-resumed, and blocked work
  is exposed via health and events.
- **Graceful shutdown marking**: `ExecutionService.onStop()` checkpoints active executions
  as interrupted before stopping, so they are discoverable on next start.
- **Health integration**: `KernelHealth.recovery` reports `pending` / `blocked` counts;
  `formatHealthHuman` shows recovery section.
- **30 new tests**: checkpoint manager (7), lease manager (10), recovery manager (13).

### Changed
- Version identity updated to `4.3.0 (Durable Agency)` across package/runtime surfaces.
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.2.0` → `xr-4.3.0`.
- `ExecutionState` type extended with recovery-aware helpers (`wasInFlight`, `sideEffectPossible`).
- `ExecutionService` now owns `checkpoints`, `leases`, and `recovery` managers; creates
  checkpoints at each safe boundary; integrates with startup recovery.
- `ExecutionRepo` adds `findInterrupted()`, `countActive()`, `markInterrupted()` queries.
- `ExecutionServiceDeps` accepts optional `onRecoveryStatus` callback.
- All changes are additive: records without checkpoints (legacy or pre-4.3) are classified
  as `unknown_side_effect` and default to `requires_approval` — never silently auto-resumed.

### Security
- Unknown external side effects block automatic retry (reconciliation_required).
- Stale authority is never reused on resume — policy/credentials/placement revalidated.
- Environment quarantine prevents reuse of orphaned or incompletely cleaned environments.
- Durable cancellation survives restart; cancelled work is never silently resumed.
- Lease mechanism prevents duplicate concurrent execution within a workspace.
- Recovery decisions are durable and auditable.
- **Explicit limitation**: Phase 4 does not implement distributed execution, remote
  workers, or a cloud scheduler. Leases are local-only guards, not distributed consensus.

### Compatibility
- All Phase 0–3 tests remain green (682 of 684 pass; 2 sandbox-dependent tests fail
  only in containerized environments without OS namespace support).
- Existing execution/workflow/agent APIs unchanged.
- Additive schema migration — XR 4.2 records remain readable.
- No Phase 5+ capabilities (automatic model routing, memory/context redesign, mailbox,
  visual workflows, remote execution) are introduced.

## [4.2.0] - 2026-07-24 — Trust and Isolation

### Added
- **Trust & Isolation subsystem** (`src/trust/`): makes XR authority enforceable
  by risk tier. A policy decision is now bound to the authority of the
  environment that executes the action — a record saying "allowed" is no longer
  treated as sufficient.
- **Deterministic risk classifier** (`classify.ts`): maps objective action facts
  to `tier0_in_process | tier1_restricted | tier2_isolated` plus required
  fs/net/process policy, resource limits, credential mode, and approval level.
  A model cannot choose or downgrade a tier.
- **Fail-closed policy-to-placement** (`policy.ts`): Tier 0 stays in-process;
  Tier 1 uses a restricted process; Tier 2 uses a namespace sandbox or container
  and is **blocked** when no enforceable backend exists — never silently
  downgraded to in-process. Root voids restricted/isolated placement.
- **Real OS isolation backends** (`environment/`): `namespace_sandbox`
  (bubblewrap primary; raw user/mount/pid/net namespaces fallback) with a
  minimal rebuilt root, no network, stripped env, and `ulimit` cpu/mem/proc;
  `container` (Docker/Podman when present); `restricted_process` (Tier 1,
  honestly labeled process restriction, not a boundary); `in_process`.
- **Task-scoped authority grants** (`authority.ts`): bounded, TTL, revocable,
  bound to execution + workspace; stale/expired/revoked grants are rejected.
- **Credential broker** (`credentials.ts`): reference-only secrets, transient
  injection into the sandbox env, redaction of registered + generic secret
  shapes, `assertClean`, and revocation on cleanup. Raw values never enter
  records/logs/output.
- **Isolation verification** (`verify.ts`): proves actual placement matches the
  policy decision and guarantees meet the tier before execution; blocks
  otherwise (incl. Tier-2 network allowlists that local backends can't enforce).
- **Environment manager** (`environment/manager.ts`): capability detection,
  selection, execute-with-verification-and-cleanup, quarantine, health, shutdown.
- **`TrustService`** with lifecycle/health, registered under `Tokens.Trust` via
  `TrustServiceProvider` and wired into `ExecutionService`.
- **Execution-fabric integration**: `ExecutionRecord.trust` (risk, placement
  decision, authority-grant id, credential scope, resource policy, verification,
  cleanup/quarantine); `ExecuteOptions.trust`; new `Placement` kinds; trust gate
  runs after policy/approval and before the action (blocked → `denied`/`TRUST_BLOCKED`).
- **Tool wiring**: `ToolContext.runIsolated`; the `shell` tool runs in the
  namespace sandbox in the full runtime (legacy fallback when no Trust service).
- **Adapter-level risk classification** recorded on every consequential action:
  file/web/git tools (Tier 0/1), control/computer-use/browser (mapped from the
  existing safe/sensitive/destructive classifier; destructive host-authority
  actions admitted with an explicit elevated gate, not blocked).
- **MCP isolation**: high-risk (credential-bearing) **stdio** servers now run
  **inside the namespace sandbox** for their lifetime (stdio passes through
  bwrap; verified), and **fail closed** when no sandbox exists unless explicitly
  acknowledged (`XR_MCP_ALLOW_UNISOLATED=1`, warned). `XR_MCP_ISOLATE_STDIO=1`
  force-isolates low-risk servers; `XR_MCP_ISOLATED_NET=1` opts into in-sandbox
  network. HTTP/SSE servers remain egress-gated (Tier 1).
- **Plugin permission-aware risk model**: operations classified by **effective
  (granted)** permissions; hard-boundary capabilities (`shell`/`control`/
  `browser`) are Tier 2 and **membrane-blocked** (declared ≠ authority); `secrets`
  → Tier 2 mediated, `net` → Tier 1 egress-gated.
- **`requiresHostAuthority`** distinction: sandboxable high-risk work (shell/code)
  must be isolated or blocked; inherently host-bound work (GUI/browser) is
  admitted with an explicit elevated gate and never treated as low-risk.
- **Trust metadata durability**: the `trust` block round-trips through the
  execution repository (`record_json`); 4.1-shaped records still load.
- **UX**: `xr trust` CLI command (status / classify / --json), daemon
  `/api/trust` + `/api/trust/classify` routes (secret-free, token-gated), a
  **dashboard Trust & Isolation matrix card**, and a dashboard `/status` line.
- **Performance script**: `scripts/measure-trust-perf.ts` (per-tier latency).
- **Phase 3 documentation**: `docs/phase3/TRUST_ARCHITECTURE.md`,
  `PLATFORM_SUPPORT.md`, `THREAT_MODEL.md`, `MIGRATION_4.1_to_4.2.md`,
  `VALIDATION_REPORT.md`.
- **88 new tests** (deterministic classifier, fail-closed policy, authority,
  credential redaction, verification, **real-sandbox adversarial** proofs,
  end-to-end execution-fabric integration, per-tool/adapter classification,
  daemon/CLI UX, durability, and migration/rollback safety).

### Changed
- Version identity updated to `4.2.0 (Trust and Isolation)` across
  package/runtime/website surfaces.
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.1.0` → `xr-4.2.0`.
- All changes are additive: actions without `opts.trust`, and runtimes without a
  wired Trust service, behave exactly as in 4.1.

### Security
- High-risk actions can no longer rely on in-process checks alone: they execute
  inside a verified OS boundary or are blocked (fail closed).
- No ambient host authority is inherited by high-risk execution; credentials are
  scoped, injected transiently, redacted from records, and revoked on cleanup.
- Documented honest limits: Tier 1 is process restriction (not a boundary);
  sandbox network is `none` (no in-boundary allowlist); Linux-only Tier 2 in
  4.2; no claim against host-kernel 0-days.

### Documented limitations (out-of-scope / procedural, not technical blockers)
- **Cross-platform Tier-2 backends** (macOS Seatbelt / Windows AppContainer) are
  out of scope for 4.2 (local Linux isolation); those platforms **fail closed**
  for high-risk actions (see `docs/phase3/PLATFORM_SUPPORT.md`).
- **Running plugin VM code itself inside a kernel namespace** is future
  hardening; the "isolate-or-block" criterion is met via the **blocked** branch
  (the VM membrane denies raw process/GUI/web authority; declared ≠ authority).
- **Production rollback drill + human security/release owner sign-off** are
  operational steps; rollback **safety** is tested (no unsafe high-risk fallback,
  4.1 records load, fail-closed default).

## [4.1.0] - 2026-07-22 — Unified Execution Fabric

### Added
- **Canonical execution contract** (`src/execution/`): one typed lifecycle for every
  consequential action (intent → plan → policy → placement → action → observation →
  evidence/artifact → outcome).
- **Bounded state machine** (`src/execution/state-machine.ts`) validating all
  transitions deterministically, with distinct states for approval, budget block,
  cancellation, timeout, partial completion, and reconciliation.
- **`ExecutionService`** registered workspace-scoped under `Tokens.Execution` via the
  Phase 1 kernel. Coordinates policy/approval/budget, timeout, cancellation,
  retry, idempotency/caching, cost charging, and persistence without duplicating
  existing gates.
- **`ExecutionRepo`** with additive `execution_records` table (redacted/truncated
  payloads, workspace/session/workflow indexes, bounded history).
- **Adapters** for agent/model turns, core tools, control/computer actions, MCP
  tools/resources/prompts, plugin/skill operations, workflow tasks, research and
  business actions — all preserving existing `AgentResult`/`ToolResult`/
  `ActionResult` compatibility.
- **Idempotency model**: `naturally_idempotent | idempotent_with_key |
  non_idempotent | unknown_unsafe` with duplicate suppression and honest
  reconciliation for unknown side effects.
- **Cancellation/timeout/retry semantics** cooperative and honest — never silently
  retries non-idempotent actions when side effects are unknown.
- **Safe inspection** (`src/execution/inspection.ts`) and `xr execution` CLI
  command for bounded secret-free execution history.
- **Phase 2 documentation**: `docs/EXECUTION_FABRIC.md`,
  `docs/MIGRATION_GUIDE_4.0_TO_4.1.md`, validation report.

### Changed
- Version identity updated to `4.1.0 (Unified Execution Fabric)` across
  package/runtime/website surfaces.
- Workspace store migration adds `execution_records` and its indexes additively;
  no existing data is modified.
- Execution events are added to the existing audit log (correlated, not
  duplicated).

### Compatibility
- All Phase 0/1 tests remain green (546 → 577 passing with 31 new fabric tests).
- Existing agent, tool, control, MCP, plugin, skill, workflow, research, and
  business APIs are unchanged at the type level; canonical records are additive.
- Cost is charged exactly once per operation; no duplicate model/tool calls.

### Security
- Existing approval, budget, egress, audit, plugin/MCP permission gates are
  preserved — the fabric records and correlates them, never bypasses them.
- Execution records redact secrets and bound payloads; no credentials, full
  prompts, arbitrary binary data, or full browser pages are persisted.
- **Explicit limitation**: in-process execution is not a Phase 3 sandbox. Phase 3
  Trust and Isolation adds enforceable isolation for high-risk operations.

## [4.0.0] - 2026-07-22 — Runtime Kernel
- Stable XR 4.0 Runtime Kernel baseline (commit `c563ff3`); see Phase 1
  validation report.

## [3.1.6] - 2026-07-22

### Added
- **Phase 0 verified baseline artifacts** under `docs/release/3.1.6/`: source-derived inventory, support matrix, validation report, baseline measurements, release notes, release checklist, audit/design review, and rollback guide.
- **Baseline validation scripts**: `baseline:inventory`, `baseline:validate`, and `baseline:measure` for reproducible local release evidence.
- **Stable doctor JSON schema** (`schemaVersion: 1`) reporting version, environment, workspace/database status, redacted configuration, summary, and health checks.
- **Daemon health metadata**: `/api/health` now includes version, localhost binding, and auth-policy metadata for smoke validation.
- **Bun tool pin file** `.bun-version` set to `1.3.14`.

### Changed
- Version identity updated to `3.1.6 (Baseline Integrity)` across package/runtime/website surfaces.
- `xr doctor` and system status set a nonzero exit code when required baseline checks fail, while optional provider/local-runtime/browser/voice/control warnings remain non-fatal.
- Docker default command now starts `xr serve --port 7842`, matching the exposed and compose-mapped port.
- Documentation now distinguishes current verified implementation from roadmap intent, including process-local runtime, in-memory event bus, local daemon/dashboard, and security/isolation limitations.

### Compatibility
- No workspace database schema migration is introduced by 3.1.6.
- Public package name, bin name, existing CLI command names, daemon token behavior, provider configuration, memory consent behavior, budget checks, and plugin/skill/MCP compatibility are preserved.

### Known limitations
- Linux x64 with Bun 1.3.14 is the verified environment for this release artifact; macOS/Windows require separate validation before being claimed verified.
- Cloud providers, local model runtimes, browser automation, voice, and desktop control remain optional/environment-dependent.
- XR 4.0 Runtime Kernel, durable event sourcing, container/VM isolation, unified execution fabric, and enterprise control-plane architecture are explicitly deferred.

## [3.1.5] - 2026-07-09

### Added
- **Final dashboard consistency pass**: overview cards now wire real security and local-runtime data into Mission Control instead of leaving placeholder values.
- **Live chat header runtime label**: dashboard chat now reflects the active provider/model instead of static copy.
- **Expanded TUI quick commands**: added shell-friendly access patterns for `/home`, `/palette`, `/notifications`, and `/quick`.
- **Release prep notes**: final 3.1 polish workstream documented in a dedicated release note.

### Changed
- **System Status panel** now shows real provider health and real local runtime state.
- **Dashboard overview** now surfaces security score and local runtime summary from live APIs.
- **XR 3.1 polish track documentation** is now reflected in the changelog for clearer release history.

## [3.1.4] - 2026-07-09

### Added
- **Runtime & Research Cockpit Pass**: upgraded Models and Research panels into live Mission Control surfaces.
- **Local runtime APIs**: added dashboard-safe runtime inspection, selection, and smoke-test endpoints.
- **Research read APIs**: added dashboard-friendly recent/latest research endpoints and session detail fetches.
- **TUI summary ergonomics**: `/budget`, `/models`, and `/research` now provide immediate shell-side summaries.

## [3.1.3] - 2026-07-09

### Added
- **Budget & Usage Cockpit Pass**: Mission Control now includes a dedicated budget surface with spend controls, recent cost events, and provider/model usage views.
- **Budget APIs**: added backend routes for live budget/usage snapshots and dashboard-driven setting updates.

## [3.1.2] - 2026-07-09

### Added
- **Sessions Mission Control Pass**: dashboard now exposes recent sessions, execution steps, audit detail, and recent research runs as a first-class product surface.
- **Session detail APIs**: added local endpoints for session lookup, step history, and session-scoped audit inspection.

## [3.1.1] - 2026-07-09

### Added
- **Provider & Workspace Mission Control Pass**: dashboard can now create/switch workspaces and edit provider routing directly.
- **Workspace persistence**: active workspace selection now survives relaunches.

## [3.1.0] - 2026-07-09

### Added
- **Fullscreen XR shell by default**: `xr` now opens a dedicated terminal workspace instead of a lightweight help-first posture.
- **Dedicated onboarding flow**: `xr onboarding` now routes to the product onboarding experience directly.
- **Richer Mission Control backend**: overview, provider, workspace, and config surfaces now return live product state suitable for dashboard use.
- **Offline-safe website preview improvements**: local branding assets and fewer remote preview dependencies.

## [3.0.0] - 2026-07-08

### Added
- **Unified XR Kernel (`XRKernel`)**: Central dependency injection container (`Container`), event-driven backbone (`EventBus`), and sequential boot sequence coordinator (`LifecycleManager`).
- **Workspace Model (`WorkspaceManager`)**: Multi-tenant data segregation partitioning local SQLite connections and `.env` overlays under `~/.xr/workspaces/`.
- **Background Service Manager (`BackgroundServiceManager`)**: Out-of-band threat scanner (LOLBins/LOLBAS), budget governor, and memory prune loop.
- **`/api/agents` & `/api/agents/workflows/:id` Routes**: Deployed missing endpoints on the local daemon server for real-time workflow tracking on the Vercel dashboard.
- **`WorkspaceCommand`**: Implemented `xr workspace [list|create|use|delete]` commands on the CLI.

### Fixed
- **Pipeline Statistics Query Bug**: Patched SQLite syntax error in `src/business/core/pipeline.ts` won/lost calculations.
- **CI Test Suite Compatibility**: Added `XR_CONTROL_FORCE_TEST` bypass flag in `src/control/service.ts` to allow local-first dry-run test flows in sandboxed test runs.
- **Ecosystem MCPAssertion Compatibility**: Aligned boxed client strings with direct primitive comparisons.

### Changed
- Config Migration Schema updated to v12 (Voice Stack + Core OS compatibility).
