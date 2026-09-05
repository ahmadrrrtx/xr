# Changelog

## Unreleased

### Phase 7 — Memory policy layer (F-21)

- **retrieval ACL:** `MemoryStore.recall*` take an optional `principal`
  (`"user"` or `{role, agentId}`; default `"user"`). New `agent_visibility`
  column (JSON role list, default `["*"]` — **existing memories are not
  restricted**); a list without `*` sequesters the row to those roles, and
  coordinators are not exempt. Enforced at `recall*`, in the context assembler
  (grant requester → principal), the agent loop's legacy block, the
  memory-manager task and the plugin host. `xr memory add --visible-to
  <role>,…`. Trust never gates retrieval — it labels the hit `channel:
  "data" | "quarantine"`; recall has no instruction channel by construction.
- **provenance mandatory:** `add()` resolves `{source: user|tool|agent|schedule,
  ref}`; `tool`/`agent`/`schedule` writes without a `ref` are **rejected**.
  Every row stores `provenance_event_id` = the audit hash of its `memory.add`
  event, plus `kind` (fact|preference|episode|procedure|summary) and
  `confidence_score`. New write channels `tool`/`agent`/`schedule` with honest
  trust ceilings; the plugin host now writes as `tool` with `plugin:<id>`.
- **contradiction arbitration:** a write lexically near (cosine ≥ 0.6, same
  scope + category) a current row opens a `memory_conflicts` row (bounded to the
  3 nearest peers) and audits `memory.conflict.detected`; nothing is
  overwritten. `xr memory conflicts` / `xr memory resolve <a> <b> --keep
  a|b|both` (loser superseded, undoable). Honest limit: token overlap, not
  semantic understanding.
- **consolidation:** `xr memory consolidate [--dry-run] [--max-tokens n]` folds
  old, low-importance groups into cited `kind: summary` rows and **supersedes**
  the originals (never deletes; the older `summarize` still deletes and is
  unchanged). Idempotent (run twice ⇒ same state), metered through its own
  `CostGovernor` envelope with an honest budget stop, deterministic summariser
  by default, fully audited (`memory.consolidate.plan|applied|budget_stop`).
- **forgetting & export:** `xr memory forget <id> | --query | --scope` is the
  **irreversible** erase (row, cached vector, undo-ledger images, projection;
  confirmation; `memory.forgotten` audit written last) — `remove` stays the
  undoable delete. `xr memory export [--md] [--scope] [--include-quarantined]
  [--no-redact]` emits `xr-memory` v2 (v1 still imports); quarantined/revoked/
  proposed rows are exported only on request and always carry a
  `quarantineLabel`; secrets masked by default. Privacy contract:
  `docs/privacy/MEMORY.md`.
- **agent tools honour the ACL:** `memory_search` already went through the
  assembler's principal filter; `memory_get` / `memory_navigate` read rows by
  id through the adapter and bypassed it. `ContextService.adaptedMemoryItem`
  now takes the requester and applies the same retrieval gate (ACL → consent →
  lineage → TTL), so a sequestered, quarantined or superseded row is reported
  as absent to an agent that may not see it. Owner reads are unchanged.
- **legacy injection deprecated:** `knowledge.injectionMode` `legacy`/`both`
  still work but raise a `loadConfig()` deprecation warning (pinned by
  `test/config/injection-mode-deprecation.test.ts`) and are flagged in
  `xr context status`; removal in 2.0. The legacy block is principal-filtered
  and drops quarantine-channel hits. `xr doctor` shows the consolidation
  suggestion next to the memory health line.
- **poisoning corpus extended:** `benchmarks/poisoning-corpus.json` grows from
  30 to 41 entries (pois_31–pois_41) with attacks aimed at the policy layer
  itself — ACL widening, provenance forgery, forget/consolidation abuse, export
  exfiltration, role impersonation, quarantine escape — all held to the same
  never-instruction property by the existing gates (no new signatures needed).
- **fix:** the memory→context adapter overwrote stored consent/trust/provenance/
  lineage with the legacy mapping, so a quarantined, revoked or superseded row
  read by id (`memory_get`, assembler extras) was presented as approved, current
  memory. Stored metadata now wins; the legacy mapping is only the fallback for
  rows that predate it (`legacy:4.4` tag is applied only to those).
- **schema:** migration 9 `phase7_memory_policy` (four additive columns +
  `memory_conflicts`), backfill from category/confidence, reversible.

### Phase 6 — Orchestration completion (task runtime, funded trees, resume, verifier)

- **budget (breaking):** a multi-agent workflow now spends **one root envelope for
  the whole tree**, not one per worker. `budget.perTaskUsd`/`perTaskTokens` are
  the ROOT ceiling; the root is partitioned across lanes deterministically
  (largest-remainder over template role weights, floor-guarded — a lane the floor
  cannot fund is DENIED, never zero-funded). Every worker step is admitted against
  its child ceiling AND the shared root in a single ledger transaction; an
  admitted step may overshoot its estimate once, so the hard bound is
  `Σ committed ≤ root + one in-flight step`. **A worker request that passes its
  own `--budget` is ignored on the funded path** — that multiplier is what this
  fixes. Legacy (unfunded) callers keep the old per-request aliases.
- **task runtime:** every workflow task — and every plain run, as a 1-node task
  — moves through an explicit 12-state machine (incl. `recovering`,
  `awaiting_budget`, `awaiting_approval`, `verifying`) with a pure transition
  table; illegal events are swallowed by the loop but the ledger throws, and all
  legal edges are audited (`task.transition` / `agents.task.transition`).
- **durable resume:** per-step checkpoints (transcript + step index + consumed
  meter + tool-call sequence) are hash-chained in `task_checkpoints`;
  `xr run --resume <id>` and `runAgentService.execute({resume})` re-enter the loop
  from the latest checkpoint. Semantics are documented and honest: the SEED is
  durable, the model is **re-asked** (no provider replay); runs with no journal,
  a broken chain, or a truncation envelope are **refused**, never silently
  restarted. Resumed runs re-seed the spend meter, so a resumed worker does not
  get a fresh budget for old work.
- **identities & depth cap:** workers execute under minted identities
  (`role/parent/task/grant/depth`); spawn depth is capped at 1 **by
  construction** — a depth-1 worker attempting to delegate is refused and
  audited. Identity surfaces are framed as data, not instructions.
- **artifact verifier:** research/build/refactor workflows gain a read-only
  verifier lane after synthesis (default on; `orchestration.verifier`). It
  receives the workers' claims plus a deterministic **artifact manifest**
  (claimed files hashed, missing files named, escapes declined) and must answer
  with reasoned strict JSON: anything else — prose assurances included — fails
  the task closed. Deviation from the plan: the plan's verifier toolset listed a
  `grep` tool; the registry has none, so the verifier ships read-only
  `read_file`+`list_dir` scope instead.
- **supervised plan editing (off by default):** for kinds enabled in
  `orchestration.supervisorEditing`, a supervisor fragment may add/rename/skip
  tasks under hard locks: strict schema, roles inside the kind's declared set,
  review/security/verification gates never skippable, completed work immutable,
  adds fundable only from unallocated root headroom, `planVersion` + bounded
  edits per workflow. Every refusal is audited (`agents.plan.edit_denied`).
- **bounded concurrency:** workers run through a gate capped at
  `orchestration.concurrentWorkers`; budget-blocked and approval-waiting lanes
  hold their slot only while live.
- **state:** reversible migration 8 (`phase6_orchestration`) adds
  `budget_partitions`, `partition_reservations` (TTL-swept at admission, so a
  kill between admit and commit can neither double-spend nor wedge) and the
  hash-chained `task_checkpoints` journal.
- **scope:** single-process. Partitions and reservations are enforced against
  the shared workspace DB — not across machines.

### Phase 4 — Evidence Integrity (signed audit, F-08)

- **audit:** the SHA-256 hash chain was tamper-*evident* but a local attacker
  with SQLite write access could truncate and rebuild every link consistently
  (F-08). The chain is now tamper-*resistant*: a per-install **Ed25519** signing
  key is generated on first real boot and stored through the existing secret
  backends (Keychain / secret-service / DPAPI / AES-GCM file fallback); the
  public key is embedded in an `audit.keyed` event, checkpoints are signed
  every N entries, and the latest **signed head** (`audit_head`) cannot be
  forged without the private key.
- **cli:** `xr audit verify --crypto` replays the chain *and* verifies Ed25519
  signatures, head-counter monotonicity and the signed head; `--anchor`
  append-verifies remote anchors; `--crypto-legacy` accepts a pre-keying
  unsigned chain. Exit codes: `0` verified, `1` integrity failure, `2` signing
  key unavailable (limited to chain). New `xr audit anchor` (push one
  checkpoint), `xr audit export-key <file>` (encrypted, passphrase-sealed key
  backup), and `xr audit re-key --yes` (audited key rotation; the old segment
  stays verifiable to the re-key point).
- **anchor (opt-in, default off):** `audit.anchor.{enabled,sink,intervalMs}` —
  pushes a redacted signed checkpoint to an operator-controlled `file://` or
  egress-gated `https://` sink (must be on the egress allowlist; refusals are
  audited and skipped, fail-safe never fail-stop; offline-first preserved).
  Scheduled hourly in long-running processes and on clean exit.
- **state:** reversible migration 7 adds `audit_log.head_counter/sig` and the
  `audit_head`/`audit_anchors` tables, additive only — the hash chain is never
  re-keyed by a migration and existing unsigned chains stay verifiable.
- **docs:** `docs/security/AUDIT-EVIDENCE.md` states the exact threat model —
  the signature protects against silent local rewrite without the key, not
  against an attacker who also exfiltrates the key (the anchor narrows that gap).
- Kill proof: a wholesale truncate + consistent-hash rebuild now fails
  `verify --crypto` (case (b) in the tamper matrix), covered in CI by
  `test/security/audit-crypto.test.ts`, `test/security/audit-anchor.test.ts` and
  the black-box `test/e2e-blackbox/audit-crypto.test.ts`.

## 1.0.0 — 2026-08-13

### Rebaseline

- **identity:** deliberate semver rebaseline — the 7.1.0 (Truth) codebase is
  re-identified as **1.0.0 (Truth)**, the first stable line. No functionality
  was added or removed in the re-identification; the full feature history
  remains under §7.1.0 and below, and the frozen 7.x artifacts stay under
  `docs/release/7.0.1/` and `docs/historical/`. All active surfaces
  (`package.json`, `src/core/version.ts`, README, `install.sh`, `install.ps1`,
  website, packaging channels) are stamped from `release.manifest.json` at
  `1.0.0`.

### Hardening (final release verification)

- **ci:** fixed the cross-platform parity failures at root cause — SQLite
  `database is locked` escaping the retry contract on the connection-open path
  (`write-gate.ts` open retry + new open-churn regression test), macOS `/var`
  vs `/private/var` realpath normalization in the files-list test, and the
  Windows `bun build --compile` panic (documented, evidence-bound win32
  exclusion; the Windows binary is still natively built + smoke-tested by the
  release and channel-install workflows).
- **plugins:** Windows-safe filesystem primitives (bounded retry on
  `renameSync`/`rmSync`) for plugin install/update/rollback/remove.

### Fixed (release-readiness pass)

- **evaluation:** run integrity no longer depends on clock timing.
  `EvaluationRunner.run()` read `Date.now()` twice — once for the stored
  provenance and once for the digest input — so when a millisecond boundary
  fell between the two reads, the persisted digest covered a `finishedAt`
  that differed from the one persisted and every read-back reported
  `integrityValid: false` for an untampered run. A tamper-evidence signal
  that fires on untouched data is worse than none. Now one clock read, one
  frozen provenance object, hashed and stored. Regression-guarded by
  `test/evaluation/integrity-race.test.ts` (ticking-clock, deterministic —
  fails 3/4 against the previous code).

### Security

- **docs:** `SECURITY.md` no longer contradicts the implementation. It
  described XR as a "secure AI Operating System" (a term `release.manifest.json`
  prohibits) and called the `node:vm` realm the "Primary Security Boundary"
  while `src/plugins/sandbox-worker.ts` documents that `node:vm` is *not* a
  security boundary. Both corrected to the real posture: in-process policy,
  `node:vm` as defense-in-depth, OS isolation as the boundary.
- **docs:** vulnerability reports were directed to `security@xr-project.org`,
  a domain with no DNS record — reports would have bounced. Replaced with
  GitHub Security Advisories, a supported-version table, and an effort-based
  (explicitly non-contractual) response process.
- **ci:** `claim-lint` now scans `SECURITY.md`, `CONTRIBUTING.md` and
  `CODE_OF_CONDUCT.md`. Those files were outside `scannedSurfaces`, which is
  why the prohibited claim above was never caught.
- **chore:** `.gitignore` now ignores all `.env.*` variants (previously only
  `.env` and `.env.local`), with negations keeping `.env.example`/`.env.sample`
  committable.

### Added

- **docs:** `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) — previously absent
  and referenced by nothing.
- **docs:** `docs/release/RELEASE_READINESS_1.0.0.md` — evidence-bound
  readiness matrix and the exact release procedure.

### Changed

- **ci:** the parity suite runner now attributes a crash-class segment failure
  to a specific file. A directory-level "exit 3, no test failures" named only
  the directory, which is why the Windows `test/perf/` panic was never pinned
  down. On a crash-class exit that survives the retry, each file is re-run in
  its own process: a real test failure or a file that dies alone fails the
  segment and is named; only if every file passes alone does the segment pass,
  with a loud warning. Real failures still fail immediately without isolation.
- **docs:** README restructured for first-time readers (plain-language opening,
  Mermaid architecture/lifecycle/provider/extensibility/security diagrams,
  long tables behind `<details>`); test counts refreshed to the measured
  3,191 tests across 240 files.

## 7.1.0 — 2026-08-05

### Features

- **phase9:** packaging & release engineering core (T1-T5 machinery) (4896793)
- **phase8:** UX, accessibility, observability & DX excellence (T1-T5) (4f31005)
- **phase7:** capability ecosystem quality + Business OS graduation (T1-T8) (15a805c)
- **intelligence:** Phase 5 — measured, explainable routing quality (c8db271)
- **phase4:** security & trust hardening - enforceable isolation lattice, egress proxy, credential brokering, dashboard hardening, su… (8c43ae5)
- **phase3:** runtime & performance engineering — lazy boot, compiled binary, budgets + regression gate (e401bef)
- **phase2/T7,T8:** giant-file splits + enforced acyclic L0-L6 boundaries (0c53cfb)
- **phase2/T6:** one execution engine — src/workflow/ retired (402967a)
- **phase2/T5:** one context store — src/memory/ retired (e9c14a9)
- **phase2/T3,T4:** one routing authority + one PlanningService (7a1c570)
- **phase2/T1,T2:** execution envelope + single ToolRegistryService (350fb48)
- **reliability:** Phase 1 reliability & persistence core (ab39ff7)

### Fixes

- **state:** retry busy transactions whole in the WriteGate (CI stability) (adeb2bd)
- **test:** close performance-test store handles (suite-shared-process flake) (711cb61)
- **ci:** truth gate, a11y flake, and perf-gate pendulum on phase-8 PR (54996cf)
- **supply-chain:** green secret/license scans on phase-8 PR (c25e11a)
- **phase4:** typecheck - server.port may be undefined; fall back to requested port (549d41e)
- **phase4:** CI round 3 - SARIF upload permissions; dashboard-bench port 0 (EADDRINUSE); regression band 30% (runner noise) (98f2fb9)
- **phase4:** CI round 2 - trivy base-image patch (apk upgrade); osv-scanner binary + bun audit; website dep bumps + overrides (d375cf5)
- **phase4:** CI - valid action versions (trivy v0.36.0, osv v2.3.8); host-agnostic guarantee-matrix tests (2a146b6)
- **golden-path:** spawn wizard via process.execPath (Windows PATH fix) (41de9e9)
- **tests:** async rmrf with event-loop backoff for Windows EBUSY (4d087ce)
- **security:** macOS /private/etc policy bypass + cross-platform CI hardening (3b5c28b)
- **reliability:** race-safe migrations + busy_timeout before WAL (92562cf)

### Refactoring

- **phase2/T9:** no phase-named modules — folded into L0-L6 homes (0dd6be9)

### Documentation

- **phase7:** completion report + audit/gap/research/validation work log (5f237c7)
- **phase7:** ecosystem + Business OS documentation and ADRs (0d6159a)
- **phase2:** final engineering review — gates proven live, honest LOC finding (642fd23)
- **phase2:** ADRs 0002-0008, boundary table, developer + migration guides (93138ff)

### Other

- Phase 6: memory, knowledge & context quality (T1-T8) — progressive lifecycle, hybrid retrieval, memory-as-tools, integr… (56defd6)
- Phase 0 (Truth & Foundation Reset): make every claim and success signal true (bfec891)

## XR 7.0.0 — "Supremacy" (Phase 13: XR OS Supremacy)

**XR becomes a measurable platform.** This release adds no product features. It
adds the layer that proves what XR can do, states plainly what it cannot, and
detects when a change makes it worse.

### Added — evaluation subsystem (`src/evaluation/`)

- **Outcome-based benchmark harness** — 14 suites, 38 versioned scenarios across
  runtime, execution, trust, durability, intelligence, context, workflow,
  environment, capability, business, deployment, enterprise, DX, and UX.
  Scenarios verify artifacts, records, states, policies, and side effects —
  never response text.
- **Nine hard safety gates** evaluated by the runner, not the scenario. A
  scenario that leaks a credential, performs undeclared network access, bypasses
  a policy, or escapes its fixture is `blocked` regardless of how well it scored.
- **Scorecard with un-averageable gates** — a critical safety failure nulls the
  headline score rather than lowering it. `not_applicable` is excluded from
  scoring, never counted as zero. Weights are always published.
- **Append-only result storage** with recompute-on-read integrity. Runs can be
  invalidated but never deleted, so negative results cannot be erased.
- **Longitudinal regression detection** with strict comparability rules, always-
  critical security/privacy regressions, and benchmark-overfitting detection.
- **Evidence-backed certification** for providers, capabilities, workflows,
  deployment profiles, and runtime versions. Certifications expire, are
  revocable, and cannot be granted from self-reported evidence alone.
- **Compatibility contract tests** over public APIs, CLI commands, and data
  schemas.
- **Machine-checked claim/evidence matrix** — every public claim is classified
  and bound to evidence, or labelled product vision. A guard prevents shipping
  any comparative superiority claim as fact.
- **Governance** — scenario semantic fingerprinting rejects unversioned meaning
  changes; discovered gaps must be classified and owned.
- **`xr evaluate` CLI** — run, suites, list, inspect, compare, regressions,
  export, verify, certify, compatibility, claims, limitations, gaps, reproduce.

### Fixed

- **SECURITY: workflow definitions were not tamper-evident for their executable
  content.** `hashDefinition()` covered only node ids and kinds, so a published
  workflow's shell command, target capability, risk tier, or `requiresApproval`
  flag could be modified while `verifyIntegrity()` still returned true. The hash
  now covers the full definition. `hashDefinitionLegacyV1()` is retained and
  `inspectIntegrity()` reports which scheme matched, so definitions published
  before 7.0 keep loading. Found by the Phase 13 benchmark suite.
- **`xr business` was missing from the CLI help catalog** — the Phase 10 command
  worked but was undiscoverable. Found by the CLI compatibility contract test.
- **Contradictory provider counts in README** ("20+" and "12+"). Corrected to
  26 (16 hosted + 10 local), counted from `PRESETS`, with an explicit note that
  provider count is not a quality measure.

### Fixed — cross-platform / CI (post-review)

- **`set-version:check` failed on Windows.** Git for Windows' default
  `core.autocrlf=true` rewrote `src/core/version.ts` to CRLF, so the identity
  check compared LF-generated content against a CRLF file and reported "out of
  sync" on a correctly-versioned file. Added `.gitattributes` pinning text files
  to LF, and made the comparison line-ending tolerant.
- **`no_real_user_data` and `no_workspace_escape` gates were vacuous.** They
  tested for the redaction marker `<home>`, which never appears in the raw
  values gates actually receive. They now compare real paths against the fixture
  root, with an explicit carve-out for the OS temp directory (on Windows the
  temp dir lives inside the user profile, so "under homedir" is not a valid
  escape test). Three regression tests added.
- **Evaluation created the real `~/.xr` directory.** `buildCatalog()` probes the
  OS key store, which creates `XR_HOME` as a side effect — so merely measuring
  XR touched real user state. The intelligence scenarios now short-circuit the
  probe with synthetic key values and restore the environment afterwards.
- **Fixture isolation test assumed a Linux layout.** It asserted the fixture
  root is not under `homedir()`, which is false on Windows. Now asserts
  containment in `tmpdir()` and exclusion from the real XR home.
- **Workflow benchmark used `WorkspaceStore`**, which unconditionally creates
  `XR_HOME`. Replaced with a fixture-local SQLite store.

### Notes

- Verified green under both Linux and a simulated Windows layout (temp inside
  the user profile).
- No new runtime, workflow engine, policy system, or telemetry pipeline.
- No destructive migration. Evaluation storage is created lazily and only when
  `--save` is used.
- The entire benchmark suite runs fully offline with no network.
- Tests: 1636 → **1771 pass / 0 fail**.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [6.1.0] — XR 6.1 Enterprise — Enterprise Trust and Operations (Phase 12)

Makes XR governable, supportable, measurable, and operable by organizations —
**without weakening local autonomy or user trust**. All enterprise features are
additive; `personal_local` continues to operate fully offline with no control plane.

### Added

**Organization policy (`src/enterprise/policy/`)**
- Six-layer policy model: platform default → deployment → organization → workspace → user/task → capability, with separate *privilege* (who may author) and *specificity* (what wins) orderings
- Safety-relevant keys resolve **most-restrictive-wins** across all layers — a privileged layer may tighten but never loosen
- **Non-overridable user-visibility invariants**: `showApprovalRequests`, `showPolicyEffects`, `showDataScope`, `showActionProvenance`, `showCapabilityTrust`, `showIncidentImpact` cannot be disabled by any layer, including platform defaults
- Every weakening attempt is **rejected and recorded**, never silently dropped
- Full decision traces: every candidate value, whether it applied, and why
- Versioned, content-hashed, reversible policy bundles; rollback re-validates the target

**Delegated authority (`src/enterprise/authority/`)**
- Delegation is always a **strict subset** of the delegator's authority — unheld scopes are stripped, not granted
- Risk-tier ceilings only narrow down a chain; depth bounded at 4
- Immediate revocation that **cascades** to all descendant delegations
- Periodic access reviews that may only reduce scope
- Policy restrictions on authority are recorded with reasons, so users can always see why an action was blocked
- **No new identity system** — subjects reference existing Phase 11 `RemoteIdentity` and business `Member`/`AIWorker` ids

**Audit export, redaction, retention (`src/enterprise/audit/`)**
- **Verifiable redaction**: redacted fields carry a SHA-256 digest of the original value and the record's chain hashes are preserved, so a redacted export still verifies
- `proveRedactionFaithful()` detects forged digests *and* records that claim redaction while retaining the value
- Controlled export with access control, integrity manifest, chain verification, and access logging
- Truncation, withholding, and source failure are **always explicit** — never a silent short export
- Retention schedules per event class; legal hold **blocks** deletion and reports the conflict; dry-run by default
- `WorkspaceStore.auditChainRange()` — ascending audit reader that includes `prev_hash`

**Operations and SLOs (`src/enterprise/operations/`)**
- Ten SLOs, each declaring whether XR can actually measure it and from which signal
- No samples ⇒ `unmeasurable`, never a fabricated "meeting"; profile-inapplicable SLOs report `not_applicable`
- Error budgets, aggregate operational status, and alert-worthy conditions

**Incident response (`src/enterprise/incidents/`)**
- Seven-state lifecycle with an enforced transition table and fast paths for contain-first response
- Hash-committed, verifiable evidence
- Response actions bridged to real subsystems via injected handlers
- Data leakage, credential exposure, isolation failure, and audit failure **always** set user-visible impact, which an administrator cannot clear

**Capability supply chain (`src/enterprise/supplychain/`)**
- Revocation by capability, semver version range, or entire publisher
- **Evidence is snapshotted before quarantine**, so a malicious capability cannot erase its own trail
- Install/update blocking, affected-deployment notices, safe-version restore that refuses revoked versions
- Organization capability catalogs (allowlist/denylist/open) evaluated *after* revocation

**Backup and disaster recovery (`src/enterprise/recovery/`)**
- Backup verification: digest recomputation, component checks, and credential-safety scanning
- **Restore preflight gate** — a restore is refused unless the backup verifies (anti restore-poisoning)
- Cross-deployment compatibility rules; partial-restore consistency reporting
- RPO/RTO measured against declared targets; unmeasured values report `unknown`
- Recorded restore drills as evidence that backups actually work

**Release and support (`src/enterprise/release/`)**
- Channels: `stable`, `lts`, `beta`, `edge` with computed support windows
- Compatibility checks across plugin API, capsule, backup, policy, and audit-export schemas
- **Rollback validation** enforcing six invariants: local operation, policy safety, audit integrity, backups, incident evidence, capability revocation
- Release artifact digest recording and verification

**Certification evidence (`src/enterprise/certification/`)**
- 36 controls, each declaring assurance as **technical** / **operational** / **external_required**
- Eight-entry threat model with residual-risk ratings
- `assertNoFalseCertificationClaim()` — a CI-enforced guard against compliance theater
- Source and test paths in the catalog are verified to exist by test

**CLI**
- `xr enterprise` (alias `xr ent`) covering status, policy, authority, audit, slo, incident, supplychain, recovery, release, evidence

**Documentation** — `docs/phase12/`: enterprise trust architecture, policy/authority, audit export, incident response, supply-chain response, backup/recovery, SLO/observability, release/support, certification evidence, governance

### Changed
- Version 6.0.0 → 6.1.0; codename "Hybrid" → "Enterprise"
- `test/daemon.test.ts` now derives the expected version from `CORE_VERSION` instead of a hardcoded string

### Fixed
- **Redaction-claim bypass**: `proveRedactionFaithful()` verified digests but not that the redaction was actually applied, so a record could claim a field was redacted while still carrying the plaintext. Found by the adversarial suite; fixed with regression tests.
- **False audit chain break**: the CLI export read via `recentAudit()`, which omits `prev_hash` and returns newest-first, producing a spurious `partial` status. Fixed by adding `auditChainRange()`.

### Security
- Organization policy cannot silently override user-visible safety information — enforced at every layer and tested adversarially
- Task-level least privilege (Phase 3) is preserved; delegation can only narrow it
- Adversarial coverage for all nine roadmap attack classes: privilege escalation, tenant leakage, hidden policy override, audit tampering, redaction bypass, compromised capability, compromised worker, restore poisoning, revoked identity reuse
- Local/private deployments verified to require no network and no control plane

### Not included — stated explicitly
- **XR holds no external certification.** No SOC 2, ISO 27001, HIPAA, PCI-DSS, or FedRAMP. No independent security assessment or third-party penetration test has been performed. The evidence pack is a self-assessment prepared *for* such an assessment.
- Controls EX-01, EX-02, EX-03 are `not_implemented` and say so.
- No Phase 13 supremacy benchmarks or comparative performance claims.

### Testing
- **1636 tests pass, 0 fail** (from 1256 at 6.0.0) — 380 new tests, 6004 assertions, 113 files
- Zero regressions in prior phases

## [6.0.0] — XR 6.0 Hybrid — Local, Cloud, and Hybrid Operating Plane (Phase 11)

### Added
- **Deployment Profiles**: Five canonical profiles (Personal Local, Private Local Server, Team Private, Managed Cloud, Hybrid) with explicit capabilities, limitations, identity models, and recovery semantics
- **Portable Task Capsules**: Versioned, integrity-hashed (SHA-256), secret-free capsule format for portable work across deployment modes
- **Placement Policy Engine**: Weighted multi-factor placement decisions with explainability, user overrides, residency gates, and hardware scoring
- **Worker Registry**: Secure worker registration, attestation, admission, heartbeat, drain, revoke, quarantine, and stale detection
- **Control/Data Plane Separation**: Control plane handles identity/placement/policy/status; data plane handles execution; local plane handles offline operation
- **Synchronization Engine**: Bidirectional sync with conflict detection, multiple resolution strategies, offline support, and retry/backoff
- **Offline Mode Service**: Full local operation when disconnected with task queuing, priority ordering, and safe resynchronization
- **Data Residency Policy Engine**: Classification-based residency enforcement, retention policies, region restrictions
- **Remote Identity Service**: Scoped time-limited revocable identity tokens, organization management, tenant boundary definitions
- **Backup Service**: Local backup/restore with pre-restore safety, retention-based cleanup, export
- **Deployment Status**: Comprehensive status reporting for CLI/daemon/dashboard

### Changed
- Version bump from 5.3.0 to 6.0.0
- Codename from "Work" to "Hybrid"
- Updated package description

### Security
- Capsule integrity verification prevents tampering
- Control plane redaction prevents sensitive data exposure
- Worker attestation and identity verification
- Tenant/workspace isolation enforcement
- Data residency policy enforcement
- Secret non-transfer in capsules
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.3.0] - 2026-07-27 — Personal and Business Operating Layer (Work)

XR now runs durable, governed, evidence-linked intelligent work for individuals, developers, researchers, operators, and organizations via outcome-oriented journeys. This is not more modules — it is complete journeys through canonical workflow, execution, trust, intelligence, context, capability contracts.

### Added

- **Personal and Business Operating Layer (`src/business/core/operating-layer.ts`)**: Central orchestrator that makes business modules use canonical workflow/execution/trust/intelligence/context/capability contracts. Outcome-oriented journeys, governed workers, authoritative records, artifacts/evidence, organization/role authority, human approval/escalation, measurable outcomes, local/private operation, audit/provenance, CLI/daemon/dashboard.
- **Operating Types (`operating-types.ts`)**: Outcome, RecordMutation, WorkerAuthorityProfile, BusinessArtifact, ApprovalRequest, PrivacyPolicy, JourneyDefinition, OperatingLayerStatus — all typed, no placeholders.
- **Record Mutation Authority (`record-mutation.ts`)**: Canonical mutation contract per spec 6.3 — every consequential mutation links actor/worker, workflow/task/execution, policy/approval, source/evidence/context, timestamp/version, previous value/change history, reversibility/restore path. Model output is proposal until policy/workflow/human commits. No direct DB mutations outside contract. Propose→commit→revert with hash chain.
- **Outcome Tracking (`outcome.ts`)**: VerifiedOutcome with journeyId, workflowRunId, recordsChanged, artifacts, evidenceRefs, metrics, cost (est/actual, tokens, duration), verifiedAt, reversibility. Measurable business outcomes.
- **Worker Governance (`worker-contract.ts`)**: Narrow authority per spec 6.2 — role/identity, org/workspace scope, allowed workflows, context scope, capabilities/tools, model/provider scope (local-first, local-only, cost-constrained), budget per task/day, risk/placement tier0-3, approval/review requirements, data access field-level, success criteria, escalation channels, revocation/disable behavior (disable removes authority, revokes credentials, audits, no silent restoration). Effective authority = declared ∩ policy ∩ grants - denied.
- **Authority Boundaries (`authority-boundaries.ts`)**: Organization/workspace/role/worker delegated authority, record/data scope, approval authority, audit visibility — reuses existing RBAC/business foundations, no second identity system.
- **Artifact & Evidence (`artifact-evidence.ts`)**: Documents, research reports, meeting notes, communications, analytics, records use existing context/artifact/provenance contracts (WorkflowArtifact, EvidenceRef). Create artifact with SHA-256 hash, provenance (actor, sources, contextPackageIds, executionRefs, workflowRef), linkedRecords, sensitivity public/internal/confidential/restricted, content preview. Verify hash, list by workspace/run.
- **Approval/Escalation (`approval-escalation.ts`)**: Human attention — what requires approval (high-value finance >$5k, deal >$10k, external write, sensitive data, public KB), what auto (low-risk), what review (low confidence <0.7, delete), what informational (KPI, forecast). Grouping/deferral 5min window max 20 per group, avoid fatigue, uncertainty display confidence/reasons/budget/evidence. ApprovalRequest with expiry, channels dashboard/cli/webhook/email/telegram, recipients user/role/webhook_url, evidence, artifacts, context summary.
- **Local/Private (`local-privacy.ts`)**: Sensitive journeys operate locally/private where providers support it, cloud transfer requires policy/consent. Privacy modes local (no cloud), private (restricted deny, confidential require approval), hybrid (allow with policy). Sensitivity public/internal/confidential/restricted. Default rules per mode, checkPrivacy returns allow/deny/require_approval/require_consent/localOnly/remediation/redactedFields. Enforces context scope before retrieval/injection, isCloudProvider heuristic, intelligence router local-only policy.
- **Execution Bridge (`execution-bridge.ts`)**: Bridges business events to ExecutionService and WorkflowEngine — records execution per business operation, leases prevent duplicate mutation, checkpoints for recovery, trust classification, idempotency keys prevent duplicate record mutation. Persist to biz_execution_records, biz_execution_leases, biz_execution_idempotency.
- **Journeys (`journeys.ts`)**: 8 representative journeys — personal-knowledge-capture, developer-project-delivery, research-evidence-report, customer-support-triage, sales-deal-progression, project-meeting-to-doc, scheduling-meeting-coordination, finance-invoice-from-deal. Each defines trigger/intent, context package (tiers, locality, sensitivity, memory), workflow version (nodes, capabilities, authority), outcomes (metrics, verifiedOutcomeType, costBudget, successCriteria), artifacts, privacy, version, active.
- **Workflow Templates (`workflow-templates.ts`)**: Canonical workflow definitions for each journey using WorkflowDefinition types — trigger→deterministic→agentic→human_approval/human_review→business_record→tool_action→notification→artifact_output→branch/join→completion. Versioned, content hash FNV-1a, entryNodeIds, retry/backoff/timeout/cost/tags, active, published via WorkflowEngine. No visual editor.
- **Operating Layer Migration (`migration.ts`)**: 9 new tables — biz_record_mutations, biz_outcomes, biz_worker_authority, biz_artifacts, biz_approvals, biz_privacy_policies, biz_execution_records, biz_execution_leases, biz_execution_idempotency — total 42 tables. Idempotent, extends biz_audit with workflow_id, execution_id, context_package_ids, evidence_refs, policy_decision, reversible via ALTER TABLE.
- **Business DB Integration (`database.ts`)**: ensureOperatingLayer, getOperatingLayerStats, 42 tables migration, preserves existing 33.
- **BusinessOS Wiring (`index.ts`)**: Initializes operating layer services first, then modules, sets business modules into operating layer, sets governance into workers module. initialize() calls operating layer initialize which migrates and publishes templates and subscribes to events (deal.created→sales, deal.won→finance, ticket.created→support, etc).
- **AI Workers Governed (`ai-workers/index.ts` + 11 roles)**: Deploy creates both biz_workers and governance profile via WorkerGovernanceService. Toggle via governance revokes authority and audits. Chat checks enabled, budget, context scope maxItems/sensitivity. inspectWorker returns effective authority, budget status, risk status. List inspections. narrowDefaultsForRole defines sales_director single-workspace $0.50/day, ceo_advisor org-read $2/day tier0, financial_analyst local-only private, hr_manager restricted etc. 11 roles now.
- **Daemon Business Routes (`daemon/routes/business.routes.ts`)**: 13 routes — /api/business/status (workspace view), /api/business/journeys list, /api/business/journeys/:id/start, /api/business/outcomes list/:id, /api/business/approvals list/:id/decide, /api/business/artifacts, /api/business/workers list/:id/:id/disable|enable, /api/business/mutations, /api/business/privacy/:workspaceId. Uses canonical `route({ id, path/prefix, method, handle })`, no Phase 11 control plane. Wired in routes/index.ts.
- **CLI Business Commands (`commands/business.ts`)**: Outcome-centered views — status (health, tables 42, journeys 8, outcomes stats, pending approvals, privacy mode, cost), journeys list/start/show, outcomes list/show, approvals/work-queue with grouping and uncertainty, workers list/inspect/enable/disable with narrow authority, artifacts with hash/sensitivity/provenance, mutations with workflow/execution/evidence/reversible, privacy, audit verify. JSON mode via --json/-j, workspace/org flags, non-TTY machine readable, progressive disclosure, keyboard operation, accessibility via output.ts theme.
- **Tests (`test/business/operating-layer.test.ts`)**: 23 new tests — module inventory journeys complete + workflow templates valid, record mutation propose/commit/deny/revert with provenance, outcome create/update/verify cost/time, worker governance narrow authority + enable/disable revokes + budget, authority boundaries RBAC+isolation+sensitivity, artifacts creation+provenance+hash verification, approvals create/list/decide expiry + classify attention avoids fatigue, privacy enforcement local/private/hybrid + context leakage prevented, execution bridge lease+idempotency, complete journeys end-to-end personal/developer/research/finance with artifacts/outcomes/approvals, security unauthorized access denied + worker escalation + context leakage, reliability checkpoint recovery.
- **Docs (`docs/phase10/`)**: AUDIT_DELIVERABLE.md 41KB, ARCHITECTURE_DESIGN.md 26KB, AI_WORKER_CONTRACT.md, ORGANIZATION_RBAC_DATA_SCOPE.md, OUTCOME_JOURNEY_GUIDES.md, BUSINESS_WORKFLOW_INTEGRATION.md, EVIDENCE_ARTIFACT_PROVENANCE.md, APPROVALS_ESCALATIONS.md, LOCAL_PRIVATE_PRIVACY.md, DEVELOPER_INTEGRATION_GUIDE.md, USER_GUIDES.md, MIGRATION_BACKUP_RESTORE.md, README.md, RELEASE_VALIDATION.md — covering personal/business operating architecture, worker contract, org/RBAC/data scope, journey guides, workflow integration, evidence/artifact/provenance, approvals/escalations, local/private privacy, developer integration, user guides, migration/backup/restore, changelog/release/validation. No enterprise control plane claims.
- **Version Bump**: package.json 5.2.0 → 5.3.0, description XR 5.3 Personal and Business Operating Layer, src/core/version.ts 5.3.0 Work, codename Work, DISPLAY_VERSION.

### Changed

- BusinessDatabase now 42 tables (33+9), ensureOperatingLayer idempotent
- BusinessOS now exposes operating layer services: recordMutations, outcomes, workerGovernance, authority, artifacts, approvals, privacy, executionBridge, operatingLayer — plus existing modules
- AIWorkersModule now governed with narrow authority, inspection, budget, enable/disable revokes
- Daemon routes index now includes businessRoutes
- CLI BusinessCommand now outcome-centered with journeys, outcomes, approvals, workers, artifacts, mutations, privacy, audit verify
- daemon.test.ts expects version 5.3.0 (was 5.2.0)

### Security

- Authoritative records protected by RBAC + workflow policy + approval + trust classification + privacy enforcement
- AI workers have narrow declared scope, effective authority = declared ∩ policy ∩ grants - denied, not free-form autonomous
- Model output is proposal/evidence until committed via record mutation contract
- External writes require elevated approval + credential scoping via trust/credential contracts + privacy policy
- Every consequential change attributable: actor/worker, workflow/task/execution, policy/approval, evidence/context, timestamp/version, previous value/change history, reversibility/restore path
- Context scope enforced before retrieval/injection via LocalPrivacyService + context policy
- Capability authority effective, not merely declared, via WorkerGovernanceService.inspect + authority boundaries
- Sensitive business/personal data respects locality/privacy policy — local-only blocks cloud provider, private denies restricted external_write, confidential requires approval
- Disabled/revoked workers cannot execute, credentials revoked, audit preserved
- Audit history tamper-evident and exportable, hash chain SHA-256, mutation chain content hash, outcome verification

### Fixed

- daemon.test.ts version expectation 5.2.0 → 5.3.0
- OutcomeTracker.getStats column cost_duration_ms → duration_ms (bug fix)

### Migration

- Additive migration 5.2 → 5.3, no breaking changes, existing business.test.ts 21 PASS still, total tests 1151 PASS 0 FAIL
- Rollback safe: new tables independent, old code ignores them, audit chain still valid, worker enabled flag respected, no silent authority restoration or record revert

## [5.2.0] - 2026-07-27 — Capability Ecosystem

XR now exposes plugins, skills, MCP servers, providers, tools, workflows, integrations, and artifact transforms through one trusted capability ecosystem. Capability metadata is inspectable, but it never grants authority. Native execution semantics and existing security contracts remain the source of truth.

### Added

- **Capability descriptor layer** (`src/capabilities/`): common schema for publisher identity, provenance, package integrity, compatibility, dependencies, declared permissions, effective authority, data scopes, network/credential/provider requirements, placement/risk, interfaces, certification, lifecycle, support, and cost.
- **Declared vs effective authority resolver**: effective authority is declaration ∩ policy ∩ user/task grants ∩ placement limits, minus denied permissions. Denied always wins.
- **Adapters** for existing planes: plugins, skills, MCP servers, providers, tools, workflows, integrations, and artifact transforms. No second registry or permission engine was introduced.
- **Capability discovery** by task, type, required capability, excluded permissions, max risk tier, locality, publisher/trust, certification, installed/enabled state. Ranking is evidence-weighted and not popularity-only.
- **Certification contract tests** distinguishing `unknown`, `self-tested`, `xr-tested`, `verified`, `quarantined`, and `legacy`.
- **Capability CLI**: `xr capabilities list|discover|inspect|permissions|certify|enable|disable|quarantine|rollback|health` with JSON output; alias `xr capability`.
- **Daemon/dashboard inspection**: `/api/capabilities*` routes and a Capability Ecosystem dashboard panel with inspection, effective-authority visibility, discovery, and quarantine controls.
- **Config v17**: additive `capabilities` policy block (`requireSignedPackages`, `updateRequiresReview`, `quarantineOnVerificationFailure`, `deniedPermissions`, `evidenceWeightedDiscovery`).
- **Tests**: new Phase 9 coverage for authority intersection, descriptors, discovery, plugin update review, rollback without silent authority restoration, and skill package path traversal.

### Changed

- Plugin registry/manager now records lifecycle state, update-review state, rollback snapshots, and quarantine state. Plugin rollback restores files but disables the plugin and clears grants.
- Skill package import is transactional: stage extraction, reject unsafe paths, verify tree hash, re-read manifest, then swap. Skill updates requesting new permissions require explicit grant review. Skill rollback disables and clears grants.
- MCP registry now separates `declaredPermissions` from `grantedPermissions`; enable/load fail closed if authority cannot be determined or the server is quarantined.
- Online skill installs can enforce signed-package policy through `capabilities.requireSignedPackages`; unsigned/invalid/unknown signatures are represented clearly.

### Security

- New permission escalation gates for plugin and skill updates.
- Quarantined plugin/MCP capabilities cannot be enabled or loaded.
- Rollback never restores authority silently.
- Package path traversal is blocked transactionally.
- Capability metadata cannot grant authority or bypass existing execution/trust/context/workflow contracts.

---

## [5.1.0] - 2026-07-27 — Environment Interaction OS

XR becomes able to act in digital environments under one governed contract.
This release does not add "more browser/voice/vision features" — it gives every
environment action one answerable envelope: what it is, what authorizes it, how
certain perception was, whether it can be undone, and what happens when it
fails.

> **Environment interfaces are capabilities, not authority.** Perception is
> evidence, never an instruction; a coordinate is never proof of a target.

Builds on the Phase 7 (Agent and Workflow OS) baseline in `main`.

### Added

- **Environment module** (`src/environment/`): universal typed contract
  (`types.ts`) over the existing control Action union — closed environment set
  (`browser`/`desktop`/`filesystem`/`application`/`voice`/`vision`), session
  lifecycle state machine, target identity (**coordinate targets require
  evidence**), interaction kind, perception confidence (`unknown` is a real
  value), honest reversibility classes (`reversible`/`compensatable`/
  `irreversible`/`unknown`), compensation specs, approval strengths
  (`none`/`standard`/`strong`), and outcome taxonomy including
  **`uncertain` = side effect unknown, always user-visible**.
- **`runEnvironmentAction` gate** (`service.ts`): kill-switch → schema →
  compatibility → target proof → staleness → capability → privacy/consent →
  risk+reversibility+approval → permission → session → execution (via the
  existing `control.runAction`, never a private executor) → bounded recovery →
  recorded history.
- **Session registry**: max-active bound, idle sweep, circuit breaker
  (3 failures / 60 s cooldown / half-open probe), cleanup states, and
  **quarantine on cleanup defects** — a session whose cleanup failed is
  contained, never auto-revived.
- **Bounded recovery** (`recovery.ts`): at most ONE automatic re-observe retry
  for perception-shaped failures, never for irreversible/unknown/unknown-side-
  effect actions. No unrestricted autonomous repair anywhere.
- **Honest capability matrix** (`capabilities.ts`): six environments probed
  (`partial` never rounds up; `unsupported` carries remediation), including a
  real Playwright import probe replacing the legacy optimistic check.
- **Governed browser sessions** (`control/browser.ts`): isolated per-session
  contexts (no cookie/storage import-export), domain allow/block policy,
  private-network navigation blocked by default, per-session downloads root
  with byte cap (oversize deleted), page-crash detection, sandboxed launch.
- **Privacy layer** (`privacy.ts`): structural secret redaction (private-key
  armor first), redacted action echoes, dual-gate cloud consent for
  STT/TTS/vision (settings AND session policy; no ambient or inferred consent),
  retention decisions — screenshots are referenced by path+hash, never copied
  into records; raw transcripts persist only under the existing local-private
  mode-0600 policy.
- **Vision provider**: typed observations with provenance/confidence/
  sensitivity (full screens declared `private` honestly) and staleness; local
  OCR (tesseract-or-nothing, no silent cloud fallback); consent-gated cloud
  routing.
- **Voice gate**: deterministic intent confidence floor (default 0.6, spoken
  refusal below it), `never-execute-risky` extended to deterministic control
  intents, strong-approval actions forced to the text/dashboard channel.
- **Workflow binding** (`workflow-binding.ts`): environment actions compile to
  canonical Phase 7 `tool_action` nodes with risk tier, idempotency class, and
  compensation policy.
- **`xr env` command** (`status`/`capabilities`/`sessions`/`close`/`close-all`/
  `history`/`observations`/`policy`, all `--json`), daemon routes
  `/api/environment/*`, and an `environment` check in `xr doctor`.
- **Config v16**: additive `environment` block — per-modality kill switches,
  browser domain/download policy, cloud-vision consent (default off), image
  size cap (default 5 MiB), observation staleness window, voice confidence
  floor, recovery bounds, session bounds. Automatic migration 15 → 16.
- **Kill switches**: `XR_ENVIRONMENT_DISABLED=1`, `environment.enabled:false`,
  or per-modality `false` — rollback without touching core XR.
- **145 tests** across 11 new files in `test/environment/`, including a
  dedicated adversarial suite (cloud-consent, voice-bypass, instruction-
  injection framing, sandbox posture, filesystem boundary, stale-observation
  protection). Full suite: **1122 pass / 0 fail**.
- **Docs**: `docs/environment/` — contract guide, BROWSER, DESKTOP, VOICE,
  VISION, REVERSIBILITY, RECOVERY, PLATFORM_SUPPORT, TESTING, USER_GUIDE;
  Phase 8 audit report and architecture in `docs/phase8/`; XR 5.0 → 5.1
  migration section in `MIGRATION.md`.

### Fixed (audited pre-existing defects)

- Desktop **`move` no longer clicks** — it was routed through the click
  executor, performing a left-click at the target coordinates.
- Desktop **scroll on macOS/Windows no longer fakes success** — it reports an
  honest unsupported/skip outcome; the capability matrix reports scroll
  injection off-Linux as missing.
- **`xr control computer` (computer-use) bypassed the approval gate entirely**
  — each loop step raw-executed. Now the run requires outer destructive
  approval and every step goes through `runEnvironmentAction` with observation
  references and declared confidence; the loop stops on deny/block/uncertain/
  circuit-open.
- **`computer_use` cloud vision had no consent parameter** — cloud routing is
  now blocked without explicit dual consent (default: blocked).
- **Vision images had no size cap** — captures above
  `environment.vision.maxImageBytes` (default 5 MiB) are deleted immediately
  and reported as failures.

### Changed

- Voice control intents and the computer-use loop route through the
  environment gate; approval channels, trust records, and Phase 7 workflow
  semantics are otherwise untouched. All changes are additive over XR 5.0.

## [4.5.0] - 2026-07-26 — Knowledge and Context OS

XR becomes a trusted long-term intelligence layer. This release does not add
"more memory" — it converts the memory subsystem into a policy-aware context and
knowledge layer governed by one rule:

> **Memory is context, not authority.** A retrieved item never becomes an
> instruction merely because it was stored or ranked highly.

### Added

- **Context taxonomy** (`src/context/types.ts`): seven distinct classes —
  `instruction`, `memory`, `knowledge`, `evidence`, `artifact`, `task_context`,
  `untrusted`. Only `instruction` can ever carry authority.
- **Deterministic authority gate**: `mayActAsInstruction(type, trust)` requires
  BOTH an authority-eligible type and `trusted_instruction` trust. No score,
  similarity, or model classification can widen it.
- **Metadata contract**: typed provenance, freshness, confidence, consent,
  sensitivity, retention, scope, index state, and bounded relationship links.
  `unknown` is a distinct value, never a synonym for approved or true.
- **Eight context tiers** with a static, testable policy table (allowed types,
  trust ceiling, instruction eligibility, item/char bounds, compressibility).
- **Scope-first retrieval** (`src/context/retrieval.ts`): authorization is
  applied *before* semantic ranking, so an unauthorized item is never scored.
- **Deterministic reranking** with an explainable, stable ordering, plus a
  contradiction/confidence stage that reports conflicts instead of hiding them.
- **Safe injection packaging** (`src/context/injection.ts`): three channels —
  `instruction` (system), `data` (system, "context, not authority"), and
  `quarantine` (**user role**, fenced, emitted last so untrusted text cannot
  reframe trusted content).
- **Anti-poisoning** (`src/context/poison.ts`): provenance trust ceilings that
  can only lower trust, self-approval blocking, seven context-specific signature
  families, and deterministic conflict penalties.
- **Evidence-preserving compression** (`src/context/compression.ts`): ten
  required invariants; when one cannot be preserved it returns `ok: false` and
  the originals are kept. Fully deterministic — no model call.
- **Consent lifecycle**: `not_eligible`, `proposed`, `approved`, `limited`,
  `expired`, `revoked`, `deleted`, `quarantined`, `legacy_unknown`.
- **Revocation and correction**: revoking destroys the cached embedding and
  writes an append-only ledger row; correcting creates a new entry and marks the
  original superseded so lineage survives.
- **Durable context packages** with identity, version, and content hash;
  `revalidate()` re-checks consent, revocation, scope, and freshness on resume.
- **`xr context` command**: `status`, `list`, `inspect`, `explain`, `pending`,
  `legacy`, `approve`, `revoke`, `correct`, `export`, `prune` — all with `--json`.
- **Daemon routes**: `/api/context`, `/api/context/items`, `/api/context/policy`,
  `/api/context/pending`, `/api/context/export`, `/api/context/item/:id`,
  `/api/context/approve/:id`, `/api/context/revoke/:id`.
- **Dashboard**: consent counters, a pending-review queue with approve/reject,
  per-entry revoke, and honest residual-data disclosure on removal.
- **Five additive tables**: `context_items`, `context_provenance`,
  `context_revocations`, `context_packages`, `context_summaries`.
- **Config v15** `knowledge` block (enabled, injectionMode, enforceScope,
  quarantineUntrusted, routeEmbeddings, lexicalOnly, rerank, bounds,
  compression, compressionFailSafe, durablePackages, revalidateOnResume,
  disclosure).
- **190 new tests** across taxonomy, security/poisoning, retrieval, compression,
  durable/intelligence integration, migration, user flows, and performance.

### Changed

- **Embedding model selection now routes through the Phase 5 intelligence
  plane.** `src/memory/embed.ts` was a second provider router; it is now the
  transport only. Routing failure degrades to the deterministic lexical vector —
  never a silent cloud call.
- **`MemoryScope` is enforced, not merely declared.** Multi-agent workers now
  receive exactly the tiers their declared scope permits (`none` → immediate
  only); an unknown scope fails closed.
- **Plugin memory writes land as `proposed`, not usable memory.** Third-party
  code can propose but never approve; trust is clamped to `untrusted_external`.
- **Message compaction preserves evidence.** Sentences carrying decisions,
  corrections, questions, uncertainty, sources, scope, or dates are kept up to
  400 chars, so a negation like "must NOT deploy on Fridays" is no longer cut.
- **Research findings are recorded as `generated_synthesis`** with source
  citations linked, never as user facts.
- **Memory read methods return `MemoryEntryWithContext`** (a superset of
  `MemoryEntry`), so existing call-sites keep compiling.
- `user_memory` gains 20 additive nullable/defaulted columns and three indexes.

### Security

- Cross-workspace access is denied by the first check in `authorize()`.
- Untrusted and unknown-trust content is quarantined regardless of tier.
- Instructions cannot be created through the context write path at all.
- Model-authored claims are clamped to `generated_synthesis`.
- Rejection records carry ids and typed reasons but never item content.
- Secrets and out-of-workspace paths are masked before reaching a prompt.
- Resumed tasks revalidate consent and revocation before reuse.

### Compatibility

- All XR 4.4 memory APIs preserved; `buildMemoryBlock()` unchanged.
- `runAgent()` without a context package behaves exactly as in 4.4.
- `knowledge.injectionMode: "legacy"` restores 4.4 injection.
- Legacy memory migrates to `legacy_unknown` consent — **never** backfilled to
  `approved`, because XR cannot verify historical consent.
- Phase 0–5 validation remains green (939 pass; 2 pre-existing sandbox-env fails).

### Known limitations

- Embedding vectors cannot be cryptographically un-learned; XR deletes and
  invalidates them and states this honestly rather than claiming erasure.
- `rag_chunks` still lack a freshness signal (deferred, documented).
- Compression is deterministic, not model-assisted.
- Legacy consent cannot be reconstructed and stays `legacy_unknown` until reviewed.

## [4.4.0] - 2026-07-26 — Universal Intelligence Plane

### Added
- **Universal Intelligence Plane** (`src/intelligence/`): provider-neutral capability
  catalog, task-requirement filtering, deterministic explainable scoring, routing modes,
  safe fallback policy, bounded historical metrics, and durable routing decision records.
- **Capability tri-state** (`supported` | `unsupported` | `unknown`) so unknown is never
  treated as true; legacy boolean presets remain compatible.
- **Model/provider descriptors** with model classes, modalities, context limits, cost,
  latency, quality, locality/privacy, and hardware hints.
- **Routing modes**: manual, preferred_with_fallback, local_only, private_only, automatic,
  cost_constrained, latency_constrained, quality_constrained, disabled.
- **Policy hard gates**: local-only / private-only / no-cloud, credentials, budget,
  health, context limits, capability requirements — applied before scoring.
- **IntelligenceService** registered on the Phase 1 kernel (`Tokens.Intelligence`).
- **Config `intelligencePlane`** block (config version 14) — additive; defaults preserve
  XR 4.3 hybrid behavior. `allowCloudFallback` defaults false.
- **CLI**: `xr providers route`, `explain`, `catalog` (+ status shows selection/why).
- **Daemon**: `GET /api/providers/route`, `GET /api/providers/catalog`.
- **Durable wiring**: optional `ExecutionRecord.routing`, audit `intelligence.route`,
  agent fabric routing evidence.
- **Docs**: `docs/phase5/` architecture, developer, user, migration, validation, checklist.
- **Tests**: 34 new intelligence/routing/privacy/performance tests.

### Changed
- `ProviderRouter` / `buildProvider` delegate selection to the intelligence plane while
  preserving public APIs; explicit provider/model pins outrank automatic preferences.
- Agent service passes tool-use task requirements and records routing decisions.
- Version identity → **4.4.0 (Universal Intelligence Plane)**.

### Security
- Automatic routing cannot move local-only work to cloud without explicit
  `allowCloudFallback`.
- Manual pins cannot bypass locality/security policy.
- Fallback refuses `unknown_completion` to avoid duplicate side effects.
- Decision records are secret-free (no keys, no raw prompts).

### Migration
- See `docs/phase5/MIGRATION_4.3_to_4.4.md`. Config migrates 13→14 automatically.

## [4.3.0] - 2026-07-25 — Durable Agency

### Added
- **Durable checkpoints** (`src/execution/checkpoint.ts`): safe semantic boundaries
  (`task_accepted`, `plan_recorded`, `policy_admitted`, `env_admitted`, `step_started`,
  `step_completed`, `model_turn_completed`, `tool_call_completed`, `cancellation_requested`,
  `review_checkpoint_reached`, `cleanup_completed`, `recovery_decided`) with
  side-effect-safety classification and authority snapshots.
- **Local ownership/leases** (`src/execution/lease.ts`): prevents duplicate execution
  within the same workspace; detects stale process ownership via PID liveness check;
  supports acquisition, renewal, release, takeover, and cleanup.
- **Startup recovery** (`src/execution/recovery.ts`): discovers unfinished work at
  boot, classifies each record as `safe` / `unknown_side_effect` / `authority_expired` /
  `environment_lost` / `cancellation_pending`, decides `auto_resume` / `requires_approval`
  / `blocked` / `quarantined`, and records recovery decisions durably.
- **Durable cancellation** (`execution_cancellations` table): cancellation requests
  survive process restart and are honored before any resume attempt.
- **Environment attachment records** (`environment_attachments` table): persist
  environment identity, lifecycle state, and cleanup status so orphaned environments
  can be detected and quarantined at startup.
- **Recovery-aware execution states**: `recoverable`, `startup_recovery_pending`,
  `resuming`, `resumed`, `recovery_blocked` exposed through the inspection layer.
- **Bounded backpressure constants**: `MAX_ACTIVE_EXECUTIONS` (50), `MAX_RECOVERY_OPERATIONS`
  (5), `MAX_ACTIVE_ENVIRONMENTS` (10), `MAX_QUEUED_WORK` (100), `PER_WORKSPACE_CONCURRENT`
  (20) with explicit capacity reporting.
- **Retry safety reinforcement**: built on Phase 2 idempotency — `non_idempotent` actions
  with unknown side effects are never silently retried; `reconciliation_required` is the
  honest terminal state.
- **Authority revalidation on resume**: policy, credentials, placement, budget, and
  approvals are re-checked before any recovered execution can proceed.
- **CLI recovery commands**: `xr execution --recovery` shows interrupted work;
  `xr execution --resume <runId>` resumes a recoverable execution with user approval
  for unknown-side-effect cases; `xr execution --cancel <runId>` creates a durable
  cancellation.
- **Daemon recovery routes**: `GET /api/recovery` returns all pending/blocked recoveries;
  `POST /api/recovery/resume` triggers resume (with optional `force` for user-approved cases).
- **Kernel startup recovery**: `XRApp.start()` now runs `startupRecovery()` after service
  readiness; interrupted work is classified, safe work auto-resumed, and blocked work
  is exposed via health and events.
- **Graceful shutdown marking**: `ExecutionService.onStop()` checkpoints active executions
  as interrupted before stopping, so they are discoverable on next start.
- **Health integration**: `KernelHealth.recovery` reports `pending` / `blocked` counts;
  `formatHealthHuman` shows recovery section.
- **30 new tests**: checkpoint manager (7), lease manager (10), recovery manager (13).

### Changed
- Version identity updated to `4.3.0 (Durable Agency)` across package/runtime surfaces.
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.2.0` → `xr-4.3.0`.
- `ExecutionState` type extended with recovery-aware helpers (`wasInFlight`, `sideEffectPossible`).
- `ExecutionService` now owns `checkpoints`, `leases`, and `recovery` managers; creates
  checkpoints at each safe boundary; integrates with startup recovery.
- `ExecutionRepo` adds `findInterrupted()`, `countActive()`, `markInterrupted()` queries.
- `ExecutionServiceDeps` accepts optional `onRecoveryStatus` callback.
- All changes are additive: records without checkpoints (legacy or pre-4.3) are classified
  as `unknown_side_effect` and default to `requires_approval` — never silently auto-resumed.

### Security
- Unknown external side effects block automatic retry (reconciliation_required).
- Stale authority is never reused on resume — policy/credentials/placement revalidated.
- Environment quarantine prevents reuse of orphaned or incompletely cleaned environments.
- Durable cancellation survives restart; cancelled work is never silently resumed.
- Lease mechanism prevents duplicate concurrent execution within a workspace.
- Recovery decisions are durable and auditable.
- **Explicit limitation**: Phase 4 does not implement distributed execution, remote
  workers, or a cloud scheduler. Leases are local-only guards, not distributed consensus.

### Compatibility
- All Phase 0–3 tests remain green (682 of 684 pass; 2 sandbox-dependent tests fail
  only in containerized environments without OS namespace support).
- Existing execution/workflow/agent APIs unchanged.
- Additive schema migration — XR 4.2 records remain readable.
- No Phase 5+ capabilities (automatic model routing, memory/context redesign, mailbox,
  visual workflows, remote execution) are introduced.

## [4.2.0] - 2026-07-24 — Trust and Isolation

### Added
- **Trust & Isolation subsystem** (`src/trust/`): makes XR authority enforceable
  by risk tier. A policy decision is now bound to the authority of the
  environment that executes the action — a record saying "allowed" is no longer
  treated as sufficient.
- **Deterministic risk classifier** (`classify.ts`): maps objective action facts
  to `tier0_in_process | tier1_restricted | tier2_isolated` plus required
  fs/net/process policy, resource limits, credential mode, and approval level.
  A model cannot choose or downgrade a tier.
- **Fail-closed policy-to-placement** (`policy.ts`): Tier 0 stays in-process;
  Tier 1 uses a restricted process; Tier 2 uses a namespace sandbox or container
  and is **blocked** when no enforceable backend exists — never silently
  downgraded to in-process. Root voids restricted/isolated placement.
- **Real OS isolation backends** (`environment/`): `namespace_sandbox`
  (bubblewrap primary; raw user/mount/pid/net namespaces fallback) with a
  minimal rebuilt root, no network, stripped env, and `ulimit` cpu/mem/proc;
  `container` (Docker/Podman when present); `restricted_process` (Tier 1,
  honestly labeled process restriction, not a boundary); `in_process`.
- **Task-scoped authority grants** (`authority.ts`): bounded, TTL, revocable,
  bound to execution + workspace; stale/expired/revoked grants are rejected.
- **Credential broker** (`credentials.ts`): reference-only secrets, transient
  injection into the sandbox env, redaction of registered + generic secret
  shapes, `assertClean`, and revocation on cleanup. Raw values never enter
  records/logs/output.
- **Isolation verification** (`verify.ts`): proves actual placement matches the
  policy decision and guarantees meet the tier before execution; blocks
  otherwise (incl. Tier-2 network allowlists that local backends can't enforce).
- **Environment manager** (`environment/manager.ts`): capability detection,
  selection, execute-with-verification-and-cleanup, quarantine, health, shutdown.
- **`TrustService`** with lifecycle/health, registered under `Tokens.Trust` via
  `TrustServiceProvider` and wired into `ExecutionService`.
- **Execution-fabric integration**: `ExecutionRecord.trust` (risk, placement
  decision, authority-grant id, credential scope, resource policy, verification,
  cleanup/quarantine); `ExecuteOptions.trust`; new `Placement` kinds; trust gate
  runs after policy/approval and before the action (blocked → `denied`/`TRUST_BLOCKED`).
- **Tool wiring**: `ToolContext.runIsolated`; the `shell` tool runs in the
  namespace sandbox in the full runtime (legacy fallback when no Trust service).
- **Adapter-level risk classification** recorded on every consequential action:
  file/web/git tools (Tier 0/1), control/computer-use/browser (mapped from the
  existing safe/sensitive/destructive classifier; destructive host-authority
  actions admitted with an explicit elevated gate, not blocked).
- **MCP isolation**: high-risk (credential-bearing) **stdio** servers now run
  **inside the namespace sandbox** for their lifetime (stdio passes through
  bwrap; verified), and **fail closed** when no sandbox exists unless explicitly
  acknowledged (`XR_MCP_ALLOW_UNISOLATED=1`, warned). `XR_MCP_ISOLATE_STDIO=1`
  force-isolates low-risk servers; `XR_MCP_ISOLATED_NET=1` opts into in-sandbox
  network. HTTP/SSE servers remain egress-gated (Tier 1).
- **Plugin permission-aware risk model**: operations classified by **effective
  (granted)** permissions; hard-boundary capabilities (`shell`/`control`/
  `browser`) are Tier 2 and **membrane-blocked** (declared ≠ authority); `secrets`
  → Tier 2 mediated, `net` → Tier 1 egress-gated.
- **`requiresHostAuthority`** distinction: sandboxable high-risk work (shell/code)
  must be isolated or blocked; inherently host-bound work (GUI/browser) is
  admitted with an explicit elevated gate and never treated as low-risk.
- **Trust metadata durability**: the `trust` block round-trips through the
  execution repository (`record_json`); 4.1-shaped records still load.
- **UX**: `xr trust` CLI command (status / classify / --json), daemon
  `/api/trust` + `/api/trust/classify` routes (secret-free, token-gated), a
  **dashboard Trust & Isolation matrix card**, and a dashboard `/status` line.
- **Performance script**: `scripts/measure-trust-perf.ts` (per-tier latency).
- **Phase 3 documentation**: `docs/phase3/TRUST_ARCHITECTURE.md`,
  `PLATFORM_SUPPORT.md`, `THREAT_MODEL.md`, `MIGRATION_4.1_to_4.2.md`,
  `VALIDATION_REPORT.md`.
- **88 new tests** (deterministic classifier, fail-closed policy, authority,
  credential redaction, verification, **real-sandbox adversarial** proofs,
  end-to-end execution-fabric integration, per-tool/adapter classification,
  daemon/CLI UX, durability, and migration/rollback safety).

### Changed
- Version identity updated to `4.2.0 (Trust and Isolation)` across
  package/runtime/website surfaces.
- `EXECUTION_ADAPTER_VERSION` bumped `xr-4.1.0` → `xr-4.2.0`.
- All changes are additive: actions without `opts.trust`, and runtimes without a
  wired Trust service, behave exactly as in 4.1.

### Security
- High-risk actions can no longer rely on in-process checks alone: they execute
  inside a verified OS boundary or are blocked (fail closed).
- No ambient host authority is inherited by high-risk execution; credentials are
  scoped, injected transiently, redacted from records, and revoked on cleanup.
- Documented honest limits: Tier 1 is process restriction (not a boundary);
  sandbox network is `none` (no in-boundary allowlist); Linux-only Tier 2 in
  4.2; no claim against host-kernel 0-days.

### Documented limitations (out-of-scope / procedural, not technical blockers)
- **Cross-platform Tier-2 backends** (macOS Seatbelt / Windows AppContainer) are
  out of scope for 4.2 (local Linux isolation); those platforms **fail closed**
  for high-risk actions (see `docs/phase3/PLATFORM_SUPPORT.md`).
- **Running plugin VM code itself inside a kernel namespace** is future
  hardening; the "isolate-or-block" criterion is met via the **blocked** branch
  (the VM membrane denies raw process/GUI/web authority; declared ≠ authority).
- **Production rollback drill + human security/release owner sign-off** are
  operational steps; rollback **safety** is tested (no unsafe high-risk fallback,
  4.1 records load, fail-closed default).

## [4.1.0] - 2026-07-22 — Unified Execution Fabric

### Added
- **Canonical execution contract** (`src/execution/`): one typed lifecycle for every
  consequential action (intent → plan → policy → placement → action → observation →
  evidence/artifact → outcome).
- **Bounded state machine** (`src/execution/state-machine.ts`) validating all
  transitions deterministically, with distinct states for approval, budget block,
  cancellation, timeout, partial completion, and reconciliation.
- **`ExecutionService`** registered workspace-scoped under `Tokens.Execution` via the
  Phase 1 kernel. Coordinates policy/approval/budget, timeout, cancellation,
  retry, idempotency/caching, cost charging, and persistence without duplicating
  existing gates.
- **`ExecutionRepo`** with additive `execution_records` table (redacted/truncated
  payloads, workspace/session/workflow indexes, bounded history).
- **Adapters** for agent/model turns, core tools, control/computer actions, MCP
  tools/resources/prompts, plugin/skill operations, workflow tasks, research and
  business actions — all preserving existing `AgentResult`/`ToolResult`/
  `ActionResult` compatibility.
- **Idempotency model**: `naturally_idempotent | idempotent_with_key |
  non_idempotent | unknown_unsafe` with duplicate suppression and honest
  reconciliation for unknown side effects.
- **Cancellation/timeout/retry semantics** cooperative and honest — never silently
  retries non-idempotent actions when side effects are unknown.
- **Safe inspection** (`src/execution/inspection.ts`) and `xr execution` CLI
  command for bounded secret-free execution history.
- **Phase 2 documentation**: `docs/EXECUTION_FABRIC.md`,
  `docs/MIGRATION_GUIDE_4.0_TO_4.1.md`, validation report.

### Changed
- Version identity updated to `4.1.0 (Unified Execution Fabric)` across
  package/runtime/website surfaces.
- Workspace store migration adds `execution_records` and its indexes additively;
  no existing data is modified.
- Execution events are added to the existing audit log (correlated, not
  duplicated).

### Compatibility
- All Phase 0/1 tests remain green (546 → 577 passing with 31 new fabric tests).
- Existing agent, tool, control, MCP, plugin, skill, workflow, research, and
  business APIs are unchanged at the type level; canonical records are additive.
- Cost is charged exactly once per operation; no duplicate model/tool calls.

### Security
- Existing approval, budget, egress, audit, plugin/MCP permission gates are
  preserved — the fabric records and correlates them, never bypasses them.
- Execution records redact secrets and bound payloads; no credentials, full
  prompts, arbitrary binary data, or full browser pages are persisted.
- **Explicit limitation**: in-process execution is not a Phase 3 sandbox. Phase 3
  Trust and Isolation adds enforceable isolation for high-risk operations.

## [4.0.0] - 2026-07-22 — Runtime Kernel
- Stable XR 4.0 Runtime Kernel baseline (commit `c563ff3`); see Phase 1
  validation report.

## [3.1.6] - 2026-07-22

### Added
- **Phase 0 verified baseline artifacts** under `docs/release/3.1.6/`: source-derived inventory, support matrix, validation report, baseline measurements, release notes, release checklist, audit/design review, and rollback guide.
- **Baseline validation scripts**: `baseline:inventory`, `baseline:validate`, and `baseline:measure` for reproducible local release evidence.
- **Stable doctor JSON schema** (`schemaVersion: 1`) reporting version, environment, workspace/database status, redacted configuration, summary, and health checks.
- **Daemon health metadata**: `/api/health` now includes version, localhost binding, and auth-policy metadata for smoke validation.
- **Bun tool pin file** `.bun-version` set to `1.3.14`.

### Changed
- Version identity updated to `3.1.6 (Baseline Integrity)` across package/runtime/website surfaces.
- `xr doctor` and system status set a nonzero exit code when required baseline checks fail, while optional provider/local-runtime/browser/voice/control warnings remain non-fatal.
- Docker default command now starts `xr serve --port 7842`, matching the exposed and compose-mapped port.
- Documentation now distinguishes current verified implementation from roadmap intent, including process-local runtime, in-memory event bus, local daemon/dashboard, and security/isolation limitations.

### Compatibility
- No workspace database schema migration is introduced by 3.1.6.
- Public package name, bin name, existing CLI command names, daemon token behavior, provider configuration, memory consent behavior, budget checks, and plugin/skill/MCP compatibility are preserved.

### Known limitations
- Linux x64 with Bun 1.3.14 is the verified environment for this release artifact; macOS/Windows require separate validation before being claimed verified.
- Cloud providers, local model runtimes, browser automation, voice, and desktop control remain optional/environment-dependent.
- XR 4.0 Runtime Kernel, durable event sourcing, container/VM isolation, unified execution fabric, and enterprise control-plane architecture are explicitly deferred.

## [3.1.5] - 2026-07-09

### Added
- **Final dashboard consistency pass**: overview cards now wire real security and local-runtime data into Mission Control instead of leaving placeholder values.
- **Live chat header runtime label**: dashboard chat now reflects the active provider/model instead of static copy.
- **Expanded TUI quick commands**: added shell-friendly access patterns for `/home`, `/palette`, `/notifications`, and `/quick`.
- **Release prep notes**: final 3.1 polish workstream documented in a dedicated release note.

### Changed
- **System Status panel** now shows real provider health and real local runtime state.
- **Dashboard overview** now surfaces security score and local runtime summary from live APIs.
- **XR 3.1 polish track documentation** is now reflected in the changelog for clearer release history.

## [3.1.4] - 2026-07-09

### Added
- **Runtime & Research Cockpit Pass**: upgraded Models and Research panels into live Mission Control surfaces.
- **Local runtime APIs**: added dashboard-safe runtime inspection, selection, and smoke-test endpoints.
- **Research read APIs**: added dashboard-friendly recent/latest research endpoints and session detail fetches.
- **TUI summary ergonomics**: `/budget`, `/models`, and `/research` now provide immediate shell-side summaries.

## [3.1.3] - 2026-07-09

### Added
- **Budget & Usage Cockpit Pass**: Mission Control now includes a dedicated budget surface with spend controls, recent cost events, and provider/model usage views.
- **Budget APIs**: added backend routes for live budget/usage snapshots and dashboard-driven setting updates.

## [3.1.2] - 2026-07-09

### Added
- **Sessions Mission Control Pass**: dashboard now exposes recent sessions, execution steps, audit detail, and recent research runs as a first-class product surface.
- **Session detail APIs**: added local endpoints for session lookup, step history, and session-scoped audit inspection.

## [3.1.1] - 2026-07-09

### Added
- **Provider & Workspace Mission Control Pass**: dashboard can now create/switch workspaces and edit provider routing directly.
- **Workspace persistence**: active workspace selection now survives relaunches.

## [3.1.0] - 2026-07-09

### Added
- **Fullscreen XR shell by default**: `xr` now opens a dedicated terminal workspace instead of a lightweight help-first posture.
- **Dedicated onboarding flow**: `xr onboarding` now routes to the product onboarding experience directly.
- **Richer Mission Control backend**: overview, provider, workspace, and config surfaces now return live product state suitable for dashboard use.
- **Offline-safe website preview improvements**: local branding assets and fewer remote preview dependencies.

## [3.0.0] - 2026-07-08

### Added
- **Unified XR Kernel (`XRKernel`)**: Central dependency injection container (`Container`), event-driven backbone (`EventBus`), and sequential boot sequence coordinator (`LifecycleManager`).
- **Workspace Model (`WorkspaceManager`)**: Multi-tenant data segregation partitioning local SQLite connections and `.env` overlays under `~/.xr/workspaces/`.
- **Background Service Manager (`BackgroundServiceManager`)**: Out-of-band threat scanner (LOLBins/LOLBAS), budget governor, and memory prune loop.
- **`/api/agents` & `/api/agents/workflows/:id` Routes**: Deployed missing endpoints on the local daemon server for real-time workflow tracking on the Vercel dashboard.
- **`WorkspaceCommand`**: Implemented `xr workspace [list|create|use|delete]` commands on the CLI.

### Fixed
- **Pipeline Statistics Query Bug**: Patched SQLite syntax error in `src/business/core/pipeline.ts` won/lost calculations.
- **CI Test Suite Compatibility**: Added `XR_CONTROL_FORCE_TEST` bypass flag in `src/control/service.ts` to allow local-first dry-run test flows in sandboxed test runs.
- **Ecosystem MCPAssertion Compatibility**: Aligned boxed client strings with direct primitive comparisons.

### Changed
- Config Migration Schema updated to v12 (Voice Stack + Core OS compatibility).
