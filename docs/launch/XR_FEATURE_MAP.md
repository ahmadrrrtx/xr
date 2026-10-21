# XR — LAUNCH FEATURE MAP (Stage 1)

_Audit scope: **Desktop app + CLI coding agent (v1)**. Cloud/Business/website-console = OUT of scope (verified green, untouched)._
_Repo: `github.com/ahmadrrrtx/xr` @ **`d183179`** (main, 2026-10-20) — 20 commits ahead of the prior master-audit commit `662ac98d`. Baseline re-established on this HEAD: **4,510 pass / 19 skip / 0 fail across 419 test files** (bun 1.3.14 pinned)._
_Every entry below was opened in code or executed. Nothing here is taken on the prior audit's word — where the prior audit is used, the item was re-verified on `d183179` (status column)._

---

## 1. In-scope inventory

### 1.1 Engine (`src/` — ~172k LOC, 748 ts files in scope-adjacent modules)

| Area | Files | Purpose | Entry points | Test signal (HEAD) |
|---|---:|---|---|---|
| `src/cli/` + `src/commands/` | 24 + 29 | CLI kernel, router, global flags, help/output, and 43 catalog commands (§2-index) | `bin/xr` → `src/index.ts` → `cli/router.ts` | covered by root suite; contract tests in `test/cli*` |
| `src/core/` + `src/execution/` | 40 + 34 | Agent loop, execution fabric (envelope, leases, idempotency, checkpoints, workflows) | `AgentService.execute` (single pipeline) | `test/execution`, `test/reliability` (green) |
| `src/providers/` + `src/intelligence/` | 24 + 17 | 26 presets (16 hosted + 10 local), health/circuit breakers, failover, router | `xr providers …`, daemon providers routes | green; live-failover needs keys (documented) |
| `src/daemon/` | 100+52 route files | Local daemon `xr serve` (127.0.0.1:3141), **283 API operations**, 23-panel dashboard, SSE, PTY, builder, mobile, LAN/TLS | `xr serve [--port] [--lan]` | `test/daemon` green; live-probed in this audit (§3) |
| `src/context/` + `src/state/` | 47 + 23 | Memory/brain engine, provenance, recall, one SQLite store | daemon memory routes, CLI memory/context | green |
| `src/security/` + `src/control/` + `src/capabilities/` + `src/runtime/` | 17 + 22 + 12 + 21 | Trust plane: policy guard, approvals, budget governor, egress/SSRF guard, secrets broker, A1 filesystem authority, hash-chained audit | enforced inside execution path | `test/security`, `test/trust` green; `xr attacks` 10/10 |
| `src/voice/` | 18 | STT/TTS (sherpa-onnx), VAD, wake-word (transcript-regex), orb HUD wiring | `xr voice`, `xr speak`, `xr listen`, daemon voice routes | unit green; no mic in sandbox (documented) |
| `src/research/` | 30 | Research mode: source-first retrieval, provenance | `xr research`, daemon research routes | green |
| `src/skills/` + `src/plugins/` + `src/mcp/` | 34 + 18 + 7 | 65 bundled skills, plugin/MCP loading, quarantine | `xr skills/plugins/mcp` | green; capability gate in CI |
| `src/bots/` + telegram/discord/whatsapp | 13+11+11+12 | Chat-bot surfaces (in scope only as engine-adjacent; not a v1 launch surface) | `xr <bot>` commands | green (unit) |
| `src/agents/` + `src/automation/` + `src/triggers` | 5+5 | Multi-agent planner/lanes/verifier, approvals queue | `xr agents`, daemon agents routes | green |
| `src/install/` + `src/update/` + `src/local/` | 3+3+6 | Installer wizard, self-update, local model mgmt | `xr install`, `xr update`, `xr models` | green; 6 Windows-only skips (`install.ps1`) |

### 1.2 Desktop (`desktop/` — Tauri v2 + React 18; 36 Rust files; 681 files total)

- **Screens (18):** Splash, Onboarding, WorkspaceLanding, Workspaces, Chat, Agents, Brain, Budget, Builder, Integrations, Memory, Research, Runs, Settings, Shield, SkillsStore, Voice, + HUD window + Orb overlay (configured as separate Tauri windows in `tauri.conf.json`).
- **Rust shell:** engine sidecar lifecycle (`engine.rs`, `engine_state.rs`), tray, menus, capture, crash reporter (redaction-pinned), theme, budget commands, shield, win/unix platform code (W-1 CREATE_NO_WINDOW, W-2 job-object containment tested on windows CI leg).
- **Engine wiring:** desktop spawns the compiled `xr-engine-<triple>` sidecar (`bundle.externalBin`), talks to the daemon API it boots (auth via sidecar token handshake).
- **Test signal:** `test/desktop/` core suites (approvals/budget/builder/engine-wire/flatpak/msix/orb…) green; eslint+tsc clean; **GUI never run in any sandbox — honest gap (no DISPLAY)**.
- **Build proven (this audit):** renderer `vite build` exits 0 (see FIX_LOG W1).

### 1.3 CLI package surface

- npm package `@rrrtx/xr` (published: latest=1.0.0; 1.1.0 in tree, unpublished — see findings L-001).
- `bin/xr`: universal launcher (plain ESM under Node20+): ① compiled binary at `dist/xr-<platform>` if present → ② Bun on PATH running `src/index.ts` → ③ actionable 127 with install hint. `engines: {bun>=1.3.0, node>=20}`.
- Modes: one-shot (`xr run/-p/--diff`), REPL/Shell (`xr`), serve (Control Center), print/JSON (`--json`), doctor/help.

### 1.4 Packaging & distribution (`packaging/` + CI)

| Channel | Files | State at HEAD |
|---|---|---|
| Tauri bundles | `desktop/src-tauri/tauri.conf.json` targets: app, dmg, msi, nsis, appimage, deb, rpm | CI legs exist for Linux x64 / macOS **arm64** / Windows **x64** only (finding L-002/L-003) |
| Engine binaries | `scripts/build-matrix.ts`: linux-x64, linux-arm64, darwin-arm64, darwin-x64, windows-x64 | windows-arm64 missing (finding L-004) |
| Homebrew | `packaging/homebrew/xr.rb` (arm64/x64 mac, linux arm64/x64) | stamped for 1.1.0 but assets never shipped (L-001) |
| winget | `packaging/winget/…/1.1.0/` (x64 zip·portable) | points at non-existent v1.1.0 assets today (L-001) |
| Scoop | `packaging/scoop/xr.json` (x64 zip) | same (L-001) |
| Flatpak | `packaging/flatpak/*` (+tests) | manifest gated by `test/desktop/flatpak-metainfo.test.ts` |
| MSIX | `packaging/windows/msix/` (+assets) | build script present; uploader path via tag release |
| Docker | Dockerfile + release.yml GHCR job | not executed since failed v1.1.0 run |
| Installers | `install.sh` (binary-first, source fallback), `install.ps1` | version-stamped; verified in findings |

### 1.5 Identity & version sources

- Truth: `release.manifest.json` (1.1.0, codename Graphite) → **6 stamped surfaces**: package.json, src/core/version.ts, website/src/lib/site.ts, README.md, install.sh, install.ps1. Gate: `bun run release:check`.
- **Not gated:** `desktop/src-tauri/tauri.conf.json` (=1.1.0 today, unguarded), `desktop/src-tauri/Cargo.toml` (**=0.2.0, drifted**), `mobile/package.json` (28.0.0, independent), `cloud/package.json` (1.0.0, independent) → finding L-012.
- Desktop installer version = `tauri.conf.json.version` (Tauri v2 uses conf over Cargo).

---

## 2. Critical user flows — as they exist in code today

> Numbering `F-xx` is the flow index every finding references.

**F-01 Install — CLI (curl/PowerShell):** `install.sh` → ensure Bun → download `releases/download/v1.1.0/xr-<platform>` + `SHA256SUMS` verify → **fallback: source tarball clone** → launcher `~/.local/bin/xr` → `xr install --from-bootstrap` wizard. _Verified: v1.1.0 binary assets are MISSING ⇒ fallback path is what real users get today (L-001)._

**F-02 Install — Desktop:** download `.dmg` (arm64 mac) / `.msi`+`.exe` NSIS (win x64) / `.AppImage`/`.deb`/`.rpm` (linux x64) from GitHub Release; run OS-gated first launch. _Verified assets on v1.1.0: dmg (aarch64), rpm, AppImage, deb, app.tar.gz only ⇒ no Windows installer, no Intel-mac dmg, no ARM-windows installer on the latest tag (L-002…L-003)._

**F-03 First-run wizard (CLI):** `xr onboarding` / `xr install` → mode select (minimal/local/byok/hybrid/full) → provider key entry → `doctor` verdict. Key storage = OS keychain → AES-256-GCM sealed-file fallback (headless-safe).

**F-04 First-run (Desktop):** Splash → Onboarding screens → engine sidecar boot (health handshake) → workspace landing. Sidecar missing/unbootable = honest error panel (engine_state.rs states pinned by tests).

**F-05 Provider/model selection:** 26 presets (16 hosted: groq, google, deepseek, cerebras, openrouter, together, mistral, fireworks, sambanova, huggingface, openai, anthropic, cohere, xai, perplexity, bedrock; 10 local runtimes) + custom OpenAI-compatible endpoint (SSRF-guarded: DNS resolve-all → private-IP refuse → IP pin → ≤3 redirect revalidate; loud escape hatch `XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER=1`) → key → vault (keychain/sealed). `providers set` verifies runtime before persisting.

**F-06 Task run:** `xr run "task"` / Shell → plan → tool loop → approvals (typed; deny-by-default; fail-closed since Phase 2.3 — re-verified §3) → budget governor (per-task/monthly/daily; stop is a first-class stream state) → audit chain entry.

**F-07 Voice:** wake (transcript regex over STT) → mic capture → sherpa-onnx STT → task → TTS reply → orb states (idle/listening/thinking/speaking). Failure states: no mic, no STT model, provider down — all mapped in `src/voice/`; `xr voice setup` installs models. _Mic path not exercisable in sandbox (documented)._

**F-08 Builder IDE:** open project → AI chat → diff apply (approval-gated writes) → preview/dev-server (supervised lifecycle, process-tree kill) → terminal (PTY sessions). Builder authority = A1 filesystem authority (Linux verified live in this audit; macOS/Windows self-declared BLOCKED → fails closed as unsupported).

**F-09 Research mode:** query → source-first retrieval (offline default; opt-in web via egress rules) → provenance-bound answer; daemon `research.routes.ts` streams.

**F-10 Multi-agent + approvals queue:** planner → lanes → verifier (shared budget tree); approvals surface in CLI, daemon dashboard, desktop `/approvals`; mobile queue (paired devices only).

**F-11 Memory/brain:** workspace store (SQLite, provenance, lifecycle, TTL) + daemon memory panel + desktop Brain; poisoning mitigations = consent-first scoped writes + data-framing of tool output.

**F-12 Themes/settings (desktop):** 5 themes, Settings incl. updater panel (state: **unprovisioned at HEAD** — no pubkey baked; honest UI message ⇒ owner launch action L-011).

**F-13 CLI one-shot/REPL/print/diff:** `xr run` (one-shot), `xr` (REPL), `-p` read-only answers, `--diff` edit proposals, `--json` machine output; exit-code contract enforced (unknown flags exit 2 — **fix verified live** this audit).

**F-14 Budget cap hit:** governor refuses new spend, stream enters budget-stop state, audit-recorded; bypass attempts covered by `test/security` (reservation/lease semantics). USD caps are estimates when pricing unknown — documented honestly.

**F-15 Cancellation:** Ctrl-C / lane cancel → process-tree kill, PTY reaping, dev-server supervision teardown; checkpoint resume on next run.

**F-16 Error paths:** RFC-7807 problem bodies with zod paths; CLI errors = ✗/Why/Fix triple; `doctor` exits 1 with the repair when the system cannot work (verified).

**F-17 Uninstall / data wipe:** `xr uninstall` + `xr reset`; sealed-secrets removal; desktop uninstall per OS (NSIS/MSI/AppImage semantics); data root `~/.xr` (XR_HOME).

**F-18 Update:** CLI `xr update` (channel manifests); desktop updater (plugin configured, **unprovisioned**); npm path `npm i -g @rrrtx/xr@latest`.

---

## 3. Live-verification ledger for this map (HEAD `d183179`)

| Check | Result |
|---|---|
| Full suite `bun test` | **4,510 pass / 19 skip / 0 fail / 419 files** (212.6 s) |
| Daemon unauth battery (283 ops) | **282 × 401, health 200** (by design) |
| Host-header gate | `Host: evil.example` → **421** |
| CSRF matrix (cookie) | 127.0.0.1/localhost/[::1] → 200 (fixed); evil.example → 403; no-Origin POST → 403 (fail-closed) |
| Unknown write fields | 400 with accepted-field list (fixed) |
| Traversal/encoded/absolute/symlink file reads | 400/400/400/400 |
| Mobile routes | wired behind pairing (no longer 404) |
| Unknown CLI flags | exit 2 + Why/Fix (fixed) |
| bun cross-compile → windows-arm64 | **works** (ARM64 PE32+ produced; currently unused by repo — L-004) |
| `npm pack --dry-run` | clean; **16.9 MB tgz / 27.8 MB unpacked / 2,268 files** — docs/ = 20 MB of it (L-010) |
| `release:check` | 6 surfaces in sync at 1.1.0 |

**Map sanity-check:** against repo at `d183179`, one pass complete; discrepancies found (presets count regex, health path, catalog 43 vs prior 29-command module count) corrected above.
