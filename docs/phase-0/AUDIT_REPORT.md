# XR Phase 0 — STEP 1: Repository Audit Report

**Audit date:** 2026-07-31
**Repository:** https://github.com/ahmadrrrtx/xr
**Audited commit:** `7be03d9` (Merge pull request #30 from ahmadrrrtx/feature/phase-13-xr-os-supremacy)
**Branch:** `main` · **Latest tag:** `v7.0.0`
**Scale:** 1,750 tracked files · 463 under `src/` · 119 under `test/`
**Toolchain verified:** Bun 1.3.14 (matches `packageManager`), TypeScript 5.9.3

> **Method.** Every file:line hypothesis in the Phase 0 prompt was checked against the live
> working tree, not against the historical reports. Where the prompt's hypothesis proved
> correct the row reads VERIFIED; where the code has moved on it reads CHANGED; where the
> claim no longer exists it reads NOT-FOUND. Behavioural claims (doctor exit code, CLI exit
> code, routing) were confirmed by **executing the CLI**, not by reading it.

---

## 0. Pre-change baseline (measured, before any edit)

| Measurement | Value | Command |
|---|---|---|
| Typecheck | **PASS**, exit 0 | `bun run typecheck` |
| Test suite | **1771 pass / 0 fail**, 6844 assertions, 116 files, 10.95 s | `bun test` |
| Dependency install | 8 packages, 1.34 s | `bun install` |

This is the regression floor. Phase 0 must end at ≥ 1771 passing tests with 0 failures.

---

## 1. File:line hypothesis reconciliation

| # | Prompt hypothesis | Verdict | Actual current state |
|---|---|---|---|
| H1 | `src/core/version.ts` = 7.0.0 | **VERIFIED** | `PKG.version = "7.0.0"`, codename `Supremacy` (version.ts:22) |
| H2 | `package.json` = 7.0.0 | **VERIFIED** | `"version": "7.0.0"` |
| H3 | README declares "3.1.6 canonical from version.ts" | **VERIFIED** | README.md:25 declares `3.1.6 (Baseline Integrity)` "canonical version from `src/core/version.ts`" while that file says 7.0.0. Also README.md:12, :20, :21, :34, :36, :38, :565. **A self-refuting claim: the README cites the very file that contradicts it.** |
| H4 | `install.sh` = 1.0.0 | **VERIFIED** | `VERSION="1.0.0"` (install.sh:6), banner "XR Stage 2 Installer v$VERSION" (:156) |
| H5 | `install.ps1` = 1.0.0 | **VERIFIED** | `$Version = '1.0.0'` (install.ps1:15), banner (:111) |
| H6 | `credentials.ts:22` random salt not persisted | **VERIFIED — exact line** | `const salt = randomBytes(SALT_LENGTH); this.encryptionKey = scryptSync(masterKey, salt, 32);` in the **constructor**. Salt is discarded when the constructor returns. Every process start derives a different key ⇒ **100 % of stored business credentials are permanently undecryptable after restart.** |
| H7 | `engine.ts:712,730` simulate | **VERIFIED (712 CHANGED to 705, 730 exact)** | `executeToolActionNode` (engine.ts:696-719) calls `applyNodeEvent(…, "complete")` and records `outcome: "succeeded"` / `"Tool action completed"` **without ever invoking a tool**; `ns.outputs = { result: node.inputs }` echoes the inputs back as if they were results. `executeWaitTimerNode` (engine.ts:721-750) contains the comment "For now, mark as completed after the delay (simulated…)" at :730 and completes instantly for `delay`, `deadline`, and `event`. |
| H8 | `system-control.ts:65,78-81` stub tools | **VERIFIED — exact lines** | `system_volume` (:65) `ok:true` "volume control unavailable in this build"; `system_battery` (:78) `ok:true` "unavailable"; `system_wifi` (:81) `ok:true` "unavailable"; `system_media` (:79) and `system_trash` (:80) return `ok:false` (already honest, still non-functional exports). All 11 registered in `SYSTEM_TOOLS` (:83-95). |
| H9 | `shell/app.ts:552` bypasses AgentService | **VERIFIED — exact line** | `const result = await runAgent(task, state.mode, {…})` at :552, importing `runAgent` directly at :18. No `extraTools` key anywhere in the file ⇒ plugins and MCP are invisible in the Shell. |
| H10 | `telegram/bot.ts`, `voice/pipeline.ts` same defect | **VERIFIED** | `telegram/bot.ts:176` and `voice/pipeline.ts:152` both call `runAgent(...)` directly (imports at :22 and :12). Neither passes `extraTools`. |
| H11 | `guard.ts:25,68,80` regex over attacker input | **VERIFIED (25→24, 68/80 exact)** | `checkAction` (:65-91) runs `JSON.stringify(action.args)` then applies **raw regex** to that string: URL harvest `argsStr.match(/https?:\/\/([^\s"'\/]+)/gi)` (:68) and secret-path test `/\.env\b|\.ssh\/|authorized_keys\|id_rsa\|credentials/i` (:80). No `realpath`, no `new URL()`. |
| H12 | `multi-agent-service.ts inferReviewState` defaults to approved | **VERIFIED** | `inferReviewState` (:505-513) — the final statement is `return "approved";` (:512). **Fails open**: unparseable, empty, or hostile reviewer output is silently treated as approval. Line :483 independently promotes `pending` → `approved`. |
| H13 | CLI: failure exit codes / one-word routing / fallback diversity | **VERIFIED (all three broken)** | Proven by execution, see §2. |
| H14 | `server.ts:44,120` binds 127.0.0.1 | **VERIFIED — exact lines** | `const HOST = "127.0.0.1";` (:44); `Bun.serve({ hostname: HOST, port, fetch: handler })` (:120). Unreachable from a published container port. |
| H15 | `doctor.ts` no-provider run reports ok:true / exit 0 | **VERIFIED (root cause is elsewhere)** | Proven by execution, see §2. Root cause is `REQUIRED_HEALTH_CHECK_IDS` in `src/baseline/status.ts:93`. |
| H16 | Website: SOC 2 / ISO 27001 / HIPAA / 12,000 skills / 74k stars / Rust core | **VERIFIED — all present** | See §3 inventory. |
| H17 | `CONTRIBUTING.md`, `CODEOWNERS`, claim-linter, templates, branch protection | **NOT-FOUND** | None exist. `.github/` contains **only** `workflows/ci.yml`. |
| H18 | Baseline scripts exist | **CHANGED — partially present** | `scripts/{baseline-inventory,measure-baseline,validate-baseline,set-version}.ts` exist and `docs/release/3.1.6/` holds baseline artifacts — but they are stamped for the **stale 3.1.6 identity**, not 7.0.0. No claim-linter exists. |

---

## 2. Behavioural findings (executed, not read)

These were reproduced by running the CLI in a clean `HOME` with no provider credentials.

**B1 — `doctor` lies about readiness.** `bun run src/index.ts doctor --json` with **zero** providers
configured returned `"ok": true`, `"state": "warn"`, `"exitCode": 0`, `"requiredFailures": []`,
process exit **0**. Root cause: `REQUIRED_HEALTH_CHECK_IDS = ["platform","bun","package-manager","config","audit"]`
(`src/baseline/status.ts:93`). Readiness is defined as *"the binary is installed"*, never *"a task can
actually run"*. Provider health is downgraded to a warning. **XR reports itself healthy while being
incapable of executing a single task.** (Exit-gate item 2.)

**B2 — Failed tasks exit 0.** `xr "write a haiku"` with no reachable provider printed
`✗ error: Unable to connect` and exited **0**. Root cause: `run-agent.ts` sets `process.exitCode = 1`
only inside `catch`; a *returned* `AgentResult` with `stopped:"error"` takes the success path
(`run-agent.ts:83-85` warns but never sets an exit code), and `router.ts:442` unconditionally
`return EXIT.OK` after `executeCommand`. **Every CI pipeline wrapping XR is silently green on failure.**
(Exit-gate item 8.)

**B3 — Same-target fallback.** Output: `Ollama (Local) → fallback Ollama (Local)`, then
`Primary provider (ollama) failed… Falling back to ollama...`. Root cause: `config.ts:515-516`
defaults `fallbackProvider` to `"ollama"` while `defaults.provider` is also `"ollama"`. The
diversity check `fallbackId !== primaryId` at `routing.ts:203` guards only the *legacy* path
(`wrapFallbackLegacy`); the primary decision path (`routing.ts:165-183`) applies **no diversity
check at all**. Retrying a dead endpoint against itself is presented to the user as resilience.
(Exit-gate item 8.)

**B4 — One-word free-form input rejected.** `xr hello` → `✗ Unknown command: hello` instead of
routing to task mode. Root cause: `router.ts:414-427` — for a single token under 24 chars with no
args, `didYouMean` + `editDistance ≤ 2` calls `unknownCommand(head)`, which throws. `hello` is
within edit distance 2 of `help`. **The documented `xr "your task"` grammar fails for one-word tasks.**
(Exit-gate item 8.)

**B5 — `xr <unknown>` returns exit 0 too.** `xr asdfqwerzxcv` fell through to task mode (correct),
failed to reach a provider, and still exited **0** — the same defect as B2.

---

## 3. Unsupported public-claim inventory (website + README)

Every hit below is a claim with **no evidence artifact anywhere in the repository**.

| Claim | Locations | Reality in repo |
|---|---|---|
| "SOC 2 Type II" | `website/src/app/page.tsx:76,200`; `security/page.tsx:17,58`; `enterprise/page.tsx:16`; `lib/data.tsx:547,613` | No audit, no auditor, no report. Fabricated. |
| "ISO 27001" | `enterprise/page.tsx:16`; `security/page.tsx:17`; `lib/data.tsx:547` | No certification. Fabricated. |
| "HIPAA / HIPAA-ready" | `page.tsx:200`; `security/page.tsx:17`; `enterprise/page.tsx:16`; `lib/data.tsx:547` | No BAA, no controls. Fabricated. |
| "GDPR", "CCPA" (as certifications) | `security/page.tsx:17` | Listed under `const certifications` — neither is a certification. |
| "12,000+ skills" | `page.tsx:54,174,252,290`; `marketplace/page.tsx:13`; `lib/data.tsx:42,73,633` | **`skills/` contains 65 directories.** Overstated **185×**. |
| "74k" GitHub stars | `page.tsx:68` | Live GitHub API for `ahmadrrrtx/xr`: the repo is days old with a negligible star count. Fabricated. |
| "Rust core" | `page.tsx:246`; `lib/data.tsx:67,586` | **Zero Rust in the repository.** 100 % TypeScript on Bun. Fabricated. |
| Dead `href="#"` links | 2 occurrences in `website/` | Non-functional navigation. |

**Newly discovered (not in the prompt):** `security/page.tsx:58` offers to send "our SOC 2 report,
penetration test summaries, and architecture whitepaper" — a promise to deliver documents that do
not exist; and `lib/data.tsx:586` claims a "Rewritten Rust core: 3x faster cold starts" as shipped
changelog history. Both are added to the T3 purge set.

---

## 4. Defects discovered during audit that the prompt did NOT list

| ID | Defect | Location | Why it matters |
|---|---|---|---|
| **N1** | `get_open_apps` returns `ok:true` with `"open-app listing is not available on this platform"` | `system-control.ts:19` | Same no-op-success class as H8 but **not** in the prompt's removal list. Caught by the T7 guard. |
| **N2** | `system_notify` returns `ok:true, "notification requested"` on Linux/Windows where it runs **no command at all** (only `darwin` is implemented) | `system-control.ts:67-77` | Claims a notification was shown when nothing happened. Cross-platform silent lie. |
| **N3** | `system_screenshot` returns `ok:true` with `"use computer_control for screenshots"` | `system-control.ts:66` | Success wrapper around a redirect message. |
| **N4** | Reviewer promotes `pending` → `approved` outside `inferReviewState` | `multi-agent-service.ts:483` | A second fail-open path; fixing only `inferReviewState` would leave this hole open. |
| **N5** | Primary routing path has **no** fallback-diversity check (only the legacy path does) | `routing.ts:165-183` vs `:203` | The prompt implies one fallback bug; there are two code paths and the *active* one is unguarded. |
| **N6** | `set-version.ts` stamps only `package.json` → `version.ts` → `website/src/lib/site.ts` | `scripts/set-version.ts:26-29` | README, `install.sh`, `install.ps1` are **outside** the invariant — which is precisely why they drifted to 3.1.6 / 1.0.0 while CI stayed green. The existing `version-sync` CI job cannot catch H3/H4/H5. |
| **N7** | `docs/release/` contains only `3.1.6/` | `docs/release/` | Release evidence directory is stamped to a version that no longer exists in code. |

**N6 is the most consequential finding of the audit:** the repository already had a version-sync
CI gate, and it was green while three surfaces disagreed — because the gate's file list was
incomplete. T1/T2 must therefore *widen the invariant*, not merely re-stamp files.

---

## 5. Work already complete (do not redo)

Honest reporting requires recording what is **already right**:

- `install.sh` **already** supports non-interactive use: `-y|--yes` (:16), `YES=1` short-circuit in
  `prompt_yes` (:38), `is_tty` guard returning safe-deny when not a TTY (:39), and `--yes`
  propagation to the sub-installer (:167). **T12's installer half is largely satisfied**; it needs
  verification and an automated test, not a rewrite.
- `.github/workflows/ci.yml` is genuinely well-built: 5 jobs, frozen lockfile, cache keyed on
  `bun.lock`, least-privilege `permissions: contents:read`, concurrency cancellation, and a
  `quality-gate` aggregation job designed as the single required status check. T2/T13 should
  **extend** this file, not replace it.
- `AgentService.runScopedTask` **already** assembles `extraTools: [...pluginService.getPluginTools(), ...mcpService.getMcpTools()]` (`agent-service.ts:195`) and skill context (:147).
  The extensibility layer is correct and reachable — **only the three interactive surfaces fail to
  call it.** T8 is therefore a genuine bridge (re-route three call-sites), exactly as the prompt's
  scope guard requires, with no envelope work.
- `src/baseline/status.ts` provides a clean `BaselineSummary` contract with a `redactValue` secret
  filter already in place — T4 can build on it rather than inventing a new contract.
- `SECURITY.md` exists (15 KB, substantive). T13 needs `CONTRIBUTING.md`, `CODEOWNERS`, and
  templates only.

---

## 6. Audit conclusion

**12 of 18 hypotheses VERIFIED at the exact line cited**, 3 VERIFIED with shifted line numbers,
2 NOT-FOUND (absent scaffolding, as predicted), 1 CHANGED (baseline tooling partially present but
stamped to a stale identity). **7 additional defects (N1–N7) were discovered that the reports did
not contain** — confirming Global Rule 2: the repository had drifted from the reports in both
directions.

The single deepest structural problem is not any individual defect but **N6 + B1 together**: XR
already had a version-sync gate and a health command, and *both reported success while the system
was in the failure state they existed to detect*. Phase 0's mission — converting XR from
self-certifying to verifiable — is therefore correctly scoped, and the fix must widen what the
gates actually check rather than add new gates beside them.

Implementation is authorised to begin.
