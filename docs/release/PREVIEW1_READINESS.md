# XR Preview 1 — readiness report

**Version** `1.2.0-preview.1` · **product name** XR Preview 1 · **branch** `release/preview-1`
**Report date** 2026-11-10 · **Status of this document** week-1 checkpoint, not the final gate

> Everything below is either **measured here** (command + result quoted), **measured on a
> GitHub-hosted runner** (run id quoted), or explicitly marked **NOT RUN** / **BLOCKED**.
> Nothing is upgraded from one category to another. Linux results are never presented as
> Windows evidence, and Wine is never evidence at all.

---

## 1. Recommendation

**NO-GO / HOLD.** The desktop packaging gate is pending and desktop journey evidence remains incomplete. The SQLite fix passed the GitHub Supply Chain gate on `43267857`; Linux Rust check/Clippy and Windows Rust tests passed in dispatch `42904607032` on `ddd97858`, but the full desktop run did not pass. Final current-tip native validation is pending. The ledger checker now passes with eight documented legacy SHA mappings. A green packaging run alone is not a release approval.

**Additional blockers (T05.a/T60.c):** direct host computer-control on Windows/macOS was not wired to a sandbox; the refusal fix is a local candidate and needs native validation. Windows Preview installer job success in run `42907522824` was metadata-only, not an install. A candidate workflow now performs the real installer lifecycle when a same-SHA artifact exists and fails BLOCKED when it does not; native execution remains NOT RUN. Current-SHA NSIS/MSI install, authenticated installed sidecar health, data retention and uninstall remain NOT RUN.

**Latest Flatpak dispatch:** `42908959944` completed the offline pinned-Rust release compile, then failed on a nonexistent 256px icon source. The manifest now uses the existing 256px `128x128@2x.png` and has an image-dimension regression; a full rerun is required. On `1f01c829` Windows native CLI/refusal tests passed, but CI security failed an outdated Windows AppContainer remediation expectation; its correction also awaits native CI.

**LLM02 remains partial:** T41.a fixes synthetic credential leaks in selected newly written audit rows, structured logs, spans and Markdown reports. Historical records are not rewritten, redaction is heuristic, and complete transcript, crash and renderer-path scans remain unverified. OTLP telemetry exists as opt-in and is disabled by default.

All three week-1 blockers are now closed or explained:

| # | Blocker | Where it stands now |
|---|---|---|
| B1 | `consumer-smoke` failed (gate item 8) | **CLOSED.** The root cause was a product defect, not a broken test: the provider-URL guard refuses loopback **custom** providers (an SSRF control), so the smoke's stub was never registered and the CLI printed `Unknown provider "consumer-stub"` — the message a real user gets after pointing a custom provider at a model on their own machine. In week 2 the gateway names the guard and the supported alternative, the guard is **unchanged**, and the smoke moved to the built-in local preset path. `consumer-smoke` → `{"ok":true,"doctorExit":0,"taskExit":0}`. |
| B2 | `desktop-app.yml` Linux-x64 + Windows-x64 green, artifacts inspected (item 9) | **OPEN.** Dispatch `42903107866` on `43267857` had a failed Flatpak source build and a Linux Clippy failure; the Clippy correction is in `dfefcf3c`. Dispatch `42904607032` on `ddd97858` passed Linux Rust check/Clippy and Windows Rust tests, but Flatpak failed and bundle legs were cancelled. Offline Flatpak staging was committed in `f783d63f`; real Cargo vendoring and sandboxed build remain unverified, with dispatch `42907089739` pending. Older x64 artifacts were partly inspected, but they predate the SQLite fix. A build is not proof a human can install and launch it. |
| B3 | Competitor comparison (T16) | **CLOSED.** `COMPETITOR-STATUS.md`: every competitor cell is from-docs with a version and date, every XR cell is verified-by-run, and anything a source did not establish is **Unknown**. No competitor was installed, and the document says so. |

Week 2 additions, all in this repo:

| Document | What it establishes |
|---|---|
| `preview1/OWASP-LLM-2025.md` | The LLM Top-10 pass: control, evidence and a stated gap per class. LLM01 has a scripted file-injection scenario: a payload-dependent mock requests a shell command, which is denied at the approval gate and, separately, at isolation when approval is granted. Companion tests cover a loopback fetched web page and the production MCP wrapper with a fake client, each with poisoned and benign controls. These are not live-model or live external MCP server tests. |
| `preview1/FEATURE-TIERS.md` | Proposed feature tiers with the evidence and gaps; owner decisions, consistent labels and working paths are not all verified. Local models, voice and computer control are **not** claimed as verified. |
| `preview1/COMPETITOR-STATUS.md` | Where XR sits next to Hermes Desktop, Claude Code and OpenHands, including the three things it is behind on. |

**What still must not be said in public:** that the desktop app works (built, never launched by a
human), that local models are usable on a small machine (no model was run here), or that macOS was manually tested by a human. Earlier macOS CI journey jobs passed on `895fd306`; they do not validate the latest candidate.

---

## 1b. Week 1 and week 2 implementation audit (2026-11-10)

**NOT fully implemented or verified.** The ledger currently includes open feature tasks T20, T21,
T31 and T33; T06 (native evidence); T40–T50 (OWASP and desktop/daemon controls); T61–T66
(Windows environment); and owner-dependent tasks including voice and computer control. Some
subtasks have test evidence or a review document, but those do not automatically satisfy every
acceptance criterion. The T11.a OWASP table is a review, not proof that every required red-team
case or test was added. The previous T33 security entry accidentally reused the installers task ID;
the original task is restored by append and the advisory is tracked as T11.b.

The existing README and `docs/cli/CODING_CONTRACTS.md` also describe filesystem authority,
estimated-spend limits, and desktop pause/cancellation as incomplete. Their present code and tests
need a targeted review before release; this report does not declare those claims resolved.

CI run `42895932985` failed Ubuntu 24.04 desktop journey: its launch step reported the engine
still listening 15 seconds after app closure. This is **unresolved**, not yet diagnosed as product
bug versus test interference. Its Flatpak build also failed with `DNSResolveFailed`. No claim of
a fully green desktop gate is justified.

### Desktop user-menu follow-up

Source inspection found that the user-menu Quit only hid the main window, workspace switching
was a placeholder, and the updater entry claimed a fixed old version was current without a check.
A candidate fix now navigates to the real screens and uses a main-only explicit quit command;
the desktop journey requests explicit quit before testing sidecar containment. Local renderer,
ACL and build checks pass; actual native quit/journey and manual installation remain **NOT RUN**.
The earlier journey failure's exact cause is unproven.

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
| 7 | `bash scripts/smoke-sidecar.sh` (Linux) | **PASS** | `--version v1.2.0-preview.1 (Preview 1)`; locally compiled candidate `7f489a2d`: public health OK; protected version endpoint refused anonymous/invalid bearer and accepted the generated token (T14.a). Earlier runs checked only public health and a token banner, not bearer authentication. Current packaged artifacts remain unverified |
| 8 | `bun run consumer-smoke` **and** `bun run journey:cli` | **PASS** | journey:cli end to end (build → package → `install.sh` → launch → agent task → update → uninstall, shell profiles byte-identical). consumer-smoke now `{"ok":true,"doctorExit":0,"taskExit":0}` — the week-1 failure was T17.a, and its root cause was a product defect, not a test: the provider-URL guard refuses loopback *custom* providers (an SSRF control), so the smoke's own stub was never registered and the CLI said `Unknown provider`. In week 2 the gateway now names the guard and the supported alternative, the guard is unchanged, and the smoke uses the built-in local preset path |
| 9 | `desktop-app.yml` green (Linux x64 + Windows x64), artifacts inspected | **PENDING** | dispatch `42895932985` on `895fd306`: Linux x64 and Windows x64 bundle jobs succeeded; Flatpak source build and Ubuntu 24.04 journey failed; overall run cancelled. PR run `42897513049` on `e551b234` was cancelled; dispatch `42903107866` on `43267857` failed Flatpak and Linux Clippy; Clippy correction committed in `dfefcf3c`; dispatch `42904607032` passed Linux Rust check/Clippy and Windows Rust tests, but Flatpak failed and bundle legs were cancelled. Offline staging candidate `f783d63f` awaits dispatch `42907089739`. Earlier `e551b234` artifacts were partly inspected, not valid for this candidate |
| 10 | New WS3 smoke scripts pass | **PENDING** | Corrected the aggregate to fail on child crashes (T12.a); Linux: 9 passed / 0 failed. Earlier Windows individual checks passed; a Windows rerun of the corrected aggregate is pending. Per-feature smoke coverage is also incomplete. |

**Gate Lite snapshot:** items 9 and 10 are pending; items 1–8 have the stated earlier evidence and should be rerun at final freeze. Supply Chain passed on `43267857`; a desktop journey failed. Packaging success would not prove a human installation or launch.

---

## 3b. Supply-chain findings opened while verifying the release (week 2)

Main went red after Dependabot merge `1834fd16` (owner's, 2026-11-10). Two required jobs failed, and
both were investigated rather than re-run until green.

### RUSTSEC-2026-0459 — bundled SQLite (fix candidate, native CI pending)

| | |
|---|---|
| Advisory | SQLite before 3.54.0 can return uninitialized page-cache memory when a process opens a database together with a sibling `-wal` whose page size differs |
| Score | CVSS v4 6.8 — `AV:L/AC:L/PR:N/UI:P`, confidentiality-only |
| How it reached XR | Previously `rusqlite 0.37` (bundled SQLite) → `libsqlite3-sys 0.35.0`. Bundled means the vulnerable SQLite was compiled into the desktop app |
| Fix | `rusqlite 0.41` → `libsqlite3-sys 0.39.1` (SQLite 3.54.1). `rusqlite` requires Rust 1.89, but the locked Tauri dependencies require **1.90**; the crate declares `rust-version = "1.90"`. The desktop workflow pins Rust 1.99.1, and native checks passed on an earlier candidate; the declared 1.90 minimum itself has not been tested |
| Exposure | The advisory requires the process to open a crafted database plus sibling WAL. **Correction:** `desktop/src-tauri/src/data_safety.rs:stage_into` extracts user-selected archives, skips `.db-shm` but not `.db-wal`, then opens each `.db` and runs `PRAGMA integrity_check`; imported data is therefore a possible path, not just a pre-existing database in the data directory. Actual exploitability and impact through this path have not been tested. Treat the finding as open, not low-risk by assumption. |
| Candidate evidence | A read-only GitHub runner generated the 0.41.1 / 0.39.1 manifest and lockfile (run 42902810943, artifact 13804585049); all five newly locked crate checksums match crates.io. Local recursive OSV exits 0 with 23 pre-existing policy-filtered findings; 17 supply-chain tests pass. GitHub Supply Chain run 42903110699 passed on commit 43267857. Windows cargo-test step passed in run 42903107866, but its job was cancelled during cache cleanup; Linux Clippy failed and a correction is awaiting rerun. Native builds and complete jobs remain required. |
| Next action | T11.b (earlier T33 collided with the installers task): verify desktop native builds and tests on the candidate and rerun the required CI Supply Chain and desktop gates. No risk acceptance was granted; do not treat local OSV alone as release readiness. |

### gitleaks — 5 `generic-api-key` hits, all false positives (FIXED in this branch)

The full-history scan on `1834fd16` reported 5 leaks. Each was opened in the SARIF and checked
against the raw line: four are audit-table rows whose prose puts a commit SHA next to a package name
(high-entropy hex trips the generic rule), and one is `release.manifest.json` evidence text that
quoted an env-var assignment — **my own commit `eed11ea0`**. No credential is involved.

Handled in two halves, which is the honest split: the manifest wording was rewritten so the pattern
stops recurring, and the five historical fingerprints went into `.gitleaksignore` with a comment
recording the verification — because rewriting those commits is not an option and deleting a finding
without reading it is how a real leak gets missed. A real secret would be rotated, never ignored,
and the comment says so.

> Also note: `bun audit` on the shipped root is clean (89 packages, 0 vulnerabilities). The OSV
> finding above comes from the recursive scan of the desktop's Cargo tree, which `bun audit` does
> not look at — so "audit passes" was never evidence about the Rust side.

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

## 7. Competitor comparison (T16)

See `preview1/COMPETITOR-STATUS.md`: competitor statements are attributed to documentation,
not hands-on tests; unknowns remain unknown. No competitor was installed.

---

## 8. Owner actions needed

1. **Supply chain** — validate the RUSTSEC-2026-0459 dependency fix on native desktop CI and the
   required Supply Chain gate; local OSV passed with 23 existing filtered advisories.
2. **Desktop** — inspect Linux and Windows x64 artifacts and verify a complete packaging run; test
   installation and launch on a real Windows machine. CI bundle success is not manual evidence.
3. **Ledger reconciliation** — six malformed historical entries were repaired with owner approval;
   eight exact-SHA legacy subject mappings are explicit in the checker. Published Git history was
   not rewritten; new entries and commits remain subject to strict validation.
4. **Signing** — the existing desktop tag preflight requires Windows Authenticode and macOS Developer ID plus notarization, even for preview tags; it also requires the updater key if its public key is provisioned. PR builds are development artifacts and do not prove signing. Whether the owner has configured tag-environment credentials is **unknown**. An unsigned tag would require a separately approved policy change, not a bypass.
5. **G3** — the owner provided `APPROVE G3` conditional on all fixes and verification. That condition is not met: do not publish the pre-release or archive old releases while the recommendation is NO-GO. Do not publish Preview 1 to npm/WinGet/Homebrew/Scoop.
6. **Credentials** — rotate the credentials supplied during the engagement.
