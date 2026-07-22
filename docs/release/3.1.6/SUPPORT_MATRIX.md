# XR 3.1.6 Support Matrix

Status values: **verified supported**, **supported with optional dependency**, **experimental**, **unavailable**, **legacy**, **not tested**, **deprecated**.

This matrix is scoped to XR 3.1.6 Phase 0. A support claim means the listed validation command passed in the stated environment; code branches alone are not support evidence.

## Required/core environment

| Surface | Status | Evidence / command | Notes |
|---|---|---|---|
| Bun 1.3.14 | verified supported | `bun --version`; `bun install --frozen-lockfile`; `bun run baseline:validate` | Pinned by `packageManager` and `.bun-version`. |
| Bun >=1.3.0 | supported | `package.json#engines` plus successful 1.3.14 run | Earlier 1.3.x not all re-tested in this run. |
| TypeScript 5.x | verified supported | `bun run typecheck` | Lockfile resolves current dependency. |
| Linux x64 | verified supported | `bun run baseline:validate` on Linux x64 | Primary verified environment for this release artifact. |
| macOS x64/arm64 | not tested | Needs same validation on macOS runner | Code contains platform branches; not claimed verified by this Linux run. |
| Windows x64/arm64 | not tested | `install.ps1` and validation require Windows runner | `bin/xr.cjs` and PowerShell install path exist; support is unverified here. |
| Local filesystem | verified supported | workspace/store tests; `xr doctor --json` | Requires readable/writable `XR_HOME` (default `~/.xr`). |
| SQLite workspace store | verified supported | `bun test test/state/workspace-store.test.ts` | Bun SQLite, WAL mode, workspace-scoped database paths. |

## CLI, daemon, and deployment

| Surface | Status | Evidence / command | Notes |
|---|---|---|---|
| Package/bin identity `@rrrtx/xr` / `xr` | verified supported | `bun run set-version:check`; `bun pm pack --dry-run` | Public bin remains `bin/xr.cjs`. |
| CLI help/version | verified supported | `bun run src/index.ts help`; `bun run src/index.ts --version` | Fast path, no provider credentials. |
| `xr doctor --json` | verified supported | `bun run src/index.ts doctor --json` | Stable schemaVersion 1, secrets redacted, nonzero on required failures. |
| Local daemon `xr serve` | verified supported | `bun test test/daemon.test.ts` | Binds `127.0.0.1`, health open, other routes token-protected. |
| Dashboard implementation | verified supported | `src/daemon/dashboard.ts`; daemon tests | Inline/offline-safe HTML served by daemon; top-level `website/` is marketing site. |
| Docker single-container image | supported with optional dependency | Dockerfile reviewed; optional `docker build .` | Docker daemon not required for core validation; command now uses port 7842 consistently. |
| `install.sh` | partially verified | `bash -n install.sh`; requires clean Linux install host for full flow | Syntax is gated; full bootstrap clone/install remains a release sign-off item. |
| `install.ps1` | not tested | Requires Windows runner | Documented as unverified in this Linux release artifact. |

## Providers and local runtimes

| Surface | Status | Evidence / command | Notes |
|---|---|---|---|
| Provider registry/presets | verified supported | `bun test`; inventory generation | Registration and offline health behavior tested. |
| Local runtimes (Ollama, LM Studio, llama.cpp, Jan, LocalAI, vLLM, GPT4All, KoboldCPP, Text Generation WebUI, SGLang) | supported with optional dependency | `xr doctor --json` local runtime detection | Not required for core startup. Healthy only when installed/running locally. |
| Cloud providers | supported with optional dependency | provider health check reports credential/runtime state | BYOK only; required baseline does not depend on network or credentials. |
| Automatic intelligence routing beyond current config | experimental | Source/config only | No Phase 1+ routing engine shipped in 3.1.6. |

## Capabilities

| Surface | Status | Evidence / command | Notes |
|---|---|---|---|
| Memory/RAG store | verified supported | memory tests, workspace-store tests | Consent/explicit memory behavior preserved. |
| Budget controls | verified supported | `test/cost.test.ts`; budget service tests | Offline deterministic budget tests. |
| Security approvals/audit | verified supported | security/control/audit tests | Process-local controls; not VM/container isolation. |
| Event bus | supported internal | core tests/source audit | In-memory notifications, not durable event sourcing. |
| Plugins | experimental supported | plugin loader/host tests | Plugin compatibility remains ABI-gated; no Phase 9 certification. |
| Skills | supported content/runtime; marketplace experimental | skill tests; inventory | Official skills are shipped content; marketplace/network behavior remains optional. |
| MCP | supported with optional external servers | ecosystem/MCP tests | External server availability is user-managed. |
| Browser automation | supported with optional dependency | Playwright package optional; doctor check | Browser binaries may require `xr control browser install`. |
| Desktop computer control | experimental/partial | control tests and doctor capability check | OS permission/tooling dependent; no Phase 3 isolation. |
| Voice | experimental/optional | voice tests and doctor check | Requires optional ffmpeg/STT/TTS tooling; disabled by default. |
| Business/research/Telegram modules | experimental/supported-by-tests | module tests | Broad capabilities exist; claims are limited to tested behavior. |

## Deferred Phase 1+ items

Runtime kernel redesign, unified execution fabric, durable event sourcing, container/VM isolation, routing intelligence, knowledge/workflow OS redesign, enterprise tenancy/control-plane, and visual workflow editing are **not shipped** in XR 3.1.6.
