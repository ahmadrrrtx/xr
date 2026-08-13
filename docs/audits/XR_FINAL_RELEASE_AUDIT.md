# XR — FINAL RELEASE AUDIT

**Auditor:** Arena.ai Agent Mode (Principal Architect / QA / Release / Security / DevOps)
**Date:** 2026-08-13 · **Basis:** `main @ 82402df` ("Merge pull request #50 from ahmadrrrtx/ux/redesign-v2")
**Toolchain:** Bun 1.3.14 (repo-pinned) · Node 20 · Linux x86_64 sandbox
**Method:** Full-tree forensic read + live execution (typecheck, 238-file test suite, golden path, release/claim gates, CLI smoke) + GitHub Actions API forensics on the failing cross-platform runs.

---

## 1. Repository profile (measured on this checkout)

| Metric | Value |
|---|---|
| Source | 518 TS files · 132,776 LOC |
| Tests | 259 TS files · 48,006 LOC (238 executed by the parity authority) |
| Scripts | 48 (TS + sh) |
| Docs | 407 files |
| Skills | 65 bundled skill directories (54 with `xr-skill.json`, 11 legacy markdown) |
| Plugins | 2 bundled (hello, github) |
| Runtime deps | `zod` only (`playwright` optional) · devDeps: bun-types, axe-core, dependency-cruiser, typescript |
| `as any` in src | 201 (deliberately scoped; seams already de-cast in a prior pass) |
| Identity | `@rrrtx/xr` **7.1.0 "Truth"** · stability `public-beta` · MIT |

---

## 2. Application entry points

| # | Entry | Path | Notes |
|---|---|---|---|
| 1 | CLI product bootstrap | `src/index.ts` | Fast paths for `--version`/`help`/`shell`/`serve`; delegates to `src/cli/router.ts` (`runCli`) |
| 2 | CLI router | `src/cli/router.ts` → `src/cli/kernel-boot.ts` | Lazy kernel boot for real commands |
| 3 | Launcher (bin) | `bin/xr` | Execs compiled `dist/<platform>` binary if present, else runs source in-process. `bin/xr.cjs` is a legacy node→bun fallback |
| 4 | Runtime kernel | `src/core/kernel.ts` (`XRKernel`) | DI container + lifecycle bootstrap |
| 5 | Daemon/Control Center | `src/daemon/server.ts` (`xr serve`) | 127.0.0.1, token-authed HTTP + dashboard |
| 6 | TUI/shell | `src/interfaces/shell/app.ts`, `src/interfaces/tui.ts` | Fullscreen shell (`xr`, `xr shell`) |
| 7 | Telegram surface | `src/telegram/bot.ts` | Optional messaging gateway |
| 8 | Installers | `install.sh`, `install.ps1` | Pull the compiled binary from GitHub Releases |
| 9 | Test/CI harness | `bun test`, `scripts/parity-suite-runner.sh`, `scripts/golden-path.ts`, `scripts/ci-capability-gate.ts`, … | |

**Verified live:** `bun run src/index.ts --version` → `v7.1.0 (Truth)`; `help` renders the full catalog; `doctor --json` returns a 45-check payload.

## 3. Subsystem map (condensed)

```
entry (index.ts / bin/xr / daemon / shell / telegram)
 └─ cli/router.ts ── runCli(argv) ── kernel-boot ── XRKernel.bootstrap()
      ├─ config/          config.ts (single load, env overrides, XR_HOME)
      ├─ state/           workspace-store.ts (SQLite WAL, hash-chained audit, write-gate) + repos
      ├─ providers/       presets.ts (26) · native/{anthropic,google,mistral,cohere,bedrock,cerebras} · openai-compat · factory
      ├─ intelligence/    routing-service → router/fallback/failover/scorer (model switching)
      ├─ core/agent.ts    agent loop (plan→tool→observe) under budget governor
      ├─ execution/       envelope/runner/state-machine/checkpoint/recovery (unified execution fabric)
      ├─ services/        agent-, provider-, skill-, plugin-, mcp-, multi-agent-, planning-, budget-service
      ├─ tools/           files/git/web/system/control + registry(-builder)
      ├─ control/         governed computer-use pipeline (classify→approve→audit)
      ├─ skills/          loader/manifest/registry/marketplace/runtime (65 bundled)
      ├─ plugins/         loader(sandbox:worker)/manifest/manager/host (trust lattice)
      ├─ mcp/             client/manager/registry/allowlist (env allow-list, stdio)
      ├─ context/         assembler + memory/* (injection, compression, retrieval, provenance)
      ├─ research/        engine (search→extract→rank→synthesize→report)
      ├─ voice/           vad/wake/stt/tts/pipeline (honest degrade, host tooling probed)
      ├─ security/        shield, secrets, egress-proxy, attacks(lab), private-ip, tool-output
      ├─ runtime/trust/   lattice, policy, environment backends (namespace/bwrap/gvisor/firecracker hooks), isolated-spawn
      ├─ cost/            governor/manager/pricing (spend ceilings)
      ├─ enterprise/      audit/authority/baseline/certification/deployment/evaluation/policy/recovery/supplychain (default-off)
      ├─ platform/        capabilities + environment (lifecycle/classify/observations/recovery)
      ├─ update/          channels + atomic-updater + selfheal
      └─ observability/    otlp/metrics/logs/tracer (local-first)
```

Dependency direction is enforced by `.dependency-cruiser.cjs` (L0–L6 boundary table + acyclicity) — the `boundaries` gate passes.

## 4. Runtime bootstrap & configuration

- `src/config/config.ts` is the single config loader; `XR_HOME` (default `~/.xr`) pins data; env overrides documented; secrets resolved via `src/security/secrets.ts` (OS keychain → encrypted file fallback).
- `release.manifest.json` is the **single source of truth** for identity + claims; `bun run release:stamp` regenerates the 6 stamped surfaces; `release:check` fails on drift.

## 5. Version landscape — FINDING V-1 (mission premise does not match the repo)

| Fact | Value |
|---|---|
| "7.1.71" referenced anywhere | **Nowhere.** `grep -rn "7\.1\.71"` returns zero matches. The mission's premise ("references around 7.1.71") is a misreading. |
| Actual current version | **7.1.0 "Truth"** (public-beta), coherently stamped across 6 surfaces (verified by `release:check`) |
| Published npm `latest` | **3.1.5** (stale — 4 minors behind; no 7.x published, no `v7.1.0` tag; requires maintainer credentials) |
| Remote git tags | `v3.0.0 v4.3.0 v4.5.0 v7.0.0` |
| Stale version stragglers found | ~20 file-header comments "XR 3.1.5 (Helios)" (`src/index.ts`, `src/cli/*`, `src/commands/*`, …) + `src/enterprise/baseline/status.ts` "3.1.6" + `src/commands/doctor.ts:251` perf-standard caption. Cosmetic only — none affect behavior. |
| `1.0.0` occurrences (368) | Almost all legitimate: skill/plugin own-version fields (`skills/*/xr-skill.json`), `>=1.0.0` compatibility floors, Keep-a-Changelog URL, docs examples. **Not** a drift of the product version. |

**Consequence:** the mission's "TARGET RELEASE VERSION: 1.0.0" would be a **semver downgrade** against an established lineage (npm 3.1.5, tags to v7.0.0, changelog 0.2.0→7.1.0). Consolidating *to* 1.0.0 would (a) break semver for existing users, (b) orphan the remote tag history, (c) require re-keying ~178 references and the whole `docs/release/7.1.0/` tree. See **V-1 decision** in the implementation plan.

## 6. Live verification results (Linux x64, Bun 1.3.14)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bunx tsc --noEmit` | **PASS** |
| Full test suite | `bun test` (238 files) | **2924 pass / 13 skip / 0 fail** · 12,978 expects · 57.6 s |
| Golden path | `bun run golden-path` (hermetic) | **PASS** — ok:true, 17 checks, chain valid, 0.76 s |
| Release identity | `bun run release:check` | **PASS** — 6/6 surfaces in sync at 7.1.0 |
| Claim governance | `bun run claim-lint` | **PASS** — 10 evidenced claims, 0 unsupported |
| Platform parity authority | `bun run scripts/platform-parity.ts --validate` | **PASS** — 238 files · linux 238 · darwin 238 · win32 234 |
| CLI smoke | `--version`, `help`, `doctor --json` | **PASS** |

## 7. CI failure forensics (the "timeout" the mission reported)

GitHub API inspection of run **31702859699** (HEAD 82402df) shows all three `Cross-Platform CI` jobs **failed at step 7** ("Full unit suite") — the segmented parity runner — **not** at a job timeout and **not** at the golden path. Wall-clock to failure: Linux **100 s**, macOS **93 s**, Windows **326 s**. The failures are **real, environment-specific test failures**, three distinct root causes:

1. **Linux** — `test/reliability/concurrency-stress.test.ts` "8 writers × 50 writes → 0 locked": `database is locked`, 399/400 written, `perWriter=[50,50,50,49,50,50,50,50]`. Flaky under hosted-runner I/O (passes locally 10/10). SQLITE_BUSY escaping the write-gate retry on some open/PRAGMA path.
2. **macOS** — `/var` vs `/private/var` realpath mismatch: `test/daemon/phase-g.test.ts:61` and `test/evaluation/` compare a `realpath`-normalized product value against an un-normalized `mkdtemp` path (macOS `/var` is a symlink to `/private/var`).
3. **Windows** — (a) `test/perf/` segment: **Bun process panic** ("Internal assertion failure", crash class, exit 3); (b) `test/capabilities/lifecycle.test.ts` "full local lifecycle with effects asserted" — Windows file-lock/cleanup contention.

Full analysis + fix plan in `XR_TEST_AND_CI_REPORT.md` and `XR_CROSS_PLATFORM_REPORT.md`.

## 8. Prior-art reconciliation

The repo already contains a large self-audit corpus (`docs/audits/`, `docs/enterprise-readiness/`, `docs/release/7.1.0/`). Key prior findings and their current disposition:

| Prior finding | Status on HEAD |
|---|---|
| A-1 multi-agent workflow broken e2e | FIXED (committed; e2e test exists) |
| A-2 npm 4 minors behind / no v7.1.0 tag | **STILL OPEN** (maintainer-credential action) |
| A-3 "AI OS"/"Provable Security" framing | FIXED (prohibited-claim patterns active) |
| A-4 secrets plaintext fallback | FIXED (AES-256-GCM `XRG1` fallback) |
| A-19 cooperative cancellation | FIXED (AbortSignal threaded; SIGINT→130) — with documented mid-fetch precision limit |
| Prior claims matrix #22 "no chat timeouts" | **FIXED on HEAD** (`openai-compat.ts` now uses `guardedRequest` + `AbortSignal.timeout`) |
| Prior claims matrix #15 "untrusted-content delimiting inactive on default path" | **STILL OPEN** (contextMode defaults to `legacy` when no context package; verify `scanUntrusted` wiring) |
| Prior claims matrix #30 blocked-workflow exit 0 / #31 `--json` unparseable / #32 skills "79 vs 65" | **RE-VERIFY** during implementation (see claim matrix) |

## 9. Security posture (summary — full register in XR_SECURITY_FINDINGS.md)

Strong, honest, layered: BYOK with redaction, AES-256-GCM file fallback + OS keychains, hash-chained tamper-evident audit, centralized SSRF/DNS-rebinding-resistant egress proxy, plugin sandbox (worker + VM defense-in-depth + trust lattice), MCP env allow-list, shell isolation backends with fail-closed fallback, no fabricated certifications (prohibited-claim lint). Remaining items are documented limitations (#4 env hydration, #5 no independent pentest, #7 weaker raw-unshare fallback). No new **critical** finding was produced by this audit; the one security-adjacent behavioral gap (untrusted-content channel inactive on the default path — claims matrix #15) is logged as **High (prompt-injection defense not active by default)** pending confirmation of the exact wiring.

## 10. Performance (spot measurements)

- `--version` fast path: sub-40 ms in this sandbox (cold includes Bun JIT); `doctor --json` ≈ 0.6–1.3 s.
- Full suite completes in <60 s locally; no runaway startup in the golden path (0.76 s end-to-end).
- No meaningful bottleneck identified that is new; perf gates (`perf-gate`, `hot-path-lint`, `profile:gate`, `size-gate`) exist and are wired in CI.

## 11. Verdict (pre-implementation)

XR is **not a fresh or sloppy project** — it is a mature, heavily self-audited runtime whose advertised golden path, test suite, typecheck and identity gates all pass on a clean Linux checkout. The concrete release blockers are: **(1)** four cross-platform CI failures with three distinct root causes; **(2)** a handful of still-open prior claim-matrix items that must be re-verified and either fixed or documented; **(3)** the version-identity decision (V-1) and the un-published npm/tag state (maintainer action); **(4)** cosmetic stale-version comment cleanup. No evidence of fabricated test success or vacuous coverage was found — the suite contains adversarial/effect-asserting tests, not coverage theater.

**Release readiness verdict before implementation: PARTIAL — blocked on CI parity + V-1 decision.**
