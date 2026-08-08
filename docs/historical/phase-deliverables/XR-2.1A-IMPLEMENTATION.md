# XR 2.1A — Unified Skill Runtime Implementation

## 1 Executive Summary

Phase A is now implemented on top of the pushed repository without redesigning the Stage 13 architecture.

The architecture from the prior approved Stage 13 work remains intact: Core systems stay Core; Plugins, MCP, Providers, Memory, Voice, Research, Computer Control, Dashboard, TUI, and Multi-Agent remain execution substrates; the Skill Runtime now orchestrates reusable expertise across those substrates.

This pass specifically adds the missing XR 2.1A unification layer:

- Skill Runtime
- Skill Registry
- Skill Loader
- Skill Resolver
- Skill Validator
- Skill Installer
- Skill Lifecycle Manager
- Skill Permission Manager
- Skill Dependency Resolver
- Local Skill Search Index
- Compatibility adapters for legacy markdown skills, plugin skills, MCP bundles, learned skills, research packs, and role packs
- Exact Phase A CLI commands under `xr skills ...`
- Dashboard Installed Skills, Skill Inspector, Permission Viewer, Dependency Viewer, and Runtime Health

No Marketplace UI was added in this Phase A pass.

## 2 Implementation Summary

Already implemented before this pass:

- `xr-skill.json` manifest schema
- Professional Skill schema
- Local marketplace/package foundation
- SDK helpers
- Official Skill packs
- Agent runtime Skill context injection
- `xr skill` compatibility CLI

Implemented in this pass:

- Added XR 2.1A Unified Skill Runtime modules.
- Added compatibility adapters so reusable expertise is represented as Skill records.
- Added local search indexing independent of online marketplace features.
- Added dependency and permission viewers for runtime inspection.
- Added lifecycle operations for enable, disable, install-local, remove, validate, migrate, and doctor.
- Added dashboard API and dashboard panel.
- Added unified runtime tests.
- Kept backward compatibility with existing `xr skill ...` commands and existing markdown skills.

Validation performed:

```bash
npm install --silent --no-package-lock
./node_modules/.bin/tsc --noEmit
```

Result: passed.

Runtime smoke performed:

```bash
npx tsx -e "import { UnifiedSkillRuntime } from './src/skills/runtime.ts'; const r=new UnifiedSkillRuntime(); const list=r.list(); console.log('total', list.length); console.log('kinds', JSON.stringify(r.health().byKind)); console.log('resolve', r.resolve('fix react performance bug',3).selected.map(s=>s.manifest.id).join(','));"
```

Observed:

```text
total 79
kinds {"xr-manifest":54,"legacy-markdown":11,"research-pack":3,"role-pack":11}
resolve performance_optimizer,react_expert,debug_error
```

## 3 Updated Architecture

The runtime stack is now:

```text
XR Core
  ├─ Provider Engine
  ├─ Plugin Platform
  ├─ MCP Platform
  ├─ Memory Engine
  ├─ Voice Engine
  ├─ Research Engine
  ├─ Computer Control
  ├─ Multi-Agent Runtime
  └─ Unified Skill Runtime
       ├─ Skill Loader
       ├─ Skill Registry
       ├─ Skill Resolver
       ├─ Skill Validator
       ├─ Skill Installer
       ├─ Skill Lifecycle Manager
       ├─ Skill Permission Manager
       ├─ Skill Dependency Resolver
       ├─ Local Skill Search Index
       └─ Compatibility Adapters
            ├─ xr-skill.json manifests
            ├─ legacy SKILL.md skills
            ├─ plugin skills
            ├─ MCP bundles
            ├─ learned skills
            ├─ research packs
            └─ role packs
```

Important rule preserved:

A Skill may guide orchestration, but it cannot bypass XR safety. Tool approvals, provider budgets, egress control, memory policy, MCP/plugin trust, and audit logging remain Core enforcement.

## 4 File-by-file plan

Changed files:

- `src/services/skill-service.ts`
  - Rebased service around `UnifiedSkillRuntime` while preserving marketplace and SDK APIs.

- `src/commands/skills.ts`
  - Added exact Phase A CLI: list, inspect, validate, enable, disable, install-local, remove, migrate, doctor.
  - Preserved backward-compatible SDK/package commands.

- `src/daemon/server.ts`
  - Added `/api/skills*` routing.

- `src/daemon/dashboard.ts`
  - Added Skills panel with installed list, inspector, permission viewer, dependency viewer, runtime health.

New files:

- `src/skills/adapters.ts`
  - Compatibility adapters.

- `src/skills/search-index.ts`
  - Local Skill Search Index.

- `src/skills/dependencies.ts`
  - Skill Dependency Resolver.

- `src/skills/permissions.ts`
  - Skill Permission Manager.

- `src/skills/validator.ts`
  - Skill Validator.

- `src/skills/installer.ts`
  - Skill Installer.

- `src/skills/loader-runtime.ts`
  - Unified Skill Loader.

- `src/skills/registry.ts`
  - Skill Registry.

- `src/skills/resolver.ts`
  - Skill Resolver.

- `src/skills/lifecycle.ts`
  - Skill Lifecycle Manager.

- `src/skills/runtime.ts`
  - Unified Skill Runtime.

- `src/daemon/skills-api.ts`
  - Dashboard Skill Runtime API.

- `test/skills-unified-runtime.test.ts`
  - Runtime test coverage.

## 5 Complete production-ready files

The complete production-ready files are in the workspace at:

```text
src/skills/adapters.ts
src/skills/search-index.ts
src/skills/dependencies.ts
src/skills/permissions.ts
src/skills/validator.ts
src/skills/installer.ts
src/skills/loader-runtime.ts
src/skills/registry.ts
src/skills/resolver.ts
src/skills/lifecycle.ts
src/skills/runtime.ts
src/services/skill-service.ts
src/commands/skills.ts
src/daemon/skills-api.ts
src/daemon/server.ts
src/daemon/dashboard.ts
test/skills-unified-runtime.test.ts
```

## 6 Migration Guide

For users:

```bash
xr skills doctor
xr skills list
xr skills inspect react_expert
xr skills validate ./skills/react_expert
```

To install a local Skill:

```bash
xr skills install-local ./my-skill
```

To migrate legacy markdown skills into full manifests:

```bash
xr skills migrate ./skills
```

Backwards compatibility remains:

```bash
xr skill browse
xr skill search react
xr skill create "My Skill"
xr skill package ./my-skill
```

Dashboard:

```bash
xr serve
```

Then open the Skills panel.

## 7 Validation Checklist

- [x] Did not redesign Stage 13 architecture.
- [x] Did not perform another architecture audit.
- [x] Implemented only Phase A unification work.
- [x] Added Skill Runtime.
- [x] Added Skill Registry.
- [x] Added Skill Loader.
- [x] Added Skill Resolver.
- [x] Added Skill Validator.
- [x] Added Skill Installer.
- [x] Added Skill Lifecycle Manager.
- [x] Added Skill Permission Manager.
- [x] Added Skill Dependency Resolver.
- [x] Added local Skill Search Index.
- [x] Added compatibility adapters.
- [x] Preserved legacy markdown skill compatibility.
- [x] Preserved plugin and MCP as execution substrates.
- [x] Integrated CLI exact commands.
- [x] Integrated Dashboard Phase A views only.
- [x] TypeScript passed.

## What remains for later prompts

XR 2.1A is now covered.

Still later phases, not implemented in this pass:

- XR 2.1B: deeper SDK build/publish/test ergonomics.
- XR 2.1C: online registry interface, signing, publisher IDs, version resolution.
- XR 2.1D: full Marketplace UI/App Store experience.
- XR 2.1E: expanding and hardening first-party Skill pack depth beyond the current official pack foundation.
