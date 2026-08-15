# Phase 03 — Final Report: One Execution Path

**Date:** 2026-08-15 Asia/Karachi
**Repository:** https://github.com/ahmadrrrtx/xr @ahmadrrrtx
**Implementation:** XR Phase 03 — *One Execution Path*

> XR — The AI Agent You Can Actually Trust.

---

## 1. Executive summary

Phase 03 removes the architectural forks that made the daemon/dashboard behave
like a separate, shallower agent. Before this phase:

- **CLI** reached agent execution through `AgentService.runTask()` →
  `execute()` → envelope → Runner → the one agent loop.
- **Daemon chat** called `buildProvider()` → `provider.chat()` directly,
  bypassing AgentService, the Runner, the Execution Fabric, Policy, Memory,
  Audit, Checkpoints, and the Tool Registry.
- **Daemon workspace switching** re-implemented the lifecycle inline instead of
  using `XRApp.switchWorkspace()`.
- **No concurrency guard** meant CLI + dashboard could interleave writes to the
  same session/workspace.

Phase 03 unifies these so **all interfaces are frontends over the same execution
kernel**:

```
CLI / TUI / Dashboard / HTTP Chat  →  AgentService.runTask()
```

Result: the daemon chat now executes through the exact same `AgentService →
Runner → agent loop → Provider · Tools · Policy · Memory · Audit · Checkpoints`
path as the CLI, streamed incrementally, cancellable cooperatively, serialized
per session/workspace.

## 2–3. Baseline and Phase 02 commits

- **Phase 00 baseline commit:** `eedf546`
- **Phase 02 commit:** `2340f09`
- **Phase 03 implementation commit:** `f72268a` — `feat(execution): unify agent
  execution across interfaces`

## 4. Original execution-path divergences (found by Task 3.1 audit)

| Concern | CLI | Daemon chat (before) |
|---|---|---|
| Task model | Execution envelope | raw `{ message }` |
| Agent loop | `runAgentLoop` | none (`provider.chat`) |
| Runner | `runEnvelope` | none |
| Execution fabric | `ExecutionService` | none |
| Tool registry | `buildToolRegistry` | none |
| Policy | budget / approval | none |
| Memory | `MemoryStore` + context | none |
| Audit | `AuditStore` + envelope | coarse `chat.message` |
| Checkpoints / recovery | `ExecutionService` | none |
| Workspace switch | `XRApp.switchWorkspace` | inline lifecycle |
| Concurrency safety | single process | none |

Full trace in `docs/implementation/PHASE_03_EXECUTION_FLOW_CURRENT.md`.

## 5. Final architecture

```
CLI ─┐
TUI ─┼→ AgentService.runTask() → Runner (runEnvelope) → runAgentLoop()
Dash─┴→ HTTP Adapter → AgentExecutor → AgentService   → Provider·Tools·Policy·Memory·Audit·Checkpoint
```

- **AgentExecutor** (`src/daemon/agent-executor.ts`) lazily boots the canonical
  `XRApp` with the `agent` boot profile (the SAME provider closure the CLI
  `run`/`ask`/`plan` commands use), so the daemon and CLI share one kernel.
- **Chat route** (`src/daemon/routes/chat.routes.ts`) is a thin HTTP adapter:
  validate → preflight (bounded health, 503) → acquire lane (429) → open SSE →
  acknowledge → `AgentService.runTask()` → stream → done.
- **Workspace switch** (`src/daemon/routes/providers.routes.ts`) delegates to
  `XRApp.switchWorkspace(id)` and re-syncs the daemon's store/shield/manager.

## 6. Workspace switching changes

- Removed inline `previousStore.close(); setActiveId(); getStore(); new Shield`.
- `/api/workspaces/switch` now calls `executor.switchWorkspace(id)` →
  `XRApp.switchWorkspace(id)` (the canonical lifecycle: state transition,
  background-job stop/start, provider rebind, health events, rollback).
- Re-syncs `state.store`/`state.shield`/`state.workspaceManager` from the app.
- `WorkspaceSwitchFailedError` → stable **503** with `workspace.{from,to}`,
  audited as `workspace.switch_failed`; previous workspace preserved.
- Tests: `test/one-agent/workspace-switch.test.ts`. **PASS.**

## 7. Provider health unification

Already centralized in Phase 01 (`src/providers/health.ts` — `ProviderHealthChecker`,
bounded 2.5 s, cached 60 s/15 s) and used by CLI and daemon `providers.list`.
Phase 03 removed the residual inline health probe from the chat route; the 503
contract is preserved via the executor's `preflight()` (shared health engine).
Test: `test/one-agent/architecture.test.ts`. **PASS.**

## 8. Chat → AgentService migration

- The chat route no longer imports `buildProvider`/`provider.chat`.
- It calls `AgentService.runTask()` (through the executor) with surface
  `"daemon"`, so it inherits the Tool Registry, Policy, Memory, Audit,
  Checkpoints, and Recovery of the CLI path.
- The Phase-01 fallback test ("dead primary → healthy fallback succeeds") now
  passes through the unified AgentService path, proving the daemon routes through
  the same execution kernel. **PASS.**

## 9. Streaming architecture

- Immediate `acknowledged` event with `runId` before any provider work (T3.9).
- The loop's incremental output is forwarded via `say()` as `{ text }` events —
  no waiting for a complete provider response (T3.8). Token-level streaming is
  deferred to Phase 04 (loop instrumentation).
- Existing SSE shapes (`{ text }`, `{ done }`, `{ error }`, `data: [DONE]`) are
  preserved for client compatibility (T3.22/T3.23).

## 10. Cancellation architecture

- `ReadableStream.cancel()` → `AbortController.abort()` → `AbortSignal` threaded
  through `AgentService.runTask` → the loop's checkpoints → `stopped:"cancelled"`.
- Cancellation while queued in a lane → `AbortError`, no phantom execution.
- Test: `test/one-agent/chat-route.test.ts`. **PASS.**

## 11. Lane queue architecture

`ExecutionLaneQueue` (`src/execution/lane.ts`):
- same workspace/session → **serialized** (FIFO);
- different sessions → **concurrent** (never a global mutex);
- bounded wait (`LANE_DEFAULT_TIMEOUT_MS = 30_000`) → `LaneBusyError` → **429**;
- reservation (`acquire`) lets the HTTP edge answer 429 before opening SSE.
Tests: `test/one-agent/lane.test.ts`. **PASS.**

## 12. Policy validation

- Chat defaults to the safe read-only `ask` mode (T3.6).
- `agent` mode does NOT auto-allow dangerous tools; `approve` emits an
  `approval_required` event and **denies by default** — policy is never weakened
  for HTTP (T3.16). Tests assert denial. **PASS.**

## 13. Memory validation

Because the daemon boots the same `agent` closure and resolves the same
`Tokens.Store`/`MemoryStore`, the daemon chat uses the SAME memory architecture
as CLI (legacy `EnvelopeContext.memory` + optional knowledge/context package).
No `ChatMemory`/`DashboardMemory` was created. Architectural equivalence
verified by code path + `surface:"daemon"`. (Full cross-interface memory
store/retrieve round-trips require a live provider; documented as a limitation.)

## 14. Audit validation

- Every daemon chat run records `chat.message` (mode, stopped, steps, truncated
  input/output) and goes through the envelope's `AuditStore` writes (session,
  cost) exactly as the CLI does.
- `workspace.switch` / `workspace.switch_failed` audited through the canonical
  store. **PASS** (asserted in tests).

## 15. Checkpoint validation

Daemon chat runs through `AgentService` → the same ExecutionService/checkpoint
architecture as CLI; no daemon-specific checkpoint store was introduced. Full
interrupt/restart recovery equivalence requires a live provider (documented).

## 16. Recovery validation

Same recovery semantics as CLI via the shared ExecutionService/RecoveryManager.
Full daemon-interruption→restart recovery test requires a live run (documented).

## 17. Golden task results

The 16-scenario golden suite requires live model/provider calls (API keys), which
are not available in this environment. **Not executed here.** The architectural
equivalence is proven by unit/integration tests; the golden suite should be run
in CI with credentials. Documented, not claimed.

## 18. CLI vs daemon comparison

| Dimension | CLI | Daemon (after Phase 03) |
|---|---|---|
| Task creation | envelope via AgentService | same |
| ExecutionRecord / envelope | same | same |
| workflow / run id | envelope id | envelope id (`dash_*`) |
| checkpoint sequence | ExecutionService | same |
| policy decisions | budget/approval | same (approval default deny) |
| provider abstraction | ProviderService | same |
| tool registry | buildToolRegistry | same |
| memory retrieval | MemoryStore + context | same |
| audit events | AuditStore + envelope | same + `chat.message` |
| final status | `stopped` | same |
| error handling | AgentResult | same |
| cancellation | signal | same |
| recovery | ExecutionService | same |

`test/one-agent/architecture.test.ts` enforces the shared path (no
`provider.chat()`/`buildProvider()` in the chat/executor modules; workspace
switch via `switchWorkspace`).

## 19. Performance measurements

Measured in-sandbox (no live provider):
- Kernel boot (`agent` profile) → AgentService resolvable in **~64–270 ms**.
- Chat with unreachable provider → **503 in ~2.6 s** (bounded health), under the
  4 s Phase-01 bound.
- Chat with dead primary + healthy fallback → **200 in ~126 ms** through the
  unified path.
- Full test suite: 3080 pass in ~121 s.

Live-provider TTFT / latency comparison (CLI vs daemon) requires credentials and
is deferred to CI (`docs/perf`).

## 20. Security results

- Authentication/authorization unchanged (server bearer/cookie gate).
- Tool policy preserved: HTTP does not weaken approval; dangerous tools denied by
  default.
- No secrets in metrics/events (structural-only observability preserved).
- Workspace isolation preserved (per-workspace store/lane keys).
- No raw request objects passed into AgentService (typed task/context only).
- Regression: full suite 3080 pass, 0 fail.

## 21. Regression results

| Gate | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run boundaries` | PASS (542 modules, 1771 deps, 0 violations) |
| `bun test` (full) | **3080 pass / 0 fail / 19 skip** (254 files) |
| `test/one-agent/` | 19 pass |
| daemon + API suites | 119 pass |
| perf daemon-routes (chat 503 + fallback) | 9 pass |
| boot-profile | 8 pass |
| architecture (ownership/boundaries) | 47 pass |

## 22. Files changed

Modified:
- `src/daemon/routes/chat.routes.ts` — chat → AgentService adapter + streaming/cancellation/lane/preflight/503
- `src/daemon/routes/providers.routes.ts` — workspace switch → `XRApp.switchWorkspace`
- `src/daemon/routes/router.ts` — `DaemonState` gains `app`/`agentExecutor`
- `src/daemon/server.ts` — create `AgentExecutor` into state
- `src/execution/index.ts` — export lane
- `docs/OWNERSHIP.md` — ownership map for new files

Added:
- `src/daemon/agent-executor.ts` — AgentService boundary + lane + preflight
- `src/execution/lane.ts` — ExecutionLaneQueue
- `docs/implementation/PHASE_03_EXECUTION_FLOW_CURRENT.md`
- `docs/implementation/PHASE_03_ONE_EXECUTION_PATH.md`
- `docs/implementation/PHASE_03_FINAL_REPORT.md`
- `test/one-agent/` — 19 integration tests (4 files)

## 23. Known limitations

- Token-level SSE streaming not implemented (loop emits whole turns via `say`);
  needs loop instrumentation (deferred).
- Dashboard approval UI not implemented; HTTP approval defaults to deny (safe).
- `history` body field is accepted but continuity is handled by the session
  store, not replayed into the model directly.
- Provider-dependent validation (golden suite, live TTFT, cross-interface memory
  round-trips, security-with-live-model) not runnable without credentials.

## 24. Deferred Phase 04 work

- Full Provider Gateway (AgentService already owns the provider boundary, so the
  daemon no longer calls `buildProvider` in chat).
- Token-level streaming / loop instrumentation.
- Dashboard approval UI.
- Content-hash exec gate / BPF LSM (already documented in security roadmap).

## 25. Rollback procedure

Phase 03 is additive and self-contained. To roll back:

```
git checkout eedf546 -- src/daemon src/execution/index.ts docs/OWNERSHIP.md
rm -f src/daemon/agent-executor.ts src/execution/lane.ts
rm -rf test/one-agent
git restore docs/implementation/PHASE_03_*.md
bun run typecheck && bun test
```

## 26. Final verdict

Phase 03 unifies CLI, daemon/dashboard chat, and workspace switching onto the
canonical `AgentService` execution kernel, adds per-session single-writer
serialization, preserves the Phase-01 provider-health and 503 contracts, and is
green across the runnable regression suite (typecheck, boundaries, 3080 tests).
Provider-dependent validations (golden suite, live latency, live security) are
**not executed** in this environment and must be run in CI with credentials.

**Verdict: PARTIAL** — architecture is unified and regression-green, but a fully
green declaration requires the live-provider golden/security/perf suites in CI.
