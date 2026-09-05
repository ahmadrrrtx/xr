# The XR Constitution

> **Status:** RECONSTRUCTED 2026-09 · canonical from v1.0.0
> **Authority:** This file is the canonical text of the Articles cited throughout XR's source, tests, CI gates, and ADRs.
> **Enforcement:** `bun run claim-lint` fails the build if code cites an Article that does not exist here.

---

## Preamble — why this file exists, and what it is honest about

Until Phase 5, XR cited its own founding law from nowhere.

Roughly **300 citations** across `src/`, `test/`, `scripts/`, `.github/workflows/`, and `docs/adr/` referred to "Constitution Art. IV.4", "Article XII · Rule 4", "Art. XXIII" and so on — in code comments, in CI job descriptions, in gate failure messages the user actually sees, and in every ADR's "Constitutional basis" header. A `find` for `*constitution*` returned nothing. Both independent audits flagged it (F-17): **a project whose entire brand is verifiability was citing a law that could not be read.**

This document resolves that. It is a **reconstruction**, and the distinction matters:

- **The Articles are real.** They governed this codebase for 800+ commits. Gates were built to enforce them, tests were written to prove them, and designs were rejected for violating them.
- **The original prose is lost.** It lived outside the repository.
- **This text was rebuilt from the citations themselves** — the code is the surviving evidence of the law, in the way a statute can be reconstructed from the judgments that applied it.

Every clause below carries a provenance marker:

| Marker | Meaning |
|---|---|
| **[V]** | **Verbatim** — quoted directly in a citing file. The exact original words. |
| **[R]** | **Reconstructed** — inferred from how the Article is cited and enforced. Faithful in substance; the wording is new. |

**Nothing here is invented.** Where evidence was thin, the clause says less rather than more. An Article cited only in passing gets one line, not an invented section. Being a reconstruction is not a defect to hide — it is the honest description of what this document is, and it is precisely the standard XR holds itself to everywhere else (Art. IX.4: no claim without evidence).

**Numbering note.** Roman numerals are preserved exactly as cited. Where no citation exists for an Article number (XIII, XVII, XXV, XXVI), the number is recorded as *unattested* rather than filled with invention.

---

# PART ONE — FOUNDATIONS

## Article I — Purpose *(unattested by direct citation; stated from the project's own README and SECURITY.md)*

XR is a **local-first, provider-neutral AI agent runtime** for a single user. It executes real work on a real machine under the user's authority, with their keys, their spend limits, and their audit trail. **[R]**

---

## Article II — Local-First Sovereignty

**II.1** The user's machine is the seat of authority. XR runs, and must remain fully functional, **offline**. **[R]**
*Cited: `docs/adr/0004` ("Art. II (local-first sovereignty)").*

**II.2** No feature may require a hosted control plane. Cloud services are optional accelerants, never a dependency for correctness. **[R]**

---

# PART TWO — DESIGN LAW

## Article III — One Source of Truth Per Concern

**III.2** **One source of truth per concern.** Two implementations of the same concern is a defect, not redundancy. **[V — cited verbatim as "one source of truth per concern" in `src/intelligence/routing-service.ts:4`, `src/services/planning-service.ts:4`, ADR-0002, ADR-0004, ADR-0006, ADR-0007]**

**III.4** **Effects, not transitions.** Tests and workflows assert real effects — a file written, a command executed, a row persisted — never that a state machine changed state. **[V — `test/core/envelope.test.ts:9`: *"Effects, not transitions. Tests and workflows assert real…"*; `src/core/execution/envelope.ts:132`]**

**Compliant design (III):** *"A single `ToolRegistryService` where core/plugins/skills/MCP register."* **[V — `src/tools/registry-service.ts:5`, ADR-0003]**

**Acceptance (III):** *"every surface uses the service."* **[V — `test/core/no-bypass.test.ts:5`]**

---

## Article IV — Strict Typing, Fail-Closed, No Silent Failure

**IV.2** A degraded result is reported as degraded. **Never a fake success.** **[R — `src/intelligence/degradation.ts:13`: *"never a fake success (Constitution Art. IV.2, Art. X.3)"*]**

**IV.4** **Ambiguity denies.** Where a decision is unclear — an unrecognised provider, a tool-name collision, a schema that does not validate — the runtime takes the **restrictive** branch. Fail closed, everywhere. **[V — "fail closed" / "ambiguity denies" cited in `src/intelligence/routing-service.ts:213`, `src/tools/registry-service.ts:30`, `src/runtime/trust/policy.ts:49`, `src/core/execution/envelope.ts:90`, ADR-0003, ADR-0004, ADR-0009]**

**IV.5** **Consent and measurement are never fabricated.** Approval is never inferred; a metric is never estimated and reported as measured. **[R — `src/state/migrations.ts:90` ("Migration honesty (Art. IV.5, Inviolable P5)"), `src/intelligence/behavioral.ts:7` ("recorded from OBSERVED OUTCOMES"), `docs/adr/0008:56`]**

**IV — general:** Strict typing on trust boundaries. **No `any`. No empty `catch`.** A caught error is recorded, never swallowed. **[V — `src/services/agent-service.ts:370` ("Art. IV: no empty catch"), `src/tools/registry-builder.ts:28`, `src/intelligence/router.ts:57` ("Typed end-to-end (Art. IV — no `any`)"), `docs/developer/CAPABILITY_AUTHOR_CONTRACT.md:56`]**

---

## Article V — Module Boundaries

**V.1** *"Modules map to the L0–L6 boundary table (§2.2), not to roadmap phases."* **[V — ADR-0008:5]**

**V.2** *"Dependency direction is explicit and acyclic; an architectural test enforces it."* **[V — `test/architecture/boundaries.test.ts:5`, `.github/workflows/ci.yml:432`, ADR-0005:5]**

**V.3** *"No module exceeds a defined size/complexity threshold without an owned plan to split."* **[V — `scripts/size-gate.ts:5`, `test/architecture/size-gate.test.ts:4`]**
*Enforced at 800 LOC, two-tier: over-threshold requires an owned, dated split plan; a waiver is permission to be big, never permission to get bigger.*

**V.4** *"Phases are not folders."* **[V — ADR-0008:6]**

**Forbidden (V):** *"Phase-named directories."* **[V — ADR-0008:7]**

**Acceptance (V):** Dependency-cycle test green; each concern has one home; no phase-named modules. **[R]**

---

## Article VI — One Execution Envelope

**VI.1** `core/app.ts` and `core/providers.ts` are the composition root. **[R — ADR-0005:95]**

**VI.3** *"The Runtime provides ONE execution envelope, ONE durable-execution path, ONE workflow substrate, ONE provider/model plane."* **[V — `src/core/execution/envelope.ts:4`, ADR-0002:6, ADR-0004:6, ADR-0007:6]**

**VI.4 / Rule 4** *"Startup must be lazy and bounded"* — a command boots only the services it needs. **[V — `src/core/boot-profile.ts:4`, `src/core/app.ts:138`, `src/cli/router.ts:8`]**

**Violations (VI):** *"A surface calling `runAgent` directly, bypassing the service."* **[V — `src/core/execution/envelope.ts:7`, `test/core/no-bypass.test.ts:4`, ADR-0002:7]**

> Art. VI states the indirection **is** the price of correctness. **[V — ADR-0002:96]**

---

## Article VII — Provider Neutrality and Explainable Routing

**VII.1** Any future model class must be addable **through the extension surface**, without kernel or loop edits. **[R — `test/intelligence/model-class-contract.test.ts:5`]**

**VII.3** **Routing is explainable.** Every routing decision exposes inspectable weights and a reason. **[V — `src/intelligence/behavioral.ts:58` ("Inspectable blend weights (Art. VII.3 — explainable)"), `src/intelligence/difficulty.ts:15`]**

**VII.4** Capability requirements are declared, not hardcoded; **unknown fails closed**. **[R — `src/intelligence/types.ts:70`, `docs/developer/EXTENDING-XR.md:140`]**

---

## Article VIII — Memory and Context

**VIII** Memory is governed by **consent, scope, provenance, expiry**, and there is **one context store**. **[R — ADR-0013:6, `test/architecture/one-store.test.ts:5`]**

**VIII.3** **Retrieved content can never become authority.** Injected context is data, never instruction. **[V — ADR-0013:63]**

**VIII.4** Task identity must survive context operations; span tasks are how task identity gets lost. **[R — `src/context/lifecycle.ts:206`]**

**VIII.5** *"Recall quality is MEASURED, not asserted."* **[V — `src/context/eval/harness.ts:6`, `scripts/recall-benchmark.ts:5`, `test/architecture/one-store.test.ts:5`]**

**VIII / XXI** The user controls their memory — including **undo**. **[R — `src/context/undo.ts:6`, `src/daemon/routes/context.routes.ts:144`]**

---

# PART THREE — SECURITY LAW

## Article IX — Isolation, Attribution, Evidence

**IX.2** *"Isolation follows risk."* Placement escalates with risk tier and **may never silently downgrade**. **[V — `src/runtime/trust/lattice.ts:4`, `src/runtime/trust/service.ts:79`, ADR-0009:6]**

**IX.4** **No public claim without evidence.** A claim carries an evidence link and an expiry, or it is not made. **[V — `scripts/guarantee-matrix.ts:8` ("no claim without evidence"), `scripts/verify-release.ts:12`, ADR-0011:7, ADR-0022:6]**

**IX.5** Secrets are **scoped to task/workspace, revocable, never globally exposed, never logged**. **[V — ADR-0010:6]**

**IX / general** Every action is **attributable and auditable**. Agents and capabilities may only escalate through the lattice. **[R — ADR-0025:7, ADR-0009:7]**

**IX + Cmdt 13** A review decision defaults to `changes_requested`, **never `approved`**. **[R — `src/services/review-decision.ts:28`]**

---

## Article X — Honest Degradation

**X.1** **Honesty at the boundary of capability.** A canary that cannot reach or authenticate a candidate reports *unreachable*, not *failed* and not *passed*. **[V — `src/providers/model-switch.ts:16` ("HONESTY (Art. X · 1)")]**

**X.3** A degraded path must name **a concrete repair path for the operator**, and destructive decisions require confirmation. **[V — `src/intelligence/degradation.ts:145`, `src/context/cli-phase6.ts:98`]**

**X** Conformance is never claimed from automated checks alone (e.g. WCAG 2.2 AA requires the manual half). **[V — ADR-0019:10, `.github/workflows/ci.yml:486`]**

---

## Article XI — API Contracts

**XI** The published contract must not drift from what the daemon actually serves; **experimental is never implied stable**. **[V — `src/daemon/routes/contract.ts:10,64`]**

---

## Article XII — Performance Is a Contract

**XII · Mandatory Rule 1** *"`--version`/`--help` p95 < 150 ms warm / < 300 ms cold."* **[V — `scripts/perf/budgets.json:5`, `test/perf/startup-latency.test.ts:10`]**

**XII · Mandatory Rule 2** *"No perf claim without a budget and a regression gate."* Every published number is a measurement. **[V — `scripts/perf/budgets.json:5`, `scripts/perf/harness.ts:24`, `.github/workflows/ci.yml:538`]**

**XII · Rule 3** Resources are **bounded** — buffers, line counts, retries have explicit ceilings. **[V — `src/providers/stream-metrics.ts:56` ("bounded resource (Article XII · Rule 3)")]**

**XII · Rule 4** *"No synchronous I/O on hot paths; event-loop stalls…"* **[V — `src/core/stall-detector.ts:4`, `scripts/hot-path-lint.ts:5`, `src/core/app.ts:145`]**

**Forbidden (XII):** *"Eager-importing the whole service graph."* **[V — `src/core/provider-modules.ts:7`]**

**Retrieval budget:** p95 < 100 ms at 100k items. **[V — ADR-0013:8, `scripts/recall-benchmark.ts:63`]**

*Budgets are absolute ceilings, never scaled to the host.* **[V — `scripts/perf-gate.ts:28`, `scripts/profile-gate.ts:31`]**

---

## Article XIV — Untrusted Code Is Isolated

**XIV.1** Untrusted code is isolated. **[V — ADR-0010:7]**

**XIV.3** Derived evidence (e.g. a provenance graph) is **never a second registry**. **[V — ADR-0014:26, `src/platform/capabilities/provenance.ts:7`]**

**XIV / XV** **Runtime semantics are never unified away.** Registration and discovery may be unified; a core tool and a plugin tool remain semantically distinct. **[V — `src/tools/registry-types.ts:29`, `src/tools/registry-service.ts:36`]**

**XIV** Trust is fail-closed: signatures and provenance, never popularity. **[V — `src/platform/capabilities/trust.ts:175`]**

---

## Article XV — Capabilities and Skills

**XV.2** **Counts are honest.** A capability is typed, and typing is what keeps counts honest. **[V — `src/commands/skills.ts:113`, `docs/developer/PUBLISH_A_CAPABILITY.md:80`]**

**XV.3** **MCP is a first-class governed boundary**, not a trusted peer. **[V — `src/mcp/allowlist.ts:4`]**

**XV.4** Marketplace trust = **signatures + provenance**. **[V — `src/platform/capabilities/trust.ts:4`]**

**XV** Skills are typed, surface-universal capabilities. **Wildcard tool allow-lists are refused at install.** **[V — `src/skills/tool-allowlist.ts:4,47`, `docs/developer/PUBLISH_A_CAPABILITY.md:12`]**

---

## Article XVI — Enterprise and Business Are Governed Extensions

**XVI** The kernel holds **only a thin contract**; Business OS is a **governed extension**, and enterprise is **operated controls + evidence with local autonomy preserved**. Scope creep as facade is forbidden. **[V — `src/core/business-l0.ts:4`, `src/core/providers/business.ts:5`, ADR-0016:7, ADR-0024:6,61]**

> **Phase 5 note.** The extraction of `src/enterprise` and `extensions/business-os` into satellite packages (ADR-0028) is the strongest available reading of this Article: the kernel now holds the L0 contract and nothing else.

---

# PART FOUR — CHANGE LAW

## Article XVIII — Stability Is Demonstrated

**XVIII** *"Breaking changes require a deprecation cycle; silent breaks are defects."* Stability is demonstrated, not promised. **[V — `scripts/api-compat.ts:9`, ADR-0017:10]**

---

## Article XIX — Documentation Is Source-Accurate

**XIX.1** *"Documentation is source-accurate and every claim carries an evidence link."* **[V — `scripts/claim-lint.ts:5`, `scripts/release-manifest.ts:107`]**

**XIX / XXII** Releases are **evidence-bound**: no release without a changelog entry. **[V — `scripts/changelog.ts:189`]**

---

## Article XX — Tests Assert Effects

**XX.1** *"Tests assert effects, not transitions."* **[V — `test/phase0/credential-vault.test.ts:4`, `test/phase0/workflow-effects.test.ts:4`, `src/execution/workflow/engine.ts:881`]**

**XX.3** Mutation testing is a required gate. **[R — `docs/historical/phases/phase-0/GAP_ANALYSIS_AND_DESIGN.md:59`]**

**XX.4** *"Supported means validated"* — each supported OS runs typecheck plus its full suite in CI. **[V — `scripts/platform-parity.ts:5`]**

**XX.5** **No silent skips.** A skipped test requires a recorded reason; a test can never vanish silently. **[V — `scripts/platform-parity.ts:109`, `.github/workflows/cross-platform.yml:11,85`]**

---

## Article XXI — Privacy Is Non-Negotiable

**XXI** Telemetry is **opt-in**, consent is explicit, and local-first knowledge works **fully offline**. **[V — `src/observability/config.ts:4` ("Article XXI (non-negotiable)"), `src/commands/telemetry.ts:6`, ADR-0013:9]**

**XXI.3** Metric **cardinality is budgeted**; every label value passes a check. **[V — `src/observability/metrics.ts:4`]**

**XXI** Observability records **structure only** — kind, name, ids, outcome — **never payloads**. **[V — `src/execution/service.ts:375`, `src/daemon/server.ts:353`, `src/observability/redaction.ts:2`]**

**XXI.4** Sensitive work never silently routes to a non-local provider. **[V — `test/intelligence/locality-v5.test.ts:4`]**

---

## Article XXII — Release Identity

**XXII.1** *"One release manifest stamps version across every surface."* **[V — `src/core/version.ts:7`, `scripts/release-manifest.ts:6,283`]**

**XXII.2** Version identity must be valid semver. **[V — `scripts/release-manifest.ts:92`]**

**XXII.3** Releases are **signed and reproducible**: SBOM, SLSA provenance, checksums, signatures. **[V — ADR-0011:6, ADR-0022:6, `src/update/channels.ts:181`]**

**XXII.4** *"No release label — complete/certified/enterprise/supreme — without a matching evidenced claim."* A prerelease can never wear a "stable" label. Claims expire. **[V — `scripts/claim-lint.ts:7,63,155,232`, `scripts/release-manifest.ts:99,109`]**

**XXII.5** **One canonical build, many channels.** Channel drift is forbidden. **[V — `scripts/channel-manifest.ts:3,264,307`, ADR-0023:6, `.github/workflows/release.yml:3`]**

---

## Article XXIII — Reversibility

**XXIII** **Every migration is reversible, with no silent loss.** A downgraded database must remain readable by code that does not know about the newer schema. Existing explicit user values are preserved untouched. No user is left without a rollback path. **[V — `src/config/config.ts:700`, `src/integrations/credentials.ts:36,174`, `src/state/migrations.ts:9,78`, `src/update/channels.ts:253`, `test/state/memory-to-context-migration.test.ts:263`]**

---

## Article XXIV — Deletion Budget

**XXIV** Additive change carries a **deletion budget**: subtraction is a first-class outcome, and moving a concern out of core satisfies it. **[R — ADR-0016:43 ("Art. XXIV deletion budget satisfied by the move")]**

> **Phase 5 note.** Phase 5 is almost entirely an Art. XXIV exercise: −23,684 LOC from core with zero enforcement removed.

---

## Article XXVII — Deprecation Cycle

**XXVII** *"Announce → warn → migrate → remove."* No stable surface is broken without a deprecation path and a dated removal. **[V — `src/services/agent-service.ts:12`, `src/daemon/routes/contract.ts:92`, `src/commands/hygiene.ts:15`, `src/commands/satellite-shims.ts:9`, ADR-0002:66, ADR-0006:9]**

---

# PART FIVE — PROJECT LAW

## Article XXVIII — Contribution Standards

**XXVIII** Contribution standards are defined and enforced. **[R — ADR-0026:7]**

## Article XXIX — Open Governance

**XXIX** Open governance, **vendor neutrality**, and **verifiable done**. **[V — ADR-0026:7, ADR-0023:7]**

**XXIX.1** **No cloud-only lock-in.** **[V — ADR-0026:37]**

## Article XXX — Decade-Scale Evolution

**XXX** XR is built to evolve over a decade; local mode stays **complete and sovereign**. **[V — ADR-0026:8, ADR-0024:34]**

---

# THE COMMANDMENTS

Cited alongside the Articles as terse operational rules.

| # | Commandment | Provenance |
|---|---|---|
| **2** | **No success without a verified effect.** An absent tool is honest; a lying tool is not. | **[V]** `src/install/baseline-status.ts` ("Commandment 2 — no success without a verified effect"), `src/computer/system-control.ts:18,49` |
| **4** | Every action is attributable. | **[R]** ADR-0025:8 |
| **6** | **One source of truth per concern.** | **[V]** ADR-0005:7, `scripts/release-manifest.ts:6` |
| **11** | **Startup is lazy and bounded.** | **[V]** `src/core/boot-profile.ts:4`, `src/cli/router.ts:8` |
| **13** | Default to the restrictive decision; never bind to a public interface by default. | **[R]** `src/daemon/server.ts:77`, `src/services/review-decision.ts:28` |

**Inviolable P5** — *Authority is never granted by inference; consent is never fabricated.* **[V — ADR-0004:7, ADR-0006:8]**
**Inviolable P6** — *Subtraction before addition.* **[R — ADR-0005:7]**

---

## Unattested Article numbers

No citation exists anywhere in the repository for **Articles XIII, XVII, XXV, XXVI**. They are deliberately left blank rather than invented. If the original text is recovered, they can be restored here without renumbering anything.

---

## Amendment procedure

1. An amendment is an **ADR** in `docs/adr/` naming the Article it changes.
2. The change lands in this file **in the same PR** as the code that relies on it.
3. `claim-lint` enforces that every Article cited in the tree exists here.
4. Articles are **never renumbered** — a repealed Article is marked repealed and kept.

---

*Reconstructed 2026-09 during Phase 5 (Scope Shrink & Naming Truth), from ~300 citations across `src/`, `test/`, `scripts/`, `.github/`, and `docs/adr/`. Provenance evidence: `docs/historical/phase-5/article-citations.txt`.*
