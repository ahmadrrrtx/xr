# XR Phase 7 — Audit Report (STEP 1)

**Task:** Capability Ecosystem Quality + Business OS Refinement
**Repo baseline:** `main` @ `bce34a0` (PR #38, Phase 6 landed) — version 7.0.1 (Truth)
**Audit date:** 2026-08-02 · **Auditor:** autonomous coding agent (Phase 7 contract)
**Method:** source-level re-verification of Phases 0–6 and the current Phase 7 surface; live test-suite baseline (2475 pass / 0 fail); no report treated as authoritative over code.

---

## 1. Phase 0–6 re-verification (the floor)

| Phase | Claim in reports | Verified evidence in code | Verdict |
|---|---|---|---|
| 0 — Truth & release | single version source; release manifest stamps version; claim-lint; golden path | `src/core/version.ts` generated from `release.manifest.json`; `scripts/release-manifest.ts --check`; `scripts/claim-lint.ts`; `test/phase0/*` incl. surface-parity | **VERIFIED** |
| 1 — Reliability & persistence | single-writer persistence; atomic updater; audit | `src/state/workspace-store.ts` (one Store); `src/update/atomic-updater.ts` (blue-green + canary + auto-rollback); `test/architecture/one-store.test.ts`; `test/reliability/*` | **VERIFIED** |
| 2 — Architecture simplification | one substrate: one tool registry, one envelope, one planner, one router, one context engine, enforced boundaries | `src/tools/registry.ts` + `registry-service.ts`; `src/core/execution/envelope.ts` + `runner.ts` (sole caller of agent loop); `src/agents/registry.ts`; `src/intelligence/router*`; `.dependency-cruiser.cjs`; `test/core/no-bypass.test.ts`; `test/architecture/boundaries.test.ts` | **VERIFIED** |
| 3 — Runtime & performance | lazy boot; compiled binary; budgets + regression gate | `src/core/boot-profile.ts`; `scripts/build-matrix.ts`; `test/perf/startup-latency.test.ts`; `scripts/perf-gate.ts`; `scripts/size-gate.ts` | **VERIFIED** |
| 4 — Security & trust hardening | enforceable isolation lattice; egress proxy; credential brokering; signed/SLSA/SBOM supply chain | `src/runtime/trust/*` (lattice, policy, isolated-spawn, service); `src/security/*`; `scripts/sbom.ts`, `scripts/license-check.ts`, `scripts/verify-release.ts`; `test/security/*`; `test/supply-chain/*` | **VERIFIED** |
| 5 — Routing quality | measured, explainable routing; one router authority | `src/intelligence/*`; `scripts/perf/route-bench.ts`; `test/intelligence/*`; `docs/adr/0012-*` | **VERIFIED** |
| 6 — Context quality | one-store context; anti-poisoning; measured recall | `src/context/*` (integrity, injection, hybrid, memory-as-tools); `scripts/recall-benchmark.ts`; `test/context/*` | **VERIFIED** |

**Baseline test run (2026-08-02):** `bun test` → **2475 pass, 0 fail** on Linux. Floor is green.

---

## 2. Current Phase 7 surface — capability ecosystem audit

### 2.1 Capability descriptor / provenance

| Item | Reality | Verdict |
|---|---|---|
| Unified capability descriptor | `src/platform/capabilities/types.ts` — one zod-validated descriptor (`xr-5.2.0/capability-v1`) across plugin/skill/mcp/provider/tool/workflow/integration/artifact; execution semantics stay in each plane | **PRESENT** |
| Declared vs effective authority | `src/platform/capabilities/authority.ts` — deterministic intersection resolver, deny-wins, undetermined⇒fail-closed; `riskTierForPermissions` | **PRESENT** |
| Certification/contract tests | `src/platform/capabilities/certification.ts` — schema, authority honesty, package integrity, placement, context scope, durability, cleanup, compatibility | **PRESENT** |
| Additive metadata store | `src/platform/capabilities/store.ts` — overlays (state/quarantine/trustDecision/pendingReview/certification/history) in `~/.xr/capabilities/metadata.json` | **PRESENT** |
| Adapters | `src/platform/capabilities/adapters.ts` — plugin/skill/mcp/provider/tool/workflow/integration/artifact → descriptor | **PRESENT** |
| Service | `src/platform/capabilities/service.ts` — list/discover/inspect/permissions/certify/enable/disable/quarantine/rollback/health | **PRESENT** |
| **Provenance graph** | **NOT FOUND.** Only per-capability lifecycle history + metadata overlays. No queryable graph (origin/version/publisher/permissions/deps/placement/data-access/update-history/**outcomes**); "what did the agent use?" is NOT a system property today | **GAP** |
| Usage/outcome recording | No recording of which capabilities were *used* by a run and with what outcome | **GAP** |

### 2.2 Tool registry

| Item | Reality | Verdict |
|---|---|---|
| One tool registry | `src/tools/registry.ts` (allTools) + `registry-service.ts` (arbitration); plugin/skill/MCP tools flow through it; no-bypass test enforces | **VERIFIED (one)** |

### 2.3 Plugin / skill / MCP manifests

| Item | Reality | Verdict |
|---|---|---|
| Plugin manifest strictness | `src/plugins/manifest.ts` — size-limited parse, permission validation, MCP command-injection checks, URL scheme checks, entrypoint containment, no self-dependency, dedup capabilities | **PRESENT** |
| Plugin trust fields | `trust.sha256 / treeSha256 / signature / keyId / reviewedBy / reviewedAt` in `xr-plugin.json`; **no runtime signature verification** in loader/validation (fields carried, not enforced) | **PARTIAL** |
| Skill manifest | `src/skills/schema.ts` — permissions (scope/reason/optional/dangerous/paths/domains), verification.level + signature + checksum, dependencies, tools (display-only), mcp, plugins | **PRESENT** |
| Skill signing | `src/skills/signing.ts` (ed25519 package signature envelope) + `verifier.ts`; used by SDK publish path | **PRESENT** |
| SBOM in manifests | Not present in plugin/skill manifests (repo-level SBOM only via `scripts/sbom.ts`) | **GAP** |
| Capability statement in manifests | Plugin `capabilities[]` exists (kind/name/description); no permission-coupling enforcement to capability statement | **PARTIAL** |
| Dependency locks | No `locks` file concept for capabilities; versions only | **GAP** |
| `allowed-tools` permissiveness | Skill `manifest.tools` is **display-only** (used in prompts, never enforced as an allow-list); auto-approve path grants all non-dangerous declared permissions at install (`grantedFor` default) | **GAP** |
| Description routing-hijack | Skill descriptions feed `scoreSkill`/`executionContext` and capability discovery scoring; no injection guard/tests | **GAP** |
| Skill typed labels | `SkillAdapterKind` (xr-manifest/legacy-markdown/…) is an *adapter* kind; the constitutional types (executable/connector/prompt-pack/knowledge-pack/experimental) are **not modeled**; no per-type honest counts | **GAP** |
| Skill surface universality | `UnifiedSkillRuntime` shared via `SkillService` (CLI, daemon); parity tests exist only for plugin tools (phase0 surface-parity); no skill parity test | **PARTIAL** |

### 2.4 Signing / verifier / marketplace trust

| Item | Reality | Verdict |
|---|---|---|
| Capability discovery scoring | `scoreDescriptor` — evidence-only (verified publisher/signed/tests/certification); comment: "Deliberately no download-count/popularity boost" | **PRESENT** |
| Skill search scoring | `scoreSkill` — text relevance + installed/verification bumps; downloads/runs collected (`SkillCatalogEntry`) but **not** used for ranking | **PRESENT (no popularity)** |
| Composite evidence trust scorer | No single scorer with explainability ("why this ranks") across planes; `trust.evidenceScore` exists but is thin | **GAP** |
| Popularity-vs-evidence test | No test proving a high-download unsigned capability ranks below a signed+tested one | **GAP** |

### 2.5 Update / rollback

| Item | Reality | Verdict |
|---|---|---|
| XR self-update | Phase-1 `atomic-updater.ts` — blue-green swap, canary (version identity + doctor), auto-rollback; binary/git/npm layouts | **PRESENT** |
| Plugin rollback | `src/plugins/manager.ts` — snapshot dirs, validate-on-rollback, history (10 snapshots) | **PRESENT** |
| Skill rollback | `src/skills/marketplace.ts` — rollback dirs + `SkillInstallation.rollback[]` | **PRESENT** |
| **TUF-style update metadata** | **NOT FOUND.** No signed versioned metadata (root/targets/snapshot/timestamp), no threshold, no rollback/freeze/mix-and-match protection, no last-seen-version state | **GAP** |

### 2.6 MCP

| Item | Reality | Verdict |
|---|---|---|
| Default-deny | `enabled: false` default; `grantedPermissions` (declarations are requests); `authorityProblem` gate; `McpRegistry` opt-in | **PRESENT** |
| Signed allowlist | Only optional `checksum`; no signed allowlist artifact, no signature verification | **GAP** |
| Isolation | `src/mcp/client.ts` — namespace sandbox for stdio servers; hardened mode fails closed on unisolated high-risk spawn; `runtime/trust/isolated-spawn.ts` | **PRESENT** |
| Kill/uninstall | `McpManager.remove` + registry remove + client kill | **PRESENT** |
| Revocation test | Not found in test suite (no allowlist revocation test) | **GAP** |

### 2.7 Capability lifecycle + certification

| Item | Reality | Verdict |
|---|---|---|
| Lifecycle states | 14 states incl. update_pending_review/quarantined/rolled_back; history recorded in metadata store | **PRESENT** |
| Certification gate | `certify` + contract tests; quarantine on failure | **PRESENT** |
| Crash isolation | Plugin sandbox workers (`plugins/sandbox-worker.ts`, `loader/sandbox.ts`) + Phase-4 isolation; no capability-level crash-isolation test | **PARTIAL** |
| CI certification/scanning | No CI step scanning bundled capabilities (manifest security) | **GAP** |

---

## 3. Business OS audit

| Item | Reality | Verdict |
|---|---|---|
| Location | `src/business/` — **36 files, 10,777 LOC** (Art. XXIV target ~11k — matches the contract's expectation) | **IN KERNEL TREE** |
| Kernel imports | `src/core/providers/business.ts` (BusinessServiceProvider), `src/core/tokens.ts` (`Tokens.Business`), `src/commands/business.ts`, `src/daemon/routes/business.routes.ts`, `src/cli/*` (catalog/route-decision/command-loaders/boot-profile/provider-modules) | **IN KERNEL** |
| In-kernel contract today | Direct `BusinessOS` class import; no thin L0 contract | **NO L0 CONTRACT** |
| Default-enabled? | No — `business?.enabled ?? false` (config-gated), but the module is *imported and registered* in every boot | **DEFAULT-OFF (runtime) but IN-BOOT (code)** |
| Execution | `core/execution-bridge.ts` — `executeBusinessAction` **records `outcome:'succeeded'` without executing/verifying any effect** when no executionService is wired; lease/idempotency/audit exist. This is the Constitution's "simulated success" pattern | **SIMULATED** |
| Record mutation | `core/record-mutation.ts` — propose/commit with policy + approval + audit + hash chain (real effect path exists) | **PRESENT** |
| Second engine? | Modules use own bus/approval/outcome services; `automation/engine.ts` exists — need Art. XVII review (workflow substrate exists at `src/execution/workflow/*`) | **REVIEW** |
| Effect verification per module | None (no per-module effect-verification gate) | **GAP** |
| Data | `biz_*` tables in the workspace store (same SQLite) — preserved across any move if we don't touch the schema | **PRESERVED** |
| Business CLI/daemon | `xr business` command + `/api/business/*` routes resolve `Tokens.Business` | **IN KERNEL** |

---

## 4. Ecosystem & Business-OS inventory (quick numbers)

- Capability planes: plugins (`src/plugins/*`, 14 types), skills (`src/skills/*`, 30 files), MCP (`src/mcp/*`, 5 files), providers (`src/providers/*`), tools (`src/tools/*`), workflows (`src/execution/workflow/*`), integrations (`src/integrations/*`), artifact transforms.
- Capability ecosystem core: `src/platform/capabilities/*` (8 files, ~1,735 LOC) — descriptor, authority, certification, store, adapters, service.
- Business OS: `src/business/**` 36 files / 10,777 LOC (16 modules + 20 core files).
- Existing docs: `docs/CAPABILITIES.md`, `docs/SKILLS-MARKETPLACE.md`, `docs/developer/CAPABILITY_AUTHOR_CONTRACT.md`, `docs/XR-15-BUSINESS-OS-ARCHITECTURE.md`, `docs/phase9/*` (XR 5.2), `docs/adr/0001–0013`.

## 5. Gap summary (feeds STEP 2)

1. **T1** — Provenance graph + usage/outcome recording missing.
2. **T2** — TUF-style signed update metadata + rollback/freeze/mix-and-match protection missing.
3. **T3** — Composite evidence-based trust scorer with explainability + popularity-vs-evidence proof missing.
4. **T4** — Manifest security: SBOM/capability-statement/dependency-locks fields, signature enforcement, authority-diff pre-enable UX missing.
5. **T5** — Skill constitutional typing, enforced (non-permissive) allowed-tools, routing-safe descriptions, skill parity tests missing.
6. **T6** — MCP signed allowlist + revocation test missing (default-deny/isolation present).
7. **T7** — CI certification/scanning gate + capability crash-isolation test missing (lifecycle mostly present).
8. **T8** — Business OS still in kernel; no L0 contract; simulated execution; no effect-verification; no default-exclusion of unproven modules.
