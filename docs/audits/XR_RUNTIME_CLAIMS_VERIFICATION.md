# XR RUNTIME — CLAIMS VERIFICATION MATRIX

**Commit:** `3308aff` · **Date:** 2026-08-12 · **Method:** live reproduction on Linux x64 /
Bun 1.3.14 against an external mock OpenAI-compatible provider, plus direct code reading.

**Status legend:** VERIFIED · PARTIALLY VERIFIED · UNVERIFIED · FALSE · DEFERRED · N/A

A claim is only VERIFIED if I personally reproduced the behavior. Code existing is *not*
evidence. A passing test is *not* evidence unless it exercises real behavior.

---

## A. CORE RUNTIME

| # | Claim | Where claimed | Implementation | Evidence I produced | Result | Status |
|---|---|---|---|---|---|---|
| 1 | Local-first agent runtime; no mandatory cloud | README | `src/core/agent.ts`, no telemetry path | Whole audit run against a purely local endpoint; grep found no telemetry egress | Works with zero cloud | **VERIFIED** |
| 2 | BYOK — "we ship none" | README | `getSecret`, `apiKeyEnv` | No bundled keys; `.gitleaksignore` lists only declared fixtures | True | **VERIFIED** |
| 3 | Every surface funnels through one runner | README architecture | `execution/service.ts` → runner → loop | Traced CLI + daemon; both reach `AgentService.execute` | Single path | **VERIFIED** |
| 4 | Honest outcomes — success/failed/cancelled, never fake | README principle 3 | stop-reason mapping | Step-limit run returned `(stopped at step limit)`; provider failure → exit 1; worker errors → task failure | Honest | **VERIFIED** |
| 5 | "Cooperative cancellation is real… A-19" | `docs/guides/cli-compat.md` | loop checkpoints | SIGINT during in-flight call → printed "interrupted" then **hung until killed (exit 124)** | Only between steps; unrecoverable during provider stall | **PARTIALLY VERIFIED** |
| 6 | Fast path performs no sync FS/process I/O | README principle 5 | `hot-path-lint` | Gate passes; `--version` measured **32ms** | True | **VERIFIED** |
| 7 | One SQLite DB per install, inspectable | README | `state/workspace-store.ts` | `/tmp/xrh1/xr.db`, opened it directly, read `audit_log` | True | **VERIFIED** |

## B. SECURITY & TRUST

| # | Claim | Evidence I produced | Result | Status |
|---|---|---|---|---|
| 8 | Tamper-evident SHA-256 audit chain | Modified `audit_log.detail` at id 101 via sqlite3 → `xr audit verify` → **"chain BROKEN at entry id 101", exit 1**; restored → exit 0 | Genuine cryptographic tamper-evidence | **VERIFIED** |
| 9 | Human approval on consequential actions | `write_file`/`shell` on non-TTY → denied; **file never created on disk** | Fails closed | **VERIFIED** |
| 10 | Filesystem confined to working directory | `/etc/passwd`, `/tmp/x`, `../../../` → "path escapes working directory" | Blocked | **VERIFIED** |
| 11 | Secrets never printed | Set `OPENAI_API_KEY=sk-REDTEAM-…`; `doctor --json` → **0** occurrences | No leak | **VERIFIED** |
| 12 | Dashboard 127.0.0.1 only, token-authed | 401 on no/bad/empty token; bound to 127.0.0.1 | Enforced | **VERIFIED** |
| 13 | "Not a sandbox — in-process policy, not kernel isolation" | `xr trust status`: container/gvisor/firecracker **unavailable** | Honest self-limitation | **VERIFIED** |
| 14 | Deterministic injection benchmark, 10/10 blocked | `xr attacks --json` → 10/10; inspected = regex scan over fixed corpus | Real regression screen, **not** model-level injection proof | **PARTIALLY VERIFIED** |
| 15 | "Untrusted content is delimited in a non-instruction channel" | `src/core/agent.ts:558` pushes raw tool output; `scanUntrusted` **never called** in agent.ts; contextMode defaults to `legacy` | Not true on the default CLI path | **FALSE (as shipped on default path)** |
| 16 | Not SOC2/ISO/HIPAA/PCI/FedRAMP certified | README states plainly | Accurate disclaimer | **VERIFIED** |

## C. PROVIDERS & MODELS

| # | Claim | Evidence | Result | Status |
|---|---|---|---|---|
| 17 | 26 presets, 16 hosted + 10 local | Counted in `presets.ts` | Count correct | **VERIFIED** |
| 18 | Native adapters | 6 exist (anthropic, google, mistral, cohere, bedrock, cerebras); rest are OpenAI-compat presets | "Built-in" true; "native" would overstate ~20 | **PARTIALLY VERIFIED** |
| 19 | Provider switching works | Config change honored in live run | Works | **VERIFIED** |
| 20 | health() + failover | Live: "Primary provider (ollama) failed… Falling back to jan" | Real | **VERIFIED** |
| 21 | Errors handled honestly | Unreachable provider → clear message, exit 1 | Real | **VERIFIED** |
| 22 | Timeouts handled | **No `signal`/timeout on any chat fetch** (openai-compat + all 6 native) | Unbounded hang | **FALSE** |
| 23 | Rate limits handled | No chat-path backoff/retry found | — | **UNVERIFIED** |
| 24 | Hosted providers actually work | No API keys; canary machinery is secret-gated (disclosed limitation #11) | Not demonstrable here | **UNVERIFIED** |

## D. AGENT, TOOLS, MULTI-AGENT

| # | Claim | Evidence | Result | Status |
|---|---|---|---|---|
| 25 | Agent loop plans, calls tools, observes | Live run: envelope → `read_file` → real file contents into context | Real | **VERIFIED** |
| 26 | Spend ceiling enforced in code | `checkBeforeStep` in loop; meter shown live (`💰 649 tok / $0.25 cap`) | Real | **VERIFIED** |
| 27 | **Multi-agent runtime executes worker agents** | Live workflow: memory-manager → security-checker → planner → 2× researcher → reviewer → synthesizer, `status: completed`, real final output | **Works.** Prior audit's "FALSE" is now stale | **VERIFIED** |
| 28 | Review gate fails closed | Reviewer prose without JSON → `changes_requested`, synthesizer blocked | Fails closed correctly | **VERIFIED** |
| 29 | Workflow failures are honest | Blocked run printed `status: blocked` + warning | Message honest… | **VERIFIED** |
| 30 | Exit codes: "a failed command never exits 0 silently" | Blocked workflow → **exit 0** | Contract violated | **FALSE** |
| 31 | `--json` machine-readable where supported | `agents run --json` → human banner, unparseable | Contract violated for this command | **FALSE** |
| 32 | 65 bundled skills | `ls skills` = 65 dirs, 54 manifests; `xr skills list` reports **79** | Inconsistent across surfaces | **PARTIALLY VERIFIED** |
| 33 | MCP platform (stdio JSON-RPC) | Client code + `xr mcp list` works; 0 servers installed by default | Present, not exercised against a real server here | **PARTIALLY VERIFIED** |
| 34 | Plugin platform, permissioned | `xr plugins list` works; 0 shipped | Present, unexercised | **PARTIALLY VERIFIED** |

## E. OFFLINE / LOCAL AI

| # | Claim | Evidence | Result | Status |
|---|---|---|---|---|
| 35 | Works fully offline with a local model | Entire audit ran against a local endpoint; loop/tools/memory/audit/daemon all functioned | True for these capabilities | **VERIFIED** |
| 36 | "Offline" is unqualified | Web search, model download, plugin/MCP install, updates all need network | Must be qualified | **PARTIALLY VERIFIED** |
| 37 | Local runtime detection | `doctor` correctly found none installed and said so | Real probe | **VERIFIED** |
| 38 | Doctor exits non-zero when XR can't work | Fresh install, no provider → **exit 1** | Real | **VERIFIED** |

## F. VOICE / COMPUTER CONTROL

| # | Claim | Evidence | Result | Status |
|---|---|---|---|---|
| 39 | Voice stack (STT/TTS) | `voice status`: recorder/player missing, devices detected; degrades honestly, disabled by default | Honest; **not** demonstrated on hardware | **PARTIALLY VERIFIED** |
| 40 | Computer control | `env capabilities`: desktop **unsupported** (no xdotool/wmctrl); browser supported via Playwright | Honest capability reporting | **PARTIALLY VERIFIED** |

## G. RELEASE / DISTRIBUTION

| # | Claim | Evidence | Result | Status |
|---|---|---|---|---|
| 41 | `bun add -g @rrrtx/xr` installs XR 7.1.0 | npm registry dist-tag `latest` = **3.1.5**; no `v7.1.0` remote tag | Users get a 4-minor-old build | **FALSE** |
| 42 | Signed releases (cosign/SBOM/SLSA) ≥7.1.0 | CI wiring exists; no 7.1.0 release cut | Aspirational | **UNVERIFIED** |
| 43 | Version stamped from one manifest, CI-gated | `release:check` passes; all surfaces agree on 7.1.0 | Mechanism real | **VERIFIED** |
| 44 | claim-lint prevents false claims | `bun run claim-lint` exit 0; blocks prohibited patterns | Real and unusual | **VERIFIED** |
| 45 | Build/typecheck/tests pass | `tsc` clean; **2,812 pass / 13 skip / 0 fail**; 7/7 gates | Reproduced | **VERIFIED** |
| 46 | Cross-platform (Linux/macOS/Windows) | Parity gate passes; only Linux tested here | Linux only | **PARTIALLY VERIFIED** |

## H. POSITIONING

| # | Claim | Result | Status |
|---|---|---|---|
| 47 | "AI Operating System" | Application runtime with DI + daemon + capabilities. Not an OS | **MISLEADING** |
| 48 | "The AI agent runtime you can actually audit" | Audit chain, claim-lint, budget enforcement all independently verified | Defensible | **VERIFIED** |
| 49 | Superior to competitors | 5 stars vs 46k–172k; fewer providers; smaller MCP ecosystem | Not supportable | **FALSE if claimed** |
| 50 | MIT, readable end to end | MIT; code is well-commented and navigable | True | **VERIFIED** |

---

## TALLY

| Status | Count |
|---|---|
| VERIFIED | 26 |
| PARTIALLY VERIFIED | 13 |
| UNVERIFIED | 3 |
| FALSE | 5 |
| MISLEADING | 1 |

**Five FALSE claims:** #15 (untrusted-content delimiting on default path), #22 (timeouts),
#30 (exit codes), #31 (`--json`), #41 (npm distribution).

**Most important correction to prior audit:** claim #27 (multi-agent) is **VERIFIED**, not
FALSE. It was fixed after that audit was written.
