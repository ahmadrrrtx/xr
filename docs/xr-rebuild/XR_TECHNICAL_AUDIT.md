# XR — Technical Audit

> Evidence date 2026-09-17 · repo `main` 7ba2dc8 (v1.0.0 "Truth") · Bun 1.4.2 audit host (linux/x64).
> Tags: [OBSERVED] / [INFERRED] / [RECOMMENDED].

## 1. Toolchain & build model

- **No build step for source distribution**: npm package ships raw TypeScript; `bin/xr` prefers a compiled standalone binary (built by `scripts/build-matrix.ts`, installed by install.sh/ps1 or `xr update`), falls back to `bun run` from source, else exits 127 with a fix-it message (audit P0-1 heritage). [OBSERVED] `bin/xr` header comment.
- **Type safety**: `tsc --noEmit` gate; strict TS across 254k LOC. [OBSERVED]
- **Architecture enforcement**: dependency-cruiser `.dependency-cruiser.cjs` (`bun run boundaries`) + `test/core/no-bypass.test.ts` (only runner may call the loop). [OBSERVED]
- **Gate inventory (package.json `ci`)**: typecheck, test, release:check, channel:check, claim-lint, platform:parity:check, changelog:check, baseline:inventory, ci-capability-gate, api:schema:check, client:check, api:compat, boundaries, size-gate, hot-path-lint, ownership:check, website:marketplace:check. Plus standalone: mutation (0.6 threshold), fuzz:canonic, soak, provider:matrix, perf:gate, profile:gate, supply:check (license+SBOM), verify-release, consumer-smoke, tag-npm-invariant. [OBSERVED]
- **CI workflows**: ci, cross-platform, nightly, release, supply-chain, fuzz-guard, soak, provider-canaries, consumer-smoke, channel-install. [OBSERVED] `.github/workflows/`

**Assessment:** gate density is elite for a single-maintainer project; it is also the main tax on velocity. For the rebuild, gates must be preserved for Core and extended with desktop-shell gates (bundle, IPC contract, a11y). [INFERRED/RECOMMENDED]

## 2. Runtime characteristics (measured)

| Metric | Value | Note |
|---|---|---|
| `bun install` | 263 ms, 52 pkgs | tiny dep tree (zod) |
| CLI cold `--version` | <1 s (JIT) | fast path avoids kernel boot [OBSERVED] `src/index.ts` |
| Daemon boot | ~1 s to listening | [OBSERVED] process log |
| Dashboard payload | ~106 KB HTML single page | server-rendered; no SPA bundle [OBSERVED] |
| Full test suite | 148 s, 3,242 pass / 0 fail | [OBSERVED] |
| Memory | not profiled in audit | perf baselines exist: `docs/perf/*`, `bun run perf:gate` [OBSERVED] |

## 3. npm package audit — `@rrrtx/xr`

| Property | Finding |
|---|---|
| dist-tags | latest=1.0.0, beta=1.0.0-beta.1 [OBSERVED registry] |
| published versions | 0.2.0, 3.0.0–3.0.3, 3.1.5, 1.0.0-beta.1, 1.0.0 [OBSERVED registry] |
| version lineage | repo CHANGELOG shows 3.x→4.x→5.x→6.x→7.1.0 then deliberate rebaseline to 1.0.0 (release.manifest comment, 2026-08-13). 4.x–7.x were **never on npm** (or unpublished) → registry history looks discontinuous to outsiders. [OBSERVED+INFERRED] |
| tarball | 5.5 MB, 1,968 files: skills 875 entries, src 592, docs 483, bin 2, plugins 4, assets 7 |
| package.json | identical to repo [OBSERVED diff] |
| `files` field | bin, src, plugins, skills, assets, docs, README, LICENSE, install.sh, install.ps1 — ships **entire docs tree** (483 files) incl. frozen 7.0.1/3.1.6 release records → tarball bloat + confusion [OBSERVED] |
| drift | **missing `src/daemon/routes/mcp.routes.ts`**; tarball OpenAPI = 120 paths vs repo 126 → published daemon lacks MCP REST surface (BUG-001) [OBSERVED] |
| bin | `bin/xr` (node launcher) + `bin/xr.cjs`; launcher requires Bun or compiled binary; on a Node-only clean machine: exits 127 with explicit fix instructions (designed) [OBSERVED] |
| engines | bun>=1.3 — npm i on Node-only host installs but cannot run from source path; compiled-binary path via installers avoids Bun [OBSERVED/INFERRED] |
| global install behavior | not re-tested in audit env beyond tarball unpack; consumer-smoke workflow exists to test exactly this [OBSERVED] |
| secrets hygiene | `.gitleaksignore` present; no credentials found in repo or tarball scan (visual) [OBSERVED] |

**Recommendations:** add a `tarball-invariant` CI gate (pack → diff file list + OpenAPI hash vs repo); prune `docs/` from `files` (keep README/LICENSE + link); republish 1.0.1 with MCP routes; document the 3.x→1.0.0 rebaseline on the npm page. [RECOMMENDED]

## 4. API surface

- 129 operations, `/api/v1/*`, OpenAPI generated from the live route registry (`scripts/generate-openapi.ts`, checked in CI). Groups: agents, approvals, audit, budget, business, capabilities, chat, config, context, control, cost, environment, files, health, mcp, memory, metrics, models, onboarding, openapi, overview, plugins, providers, recovery, research, security, sessions, shield, skills, traces, triggers, trust, workspaces. [OBSERVED] `docs/api/openapi.json`
- Auth: bearer token → HttpOnly SameSite=Strict cookie (24 h); 401 JSON for non-browser; accessible 401 sign-in page for browsers (a11y-tested when Playwright present). [OBSERVED]
- Streaming: SSE for chat + research jobs. [OBSERVED]

**Assessment:** this API is the rebuild's foundation. Desktop app should consume it exclusively (plus a typed client generated by `scripts/generate-client.ts`). [RECOMMENDED]

## 5. Persistence

- bun:sqlite WorkspaceStore; 11 repos; migrations 10/11 + write-gate + idempotency keys. Audit log is an Ed25519 hash chain with anchor job. [OBSERVED]
- Config: `~/.xr/config.json`; secrets in OS keyring (linux-secret-service observed). [OBSERVED]

## 6. Platform & packaging

- Linux/macOS/Windows parity attempted (cross-platform workflow; win32 test skips documented). Docker + compose; Homebrew/Scoop/Winget manifests; compiled binary matrix. [OBSERVED]
- VS Code extension `xr-vscode` 0.1.0: status-bar cost meter + "Ask XR about selection" + open dashboard; talks to daemon at default `http://127.0.0.1:3141` (matches daemon default — verified `src/daemon/server.ts:399`). Thin but correct. [OBSERVED]

## 7. Satellites & ecosystem shape

- `@rrrtx/business-os`, `@rrrtx/xr-enterprise` hold extracted enterprise/business layers (Phase 5, ADR-0028). Core keeps L0 business views + daemon routes (migration residue). CLI shims announce relocation and exit non-zero until 2.0.0. [OBSERVED]
- Website (Next.js 16) generates marketplace data checked in CI. [OBSERVED]

## 8. Technical verdict for the rebuild

1. **Keep**: Core loop, execution fabric, trust, security services, state, providers, daemon API, gates.
2. **Adapt**: dashboard → deprecated in favor of Desktop shell (keep as headless fallback); business routes → finish satellite migration or re-home.
3. **Add**: desktop shell (Tauri v2 recommended — see Desktop Architecture), typed IPC client over daemon API, editor/terminal panes, project workspace model, design system.
4. **Never**: reimplement policy/approvals/audit in the frontend; fork the loop per surface. [RECOMMENDED]
