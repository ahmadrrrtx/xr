# Phase 03 — Execution Flow (Current)

**Date:** 2026-08-15 Asia/Karachi
**Repository:** https://github.com/ahmadrrrtx/xr @ahmadrrrtx
**Auditor:** Senior Implementation Engineer (Phase 03)

This document is Task 3.1 of XR Phase 03 — *One Execution Path*. It traces every
major interface's execution flow **before** the Phase 03 unification and records
where the paths diverged. It is the source of truth the unification was built
against.

---

## 1. Executive summary

XR's CLI path already used the canonical kernel:

```
CLI → RunAgentCommand → AgentService.runTask() → execute() → assembleEnvelope()
   → runEnvelope() → runAgentLoop()
```

The **daemon/dashboard path did not**. It built a provider and called
`provider.chat()` directly, bypassing `AgentService`, the Runner, the Execution
Fabric, Policy, Memory, Audit, Checkpoints, and the Tool Registry. It was, in
effect, a **second, shallower agent** living behind `/api/chat`.

Additional forks were found:

- **Workspace switching** — the daemon performed inline lifecycle operations
  (`previousStore.close(); setActiveId(); getStore(); new Shield...`) instead of
  `XRApp.switchWorkspace(id)`.
- **Provider discovery/health** — mostly unified in Phase 01 (a shared
  `ProviderHealthChecker` + bounded, cached health), but the daemon still held a
  residual inline health gate in the chat route.
- **Concurrency** — no single-writer / lane guarantee meant CLI + dashboard could
  interleave writes to the same session/workspace.

Phase 03 removes these forks so all interfaces converge on the SAME execution
kernel.

---

## 2. Path traces (pre-unification)

### 2.1 CLI task (`xr run`, `xr "task"`)

```
src/cli/router.ts
  → bootKernelForCommand("run")      → XRKernel.bootstrap({ profile: ["agent"] })
  → RunAgentCommand.execute()
      → agentService.runTask(task, mode, overrides)      // registry.resolve(Tokens.Agent)
      → AgentService.execute({ task, mode, overrides })   // THE canonical entry
          → providerService.getProvider(...)              // Provider abstraction
          → buildToolRegistry(...)                        // ONE Tool Registry
          → assembleEnvelope({ intent, plan, policy, placement, observation, evidence })
          → runEnvelope(envelope, stores, context)        // src/core/execution/runner.ts
              → runAgentLoop(...)                          // the ONE agent loop
          → outcome → exit code mapping
```

**Canonical services present:** Execution envelope · Runner · single agent loop ·
Tool Registry · Policy (budget/pricing/approval) · Memory (EnvelopeContext +
MemoryStore) · Audit (AuditStore) · Checkpoints/Recovery (ExecutionService) ·
workspace/session state. ✓

### 2.2 CLI ask (`xr ask`)

Same as 2.1 with `mode: "ask"`. Tool discovery is filtered to read-only tools by
`RegistryService.discover({ mode })` → `inMode()`. ✓ Same kernel.

### 2.3 TUI / Shell task

The Shell is a full-screen frontend. It resolves the kernel and calls the agent
through the same `AgentService` path (surface `"shell"`), rendering output
itself. ✓ Same kernel.

### 2.4 Dashboard chat (`POST /api/chat`) — **THE DIVERGENCE**

```
src/daemon/server.ts (thin shell, no XRApp)
  → chat.routes.ts
      → buildProviderWithDecision(config, {})          // provider built in-route
      → health gate (bounded 2.5 s)
      → provider.chat(messages, [])                     // DIRECT provider call
      → fullText → single { text } SSE event
      → { done: true } → [DONE]
```

**What was missing:** AgentService, Execution Fabric, Runner, Tool Registry,
Policy, Memory, unified Audit (only a coarse `chat.message` audit), Checkpoints,
Recovery, workspace/session lane. This is the P0-06 coherence gap the forensic
audit and Phase 03 forbid.

### 2.5 HTTP chat (same as 2.4) — no separate path; the daemon is the HTTP surface.

### 2.6 `agent` command

`src/commands/agents.ts` — agent registry/execution surfaces, resolves through
`AgentService`/`MultiAgentService`. ✓ Same kernel.

### 2.7 Workspace switch — **THE SECOND DIVERGENCE**

```
CLI  : withKernel(...) → kernel.switchWorkspace(id)   // XRApp.switchWorkspace ✓
Daemon: providers.routes.ts → inline:
          previousStore.close(); setActiveId(id); getStore(id); new XRShieldService(...)
```

The daemon re-implemented the workspace lifecycle instead of calling the
canonical `XRApp.switchWorkspace()`. No health events, no provider rebind, no
background-job stop/start, no rollback on failure.

### 2.8 Provider discovery

- CLI `providers` command → Phase 01 `ProviderHealthChecker` (bounded 2.5 s,
  cached 60 s/15 s). ✓
- daemon `providers.list` → `checkProviderHealthCached` (shared engine). ✓
- daemon chat carried a residual inline bounded health probe (removed in Phase 03).

### 2.9 Tool invocation

Both CLI and daemon reach tools through the ONE Tool Registry; but because the
daemon chat never built a registry, it could not invoke tools at all (it only
called `provider.chat`). Phase 03 gives the daemon chat the registry through
`AgentService`.

### 2.10 Memory retrieval

CLI: memory assembled in `AgentService.execute` (legacy `EnvelopeContext.memory`
+ optional Context/knowledge package + `MemoryStore` over the unified
`WorkspaceStore`). daemon chat: **none** (no AgentService). Phase 03 routes the
daemon through the same memory assembly.

---

## 3. Divergence table

| Concern                | CLI                        | Daemon chat (before)               | Phase 03 fix                     |
|------------------------|----------------------------|------------------------------------|----------------------------------|
| Task model             | Envelope `intent`          | raw `{ message }`                  | Envelope via AgentService        |
| Agent loop             | `runAgentLoop` (1)         | none (`provider.chat`)             | reuse `runAgentLoop` (1)         |
| Runner                 | `runEnvelope`              | none                               | reuse `runEnvelope`              |
| Execution fabric       | ExecutionService           | none                               | reuse                            |
| Tool registry          | buildToolRegistry          | none                               | reuse                            |
| Policy                 | budget/approval            | none                               | reuse (approval default deny)    |
| Memory                 | MemoryStore + context      | none                               | reuse                            |
| Audit                  | AuditStore + envelope      | coarse `chat.message` only         | reuse + `chat.message`           |
| Checkpoints/recovery   | ExecutionService           | none                               | reuse                            |
| Workspace switch       | `XRApp.switchWorkspace`    | inline lifecycle                   | `XRApp.switchWorkspace`          |
| Provider health        | ProviderHealthChecker      | shared + residual inline probe     | shared (inline removed)          |
| Concurrency safety     | single process             | none                               | ExecutionLaneQueue (T3.11)       |

---

## 4. Post-unification target (this Phase)

```
CLI ─┐
TUI ─┤   → AgentService.runTask()
Dash─┴→ HTTP Adapter → AgentService → Runner → provider·tools·policy·memory·audit·checkpoint
```

The daemon chat is now an **HTTP adapter over the canonical AgentService**
(`src/daemon/agent-executor.ts`), serialized per workspace/session by
`ExecutionLaneQueue` (`src/execution/lane.ts`), streaming the loop's incremental
output, cancelling cooperatively via AbortSignal, and defaulting to the safe
`ask` mode with policy-preserving approval.

See `PHASE_03_ONE_EXECUTION_PATH.md` for the implemented architecture.
