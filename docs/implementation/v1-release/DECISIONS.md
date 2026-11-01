# XR v1 — Decision Log

**Rule:** every decision that changes scope, ordering, architecture or governance gets an
entry here *before* it is executed. Decisions are never deleted; they are superseded.
`APPROVED` means the Plan Owner has authority to proceed; `OWNER-REQUIRED` means the
repository owner (`@ahmadrrrtx`) must approve because the decision touches protected
engineering governance, release identity, or legal/compliance surfaces.

**Status values:** `PROPOSED` · `APPROVED` · `OWNER-REQUIRED` · `REJECTED` · `SUPERSEDED`.

---

## D-001 — Enable branch protection with required checks on `main`

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | **Corrected 2026-11-01.** This entry originally claimed `main` was unprotected. It is **not**: ruleset `main protection` (id 19119579) is active and rejects direct pushes (`E-32`, `E-33`). The real problem is depth — `required_approving_review_count: 0`, `require_code_owner_review: false`, one required check (`Quality Gate`, duplicated), no native-lane checks, `strict_required_status_checks_policy: false`. |
| Options considered | (a) Leave as-is and rely on discipline. (b) Enable protection with the real check names as required, require review on `CODEOWNERS` paths, disallow bypass. (c) Enable protection but allow admin bypass. |
| Decision | **(b), amended to "deepen the existing ruleset"**: set required approvals ≥1, enable `require_code_owner_review`, add `Cross-Platform gate` and `Desktop gate` once green, de-duplicate the `Quality Gate` entry, keep `bypass_actors: []`, keep deletion/force-push blocked (already in force). |
| Reasoning | The platform layer already blocks the worst case (direct pushes). What remains is review depth: with 0 approvals and no code-owner review, a single actor can open and merge their own PR in one step, which defeats `CODEOWNERS` while technically satisfying the rule. (a) leaves that hole; (c) re-opens the bypass hole. |
| Trade-offs | Requiring approvals costs one extra human step per PR — acceptable and intended. Adding the native lanes as required while they are **red** (`E-14`) would block all merges, so they are added at `XR-P09` (D-006), not now. |
| Affected components | Repository settings, `.github/workflows/*` (names only, content untouched), `CODEOWNERS`, `test/quarantine.json`. |
| Approval | **OWNER-REQUIRED** |
| Revision history | R1 2026-11-01 proposed. |

> **Known operational consequence to resolve at approval time:** because two native lanes
> are red at `6b9cb599`, enabling (b) *exactly as listed* will block merges. The owner must
> choose one at approval: **(i)** require the full set now and treat the red lanes as the
> first work item (this plan's recommendation, `XR-P09` scope pulled forward), or
> **(ii)** require the currently-green set now (CI/Core, Supply Chain, Channel Install,
> Clean-Machine, npm Pack Smoke, Workflow Audit) and add Cross-Platform + Desktop App to
> the required set at `XR-P09`. Either is acceptable; **(ii)** is the safer bootstrap and
> is what the phase prompt will assume unless the owner says otherwise (see D-006).

---

## D-002 — Platform tiering for v1

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | No Windows or macOS evidence exists in the audit environment (`E-01`); the audit forbids claiming parity. |
| Options | (a) Claim all three platforms. (b) Tier: Linux x64 `Verified` target; Windows/macOS `Limited` unless native evidence lands; ARM64/WSL/container `Experimental`. (c) Support Linux only. |
| Decision | **(b)**. |
| Reasoning | Matches the evidence actually obtainable; keeps Windows/macOS in scope without lying; consistent with `docs/release/1.1.1-rc.1/known-limitations.md`, which already says these are `BLOCKED/NOT RUN`. |
| Trade-offs | Commercial reach is smaller at first release; must be stated plainly in release notes. |
| Affected | `docs/release/SUPPORT_MATRIX.md`, `docs/release/DESKTOP-SUPPORT-MATRIX.md`, release notes, README. |
| Approval | **OWNER-REQUIRED** (public-facing claim) |
| Revision | R1 2026-11-01 proposed. |

---

## D-003 — Release channel state and `1.1.1-rc.1`

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `release.manifest.json` declares `publicVersion 1.0.0`, identity `1.1.1-rc.1`, and `v1.1.0` as a *withdrawn* tag — yet GitHub serves `v1.1.0` as a normal, non-prerelease release with 5 unsigned assets (`E-17`). The manifest's disclosure is accurate; the channel state is inconsistent. |
| Options | (a) Repair the `v1.1.0` release to prerelease/withdrawn now. (b) Leave it and fix the channel during the next publication. (c) Promote `1.1.1-rc.1` to the public channel. |
| Decision | **(b)** for this plan; **(c) explicitly rejected**. Repairing an existing public release is an owner action, and promotion is forbidden until `XR-P09` passes with real evidence. |
| Reasoning | This plan is code-and-evidence work; mutating published releases mid-plan would destroy the audit trail the plan depends on. |
| Trade-offs | The inconsistency persists during the plan and must be disclosed in the limitations register. |
| Affected | `release.manifest.json` (owner edit only), `docs/release/CHANNELS.md`, release notes. |
| Approval | **OWNER-REQUIRED** for any change; the *decision to defer* is `APPROVED` as plan scope. |
| Revision | R1 2026-11-01. |

---

## D-004 — Consent, privacy notice and data-flow document

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | No terms/privacy/EULA document exists anywhere (`docs/privacy/` holds only `MEMORY.md`), and onboarding has no acceptance step (`E-21`). `XR-P02` cannot honestly implement consent without an owner-authored or owner-approved document. |
| Options | (a) Have the implementing agent write the legal text. (b) Owner supplies the documents; the phase implements display, versioning and persistence only. (c) Defer consent past v1. |
| Decision | **(b)**. The phase must not invent legal text. Until the owner supplies it, `XR-P02`'s consent sub-task is `BLOCKED` while the rest of `XR-P02` proceeds. |
| Reasoning | An agent-invented privacy promise is precisely the "claim without evidence" failure the audit condemns. |
| Trade-offs | `XR-P02` may complete partially; consent is a v1 gate, so `XR-P09` cannot pass without it. |
| Affected | `docs/privacy/**` (new), `desktop/src/screens/Onboarding/StepPromise*`, `desktop/src/screens/Settings`. |
| Required content (minimum) | Plain-language statement that XR is local-first but **cloud providers receive whatever prompt/context is sent to them**; what is stored locally and where (`~/.xr-desktop`); what telemetry exists (verify: none by default); how to delete/export data; document version identifier. |
| Approval | **OWNER-REQUIRED** |
| Revision | R1 2026-11-01. |

---

## D-005 — Plan precedence over the four pre-existing planning regimes

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `docs/IMPLEMENTATION-PLAN.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/implementation/*` (12 files) and `docs/release/V1-RELEASE-LEDGER-2026-10-28.md` all describe phase systems (`XRD-009`). A fresh agent given "follow the plan" would find four. |
| Options | (a) Delete the older documents. (b) Declare this plan authoritative for *this* release effort, add a one-line precedence banner to each older doc, and keep them as historical records. (c) Leave all four in place. |
| Decision | **(b)**. |
| Reasoning | History is evidence (Rule E: "never delete an unsuccessful attempt"); but one authority must be unambiguous. |
| Trade-offs | Five documents remain on disk; a reader must follow the banner. Acceptable. |
| Affected | `MASTER_PLAN.md` (this set), the four prior documents (one banner line each, no content deleted). |
| Approval | **APPROVED** (plan scope; no governance file modified) |
| Revision | R1 2026-11-01. |

---

## D-006 — Required-check set for the bootstrap of protection

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | Which exact checks become *required* on `main` at `XR-P00`, given two are red (`E-14`)? |
| Options | (i) Full set including the currently red Cross-Platform and Desktop App. (ii) Currently-green set now; add the two red lanes at `XR-P09` when they are green. |
| Decision | **(ii)** as the default; the owner may override to (i). |
| Reasoning | Enabling protection is the priority; blocking all merges on a pre-existing red lane would stall the very phases that must fix it. The red lanes are then added as a **hard** requirement before the release gate, so the weakness has a deadline — the same discipline as `test/quarantine.json`'s expiry rule. |
| Trade-offs | Between `XR-P00` and `XR-P09` the two native lanes are not merge-blocking. Mitigation: `XR-P09` cannot be `ACCEPTED` while they are red, and `PHASE_STATUS.md` records the outstanding obligation. |
| Affected | Repository settings; `PHASE_LEDGER.md`. |
| Approval | **OWNER-REQUIRED** (part of D-001) |
| Revision | R1 2026-11-01. |

---

## D-007 — Additive-only migrations during v1

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `XR-P03` (settings shape) and `XR-P06` (artifact table) both need persistence changes; the audit forbids destructive migration without backup/rollback. |
| Options | (a) Rewrite tables. (b) Additive migrations + one-way read-compat for one release + reuse `data_safety.rs`'s backup mechanism. |
| Decision | **(b)**. No `DROP`, no in-place type change, no data rewrite without a `snapshot_db` (VACUUM INTO) taken beforehand. |
| Reasoning | `data_safety.rs` already provides integrity checks, consistent snapshots and import backups; destructive migration buys nothing. |
| Trade-offs | Orphan rows are possible on rollback (harmless); dead code may linger for a release. |
| Affected | `src/state/migrations.ts`, `desktop/src-tauri/src/data_safety.rs`, settings store. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-008 — Engine readiness state vocabulary

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | The renderer currently has `unknown|checking|up|down|unauthorized` (`engineStore.ts:33`) while the plan (and the audit) require user-meaningful states including `degraded`. |
| Options | (a) Keep the current set. (b) Adopt `starting | ready | degraded | disconnected | failed(reason)` and map the old values onto them. |
| Decision | **(b)**, with `unauthorized` preserved as a distinct `failed` reason (session rejection is not a crash). |
| Reasoning | The audit's requirement (show *why*) is only satisfiable if `degraded` exists; the current binary up/down cannot express "connected but incompatible". |
| Trade-offs | Touches every consumer of `engineStore.status`; must be done in one phase with a mapping table and tests. |
| Affected | `desktop/src/stores/engineStore.ts`, `components/engine/EngineDownBanner.tsx`, all `status ===` call-sites. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-009 — Onboarding resumability scope

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `XR-P02` must make onboarding resumable; "resumable" can mean anything from "don't restart at step 1" to "resume a partial model download". |
| Options | (a) Per-step checkpoint only. (b) Per-step checkpoint + resumable download. |
| Decision | **(a)** for v1: persist step completion and user choices; a mid-download interruption restarts the download (with a clear message), because Ollama's pull API, not XR, controls partial-blob resumption. |
| Reasoning | Scope discipline: (b) would require owning Ollama's download semantics — an unbounded dependency. |
| Trade-offs | A user re-downloads after a crash; disclosed in the UI. |
| Affected | `desktop/src/stores/onboarding.ts`, `StepDownload.tsx`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-010 — Voice preview policy

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | The wizard previews with the **OS Web Speech** engine while persisting a **Piper** voice id (`E-21`) — the user hears a different voice from the one configured. |
| Options | (a) Preview via the engine's Piper TTS endpoint. (b) Keep Web Speech but label it explicitly as an approximation. |
| Decision | **(a) preferred, (b) as an honest fallback**, decided by what the engine exposes at implementation time. If no engine TTS synthesis endpoint exists for a pre-download voice, the label must say *"approximation — the configured voice is synthesised by XR's engine on this device"* and the failure path must be visible. |
| Reasoning | The confirmed defect is the **substitution**, not the browser API. Either option removes the dishonesty; (a) is better UX. |
| Trade-offs | (a) may require Piper weights before a user has downloaded any model (adds setup weight); (b) leaves a small UX gap but no lie. |
| Affected | `desktop/src/screens/Onboarding/StepVoice.tsx`, `src/voice/{tts,models}.ts`, possibly a daemon route. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-011 — Ownership of the configured-provider set

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | Configured providers live in the desktop settings store while the engine holds the credentials and the preset catalog (`E-22`). Which is authoritative? |
| Options | (a) Engine owns configured connections; desktop renders them. (b) Desktop owns them and pushes to the engine. (c) Both, synchronised. |
| Decision | **(a)**. `settingsStore.models.providers` is reduced to defaults (capability → model) with a one-way migration. |
| Reasoning | The engine is the only process that can authenticate, discover models and hold secrets; a desktop-owned list is a second truth by construction. (c) is the current de-facto state and is the cause of the symptom. |
| Trade-offs | Requires an engine-side representation of "configured" (may already exist in `providers/custom.ts` + health cache); a settings migration must be reversible for one release. |
| Affected | `src/providers/*`, `providers.routes.ts`, `contract.ts`, `desktop/src/engine/*`, `settingsStore.ts`, both Models screens. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-012 — Convergence of the two Models screens

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `screens/Settings/tabs/ModelsTab.tsx` (639 lines, engine-catalog-driven) and `screens/Budget/components/ModelsTab.tsx` (621 lines, price-registry-driven) both write the same settings key (`E-22`). |
| Options | (a) Delete the Budget one. (b) Extract a shared core; both screens become thin views over it. (c) Leave both. |
| Decision | **(b)**. Deletion is forbidden (the Budget view carries price/context chips the Settings view lacks). |
| Reasoning | Removing user-visible capability to reduce code is a regression; two writers is the actual defect. |
| Trade-offs | Highest blast radius in the plan; requires behaviour-parity tests written **before** extraction, and a no-visual-change rule. |
| Affected | Both screens + a new shared module + `test/desktop/`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-013 — Demo/seed data policy

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | Demo data was removed from release builds; two dev seams remain (`VITE_XR_DEMO_DATA`, `localStorage['xr.dev.mockLLM']`) and `brain/demo.ts` falls back to a canned run when no provider answers. What remains permitted? |
| Options | (a) Remove all demo paths. (b) Keep dev seams (debug-only), keep the **labelled** no-model demo run, and pin all three with gates. |
| Decision | **(b)**. The labelled fallback is genuinely useful for a user with no provider and is honest; the dev seams are already gated. |
| Reasoning | Removing the labelled fallback would leave an empty Brain screen with no explanation. |
| Trade-offs | Three code paths must stay gated; the widening gate in `XR-P04` must encode exactly this permission. |
| Affected | `desktop/src/lib/llm.ts`, `budget/api.ts`, `brain/demo.ts`, `scripts/desktop-seed-gate.ts`, `scripts/placeholder-lint.ts`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-014 — Permission surface scope

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | How much of the capability plane should v1 expose in one surface? |
| Options | (a) Full policy editor. (b) Read-effective-policy + grant/revoke + approval history + emergency stop. |
| Decision | **(b)**. No policy *authoring* beyond the existing grant API. |
| Reasoning | The enforcement engine is correct and tested; the gap is visibility and scoped grants. An editor invites users to weaken fail-closed defaults. |
| Trade-offs | Advanced users cannot express arbitrary rules; acceptable for v1. |
| Affected | `desktop/src/screens/Shield/**`, `capabilities.*` routes. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-015 — Artifact storage and naming

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `ArtifactRecord` needs a stable identity and path policy. |
| Options | (a) Absolute paths. (b) Workspace-relative paths + a workspace id, canonicalised at read time. |
| Decision | **(b)**. Absolute external paths are recorded only as `external: true` and are never opened through the inert-type allow-list. |
| Reasoning | Absolute paths break on workspace moves and invite traversal; `reveal_policy.rs` already refuses non-XR-owned roots. |
| Trade-offs | Moving a workspace invalidates records unless re-rooted (mitigate: reconcile on workspace open). |
| Affected | `src/state/migrations.ts`, artifact route, `desktop/src/screens/Artifacts/**`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-016 — Artifact preview safety

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | Rendering model-generated Markdown/HTML in a webview is an injection surface. |
| Options | (a) Render with raw HTML allowed. (b) Sanitise + sandbox; never execute scripts; MIME from content sniff + extension allow-list. |
| Decision | **(b)**. `desktop:sink-lint` must remain green with no new exception without a written reason. |
| Reasoning | Generated HTML/JS is the classic artifact XSS vector; the repo already forbids raw HTML sinks. |
| Trade-offs | Some HTML previews render degraded (shown as source instead) — acceptable and disclosed. |
| Affected | `desktop/src/screens/Chat/**`, `screens/Artifacts/**`, `scripts/desktop-sink-lint.ts`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-017 — Automations scope for v1

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | The scheduler exists and is unreachable; a full automation product is large. |
| Options | (a) Full product (triggers, webhooks, notifications, templates). (b) Surface over existing `triggers.*` with pause-all, budget ceiling, approval gating and history. |
| Decision | **(b)**; (a) is deferred. |
| Reasoning | Composition and safety first; feature breadth is not a release gate. |
| Trade-offs | Limited trigger types in v1 (already limited in `trigger-spec.ts`). |
| Affected | Automations screen + `test/automation/`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-018 — Test-baseline stamping

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `README.md:594` publishes `4,972 pass / 450 files` while the measured baseline is `5,119 / 473` (`E-19`). The refresh is manual today. |
| Options | (a) Manual refresh, documented. (b) Generate the line from `docs/release/TEST-BASELINE.json` and fail a gate on mismatch. |
| Decision | **(b)**. |
| Reasoning | A hand-maintained published number will drift again; the repo already has a stamping precedent (`release:stamp`, generated OpenAPI/client, `changelog`). |
| Trade-offs | Requires the measurement to be recorded in a canonical JSON (`TEST-BASELINE.json`) as part of the gate sequence. |
| Affected | `README.md` (stamped region — never hand-edited), `docs/release/TEST-BASELINE.json`, `scripts/*`, `package.json`. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-019 — Preview vs. stable publication

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | What may actually be published after `XR-P09`? |
| Options | (a) Promote `1.1.1-rc.1` to stable/public channels. (b) Limited developer preview, Linux x64 `Verified`, everything else tiered, no channel promotion. (c) No publication. |
| Decision | **(b)**. Promotion to *stable* requires Windows/macOS evidence and signing material that do not exist — that is a later decision, not this plan's. |
| Reasoning | `RELEASE_CANDIDATE_REPORT.md:16` already says "NOT READY for public preview or stable publication"; this plan's job is to change that sentence **only** with evidence. |
| Trade-offs | Slower public launch; matches the honesty objective. |
| Affected | Release notes, `release.manifest.json` (owner), `docs/release/CHANNELS.md`. |
| Approval | **OWNER-REQUIRED** |
| Revision | R1 2026-11-01. |

---

## D-020 — Sequencing of `changelog:check` (documented battery vs. release workflow)

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `AGENTS.md` mandates `bun run ci` as the pre-PR battery and includes `changelog:check`; that gate exits 1 at the verified commit because no `CHANGELOG.md` entry exists for `1.1.1-rc.1`, and the entry is only generated by `release.yml` at release time (`E-27`). A contributor following the documented rule is blocked; a contributor ignoring it lands work that seven other ungated checks would also have blocked. |
| Options | (a) Generate a `1.1.1-rc.1` changelog entry now so the battery passes. (b) Remove `changelog:check` from the `ci` script and keep it release-only. (c) Keep it in `ci` and also run it in a workflow. |
| Decision | **(a)** as the target state — a real generated entry, produced by the generator (`bun run changelog:generate`), never hand-written. If the owner prefers the gate to be release-only, then **(b)** must be recorded as an explicit re-scope in `AGENTS.md`'s command table (owner approval, because `AGENTS.md` is protected), **not** silently dropped. **(c)** is rejected for `1.1.1-rc.1` because it would make `main` permanently red until the identity changes. |
| Reasoning | The invariant worth protecting is "the documented battery is runnable and green". Either satisfying it (a) or re-scoping it in writing (b) achieves that; leaving the contradiction in place does not. |
| Trade-offs | (a) writes a changelog entry for an unpublished identity — harmless and reversible; (b) reduces pre-merge coverage of changelog hygiene. |
| Affected | `CHANGELOG.md`, `scripts/changelog.ts`, `package.json` (`ci` script), `AGENTS.md` (only under option b, owner-approved). |
| Approval | **OWNER-REQUIRED** (touches `AGENTS.md` under option b; touches release-evidence surfaces under option a) |
| Revision | R1 2026-11-01. |

---

## D-021 — Wiring the seven unenforced gates into CI

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | `placeholder-lint`, `desktop:sink-lint`, `ci-capability-gate`, `website:marketplace:check` (and `changelog:check`, D-020) are described as CI-enforced but are invoked by no workflow (`E-27`, corrected by `E-29`). Two gates originally listed here — `platform:parity:check` and `ownership:check` — are in fact enforced under different command forms and are **not** in scope. |
| Options | (a) Wire all of them into `ci.yml` as required checks. (b) Wire them as non-blocking (report-only). (c) Leave them as local-only gates and correct `AGENTS.md`'s wording. |
| Decision | **(a)**, with one exception: any gate whose runtime would materially lengthen the PR lane may start as report-only for at most one release, recorded with an expiry in the same style as `test/quarantine.json`. |
| Reasoning | These gates protect real invariants — `desktop:sink-lint` is the only automated defence against raw HTML/`eval` sinks in the renderer, which `XR-P06` will exercise; `platform:parity:check` is the "one computation authority" file-distribution check; `ownership:check` guards the generated ownership map. Making them report-only by default (b) would reproduce the current defect with extra steps. |
| Trade-offs | Slower PR lane; possible immediate reds (all six pass at HEAD, so risk is low). |
| Affected | `.github/workflows/ci.yml`, `package.json`, `test/architecture/` (new gate-inventory test). |
| Approval | **APPROVED** (adds enforcement; weakens nothing). The workflow file is `CODEOWNERS`-protected, so the change requires the owner's review — the intended friction. Each wired gate must also be added to `quality-gate`'s `needs:` list, otherwise the aggregate would pass while the new jobs fail (`E-30`). |
| Revision | R1 2026-11-01. |

---

## D-022 — Required-check context set named by branch protection

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | D-001/D-006 said "the real check names" without naming them. `ci.yml` already contains an aggregate `Quality Gate` whose comment instructs the owner to make it a required check, and `cross-platform.yml`/`desktop-app.yml` have equivalent aggregates (`E-30`, `E-31`). |
| Options | (a) Require every individual job (40+ contexts). (b) Require the three **aggregate** gates (`Quality Gate`, `Cross-Platform gate`, `Desktop gate`) + `Supply Chain`. (c) Require only `Quality Gate`. |
| Decision | **(b)**. Individual jobs stay non-required; the aggregates are the contract. `Cross-Platform gate` and `Desktop gate` are **currently red** (`E-14`), so per D-006 they are added to the required set at `XR-P09` once green — until then the required set is `Quality Gate` + `Supply Chain` + the already-green lanes (`Channel Install Tests`, `Clean-Machine Journey`, `npm Pack Smoke`, `Workflow Audit`). |
| Reasoning | Aggregate gates already assert their upstreams (`if: always()` + "every required job succeeded"), so requiring them is equivalent to requiring 17 jobs with one maintenance surface. Requiring all individual jobs would need editing on every job addition — a new drift source. |
| Trade-offs | A single aggregate name is a coarser signal in the PR UI; the failing job is still visible in the run. |
| Affected | Repository branch protection settings; `PHASE_STATUS.md` obligations. |
| Approval | **OWNER-REQUIRED** (part of D-001) |
| Revision | R1 2026-11-01. |

---

## D-023 — How required-check context names are asserted (and the endpoint trap)

| Field | Value |
|---|---|
| Date | 2026-11-01 |
| Problem | Verification of governance state used `GET /repos/{owner}/{repo}/branches/main`, which returned `protected: false` while an **active ruleset** was in force. That produced a wrong finding (`XRD-006` as first written), a wrong Tier-0 ranking, and a phase prompt that told an executor to "enable protection". Discovered only when a real `git push origin main` was rejected with `GH013` (`E-33`). |
| Options | (a) Keep using the branches endpoint and note the caveat. (b) Require **all three** signals before any governance claim: `GET /rulesets`, `GET /rulesets/{id}`, and an actual push/merge attempt. |
| Decision | **(b)**. Any phase that asserts a governance rule is in force must record: the ruleset list, the full rule parameters, and a behavioural proof (a rejected push or a blocked merge). A settings read alone is never sufficient. |
| Reasoning | The two APIs report different subsystems, and a claim about enforcement is a claim about *behaviour*; only behaviour can verify it. This mirrors `AGENTS.md` rule 1 ("claims need evidence") applied to governance claims themselves. |
| Trade-offs | Slightly more work per governance check; a push attempt must be made against a scratch ref, never `main`'s history. |
| Affected | `XR-P00` preflight and acceptance (`P00-AC1`, `P00-AC2`), `EVIDENCE_LOG.md` method notes, this plan's own verification habits. |
| Approval | **APPROVED** |
| Revision | R1 2026-11-01. |

---

## D-024 — `XR-P00` acceptance ruling (repo half) and the boundary of what acceptance may unlock

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Problem | `XR-P00` is `IMPLEMENTATION_REPORTED`. The Plan Owner must rule on it. The phase has two halves: an **in-repo** half (wired gates + a gate-enforcement test + no scope violation) and an **owner-actions** half (deepen ruleset `19119579`; resolve D-020). Ruling "accept" or "reject" wholesale is wrong in both directions: rejecting the repo half discards verified, correct work; accepting the owner half would mark a governance control as in force while `E-37` shows a PR merged with **zero reviews**. |
| Options | (a) `ACCEPTED` outright. (b) `FAILED` (owner items unmet). (c) **Split ruling**: `VERIFIED — IN-REPO HALF`, owner actions carried as dated, named, tracked obligations, and a standing prohibition on using P00 as an authorization to act on governance. |
| Decision | **(c)**. `P00-AC3/AC6…AC11` = **PASS**, independently re-verified 2026-11-02 (`E-36`). `P00-AC1/AC2/AC4` = **BLOCKED — OWNER ACTION**, exactly as the prompt's own verification column permits for AC1. `P00-AC5` = **FAIL, environmental** (monolithic `bun test` OOM-killed, EXIT 137; a segmented runner substitutes file coverage). No `§7` hard constraint was violated — checked individually, none applies. |
| Reasoning | The prompt states *"violating any one \[hard constraint\] fails the phase"* and lists no constraint on §4.1/§4.2/§4.3 being externally applied. `MASTER_PLAN` §P01.4 requires only `XR-P00 ACCEPTED` as P01's gate. The audit's `XRD-013` — gate enforcement — **is** closed and is the phase's substance. Therefore the repo half is acceptable and does **not** authorize anything governance-related. The ruleset and D-020 are real debts with a real owner and are carried forward, not absorbed. |
| Trade-offs | An "accepted" phase with open owner items can look like papering over. Mitigated by (i) recording the split explicitly here, (ii) keeping the obligations rows in `PHASE_STATUS.md`, and (iii) forbidding any phase to *rely* on a governance control until the obligation is discharged. A stricter reading would block P01 indefinitely on a setting only the repo admin can change — that stalls the critical path without improving safety. |
| Affected | `PHASE_STATUS.md` (`XR-P00`, `XR-P01`), `EVIDENCE_LOG.md` (`E-44`), this entry. |
| Approval | **APPROVED** by Plan Owner (Agent Mode, acting on the user's instruction of 2026-11-02). **Open point for the repository owner:** this ruling is recorded *in-repo*; the owner's countersignature on D-024 (and on D-001/D-022) is what makes the governance half binding. |
| Revision | R1 2026-11-02. |

### D-024.1 — Standing prohibitions carried by this acceptance

1. **No phase may treat `/api/health`, ruleset state, or `bun run ci` as green on the strength of this acceptance.** `changelog:check` is still EXIT 1; `bun run ci` still cannot exit 0.
2. **`XR-P01` may proceed on the in-repo half only.** Its §4 does not touch governance, settings, or release identity, so no owner action is required to start it. If P01 finds it needs any of those, it stops and escalates.
3. **The P00 owner payload is not to be re-attempted by any executor.** It needs repo admin; executors do not have it and must not request it.
4. **Acceptance is not a re-scope of D-020.** D-020 remains `OWNER-REQUIRED`; the `GATE_EXEMPTIONS` entry for `changelog:check` is a self-expiring marker, not a permanent waiver.

---

## D-025 — Which ruleset parameters were changed, and which were deliberately not

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Problem | D-001/D-022 call for `required_approving_review_count: 1` **and** `require_code_owner_review: true`. Applying either is, in this repository, catastrophic rather than merely strict: `E-46` shows exactly **one** collaborator (`ahmadrrrtx`, admin), `CODEOWNERS` routes `.github/**`, `src/**`, `test/**`, `docs/**` to a single owner, and GitHub forbids self-approval. Every PR would become permanently unmergeable — including the PR carrying the fix. |
| Options | (a) Follow D-001 literally (approvals 1 + code-owner). (b) Change nothing. (c) **Apply the part that is provably safe now** (de-duplicate the required checks + require the aggregates that are actually green on `pull_request`), and hold the review parameters behind a named precondition. |
| Decision | **(c)**. Applied 2026-11-02 (`E-45`): required checks `["Quality Gate" ×2]` → `["Quality Gate", "Cross-Platform gate", "Supply Chain gate", "npm Pack Smoke gate"]`; all four verified to fire on `pull_request` and green at `4adcec2`. `required_approving_review_count` stays `0` and `require_code_owner_review` stays `false` **until a second reviewer exists**. |
| Reasoning | Requiring a context that does not run on PRs, or a review that cannot physically be given, does not add enforcement — it adds a permanent deadlock and trains everyone to bypass. The enforceable half was applied and proven behaviourally (rejected push, blocked merge); the unenforceable half is documented with its precondition instead of being silently dropped or blindly applied. |
| Trade-offs | The "one actor self-merges" weakness persists until a second collaborator is added — this is a real, unresolved gap, recorded as an obligation, not a solved problem. `Cross-Platform gate` was green at `4adcec2` but is a heavy matrix; if it flakes, it is now merge-blocking. |
| Precondition to finish D-001 | Add a second collaborator (or an org team) with `write`; then set `required_approving_review_count: 1` and `require_code_owner_review: true`. Both are one `PUT` away; the payload is in `E-45`. |
| Affected | Ruleset `19119579`; `PHASE_STATUS.md` obligations; `P00-AC1`. |
| Approval | **APPROVED** by Plan Owner (Agent Mode) on the user's explicit instruction of 2026-11-02 to act as decision-maker on the data. **Repository-owner countersignature still required** — this ruling is recorded in-repo; the setting already changed. |
| Revision | R1 2026-11-02. |

### D-025.1 — Why the two aggregates that are red were left out

`Desktop gate (bundles + latest.json + journey)` and `Clean-Machine Journey gate` were
**failure/cancelled at `4adcec2`**. Requiring them now would block every merge for a reason
unrelated to the PR. They stay out, and `XR-P09` must add them once green — unchanged from
the existing obligation. The remaining two declared-but-not-required aggregates
(`Desktop gate`, `Clean-Machine Journey gate`) are therefore still unenforced, which is
recorded rather than papered over.
