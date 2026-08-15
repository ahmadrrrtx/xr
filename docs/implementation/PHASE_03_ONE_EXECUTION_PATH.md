# Phase 03 — One Execution Path

**Date:** 2026-08-15 Asia/Karachi
**Repository:** https://github.com/ahmadrrrtx/xr @ahmadrrrtx
**Implementation:** XR Phase 03

> The AI Agent You Can Actually Trust.

Phase 03 makes XR behave as **ONE coherent agent** regardless of interface. The
architectural invariant:

```
CLI   → AgentService.runTask()
TUI   → AgentService.runTask()
Daemon→ AgentService.runTask()
```

All interfaces are frontends over the same execution kernel. This document
describes the implemented architecture, the changes, and the verification.

---

## 1. Target architecture

```
                CLI        TUI        Dashboard / HTTP Chat
                 │          │            │
                 └──────────┼────────────┘
                            ▼
                 HTTP Adapter (chat.routes.ts)
                            ▼
                 AgentExecutor (agent-executor.ts)
                   │  lazy XRApp boot (agent profile)   ─┐
                   │  ExecutionLaneQueue (per session)   │  ONE kernel
                   ▼                                     ▼
                 AgentService.runTask() ─────────────► execute()
                   │                                     │
                   ▼                                     ▼
              Runner (runEnvelope) ───────────────► runAgentLoop()
                   │                                     │
                   ▼                                     ▼
        Provider · Tools · Policy · Memory · Audit · Checkpoints · State
```

Every path creates ONE Task (envelope), runs ONE loop, and shares ONE set of
governance/memory/audit/checkpoint services. Interfaces own only presentation
(SSE/terminal formatting).

---

## 2. What changed

### 2.1 daemon chat → AgentService (`src/daemon/routes/chat.routes.ts`)

Before: `buildProvider() → provider.chat() → fullText → { text }`.
After:

```
validate → acquire execution lane (429 if busy) → open SSE →
acknowledge immediately →
AgentService.runTask(message, mode, { say, approve, signal, surface:"daemon" })
  → stream incremental text events → { done } → [DONE]
```

- **Immediate ack** (`acknowledged` + `runId`) before any provider work (T3.9).
- **Streaming** at the loop's native granularity via `say()` → `{ text }` events
  (T3.8). Token-level streaming is deferred (Phase 04 / loop instrumentation).
- **Cancellation** — dropping the stream aborts an `AbortSignal` threaded through
  `AgentService` → the loop's checkpoints (T3.10).
- **Mode** — explicit `mode` (`agent|ask|plan`), defaulting to the safe read-only
  `ask` (T3.6). `agent` mode does NOT auto-allow dangerous tools.
- **Approval** — dangerous tools emit an `approval_required` event and are
  **denied by default**; policy is never weakened for HTTP (T3.6, T3.16).
- **Backward compatibility** — `/api/chat` is preserved; the SSE frame shapes
  `{ text }`, `{ done }`, `{ error }` and `data: [DONE]` are retained (T3.22,
  T3.23).

### 2.2 AgentExecutor (`src/daemon/agent-executor.ts`)

A lazily-booted canonical `XRApp` (agent boot profile = the SAME provider set the
CLI `run`/`ask`/`plan` commands use), exposing:

- `runTask(task, mode, opts)` / `runHeld(task, mode, opts)` — route through
  `Tokens.Agent` (`AgentService`), force surface `"daemon"`.
- `acquireLane(key, opts)` — reserve the execution lane so a busy session answers
  **429** before opening a doomed 200 SSE stream (T3.11).
- `switchWorkspace(id)` — delegate to the canonical `XRApp.switchWorkspace` (T3.2).
- `shutdown()` — tear down the booted kernel.

The daemon server remains a fast `serve` path (Commandment 11): the kernel is
booted lazily on first task/workspace-switch.

### 2.3 Workspace switching (`src/daemon/routes/providers.routes.ts`)

The inline lifecycle (`previousStore.close(); setActiveId(); getStore(); new
Shield`) is gone. The route now calls `executor.switchWorkspace(id)` →
`XRApp.switchWorkspace(id)` (the canonical lifecycle: state transition,
background-job stop/start, provider rebind, health events, rollback on failure),
then re-syncs the daemon's `store`/`shield`/`workspaceManager` from the app.
Failures surface the canonical `WorkspaceSwitchFailedError` as a stable **503**
with `workspace.{from,to}`, and are audited (`workspace.switch_failed`).

### 2.4 Execution lane queue (`src/execution/lane.ts`)

A process-local, key-scoped FIFO single-writer guard (T3.11):

- same workspace/session → **serialized**;
- different sessions → **concurrent** (never a global mutex);
- queued wait bounded (`LANE_DEFAULT_TIMEOUT_MS = 30_000`) → `LaneBusyError`
  → retryable **429**;
- cancellation while queued → `AbortError`, no phantom execution.

This is distinct from (and composes with) the cross-process `LeaseManager`
(`src/execution/lease.ts`).

### 2.5 Provider health (`src/providers/health.ts`)

Already unified in Phase 01: a shared `ProviderHealthChecker` with bounded
(2.5 s) checks and cached (60 s positive / 15 s negative) results used by both
CLI and daemon. Phase 03 removed the residual inline health probe from the chat
route (provider selection/failure now flows through AgentService's routing).

---

## 3. Task / Execution model reuse

Phase 03 **reuses** the existing models. No duplicate Task, checkpoint, policy,
memory, audit, or provider systems were created:

- Task = execution envelope (`src/core/execution/envelope.ts`).
- Execution records / checkpoints / recovery = `src/execution/*` (ExecutionService).
- Policy = envelope `policy` (budget, pricing, approval) + `RegistryService.discover`.
- Memory = `MemoryStore` over the unified `WorkspaceStore` (+ Context package).
- Provider abstraction = `ProviderService.getProvider` (+ intelligence router).

---

## 4. Verification

- `bun run typecheck` — PASS
- `bun run boundaries` — PASS (542 modules, no violations; surfaces may import
  the kernel; `src/execution` stays surface-free)
- `test/one-agent/` — PASS (18 tests):
  - lane serialization / concurrency / timeout / cancellation;
  - chat streaming + mode default + cancellation + 429;
  - workspace switch through canonical lifecycle + failure mapping;
  - architectural assertion: no `provider.chat()`/`buildProvider()` in chat path;
    workspace switch uses `switchWorkspace`, not inline lifecycle.
- daemon + API suites — PASS (119 tests).
- core / state / execution suites — PASS.
- architecture (boundaries/ownership) — PASS.

---

## 5. Deferred (documented, not Phase 03 scope)

- Token-level SSE streaming (loop emits whole turns via `say`; per-token events
  need loop instrumentation — Phase 04).
- Dashboard approval UI (Phase 03 defaults dangerous tools to deny; an approval
  UI can upgrade `approve` later without weakening policy).
- Provider Gateway full Phase 04 implementation (AgentService already owns the
  provider boundary, so the daemon no longer calls `buildProvider` in chat).
