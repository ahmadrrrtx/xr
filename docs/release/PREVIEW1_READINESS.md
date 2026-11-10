# XR Preview 1 — readiness report

**Version** `1.2.0-preview.1` · **product name** XR Preview 1 · **branch** `release/preview-1`
**Report date** 2026-11-10 · **Status of this document** week-1 checkpoint, not the final gate

> Everything below is either **measured here** (command + result quoted), **measured on a
> GitHub-hosted runner** (run id quoted), or explicitly marked **NOT RUN** / **BLOCKED**.
> Nothing is upgraded from one category to another. Linux results are never presented as
> Windows evidence, and Wine is never evidence at all.

---

## 1. Recommendation

**HOLD ONE STEP SHORT OF GO — conditional GO once gate item 9 returns green.**

All three week-1 blockers are now closed or explained:

| # | Blocker | Where it stands now |
|---|---|---|
| B1 | `consumer-smoke` failed (gate item 8) | **CLOSED.** The root cause was a product defect, not a broken test: the provider-URL guard refuses loopback **custom** providers (an SSRF control), so the smoke's stub was never registered and the CLI printed `Unknown provider "consumer-stub"` — the message a real user gets after pointing a custom provider at a model on their own machine. In week 2 the gateway names the guard and the supported alternative, the guard is **unchanged**, and the smoke moved to the built-in local preset path. `consumer-smoke` → `{"ok":true,"doctorExit":0,"taskExit":0}`. |
| B2 | `desktop-app.yml` Linux-x64 + Windows-x64 green, artifacts inspected (item 9) | **Still open — the only open gate.** The run dispatched on `c1518351` came back **cancelled**; the packaging run before it built Windows, macOS x64/arm64 and Linux successfully (Flatpak died on a runner `DNSResolveFailed`). Re-dispatched on the current tip. A green packaging run is still not proof a human can install and launch it — that is an owner action. |
| B3 | Competitor comparison (T16) | **CLOSED.** `COMPETITOR-STATUS.md`: every competitor cell is from-docs with a version and date, every XR cell is verified-by-run, and anything a source did not establish is **Unknown**. No competitor was installed, and the document says so. |

Week 2 additions, all in this repo:

| Document | What it establishes |
|---|---|
| `preview1/OWASP-LLM-2025.md` | The LLM Top-10 pass: control, evidence and a stated gap per class. LLM01 is proven **end to end** — injected file content → shell request → denied at the approval gate, and again at isolation once approval is granted. |
| `preview1/FEATURE-TIERS.md` | Every advertised feature assigned a tier from the evidence: what ships ON, what is Experimental with a working path, what is not in this release. Local models, voice and computer control are **not** claimed as verified. |
| `preview1/COMPETITOR-STATUS.md` | Where XR sits next to Hermes Desktop, Claude Code and OpenHands, including the three things it is behind on. |

**What still must not be said in public:** that the desktop app works (built, never launched by a
human), that local models are usable on a small machine (no model was run here), or that macOS was
journey-tested (it was not).

---

## 2. Release identity (D4)

`identity.version = 1.2.0-preview.1`, codename `Preview 1`, `stability = public-beta`.
`channels.publicVersion` stays **1.0.0** and all six channels stay claimed **for the 1.0.0 line**;
Preview 1 itself ships as a GitHub pre-release only.

The plan's primary `0.1.0-preview.1` was attempted and abandoned for contract reasons documented
in `docs/release/WEEK1_LOG.md` and `docs/release/1.2.0-preview.1/known-limitations.md` (deviation
T04.a). One real defect was found on the way: the pinned dashboard DOM hash normalized the
generated *version* but not the generated *codename*, so any codename change broke the pin.

```
release:check        10 surfaces @ 1.2.0-preview.1        PASS
channel:check        5 configs @ public 1.0.0             PASS
claim-lint           20 evidenced claims                  PASS
changelog:check      189 commits since v1.1.0             PASS
api:schema:check     292 operations, matches registry      PASS
```

---

## 3. Release Gate Lite (§7) — item by item

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | `npx tsc --noEmit` (root) + desktop typecheck | **PASS** | both exit 0 |
| 2 | Tests per directory, 0 unexplained failures | **PASS** | 4,864 pass / 0 fail across 54 directories; `test/fixtures` and `test/helpers` hold no test files (documented state). Skips are listed, never counted as passes |
| 3 | `bun run security:check` | **PASS** | exit 0 locally; the same gate is green in CI run 42705922418 |
| 4 | `claim-lint`, `placeholder-lint`, `release:check`, `changelog:check` | **PASS** | all exit 0 |
| 5 | `api:schema:check`, `client:check` | **PASS** | both exit 0 |
| 6 | `desktop:sink-lint`, desktop `build`, `lint` | **PASS** | sink-lint 0; build exit 0 (2.18s); lint exit 0 (0 errors, 2 pre-existing warnings) |
| 7 | `bash scripts/smoke-sidecar.sh` (Linux) | **PASS** | `--version v1.2.0-preview.1 (Preview 1)`; serve booted on an isolated `XR_HOME`; health OK with the token handshake banner |
| 8 | `bun run consumer-smoke` **and** `bun run journey:cli` | **PASS** | journey:cli end to end (build → package → `install.sh` → launch → agent task → update → uninstall, shell profiles byte-identical). consumer-smoke now `{"ok":true,"doctorExit":0,"taskExit":0}` — the week-1 failure was T17.a, and its root cause was a product defect, not a test: the provider-URL guard refuses loopback *custom* providers (an SSRF control), so the smoke's own stub was never registered and the CLI said `Unknown provider`. In week 2 the gateway now names the guard and the supported alternative, the guard is unchanged, and the smoke uses the built-in local preset path |
| 9 | `desktop-app.yml` green (Linux x64 + Windows x64), artifacts inspected | **PENDING** | the run dispatched on `c1518351` came back **cancelled**, and the packaging run before it succeeded for Windows, macOS x64/arm64 and Linux (Flatpak failed on a runner `DNSResolveFailed`, a flake not a defect). Re-dispatched on the current tip. This is the only open gate |
| 10 | New WS3 smoke scripts pass | **PASS** | `bash scripts/release-smoke/run-all.sh` → 9 passed / 0 failed on Linux **and** 9 passed / 0 failed on the Windows runner |

**Verdict on Gate Lite: 9 of 10 items green; item 9 (desktop packaging) is the only one open**, and a green
packaging run still does not prove a human can install and launch the app. Recorded as such rather than rounded up.

---

## 4. Platform evidence

| Platform | Evidence | Source |
|---|---|---|
| **Linux x64** | full suite, gates, sidecar boot, journey:cli, smoke lane 9/0 | this machine (2 GB, no GUI) |
| **Windows x64** | workflow run **42707408342**, all three jobs success: CLI smoke 9/0 on `MINGW64_NT-10.0-26100`; `cargo test` on the Tauri shell; 122 path-escape assertions native; installers job ran its inspection path | GitHub-hosted `windows-latest` only |
| **macOS arm64/x64** | Tauri **bundles built** in `desktop-app.yml`; journey job cancelled in the same run | CI artifacts, **journey NOT RUN** |
| **D5 refusal (Windows)** | guarantee matrix on the runner: `win32/x64`, `shell / arbitrary code` → tier2_isolated, placement **`BLOCKED (fail-closed)`**, kernel boundary ✗, fail-closed ✓, remediation names Docker Desktop/Podman or experimental AppContainer | run 42707408342, artifact 13714491518 |
| **Unattended approval** | one-shot turn against a keyless loopback provider: the shell call is **DENIED**, exit code 4 | Linux + Windows smoke lanes |

---

## 5. Security findings

**Fixed this week**

| ID | Finding | State |
|---|---|---|
| D1 | `new Function()` code execution in workflow branch conditions | fixed + tested (T01) |
| D2 | voice status probe reported `GROQ_API_KEY` present after deletion | fixed + tested (T02) |
| T60.b | **A false PASS in my own Windows evidence lane** — four path-escape probes counted any non-zero exit as "denied", but every probe had died at provider preflight. Also `XR_FORCE_NO_SANDBOX` does not exist anywhere in `src/` | fixed: native policy tests + real smoke lane |
| T22 | retry-storm settlement: a failed attempt must not be free | invariant pinned and **mutation-proven** |
| T23 | tamper detection | **mutation-proven**: forcing the chain to report valid kills exactly the single-edit test |

**Open**

| ID | Finding | Severity |
|---|---|---|
| B1 / T17.a | `consumer-smoke` stub provider is not resolvable (`Unknown provider "consumer-stub"`). Narrowed: the stub `config.json` is written correctly (version 22, `providerEngine.customProviders` present) yet provider resolution does not see it. A hand-copied `CONFIG_VERSION = 20` was one real defect and is fixed (now imported from the schema); a second one remains | P2 (self-check, not user-facing) |
| T21.b | price facts exist for only 3 of 26 presets; the proven path is an operator-declared rate | P2 |

**Dependency and secret posture:** `audit-deps.sh` PASS on both trees (35 production packages
root, 286 desktop, 0 findings). Secret scan: the only pattern matches in the tree are the
intentional fake specimens already documented in `.gitleaksignore`; an exact-string search for the
owner's live GitHub token and Groq key returns **0 files and 0 commits**.

---

## 6. Feature matrix (what a user can actually do)

Statuses are limited to what was exercised this week. A feature not exercised here is marked
**NOT VERIFIED THIS WEEK** — that is not a claim that it is broken, and it is not a claim that it
works.

| Area | Status | Basis |
|---|---|---|
| CLI: `--version`, `--help`, `doctor`, `env capabilities --json` | **verified** | smoke lane, Linux + Windows |
| Agent turn: provider → planner → tool → approval gate | **verified** | smoke lane against a loopback provider; unattended shell denied (exit 4) |
| Spend caps: loop, retry storm, fan-out, persistence failure | **verified** | `test/cost.test.ts`, `test/cost-adversarial.test.ts`, `test/phase2`, `test/phase6`; mutation-proven |
| Security plane: policy gate, approvals, secret broker, tamper-evident audit | **verified** | `test/security` 377/0, `test/trust` 159/0; tamper matrix mutation-proven |
| Installer journey (Linux): install → launch → agent → update → uninstall | **verified** | `journey:cli` PASS |
| Desktop app: build, lint, typecheck, screens | **verified for build/typecheck/screens** | 491 desktop tests, axe + keyboard in CI, bundles build on 3 OSes |
| Desktop UI honesty (no dead controls) | **fixed this week** | T03: Research/Memory wired, Files removed, archived-chats dead end withdrawn, `coming_soon` cards filtered |
| Windows shell execution | **refused by design, verified** | fail-closed row + exit-code-4 refusal |
| Windows/macOS installers (MSI/NSIS/DMG) | **bundles build; install not exercised** | artifacts only |
| Voice, computer-use, multi-agent/orchestrator, Telegram/Discord/WhatsApp, MCP/plugins/skills, research, memory, cloud plane | **NOT VERIFIED THIS WEEK** | their suites exist and run in CI; no human-driven verification yet |
| npm / Homebrew / WinGet / Scoop / Docker | **not Preview 1 channels** | by owner decision D4 |

---

## 7. Competitor comparison (T16) — deliberately not written yet

The protocol requires every cell to be *Verified-by-run*, *From-docs* (with a link) or *Unknown*,
and any performance or quality claim to come from a run on the same task with the same model. A
table filled in from memory would violate the release's own rules, so it stays empty until it can
be produced properly. **This is a blocker for the final readiness report, not for the branch.**

---

## 8. Owner actions needed

1. **B1** — decide whether `consumer-smoke` blocks the preview or can ship as a known self-check
   defect (my recommendation: fix it in week 2; the shipped binary is unaffected, but a gate that
   fails is a gate that will be ignored).
2. **Signing** — no certificate is part of this release; Windows SmartScreen and macOS Gatekeeper
   will warn. Needed only if you want signed preview builds.
3. **G3** (publish pre-release + archive old releases as Legacy) — not requested yet, and Preview 1
   must not be published to npm/WinGet/Homebrew/Scoop.
4. **Rotate the two credentials you pasted in chat** once this engagement ends; they were used
   from a mode-600 file outside the repo and never committed (verified: 0 files, 0 commits).
