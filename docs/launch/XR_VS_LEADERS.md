# XR vs LEADERS — live-researched comparison (Stage 2)

_All sources fetched **2026-10-20** (Asia/Karachi). Verdicts: **BLOCKER** (launch without it = bad) · **GAP** (parity-losing) · **EDGE** (XR ahead — honest marketing)._

---

## 1. CLI coding agents — install & first-run UX

| Product | Primary install (today) | npm shape | Runtime the user must have | First-run time-to-value |
|---|---|---|---|---|
| **Claude Code** (2.1.x, Oct 2026) | Native installer `curl …install.sh` / `irm …install.ps1` (auto-updates in background); Homebrew; WinGet — **npm moved to "deprecated/advanced"** | `@anthropic-ai/claude-code` downloads a **platform native binary**; Node 22+ engine only warns (EBADENGINE) — binary never uses Node | **None** (native binary) | Seconds; subscription sign-in or Console key |
| **OpenAI Codex CLI** | `curl …/codex/install.sh` / `install.ps1` (fetches from releases.openai.com, GH Releases fallback); Homebrew; WinGet; npm; **standalone per-arch binaries** (incl. `aarch64-apple-darwin`, `x86_64-apple-darwin`) | npm = Node wrapper fetching native bits | None (binary path) / Node 22+ (npm path) | Seconds; ChatGPT account or API key |
| **Gemini CLI** | **npm-first** (`npm i -g @google/gemini-cli`), Homebrew, `npx @google/gemini-cli` | Pure JS on Node 20+; channels latest/preview/nightly | Node 20+ | One command; paid API key / Code Assist (free tier retired Jun 2026) |
| **Aider** | `python -m pip install aider-install && aider-install` (uv-isolated); curl script; pipx | n/a (PyPI) | Python bootstrapped by installer (uv) | One command; BYOK |
| **OpenCode** | `curl …/install | bash`; Homebrew; npm/bun/pnpm/yarn (v2 needs `--trust`/`--allow-build` flags) | `@opencode/cli` fetches native bin; Bun install path doesn't work on Windows | None (binary-first) | Fast; BYOK |
| **XR (today)** | `install.sh`/`install.ps1` (binary-first w/ checksum + source fallback); homebrew/winget/scoop manifests; npm | `@rrrtx/xr` ships TS sources, **needs Bun ≥1.3.0 at runtime** (else actionable exit 127) | **Bun** on npm path; none on binary path | One scripted install → `xr install` wizard |

**Verdicts**
- **GAP — npm runtime requirement.** Every leader's public package ends in a *native binary or ubiquitous Node*; XR's npm path requires the user to install Bun first and downloads nothing. The compiled-binary channel exists but the npm package cannot reach it. Mitigation documented in findings (L-006).
- **GAP — npm package size.** XR tarball = 16.9 MB / 27.8 MB unpacked (docs/ = 20 MB of it). Leaders: small JS wrapper + on-demand binary. Fix L-010 cuts XR to ≈7 MB / ≈8 MB — inside the accepted band; binary-fetch-on-install remains the P2 ideal.
- **EDGE — trust surface.** None of the leaders ships an offline-verifiable hash-chained audit of what the agent did, a hard budget stop as a first-class state, or a CI gate that fails the build on its own overclaims. Genuine differentiators for the launch narrative.
- **Parity** — one-liner installers (sh/ps1), Homebrew/winget/scoop presence, checksums+SBOM+SLSA on CLI releases (XR is ahead of most peers on release provenance).

## 2. Desktop AI agents/assistants

| Product | Onboarding | Voice | Model management | Offline story | Trust model |
|---|---|---|---|---|---|
| **Jan** (v0.8.5, Oct 2026, Apache-2.0) | Polished native app on all 3 OSes; built-in HF model hub; local API :1337; MCP | None headline | llama.cpp + MLX, one-click downloads | **100% offline**; opt-in analytics | OSS, no governance layer |
| **Anything-LLM** (MIT) | Desktop app + Docker; no-code agent builder; data connectors; workspaces | Basic | External engines (Ollama/LM Studio/…) or built-in | Local-first docs/RAG | OSS; opt-out telemetry |
| **Open Interpreter** (AGPL-3.0) | CLI-first; code execution with approval prompts | History of voice efforts | BYOK/local | Local code execution | Approval prompts |
| **ChatGPT desktop / Copilot / Grok** | Account sign-in; cloud models | **Best-in-class voice latency** | Managed | None | Vendor trust |
| **XR desktop** | Onboarding screens → engine sidecar handshake → workspace landing | sherpa-onnx STT/TTS; wake-word = transcript regex; orb states; honest fallback | 26 presets BYOK + 10 local runtimes | Fully local-first, zero telemetry | **Governance in the path: policy, approvals, budgets, audit chain** |

**Verdicts**
- **BLOCKER-adjacent — signed installers.** Every consumer-grade competitor ships signed+notarized apps; XR ships unsigned CI builds today (macOS Gatekeeper / Windows SmartScreen blocks = first-launch abandonment). Owner action (certs/secrets) — see L-005/L-011. Configuration scaffolding added in Wave 1.
- **GAP — voice vs consumer leaders** (wake word regex; nothing bundled on a stock machine). Honest v1 scope: voice = "works where models installed", not a headline. (P2 recommendation; prior-audit P1-12 stands, out of Wave-1 scope.)
- **EDGE — offline + governed actions.** Jan/Anything-LLM *chat*; XR *acts under policy* with budgets and proof. Different category, worth saying plainly in launch copy.
- **GAP — model hub UX.** Jan's one-click HF hub has no XR equivalent; XR's `xr models install` is CLI-grade. Acceptable for a dev-buyer v1.

## 3. Packaging & distribution best practices (live-verified 2026-10-20)

**Tauri v2 / Windows:**
- ARM64 target = `aarch64-pc-windows-msvc`; **NSIS is the ARM64 bundle target** (MSI support for ARM64 is not the safe default; Tauri's own docs steer to `--bundles nsis`); Tauri's NSIS bootstrapper may itself run under x86 emulation while installing the native ARM64 app — normal.
- **Native runner now GA:** `windows-11-arm` (migrating to `windows-11-vs2026-arm` image, GA Aug 2026) — this is the current best practice vs cross-compiling with VS ARM64 build tools on x64 runners. Native = sidecars/tests run on-target. (XR's sidecar makes this mandatory.)
- Cross-compile alternative: `rustup target add aarch64-pc-windows-msvc` + "MSVC v143 ARM64 build tools" on `windows-latest`; builds but cannot run smoke.

**macOS:**
- Developer ID Application cert + **notarization is mandatory** for anything downloaded outside the App Store (since Catalina); signed-but-unnotarized = blocked exactly like unsigned. `tauri build` notarizes when `APPLE_CERTIFICATE(+PASSWORD)`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID`/`APPLE_PASSWORD`(or App Store Connect API key) env secrets exist; staple ticket to DMG.
- Shipping Intel + Apple Silicon = two targets (`x86_64-apple-darwin` cross-compilable on arm64 runners) or `universal-apple-darwin`. XR today: arm64 only.

**Linux:**
- AppImage + deb + rpm coverage (XR has all three) + Flatpak manifest (has it) is the complete v1 set. WebKit2GTK 4.1 is the build dep on modern runners.

**Auto-updaters:**
- Tauri updater v2 requires: pubkey in config, private key in CI secret (`TAURI_SIGNING_PRIVATE_KEY`), `latest.json` hosted at release URLs. XR: plugin + UI wired, **keypair never provisioned** → provision via `scripts/generate-updater-keys.ts --apply` (owner) + GitHub secret. Empty key ⇒ no `.sig` files ⇒ honest no-op — good fail-closed design.

**npm CLI packaging norms (2026):**
- `bin` correct shims on all 3 OSes (npm generates `.cmd` wrappers — verified for XR in Wave 1), `engines` advisory not fatal, `optionalDependencies` or postinstall-resolve for native bits, keep tarball small (few-MB wrappers + lazy binary download is the leader pattern); **avoid heavy postinstalls** (XR's `optionalDependencies.playwright` warrants scrutiny → L-007).

**Windows SmartScreen reality (unsigned/new signer, 2026):**
- Unsigned + new-signer installers get SmartScreen "Windows protected your PC" interstitial; **multiple 2026 sources note EV certs no longer buy instant reputation** — reputation accrues from download telemetry; mitigations: sign (OV/EV or **Azure Trusted Signing** — the modern cheap path), submit binaries to Microsoft's file-submission portal, consistent publisher identity, honest install docs with "More info → Run anyway" screenshots. macOS equivalent: notarization or users must right-click→Open (unacceptable for v1 consumer-facing, tolerable for dev-CLI beta).

**Honest XR position vs these:** binary channel layout + channels (brew/winget/scoop/flatpak/MSIX) is ahead of most indie projects; **missing**: Windows-ARM + Intel-mac legs, signing/notarization, provisioned updater, npm binary resolution, and a green v1.1.x release actually attached. Those are the launch blockers this audit fixes/escalates.

---
## 4. Gap → action index
| Gap | Class | Finding |
|---|---|---|
| v1.1.0 release incomplete (no npm/CLI/WIN assets) | BLOCKER | L-001 |
| No Windows ARM (desktop + CLI) | BLOCKER (scope) | L-002, L-004 |
| No Intel mac desktop | BLOCKER (scope) | L-003 |
| Unsigned installers + no notarization + unprovisioned updater | BLOCKER (owner action + scaffolding) | L-005, L-011 |
| npm size + runtime friction + playwright postinstall | GAP | L-010, L-006, L-007 |
| Version-identity blind surfaces (tauri.conf/Cargo) | GAP | L-012 |
| voice/model-hub polish | GAP (v2) | prior audit P1-12 (logged, not wave-1) |
| Governance/audit/offline story | EDGE | launch copy |
