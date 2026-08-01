# XR Phase 4 — Step 1: Repository Audit Report

**Commit audited:** `c9332f5` (main, PR #34 — Phase 3 landed)
**Date:** 2026-08-01
**Method:** Live source inspection + live probes (`bun test`, `bun run typecheck`, backend detection) on the audit host. The repository is the source of truth; all report claims are cross-checked against code.

---

## 1. Phase 0–3 re-verification (the floor)

| # | Phase 0/1/2/3 claim | Status | Live evidence |
|---|---|---|---|
| P0-1 | One release manifest stamps version across all surfaces; CI fails on drift | **VERIFIED** | `release.manifest.json` + `scripts/release-manifest.ts --check` wired into CI (`ci.yml` truth-gate job); `src/core/version.ts` stamped 7.0.1 |
| P0-2 | Claim linter fails CI on unsupported public claim | **VERIFIED** | `scripts/claim-lint.ts` runs in CI truth-gate; `bun run claim-lint` passes locally |
| P0-3 | Guard (`security/guard.ts`) canonicalizes paths via `realpath` + WHATWG URL before policy | **VERIFIED** | `canonicalPath` (realpath + lexical fallback), `normalizeHost` collapses hex/octal/int/IPv6 host forms, `fullyDecode` percent-decodes; `checkAction` decides on canonical values |
| P1-1 | Single-writer/serialized persistence; audit chain concurrency-safe | **VERIFIED** | `busy_timeout` before WAL (Phase 1 commit), serialized audit append; `test/reliability/single-writer.test.ts` green in baseline run |
| P1-2 | Migrations versioned, reversible | **VERIFIED** | `test/reliability/migrations.test.ts` + `test/trust/migration-rollback.test.ts` green |
| P2-1 | One execution envelope, one runner, one registry, one router, one planner, one context engine | **VERIFIED** | `src/core/execution/envelope.ts` + `runner.ts`; architectural test `test/core/no-bypass.test.ts`; registry `ToolRegistryService`; `src/workflow/` and `src/memory/` retired |
| P2-2 | Envelope records placement | **VERIFIED** | `envelope.ts:103` `Placement`; **BUT recorded only — see Gap G1** |
| P3-1 | Lazy boot + compiled binary + perf budgets + regression gate | **VERIFIED** | `scripts/build-matrix.ts`, `scripts/perf-gate.ts`, `docs/perf/baseline-7.0.1-source.json`, `hot-path-lint`; all in CI |
| P3-2 | Baseline test suite green | **VERIFIED** | Live: **2303 pass / 0 fail** (158 files, 29.7s) on audit host; typecheck clean |

**No REGRESSED item found in Phases 0–3.**

## 2. Phase 4 surface audit

### 2.1 Execution placement: recorded → enforced?
**NOT ENFORCED (GAP G1 — the central Phase 4 gap).**
- `src/services/agent-service.ts:363-367` hardcodes `placement: "in_process"` with the comment *"Phase 2 records placement; risk-tiered isolation is Phase 4 and is NOT claimed here."*
- The canonical agent loop `src/core/agent.ts:217-222` builds `toolCtx` **without `runIsolated`**. The `shell` tool (`src/tools/system.ts:101-127`) therefore takes the **host-authority fallback** `runCommand("bash", ["-lc", cmd])` on the canonical path (CLI/shell/telegram/voice/daemon chat). The comment at `system.ts:79` ("FAILS CLOSED… never silently runs in-process") is **false on the canonical path** — the isolated path only exists when `toolCtx.runIsolated` is wired, which happens only in `src/execution/adapters/tool-adapter.ts:108` (`runIsolated: service.trust`), and that adapter is **not reachable from the canonical loop** (only `src/execution/adapters/index.ts` imports it; `core/agent.ts` calls `tool.run` directly at line 417).
- `TrustService` is **opt-in**: `src/execution/service.ts:65` `trust?: TrustService` — "opt-in via opts.trust" (`service.ts:357`).

### 2.2 Plugin sandbox: `node:vm` described as a boundary?
**CONFIRMED (GAP G8).** `node:vm` is used and *described as the security boundary*:
- `src/plugins/sandbox-worker.ts:5` — *"Creates a hardened VM sandbox (two-realm + membrane)"*; header lists VM blocking of `process/Bun/Function/eval/WebAssembly` as **SECURITY PROPERTIES**.
- `src/plugins/loader/sandbox.ts:2` — *"the hardened in-process VM sandbox (two-realm isolation)… This is the security boundary proven by `test/plugins/loader.test.ts`"*.
- `src/plugins/loader.ts:37,48` — *"Node.js node:vm hardened resolver patterns"*, *"the hardened in-process VM sandbox"*.
- Plugins run in a **Worker thread inside the host process** (`worker_threads`); there is **no OS-level boundary** for plugins today. Worker threads are in-process (shared address space): a compromised worker can only be stopped by the loader — and the VM realm cannot reach host modules *by construction*, but this is defense-in-depth, not confinement.

### 2.3 MCP execution model
**Partial (GAP G3).** Third-party stdio servers spawn with host authority **unless** bwrap is available AND the server is classified high-risk:
- `src/mcp/client.ts:306-361` — high-risk (credential-bearing) servers require isolation via `buildIsolatedStdioSpawn`; **`XR_MCP_ALLOW_UNISOLATED=1` explicitly permits running high-risk servers without kernel isolation** (line ~346-353) — a fail-open escape hatch not gated by any hardened mode.
- HTTP/SSE servers are connected to directly from the host process (no isolation), guarded only by URL policy (`client.ts:175`).
- Registry has declared/granted permissions + quarantine (`src/mcp/registry.ts`), and `McpManager.authorityProblem` blocks missing grants — default-deny is *partially* present for permissions; needs verification/strengthening + tests (G3b).

### 2.4 Egress: `security/guard` private-range/metadata/redirect?
**GAPS CONFIRMED (GAP G4).**
- `checkAction` is **policy, not confinement**: it validates URL-shaped strings in tool args against the domain allowlist. It does **not** block domains that resolve to private ranges, does not block `169.254.169.254` metadata via DNS, does not revalidate redirects, does no DNS resolution/pinning, no byte/time caps.
- Raw IP literals are denied unless explicitly allow-listed (`guard.ts` `isIpLiteral` path) — but the **actual fetch** (`src/tools/web.ts` `fetch(url)`) is made by the host process after the policy check: DNS rebinding / redirect-to-metadata are not prevented. `src/tools/egress.ts:hostAllowed` is suffix matching only.
- No centralized egress proxy exists anywhere in `src/`.

### 2.5 Secrets: process-global or brokered?
**HYBRID — global exposure remains (GAP G5).**
- `src/security/secrets.ts` — OS-keychain/file-backed storage with an in-memory memo; values are returned to callers in plaintext.
- `src/config/config.ts:989-1012` `hydrateSecrets()`/`hydrateSecretsAsync()` **write raw provider keys into `process.env`** (process-global), and `src/util/process.ts:82,178` child processes inherit `process.env` by default when no explicit env is passed → secrets reach children.
- `src/daemon/server.ts:160` prefetches secrets into `process.env` at daemon start.
- `src/plugins/loader/worker-loader.ts:91-108` **pre-loads raw secret values and ships them into the plugin worker** (`msg.secrets`) — raw values enter the plugin sandbox address space at startup.
- The **CredentialBroker exists** (`src/runtime/trust/credentials.ts`): in-memory, task-scoped refs, TTL, redaction, `assertClean`. It is used by the TrustService environment path but is **not** the default path for provider keys or plugin secrets.

### 2.6 Dashboard: auth / CSP / innerHTML / CSRF / rate limits
**GAPS CONFIRMED (GAP G6).**
- Auth: static bearer token, accepted via `Authorization` header **or `?token=` query string** (`src/daemon/server.ts:105-110`) — token leaks into browser history/logs/referrers; no session, no cookie, no one-time bootstrap, no rotation.
- CSP: `src/daemon/routes/router.ts:97` — `script-src 'unsafe-inline'` (dashboard script is inline); no nonce/hash.
- CSRF/Origin: **none** — any webpage can drive state-changing endpoints of the local daemon (token in URL only guards read, and a victim's browser can still be abused for cross-origin writes; `Authorization` header is not sent cross-origin, but the `?token=` query param **is** sent cross-origin on `<img>`/form navigations — token-in-URL is itself the CSRF weakness).
- Rate limits: **none** anywhere in `src/daemon/`.
- Route caps: none (no body-size/time/output caps).
- DOM: `src/daemon/dashboard/client-script.ts` has ~30 `innerHTML` sinks; most interpolate through `escapeHtml`, several do not (e.g., line 159 hardware summary concatenation; line 191 cell content; line 561 session detail template).

### 2.7 Isolation backends wired
| Backend | Exists? | Live detection on audit host |
|---|---|---|
| in-process (plain child, env-stripped) | ✅ `environment/in-process.ts` | available |
| restricted-process (path checks) | ✅ `environment/restricted-process.ts` | available (non-root) |
| namespace-sandbox bwrap | ✅ `environment/namespace.ts` (`bwrap` primary) | **bwrap NOT installed** → falls back to raw `unshare` |
| namespace-sandbox unshare fallback | ✅ same file | **available** (verified live: `unshare -Urmnp` works) |
| container (docker/podman) | ✅ `environment/container.ts` | **not installed** → unavailable (fail-closed) |
| Landlock / seccomp | ❌ not wired | — |
| gVisor / Firecracker / Kata | ❌ not wired | — |
| Seatbelt (macOS) / Apple Containers | ❌ not wired | — |
| Windows | ❌ none (documented gap) | — |

**Lattice (escalate-only merge):** ❌ absent. `policy.ts` has per-tier minimum placement tables (`MIN_PLACEMENT_FOR_TIER`) but no capability-merge lattice; `pluginCapabilityTier` (`tool-support.ts:189`) maps plugin perms to tiers but nothing enforces a merged escalate-only effective tier.

### 2.8 Supply chain
**GAPS CONFIRMED (GAP G7) — no signing, no SBOM, no provenance, no scanning.**
- CI (`.github/workflows/ci.yml`): typecheck, truth-gate, baseline, website, test, reliability, boundaries, mutation, perf. **No SAST, no secret scanning, no container scan, no license scan, no SBOM, no dependency vuln scan** (`bun install --frozen-lockfile`, no `--ignore-scripts`).
- No release workflow at all; `prepublishOnly` runs `release:check` + `claim-lint` only. No npm trusted publishing, no cosign, no Rekor, no SLSA.
- No guarantee matrix anywhere in repo (grep: 0 hits).
- No pentest register.

## 3. Isolation-backend inventory (live probes, audit host: Linux x86_64, uid 1000, bun 1.3.14)

```
in_process           AVAILABLE   (no kernel boundary — honest label)
restricted_process   AVAILABLE   (path checks only — honest label)
namespace_sandbox    AVAILABLE via unshare (bwrap absent)   → kernel boundary (user+mount+pid+net ns)
container            UNAVAILABLE (docker/podman not installed) → fail-closed
browser_isolated     UNAVAILABLE (playwright not installed)  → fail-closed for browser paths
```

## 4. Gap summary (mapped to tasks)

| # | Gap | Evidence | Risk | Task |
|---|---|---|---|---|
| G1 | Placement recorded, not enforced; canonical loop has no `runIsolated`; shell runs with host authority; TrustService opt-in | `agent-service.ts:363`, `core/agent.ts:217`, `system.ts:101-127` | **High** | T1, T3 |
| G2 | No restrictiveness lattice / escalate-only merge | `policy.ts` per-tier tables only | High | T1 |
| G3 | MCP: `XR_MCP_ALLOW_UNISOLATED` fail-open hatch; HTTP servers unisolated; default-deny under-tested | `mcp/client.ts:346-361` | High | T3 |
| G4 | No centralized egress: no DNS-time private-range/metadata block, no redirect revalidation, no pinning, no byte/time caps | `web.ts`, `egress.ts`, `guard.ts` | High | T4 |
| G5 | Secrets process-global (`process.env` hydrate), raw values into plugin workers | `config.ts:989-1012`, `worker-loader.ts:91-108` | High | T4 (broker) |
| G6 | Dashboard: `?token=` auth, `unsafe-inline` CSP, no CSRF/Origin, no rate limits, no route caps, unescaped `innerHTML` | `server.ts:105-110`, `router.ts:97`, `client-script.ts` | Medium-High | T5 |
| G7 | No supply-chain: no SBOM/SLSA/cosign/scanning/trusted publishing | `.github/workflows/*` | Medium | T6 |
| G8 | `node:vm` described as security boundary | `sandbox-worker.ts:5`, `loader/sandbox.ts:2`, `loader.ts:37,48` | Medium (truth) | T8 |
| G9 | No guarantee matrix, no pentest register, security-model docs predate lattice/egress/broker | grep 0 hits | Medium | T2, T7, docs |
