# XR 5.2 — Phase 9 Required Repository Audit: Capability Ecosystem

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


- **Baseline audited:** XR 5.1.0 Environment Interaction OS (Phase 8), commit `9ce62bbb75a1d7c94a5c7e720bb2d3af05d56940`.
- **Target:** XR 5.2.0 Capability Ecosystem.
- **Audit date:** 2026-07-27.
- **Scope discipline:** This audit covers capability metadata, provenance, effective authority, discovery, certification, lifecycle safety, SDK/marketplace verification, and inspection. It explicitly excludes Phase 10 personal/business operating-layer work, enterprise control planes, remote execution fleets, visual workflow editors, new environment modalities, model-router redesign, memory/context redesign, and new workflow engines.

## Prerequisite verification

| Gate | Command / evidence | Result |
|---|---|---|
| Commit/version | `git rev-parse HEAD` → `9ce62bbb75a1d7c94a5c7e720bb2d3af05d56940`; package/version source said `5.1.0 (Environment Interaction OS)` before Phase 9 changes | ✅ |
| Frozen install | `npx bun@1.3.14 install --frozen-lockfile` | ✅ |
| Typecheck | `npx bun@1.3.14 run typecheck` | ✅ |
| Full tests | `npx bun@1.3.14 test` | ✅ 1122 pass / 0 fail before coding |
| CI | `npx bun@1.3.14 run ci` | ✅ |
| Phase 8 release evidence | `docs/phase8/PHASE8_RELEASE_VALIDATION.md` | ✅ release ready |
| Security validation | Primary in-repo tests green; `scripts/verify-security.ts` is a legacy string-matching advisory and failed on stale literal expectations not aligned to Phase 8 implementation names | ⚠ disclosed, not treated as authoritative gate |

## 1. Extension-plane inventory

| Plane | Primary files | Existing semantics | Phase 9 inspection adapter |
|---|---|---|---|
| Plugins | `src/plugins/{types,manifest,loader,host,registry,manager,cli}.ts` | Code extensions loaded through manifest validation, hash pinning, VM/worker isolation, host membrane, permission grants, catalog, CLI, daemon plugin API | `descriptorFromPlugin`; safe rollback/quarantine metadata added to existing registry |
| Skills | `src/skills/{schema,manifest,marketplace,marketplace-backend,installer,lifecycle,runtime,sdk,signing}.ts` | Prompt/professional capability packs with manifests, marketplace, SDK, dependency solver, package format, signing helpers, rollback | `descriptorFromSkill`; transactional package extraction and permission-escalation review added |
| MCP | `src/mcp/{types,client,registry,manager,cli}.ts` | Local/remote MCP server registry, lifecycle, health, tool/resource/prompt wrappers with approval and execution adapters | `descriptorFromMcp`; granted permissions and quarantine overlay added |
| Providers | `src/providers/{registry,presets,capabilities,custom}.ts`, `src/services/provider-service.ts` | Built-in and custom OpenAI-compatible/native provider presets and dynamic registry | `descriptorFromProvider` |
| Tools | `src/tools/registry.ts`, `src/tools/*`, `src/execution/adapters/tool-adapter.ts` | Core tools selected by mode and routed through execution/trust adapters | `descriptorFromTool` |
| Workflows | `src/workflow/{types,engine,repository,inspection}.ts`, `src/templates/workflows/` | Canonical immutable workflow definitions/runs, durable repository, workflow engine | `descriptorFromWorkflow` |
| Integrations | `src/integrations/{registry,credentials,oauth}.ts` | Optional connector catalog delegating to plugins/MCP or credentials; no new execution semantics | `descriptorFromIntegration` metadata only |
| Artifacts | `src/workflow/types.ts`, export/report surfaces | Artifact contracts exist as workflow outputs; no independent executor | metadata-only artifact transform descriptors |
| Marketplace / signing | `src/skills/{marketplace,marketplace-backend,download-engine,signing,online-registry}.ts` | Skill package download/hash/signature verification and registry cache | Signature policy integrated with config; unsigned clearly represented |
| Daemon/dashboard | `src/daemon/routes/*`, `src/daemon/dashboard.ts` | Localhost token-auth API and dashboard panels | `/api/capabilities*` + Capability Ecosystem dashboard panel |

## 2. Capability type / manifest matrix

| Type | Existing manifest/source | Common descriptor fields populated | Execution semantics preserved |
|---|---|---|---|
| Plugin | `xr-plugin.json` (`PluginManifest`) | id/type/version, author publisher, source, hashes/signature fields, dependencies, permissions, capabilities/hooks, MCP/skills, lifecycle | Plugin VM/worker + `PluginHost`; no new plugin executor |
| Skill | `xr-skill.json` or legacy `SKILL.md` adapter | publisher, verification, content/tests/docs, dependencies, permissions, settings/secrets, contributions | Unified skill runtime; instructions remain guidance not authority |
| MCP | `McpServerConfig` registry row | server source/transport, tools/resources/prompts, permissions, health, checksum, credentials | MCP client/manager and execution adapter unchanged |
| Provider | `ProviderPreset` / config custom provider | kind/locality, model capabilities, cost tier, API key env, docs URL | Provider registry/router unchanged |
| Tool | `Tool` registration | inferred permission/resource/risk facts and tool interface schema | Existing tool adapter/execution/trust path unchanged |
| Workflow | `WorkflowDefinition` | graph version/content hash, nodes/tags/parameters/artifact contracts | Existing workflow engine unchanged |
| Integration | `ConnectorDefinition` catalog | auth/scopes/config fields/capabilities and backing plugin/MCP dependencies | Metadata only; no business module activation |
| Artifact | Built-in transform descriptor | artifact interface and support metadata | Metadata only; workflow/export contracts remain source of truth |

## 3. Permission / dependency / provenance matrix

| Plane | Declared permissions | Effective authority source | Dependencies | Provenance/integrity |
|---|---|---|---|---|
| Plugin | `manifest.permissions` | `manifest.permissions ∩ registry.grantedPermissions − config denied`; load recomputes via `effectiveGrant` | manifest plugin IDs; MCP/skill declarations | installed entry hash + tree hash; optional manifest trust fields |
| Skill | `manifest.permissions` | installation `grantedPermissions` or non-dangerous defaults; update escalation blocked unless `--grant` review supplied | `SkillDependency[]`, MCP/plugins/providers/tools/settings | package tree hash, optional checksum/signature, publisher metadata |
| MCP | `declaredPermissions` | `grantedPermissions`; load/enable fail if declared scopes are not approved or are policy-denied | external command/url/apiKeyEnv | checksum optional; transport/source + health |
| Provider | preset capabilities + apiKeyEnv | provider use still budget/key gated by provider service | none except model/runtime | built-in/custom config source |
| Tool | adapter-inferred | mode allow-list + execution/trust approval | none | core built-in source |
| Workflow | node graph facts | workflow engine + execution/tool scopes | node references/tool/provider/artifacts | content hash + repository state |
| Integration | auth scopes/config fields | connector install/auth path; descriptor only does not grant | pluginId/mcpServer | built-in catalog source |

**Important invariant:** manifest declarations are requests, never authority. Capability metadata is not used to mint grants. Effective authority is inspectable as:

```text
declaration ∩ publisher/package policy ∩ workspace policy ∩ user grant ∩ agent/task grant ∩ trust/placement limits − denied
```

## 4. Install / update / rollback flow

| Flow | Existing baseline | Phase 9 changes |
|---|---|---|
| Plugin install | stage copy, validate, hash, registry upsert | rollback snapshots preserved before replacement; lifecycle state recorded |
| Plugin update | validates source and blocks permission increase | now compares against previous declarations and records review-required state; package snapshot created before replacement |
| Plugin rollback | absent | restore prior package snapshot, validate/hash, disable, clear grants (no authority restored silently) |
| Plugin quarantine | absent | registry marks quarantined/untrusted, unloads/disable, blocks enable/load |
| Skill install | copy/import/package install | permission escalation check against previous grants; grants intersect declared scopes |
| Skill package import | extract directly to destination | transactional stage → hash/manifest verify → swap; unsafe path fails before destination mutation |
| Skill update | reinstall source or online package | new authority requires `--grant`; online updates inherit the same gate |
| Skill rollback | registry pointer only | restore snapshot/copy and disable + clear grants |
| MCP enable/load | enable registry row and connect | quarantined/permission-undetermined rows fail closed; declared scopes must be granted |

## 5. Trust / verification gap analysis

| Gap before Phase 9 | Risk | Phase 9 response |
|---|---|---|
| No common descriptor across extension planes | Users could not compare capabilities | `src/capabilities/types.ts` + adapters for all planes |
| Declared/effective authority visible only in individual planes | Confusing review and update behavior | `resolveEffectiveAuthority`, capability CLI/API/dashboard permissions views |
| Plugin rollback missing | Failed/tampered update could not be reverted safely | rollback snapshots + disable/no-silent-authority semantics |
| Skill package import not transactional enough | Partial extraction or path traversal failure could mutate install dir | staging extraction, hash validation, manifest re-read, rollback backup |
| MCP permissions were declarations only | Server could be enabled with unclear effective authority | `grantedPermissions`, enable/load fail closed when not approved |
| Certification conflated with trustLevel/popularity | Marketplace trust could be social only | contract-test evidence model; discovery does not rank by download count |
| Dashboard lacked cross-plane view | UI inspection fragmented | Capability Ecosystem panel + daemon routes |

Remaining intentionally-deferred gaps are listed in §10.

## 6. Execution-placement matrix

| Capability | Placement shown in descriptor | Actual execution path |
|---|---|---|
| Core tool | `in_process`, `restricted_process`, or `namespace_sandbox` depending inferred risk | `executeTool` → Execution Fabric → Trust service when supplied |
| Plugin | VM/worker membrane, risk tier from effective permissions | existing `loadPlugin`/`PluginHost`; hard-boundary declarations remain membrane-blocked unless host-mediated |
| Skill | `prompt_runtime` | Unified Skill Runtime; instructions injected as context/guidance only |
| MCP | `remote_service` for remote, local registry for stdio | `McpClient` + execution adapter wrappers; approval-gated tools |
| Provider | `provider_api` | provider registry/service + budget/key controls |
| Workflow | `workflow_engine` | canonical workflow engine/repository |
| Integration | metadata-only until connected | backing plugin/MCP/credential path |
| Artifact | metadata-only transform descriptor | workflow/export artifact contracts |

## 7. API / SDK compatibility matrix

| Surface | Compatibility decision |
|---|---|
| Plugin API | `PLUGIN_API_VERSION` remains 2; no host ABI break |
| Skill schema | `SKILL_SCHEMA_VERSION` remains 1; no schema break |
| MCP protocol | `MCP_VERSION` unchanged (`2025-06-18`) |
| Workflow definition | `WORKFLOW_DEFINITION_SCHEMA_VERSION` unchanged |
| Config | additive v16 → v17 `capabilities` block |
| CLI | adds `xr capabilities`/`xr capability`; existing `plugins`, `skills`, `mcp` commands preserved |
| Daemon | adds `/api/capabilities*`; existing routes preserved |
| SDK | existing skill SDK create/build/test/package/publish remains; capability certification is an extra inspection path |

## 8. Supply-chain threat model

| Threat | Control / test |
|---|---|
| Malicious manifest | plugin/skill schema validation + capability contract schema tests |
| Permission mismatch | declared vs effective authority vectors; MCP enable/load fail closed; plugin/skill grants intersect declarations |
| Dependency confusion | descriptors expose dependency type/id/version/status; later policy registry pinning deferred |
| Package hash mutation | skill download hash verify; plugin installed tree hash; load refuses mismatch |
| Invalid signature | skill backend blocks invalid signature; descriptors mark invalid/unsigned/unknown distinctly |
| Publisher key unavailable/change | backend blocks signed package when trusted public key missing |
| Update permission escalation | plugin update review gate; skill update/import review gate |
| Path traversal extraction | skill package import stages and rejects unsafe paths before swap |
| Capability bypass | descriptors do not execute; existing execution/trust contracts unchanged |
| Stale/quarantined execution | plugin/MCP enable/load block quarantined state; capability service disables before quarantine |
| Unsigned package policy | config `capabilities.requireSignedPackages`; unsigned marked/governed |
| Rollback tampering | rollback snapshot re-validated/re-hashed before use; authority not restored |
| Malicious memory/context writes | existing context write admission remains unchanged; plugin memory writes stay proposed/quarantined by context policy |
| Secret/network mismatch | descriptor exposes credential/network requirements; host/MCP/provider surfaces still mediate secrets and egress |

## 9. File-by-file change proposal / implementation map

| File | Change |
|---|---|
| `src/capabilities/types.ts` | common descriptor schema and trust/certification/lifecycle vocabulary |
| `src/capabilities/authority.ts` | effective authority resolver and risk-tier helper |
| `src/capabilities/certification.ts` | contract test framework and evidence scoring |
| `src/capabilities/store.ts` | additive metadata overlay store for certification/review/quarantine |
| `src/capabilities/adapters.ts` | plugin/skill/MCP/provider/tool/workflow/integration/artifact descriptor adapters |
| `src/capabilities/service.ts` | cross-plane listing, discovery, inspection, permissions, certification, lifecycle controls |
| `src/capabilities/index.ts` | public exports |
| `src/config/config.ts` | v17 additive `capabilities` policy block and migration 16→17 |
| `src/core/tokens.ts`, `src/core/providers.ts`, `src/core/app.ts` | capability service token/provider wiring |
| `src/commands/capabilities.ts`, `src/cli/router.ts`, `src/cli/catalog.ts` | `xr capabilities` CLI and aliases |
| `src/daemon/routes/capabilities.routes.ts`, `src/daemon/routes/index.ts` | daemon capability API routes |
| `src/daemon/dashboard.ts` | Capability Ecosystem dashboard panel |
| `src/plugins/registry.ts`, `src/plugins/manager.ts`, `src/plugins/cli.ts`, `src/services/plugin-service.ts` | plugin lifecycle state, rollback snapshots, quarantine, update review gate |
| `src/mcp/types.ts`, `src/mcp/registry.ts`, `src/mcp/manager.ts`, `src/mcp/cli.ts` | declared vs granted MCP permissions, fail-closed load, quarantine |
| `src/skills/marketplace.ts`, `src/skills/marketplace-backend.ts` | transactional package import, update permission review, rollback no-silent-authority, signed-package policy |
| `test/capabilities/ecosystem.test.ts` | authority, descriptor, update review, rollback, path traversal tests |
| `test/context/migration.test.ts`, `test/environment/migration.test.ts`, `test/daemon.test.ts` | v17/5.2 expectations |
| `package.json`, `src/core/version.ts`, `website/src/lib/site.ts` | release identity 5.2.0 Capability Ecosystem |
| `docs/phase9/*`, `docs/CAPABILITIES.md`, `MIGRATION.md`, `CHANGELOG.md` | docs and validation evidence |

## 10. Later-phase deferrals

- Enterprise governance/control-plane policy server and org-wide publisher approvals.
- Remote execution fleet / distributed sandbox pool.
- Visual workflow editor or workflow engine redesign.
- Model routing redesign beyond descriptor metadata.
- Memory/context architecture redesign.
- New browser, voice, vision, desktop, or environment primitives.
- Popularity/download-count marketplace scoring. Phase 9 evidence scoring is certification/provenance/signature based only.
- Public marketplace expansion for its own sake.
- Full dependency-lockfile ecosystem with transitive package pinning across every language runtime.

## Audit conclusion

The audited repository already had strong individual extension systems. Phase 9 therefore adds a shared capability metadata and lifecycle layer **without replacing** plugin/skill/MCP/provider/tool/workflow registries or permission engines. Effective authority is now visible and testable, updates requesting new authority are review-gated, package integrity and signature state are inspectable, and quarantine/rollback are safe and auditable.
