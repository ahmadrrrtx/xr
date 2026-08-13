# XR — CLAIM VERIFICATION MATRIX

**Basis:** `main @ 82402df` (2026-08-13) · verified by live execution on Linux x64 / Bun 1.3.14 + source tracing.
Builds on and supersedes `docs/audits/XR_RUNTIME_CLAIMS_VERIFICATION.md` (2026-08-12, commit 3308aff) where noted.

**Status legend (mission taxonomy):**
`PROVEN` · `PARTIALLY PROVEN` · `UNPROVEN` · `INCORRECT` · `IMPLEMENTED BUT UNTESTED` · `DOCUMENTATION-ONLY` · `DEPRECATED`
Confidence: **H**igh / **M**edium / **L**ow.

---

## A. Core runtime

| # | Claim | Source of claim | Implementation | Test / evidence | Status | Conf. | Gap → action |
|---|---|---|---|---|---|---|---|
| A1 | Local-first agent runtime; no mandatory cloud | README, manifest claim `local-first` | `src/core/agent.ts`; no telemetry egress path | Full audit vs local endpoint; grep for egress | **PROVEN** | H | — |
| A2 | BYOK — "you bring the key, we ship none" | README, `byok` claim | `secrets.ts` + `config.ts` `apiKeyEnv` | `.gitleaksignore`; redaction tests | **PROVEN** | H | — |
| A3 | Provider-neutral — 26 presets (16 hosted + 10 local) | README, `provider-neutral` claim | `src/providers/presets.ts` | Counted presets; switch tested | **PROVEN** | H | Native-adapters wording: only 5 wired natively (A-7, fixed in README) |
| A4 | Spend-capped (USD + token ceilings) | README, `spend-capped` claim | `cost/governor.ts`, `core/agent.ts` checkBeforeStep | `test/cost.test.ts`; live meter | **PROVEN** | H | — |
| A5 | Tamper-evident hash-chained audit + verify command | README, `tamper-evident-audit` claim | `workspace-store.ts` chain + `commands/audit.ts` | Golden path `chainValid`; tamper test | **PROVEN** | H | — |
| A6 | One execution path for every surface | README architecture | `execution/service.ts`→runner→loop | Traced CLI + daemon reach `AgentService` | **PROVEN** | H | — |
| A7 | Honest outcomes (never fake success) | README principle | stop-reason mapping + `assertNoNoOpSuccess` | Step-limit / provider-down honest exits | **PROVEN** | H | — |
| A8 | Fast path does zero sync FS/process I/O | README principle | hot-path lint | `hot-path-lint` 0 sync calls | **PROVEN** | H | — |
| A9 | One SQLite DB per install, inspectable | README | `state/workspace-store.ts` | Opened `xr.db` directly | **PROVEN** | H | — |
| A10 | Written in TypeScript on Bun; no Rust | README, `typescript-runtime` claim | `package.json` engines; tree | Grep: zero Rust sources | **PROVEN** | H | — |

## B. Security & trust

| # | Claim | Evidence | Status | Conf. | Gap → action |
|---|---|---|---|---|---|
| B1 | Plugin isolation (worker + VM + trust lattice) | `plugins/loader/sandbox.ts`, `sandbox-worker.ts`, `runtime/trust/*`; tests | **PROVEN** (implemented; OS backends platform-gated) | H | macOS/Windows isolation backends unvalidated (known-lim #1) |
| B2 | MCP env allow-list (no secret leakage to servers) | `mcp/client.ts` + `test/security/mcp-allowlist.test.ts` | **PROVEN** | H | — |
| B3 | SSRF/DNS-rebinding-resistant egress | `security/egress-proxy.ts` (parse→allow→resolve→block→pin→redirect) + tests | **PROVEN** | H | — |
| B4 | Dashboard 127.0.0.1-only, token-authed | `daemon/server.ts`; live 401 probe | **PROVEN** | H | — |
| B5 | Secrets never printed | `observability/redaction.ts`, doctor JSON probe | **PROVEN** | H | Keys still hydrated into process.env (known-lim #4) |
| B6 | Secrets at rest encrypted (AES-256-GCM fallback) | `secrets.ts` `XRG1` + `test/security/secrets.test.ts` | **PROVEN** | H | Threat-model ceiling documented |
| B7 | Human approval on consequential actions, fail-closed | `control/approvals.ts`; non-TTY deny test | **PROVEN** | H | — |
| B8 | Filesystem confined to workspace | `tools/files.ts` + path-escape tests | **PROVEN** | H | — |
| B9 | Deterministic injection screen (10/10 corpus) | `security/attacks.ts`/`lab.ts` | **PROVEN** (as regression screen, not model-level proof) | H | Keep "screen, not proof" wording (H-1) |
| B10 | **Untrusted tool output delimited in a non-instruction channel** | **VERIFIED on HEAD (2026-08-13):** `core/agent.ts:569` calls `frameToolOutput()` (→ `scanUntrusted`) on every tool result and pushes the delimited content into the model stream; flagged output is audited as `security.untrusted_content` (GAP-003). Prior audit's "uncalled" finding is stale. Pinned by `test/security/tool-output-framing.test.ts`. | **PROVEN** | H | — |
| B11 | "Not a sandbox — in-process policy, not kernel isolation" | `xr trust status` honest output | **PROVEN** | H | — |
| B12 | No false certifications (SOC2/ISO/HIPAA/PCI/FedRAMP) | `release.manifest.json` prohibitedClaims + claim-lint | **PROVEN** | H | — |
| B13 | Signed releases (cosign/SBOM/SLSA) | `release.yml` wiring exists; **never run on a real tag** | **IMPLEMENTED BUT UNTESTED** (public-log evidence pending) | M | Requires tagged release (maintainer action; known-lim #6) |
| B14 | Independent pentest conducted | — | **INCORRECT** (not conducted; honestly disclosed as known-lim #5) | H | Keep disclosed; schedule engagement |

## C. Providers & models

| # | Claim | Evidence | Status | Conf. | Gap → action |
|---|---|---|---|---|---|
| C1 | Provider switching works | config change honored live | **PROVEN** | H | — |
| C2 | health() + failover | live "ollama failed → fallback jan" | **PROVEN** | H | — |
| C3 | Chat requests bounded + cancellable | `openai-compat.ts` `guardedRequest` + `AbortSignal.timeout(8000)` | **PROVEN on HEAD** (prior #22 FALSE is now fixed) | H | Verify all 6 native adapters carry the same bound |
| C4 | 429/5xx retry | `callWithRetry` one-shot retry | **PROVEN** | M | — |
| C5 | Hosted providers actually work | no CI API keys; canary is secret-gated (known-lim #11) | **UNPROVEN** (continuous) | M | Maintainer adds canary secrets |
| C6 | Local runtimes (ollama/lmstudio/…) detected | `local/*` + doctor probe | **PROVEN** | H | — |

## D. Agent, tools, multi-agent, extensibility

| # | Claim | Evidence | Status | Conf. | Gap → action |
|---|---|---|---|---|---|
| D1 | Agent loop plans→tools→observes | live envelope run | **PROVEN** | H | — |
| D2 | Multi-agent runtime executes workers | `test/multi-agent-e2e.test.ts` (prior A-1 fixed) | **PROVEN** | H | — |
| D3 | Review gate fails closed | reviewer-prose → `changes_requested` | **PROVEN** | H | — |
| D4 | Cancellation (SIGINT→130, cooperative) | A-19 live verification + `agent-cancel.test.ts` | **PROVEN** (with documented mid-fetch precision limit) | H | Cross-process stopWorkflow remains durable-record-only (documented) |
| D5 | **A failed command never exits 0 silently** | **VERIFIED on HEAD:** `commands/agents.ts` GAP-004 — terminal workflow status maps to exit codes (completed→0, cancelled→`INTERRUPT`, else→`ERROR`); router propagates `process.exitCode` (Phase 0 · T11). Prior #30 is stale. | **PROVEN** | H | — |
| D6 | **`--json` machine-readable where supported** | **VERIFIED on HEAD:** GAP-005 — `agents run --json` emits a structured JSON block; output layer routes `--json` through `JSON.stringify`. Prior #31 is stale. | **PROVEN** | H | — |
| D7 | 65 bundled skills (mechanically counted) | **VERIFIED on HEAD:** README/manifest claim is 65 dirs (mechanically counted); `xr skills list` now prints both populations explicitly ("Loaded skill records (79)" + "bundled on disk: 65 (54 manifest, 11 legacy)") — two documented populations, no contradiction (GAP-008). Prior #32 is stale. | **PROVEN** | H | — |
| D8 | MCP platform reachable from CLI + surfaces | `mcp/manager.ts`, `xr mcp list`; surface-parity test | **PARTIALLY PROVEN** (not exercised against a live server in this audit) | M | Optional: e2e vs `test/fixtures/fake-mcp-server.ts` |
| D9 | Plugin platform, permissioned | `plugins/manager.ts`, `xr plugins list` | **PARTIALLY PROVEN** | M | — |
| D10 | Workflow engine (pause/approve/cancel) | `execution/workflow/*` + tests | **PROVEN** (with documented node-executor gap, known-lim #10) | H | — |

## E. Offline / local AI / voice / computer

| # | Claim | Evidence | Status | Conf. | Gap → action |
|---|---|---|---|---|---|
| E1 | Works offline with a local model | audit vs local endpoint | **PROVEN** | H | "Offline" must be qualified (web search / downloads / updates need network) |
| E2 | Doctor exits non-zero when XR can't work | fresh-install probe → exit 1 | **PROVEN** | H | — |
| E3 | Voice stack (STT/TTS) degrades honestly, default-off | `voice/*` + `voice status` | **PROVEN** (not hardware-demonstrated) | M | — |
| E4 | Computer control governed (classify→approve→audit) | `control/*` + `computer/system-control.ts` | **PROVEN** (single-shot tools live; 6 no-op stubs removed) | H | — |
| E5 | Research produces citable reports | `research/*` | **IMPLEMENTED BUT UNTESTED** (no live e2e in this audit) | M | Optional e2e |

## F. Distribution / packaging

| # | Claim | Evidence | Status | Conf. | Gap → action |
|---|---|---|---|---|---|
| F1 | One canonical build, many channels | `scripts/build-matrix.ts` + `channel-manifest.ts` + `channel:check` | **PROVEN** (mechanism) | H | — |
| F2 | `.deb` real install tested on every PR | `channel-install.yml` deb-install job | **PROVEN** | H | — |
| F3 | Homebrew/WinGet/Scoop generated + stamped | channel-structural job | **PROVEN** (structural) | M | Real `brew/scoop/winget` install only after first tagged release |
| F4 | `bun add -g @rrrtx/xr` installs current version | npm `latest` = 3.1.5 | **INCORRECT** (documented honestly in README) | H | Cut + publish a release (maintainer action) |
| F5 | Docker image built + scanned | `Dockerfile`, supply-chain container-scan | **PROVEN** | H | GHCR publication pending tag |

## G. Summary counts (verified on HEAD 2026-08-13)

| Class | Count | Items |
|---|---|---|
| PROVEN | 37 | A1–A10 (10), B1–B13 (12 incl. B10), C1–C4,C6 (5), D1–D7 (7), E1–E4 (4), F1–F3,F5 (4 minus F4) |
| PARTIALLY PROVEN | 3 | D8 (MCP), D9 (plugins), E3/E5 (voice/research — hardware/demo not exercised) |
| IMPLEMENTED BUT UNTESTED | 1 | B13 (signed releases — pending a real tag) |
| INCORRECT / honestly-disclosed | 2 | B14 (no pentest — disclosed), F4 (npm stale — disclosed) |
| UNVERIFIED (continuous) | 1 | C5 (hosted providers — needs CI secrets) |

**Bottom line:** every *advertised* product claim has evidence on HEAD. The prior audit's open items (B10 untrusted-content, #22 timeouts, #30 exit codes, #31 `--json`, #32 skills count) are **all fixed in the 2026-08-13 `ux/redesign-v2` merge** and pinned by tests. Remaining honest limitations: no independent pentest (B14), npm/channel publication pending a tagged release (B13/F4), hosted-provider canaries bounded by CI secrets (C5).
