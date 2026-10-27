# XR 1.1.1-rc.1 — implementation and release-candidate report

> **Subsequent owner source-submission amendment:** the owner has now requested
> a source commit/push and PR into protected main. No-commit/no-push statements
> below describe the original local-verification phase. They do not claim that
> subsequent authorized source submission never occurred. No release/tag/
> package/default promotion is authorized. A Windows host-alias build-script
> correction and its separate checks are in [GITHUB_HANDOFF.md](GITHUB_HANDOFF.md);
> remote CI/commit/PR results must be reported for the actual new head.


**Disposition: NOT READY for public preview or stable publication.**

The locally implementable engine/provider/desktop-source/benchmark/release
changes are implemented and verified within the Linux scopes below. Remaining
native-platform, actual keychain, production signing/provenance and account
checks are **BLOCKED/NOT RUN**, not converted to passes. Development source is
ready for owner engineering review; this is not a security certification or an
authorization to publish.

* Repository: `/home/user/xr`; branch `audit/release-candidate-2026-10-26`.
* Base/index commit: `e25afd362e80485340a322e60a97a04d41b6bd51` plus uncommitted
  changes. That commit alone does **not** identify the modified tree.
* Identity: **1.1.1-rc.1 / developer-preview** across10mandatory surfaces.
  Canonical public-version authority/installers/stable templates remain1.0.0.
* **No commit, push, tag, release, package, channel/default promotion or real
  WinGet/tap/account mutation was performed.** RC name availability was a
  read-only observation, not a reservation.
* Live-channel caveat: a fresh read-only GitHub latest-release observation still
  returned **v1.1.0, not prerelease,5assets**. It is in the withdrawn-tag register.
  Public authority1.0.0 is **not** a claim that every live channel is coherent;
  repair remains an explicit owner action.

## 1. Implemented changes and exact files

[CHANGESET.md](CHANGESET.md) enumerates exact changed/new paths, including tests,
workflows, derived artifacts and evidence. Major engineering changes:

| Area | Implementation |
|---|---|
| Identity/channels | `release.manifest.json`, `scripts/release-manifest.ts`, `channel-manifest.ts`,10derived surfaces, stable packaging templates. Strict semantic version/tag/withdrawn/stability checks; preview never projected into stable defaults. Debian prerelease control version derives1.1.1~rc.1 and orders before stable. |
| Policy/OS effects | Existing `src/security/filesystem.ts`, native descriptor authority, canonical grant/tool execution and `runtime/trust/environment/*`: fail closed, capability drop/no-new-privileges, read-only recursive mounts, bounded process/env/output/scratch, real cancellation. No silent unenforced isolation fallback. |
| Governed accounting | `src/core/model-accounting.ts`, `cost/{governor,manager,pricing}.ts`, existing BudgetService factory, provider attempt seam. Per-attempt actual identity/settlement, unknown/non-finite tariff refusal, retry/fallback consent, explicit estimated-versus-provider usage. Telemetry cannot double-settle/replay a paid attempt. |
| Providers/metadata | Canonical browser-safe `src/core/model-{facts.json,registry.ts}`, shared abort contract, existing intelligence facade/catalog/router/service and native/compatible adapters. Versioned sourced facts, transport/tool continuation, freshness/lifecycle and evidence states. Credential presence never means successful auth or agent validation. |
| Desktop/CLI separation | `desktop/scripts/engine-home.ts`, native `desktop_home.rs`/`engine.rs`, bundled sidecar cache, broker/settings/persistence/migration, model/Auto/budget UI. Independent validated desktop home/per-home OS namespace, no implicit CLI state copy or global CLI requirement. Acknowledged secret save/removal; no generic settings/localStorage key persistence. |
| Benchmark | `benchmarks/agent/v1/suite.json`, `scripts/agent-benchmark{,-runner}.ts`, pure verifiers/tests and protocol README.15versioned categories,5smoke, actual governed tools/SQLite/effects/audit. Temp home pinned before product imports; ambient keys/opt-outs stripped. |
| Release enforcement | Existing Release/Desktop/CI/Publish Channels workflows, signing/asset/SBOM/strict verifier/native-CI helpers. Private draft preparation; owner-only publication/default promotion after exact-tag evidence; signed metadata bytes, no PAT argv/unverified WinGet download, no replacing published releases. |
| Engineering gates | Executable `security:check`, actual async process-group watchdog, existing segmented parity authority, no broadened dependency rules/global size threshold. Shared facts/errors moved down to L0; provider command handlers split below800LOC, stale waiver removed. Generated ownership/API/IPC refreshed. |

The original architecture was retained: CLI/coder/daemon/desktop → AgentService →
envelope/runner → canonical loop/policy/tools → confined effects + SQLite/audit.
No second provider, loop, database or publishing framework was introduced.

## 2. Executed verification

Final command records and exact selected outputs are in
[evidence/rc-final-2026-10-27/commands.json](evidence/rc-final-2026-10-27/commands.json).
The [evidence manifest](evidence/rc-final-2026-10-27/evidence-manifest.json) hashes
those files. Full failure/recovery history remains in [PROGRESS](PROGRESS.md) and
workspace `xr-evidence/commands.jsonl`; failed runs are not erased.

| Check | Status | Executed result and scope |
|---|---|---|
| Governed security + full canonical parity | **PASS** | `closure-security`: exit0,191.155s,307176KiB peak. Existing54sequential segments: **5007PASS/33SKIP/0FAIL**,459/459filtered files; no retries. Dedicated kernel stage, smoke and mandatory online dependency audit also PASS. Existing quarantine and E2E exclusion remain explicit; skips are not passes. Includes the Debian mapping regression; its separate16PASS identity/ordering run is also retained. |
| Real Linux boundary effects | **PASS** | Dedicated31tests/143assertions/zero skipped: both unshare+bwrap, host canaries unchanged, positive workspace write, denied remount/inherited writable submount, bounds/env/signal/descendant/output controls. Isolated stage is authoritative; mixed suites can legitimately skip unavailable test wiring. |
| Public CLI blackbox | **PASS** | `handoff-latest-blackbox`: **98PASS/0FAIL**,413assertions/10files; exit0,46.492s,112732KiB. Actual child processes/loopback requests, filesystem disclosure/escape/positive controls, approval/dry-run/decoy/token/print/cancel, provider lifecycle and F-02/F-03/no-color proofs. Controlled tariffs/capabilities are explicit, never production assumptions. |
| TypeScript root | **PASS** | Final Node bounded-heap tsc: exit0,18.722s,1002612KiB peak. No Bun-tsc retry/OOM loop. |
| Renderer build/typecheck | **PASS** | `cd desktop && bun run build`: exit0,27.071s,752372KiB. Vite2.77s. This is not native GUI proof. |
| Renderer ESLint | **PASS** | exit0,32.428s,431972KiB. |
| Actual production seed gate | **PASS** | exit0;7configured seed probes absent from production output. It is not a blanket claim that every compiled filename containing mock means demo data. |
| API/client/IPC/identity/claims/ownership/size | **PASS** |10product surfaces,5stable-template files at public1.0.0;284APIoperations/1485client lines. IPC refresh changed no permission set;129main/124workspace/96HUD/9orb/10theater commands. Dependency/cycle/budget-construction checks remain enforced.800LOC module threshold unchanged; source tree near174500ceiling is disclosed. |
| Shared native Rust subset | **PASS** | Shipped governor18, legacy-scope2, independent-home3tests; locked one-job Rust1.99.1, exit0/10.796s/273496KiB. Not whole Tauri, actual OS stores or Rust1.77 validation. |
| TCP SSE/accounting integration | **PASS** |4actual loopback transport cases: late final usage exactly once, real in-flight abort/closed transport, upstream failure, incomplete counters. Real adapter/envelope/SQLite + desktop parser/reducer, not a native IPC/GUI/live-vendor claim. Expected upstream-disconnect diagnostic is intentional. |
| Managed fallback/telemetry | **PASS** | Consented real daemon fallback ends stopped=done with exactly one estimated failed-primary + one provider fallback receipt. Independent canonical SQLite integration checks2actual-identity rows; throwing metrics cannot replay/double-settle. Unknown/auth/cancel/accounting failures remain terminal. |
| Linux standalone engine/cache/serve | **PASS** |863modules, real1.1.1-rc.1 executable, source/tool/target/binary fingerprint reuse/rebuild, isolated authenticated health smoke. Last current-source package/smoke command exit0/6.893s. No global CLI requirement or fake cross-platform execution. |
| CLI binary lifecycle | **PASS** | exit0,5.067s,218244KiB. Build/package/install/launch/real write_file, synthetic1.1.1-rc.1→1.1.2-journey.1 update, uninstall/profile byte restoration. Disposable home only. |
| CLI npm lifecycle | **PASS** | exit0,12.804s,228596KiB; same7effects, temporary prefix. Not historical-version migration/production registry publication. |
| Local artifact identity/payload | **PASS** |1671tar entries;3identity surfaces agree; no disallowed private path names; actual Debian control1.1.1~rc.1; extracted binary hash equals compiled payload and runs with no global Bun on PATH. Not full-content secret certification or system installer/GUI PASS. |
| Combined locked SBOM | **PASS** | Actual1206-component inventory validated against official CycloneDX1.5 schemas; valid hex/refs/product version, root+renderer+Cargo scope, unavailable local-crate integrity explicit. System libraries/runtime reachability are not invented. |
| Local trusted release authentication | **BLOCKED** | Strict verifier returned exit1: actual bytes/inventory/SBOM PASS, production identity/signatures/SLSA absent. Local fixture keys cannot substitute. |
| Tag signing prerequisite | **BLOCKED** | Expected exit1 for missing Apple cert/identity/notary and Windows cert/password. Presence checks are not OS signature checks. |
| Full native shell prerequisites | **BLOCKED** | pkg-config exit1: GTK3 and WebKit2GTK4.1 development files absent. No unsafe/heavy install attempted in this~2GiB sandbox. |
| macOS/Windows/native GUI/keychains/install/update | **NOT RUN** | Require real platform runners/clean OS profiles and owner material. Linux/renderer/source tests do not validate them. |
| Production CI OIDC/signing/registries/container | **NOT RUN** | Workflows/negative contracts implemented, but no actual new tagged CI/account mutation, production verification or local container build. |
| Bounded live provider/agent quality | **NOT RUN** | No owner API keys, paid calls or model weights. Official metadata/deterministic API fixtures are not account compatibility or quality proof. |
| Competitor comparison | **NOT APPLICABLE** | Optional protocol supplied, not executed; no comparative performance claim. |

The pre-existing quarantined `test/daemon/phase2b.test.ts` was also run alone:
**11PASS/0FAIL/41assertions**, exit0/0.451s. It stays quarantined under the owner's
existing10consecutive-main-run rule; one local pass does not clear that policy.
No new quarantine or silent skip was introduced.

Validation input digest:
[`68ff51598a6d722ab3aef08eadc17cdf2578f25357b9ef45fd016cdc20b3818d`](evidence/rc-final-2026-10-27/code-inputs.json)
for2955source/config/test/workflow/packaged inputs. It excludes generated caches
and self-referential report/evidence documents and is not publisher provenance.

Counts overlap across gates; do not sum them into unique tests. The observed
platform was Linux6.1.158+x86_64,2CPUs,1982MiB/no swap, Bun1.4.2, system
Node20.20.2 and verified Rust1.99.1. Benchmark JSON's Node field is the Bun
process compatibility version, not a claim about the system tsc executable.
One major check/build ran at a time. A rejected monolithic full attempt timed
out under memory pressure; no OOM kill was recorded. Its process was stopped,
the watchdog corrected and existing segmented execution used successfully.

## 3. Benchmark result — honest interpretation

[Machine report](evidence/rc-final-2026-10-27/agent-benchmark-final.json):
**15/15tasks,57/57checks,8/8expected denials**, zero monitored unauthorized effects,
zero unexpected network attempts,25scripted model invocations,1retry,
9689input/4808output heuristic tokens. Fixture wall367.929ms excludes module
startup/outer cleanup; collector wall0.628s/RSS100704KiB has a different scope.
Approvals were5predetermined callbacks/1denial; actual human interventions and
billed USD are **null/unavailable**. Tariff1/1 is explicitly synthetic.

Success depends on actual code verifier/file hashes, denied effects, SQLite,
audit/reopen/tamper and selection controls, not a model's done message. The
monitored effect scope is fixture workspace/sibling canaries, not an assertion
of no host effects anywhere. Smoke covers5/15, never15. Native isolation and
live intelligence/billing are separate evidence. See [benchmark protocols](../../benchmarks/agent/README.md).

## 4. Artifact trust and release channels

Local hashes/inspection are in
[artifact-inspection-final.json](evidence/rc-final-2026-10-27/artifact-inspection-final.json).
They bind only the recorded private artifacts, not a publisher. Large generated
binaries/caches are reproducible workspace artifacts, not source recovery inputs.

Tag pushes now prepare verified **private drafts only**. Public versioned
publication requires owner dispatch publish=true, independent signed artifact/
SLSA checks, supply chain/journeys and the exact latest successful native
workflow for that tag+commit. Raw desktop signing values are tag-only, not PR
env inputs; actual environment reviewers/ref protection must be configured.
An already published release cannot be silently adopted/replaced by drafting.

Stable metadata projection is separate from live publicVersion. Signed metadata
bytes matter: matching URLs/hash literals do not forgive injected Homebrew Ruby.
npm consumes the exact signed tarball; beta/candidate/version staging does not
move latest. The existing Publish Channels workflow separately verifies native
CI/immutable npm bytes/image digest and owner-selected stable authority before
optional default promotion. WinGet uses bounded Git Data/PR APIs with a header
token; it does not force-replace owner branches, expose a PAT in argv or download
an unverified submit executable. Community acceptance is not an install PASS.
Cross-registry default changes are not an atomic transaction; partial failure
remains RED and needs owner reconciliation.

## 5. Genuine blockers and concrete owner action

1. **Native runners/resources:** provision Linux GTK3/WebKit4.1/tray/OpenSSL
   build prerequisites and native macOS/Windows runners. Execute existing Desktop
   App/cross-platform/journey workflows for the reviewed new commit. Verify GUI,
   IPC, OS stores, installers, data preservation/uninstall and cross-version
   update/compatible rollback. Same-version reinstall source is not that proof.
2. **Signing/accounts:** configure secrets directly in GitHub/platform stores,
   never chat/source/argv. Provide Developer ID+notarization, Authenticode and
   appropriate registry/tap/WinGet scopes; configure required-reviewer/tag rules
   on desktop-signing/release-promotion/npm-publish/release-channels. YAML names
   alone do not prove protection. Re-run actual OS verifiers/production proofs.
3. **Updater:** keep disabled until the real public key/channel endpoints and
   full signed two-version update/negative-key/interruption/recovery tests exist.
   No preview may mutate the stable/default feed; no rolling feed was enabled.
4. **Public repair:** latest GitHub still exposes registered-withdrawn1.1.0.
   Owner must reconcile withdrawal/default assets/channels using trusted proof,
   not reuse the tag or publish this dirty candidate to hide it.
5. **Compatibility/live evidence:** validate declared Rust1.77 minimum or revise
   the supported requirement deliberately;1.99.1 pure tests cannot infer it.
   Optional exact-provider/model bounded live canary/agent tasks need owner
   opt-in and a dedicated home/tariff. Do not mark agentValidated/recommended
   from credential presence or these deterministic fixtures.
6. **Container:** frozen/no-scripts/nonroot image changes are implemented but
   actual build/runtime and existing-volume permission migration are NOT RUN.
   Back up/inspect existing root-owned data and perform an owner-reviewed
   ownership migration; there is no automatic recursive chown/data deletion.

No agent push/tag/publication is needed to review this handoff. Review the
working tree/recovery manifest, commit deliberately, run applicable pre-tag CI,
then let the owner authorize controlled signed draft preparation/promotion.

## 6. Security/design limits that were not overclaimed

* Dollar/token inputs are admission estimates/request bounds, **not an absolute
  provider invoice ceiling**. Unknown/non-finite rates refuse governed requests,
  including with USD disabled. Provider premiums/cache/tokenizers/hardware may
  differ; unavailable costs are not invented zero.
* Linux limits are per-process/scratch/network/authority controls, not aggregate
  cgroup quotas. Unsupported requested file-count controls refuse. Non-Linux
  isolation remains separately experimental/unvalidated here.
* Sealed AES-GCM file storage has an adjacent private key: protection from
  accidental plaintext disclosure, not complete-home/same-user compromise.
  Removal is not backup/environment/other-install/vendor revocation or physical
  erasure. Moving desktop home changes its OS-store namespace.
* Hash chain/signatures detect covered tampering relative to retained anchors;
  independently retained trust is needed against rewriting a complete local
  history/home. Config/SQLite/multiple-store atomicity is not claimed.
* Renderer large-chunk/dynamic-import warnings and near-ceiling source size
  remain disclosed engineering debt. Legacy test-store cleanup warnings are not
  production leak evidence or a reason to invent a zero-leak claim.

## 7. Engineering handoff

Use [VERIFICATION_COMMANDS.md](VERIFICATION_COMMANDS.md) for verified development/
CLI/renderer/security/benchmark/build/inspection commands, distinguished from
owner-only NOT RUN native/signing recipes. Use [DESKTOP_SIGNING.md](DESKTOP_SIGNING.md)
and [VERIFYING_RELEASES.md](VERIFYING_RELEASES.md) for current trust policy.
[PROGRESS](PROGRESS.md), [DECISIONS](DECISIONS.md), [plan](IMPLEMENTATION_PLAN.md),
[architecture](ARCHITECTURE_AUDIT.md), [security](SECURITY_AUDIT.md) and
[release audit](RELEASE_AUDIT.md) preserve reasoning, failures and evidence scope.
The recovery ZIP is an uncommitted changeset for the exact base, **not** a signed
release or permission to publish. Its separate manifest records file digests.
