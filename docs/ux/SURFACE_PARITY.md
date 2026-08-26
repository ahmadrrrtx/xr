# XR Surface Parity Matrix

**Phase:** 12 — UX Unification · **Date:** 2026-08-26
**Repository state:** `main` @ `cc37607`

The goal is **coherent behaviour, not identical feature count** (brief §33). A
capability is classified honestly:

- **SUPPORTED** — works on that surface, backed by the named backend source.
- **PARTIAL** — present but incomplete, or read-only.
- **N/A** — legitimately does not belong on that surface.

Every row names the backend source so parity claims can be checked, and so no
surface can appear to support something the backend does not.

---

## 1. Capability matrix

| Capability | CLI | TUI / Shell | Chat (dashboard) | Dashboard panels | Backend source |
|---|---|---|---|---|---|
| Start task | SUPPORTED `xr "task"`, `xr run` | SUPPORTED composer | SUPPORTED composer | SUPPORTED chat panel | `services/surface-execution.ts` → `runEnvelope` |
| Continue task / session | SUPPORTED `xr execution list`, `xr status` | SUPPORTED sessions view | PARTIAL history in-thread | SUPPORTED sessions panel | `src/execution`, `state/repos/session-repo.ts` |
| Interrupt active run | SUPPORTED `Ctrl+C` (exit 130) | SUPPORTED `Esc` / `Ctrl+C` | SUPPORTED stop button | SUPPORTED | `AbortController` → loop checkpoints |
| Truthful run status | SUPPORTED `say()` lines | **SUPPORTED** canonical vocabulary | **SUPPORTED** status chip + live region | **SUPPORTED** | `src/core/ux-status.ts` |
| Token streaming | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | Phase 05 canonical sink |
| Tool-call visibility | SUPPORTED `say()` timeline | SUPPORTED timeline + `Ctrl+T` detail | **SUPPORTED** real tool cards | **SUPPORTED** | `tool_call` / `tool_result` events |
| Tool approval | SUPPORTED confirm prompt | SUPPORTED `promptConfirm` overlay | PARTIAL inspector approvals list | SUPPORTED approvals panel | `capabilities/policy.ts`, `/api/control/pending` |
| Provider switch | SUPPORTED `xr providers set` | SUPPORTED `Alt+P`, `/model` | N/A (per-request) | SUPPORTED providers panel | `providers/gateway.ts` |
| **Active provider/model shown** | SUPPORTED from config | SUPPORTED status bar + sidebar | **SUPPORTED** hydrated from `/api/providers` (was a localStorage fake `"Auto"`) | SUPPORTED | `XRConfig.defaults` |
| **Execution mode (agent/plan/ask)** | SUPPORTED `xr run --mode` | SUPPORTED `Shift+Tab`, `/mode` | **SUPPORTED** — now validated against `Mode` and actually sent (was a no-op cycling a non-existent `Research` mode) | N/A | `Mode` union, `ChatBody.mode` |
| Model switch | SUPPORTED `xr models set` | SUPPORTED `Alt+P`, `/model` | N/A | SUPPORTED models panel | `providers/factory.ts`, `local/registry.ts` |
| Fallback visibility | SUPPORTED | SUPPORTED | PARTIAL provider chips refresh | SUPPORTED | `providers/fallback-chain.ts` |
| Memory status | SUPPORTED `xr memory …` | SUPPORTED `/memory`, memory view | SUPPORTED `/memory` | SUPPORTED memory panel | `context/memory/store.ts` |
| Research | SUPPORTED `xr research` | SUPPORTED research view | N/A | SUPPORTED research panel | `src/research` |
| Research progress **in chat** | N/A | N/A | **NOT IMPLEMENTED** | N/A | no stream event type exists — see §3 |
| Security / shield status | SUPPORTED `xr doctor` | SUPPORTED `/security-lab`, status view | PARTIAL | SUPPORTED shield panel | `security/shield.ts`, `security/lab.ts` |
| Audit chain | SUPPORTED `xr audit verify` | SUPPORTED `/audit`, `/export-audit` | PARTIAL | SUPPORTED audit panel | `state/repos/audit-repo.ts` |
| Budget | SUPPORTED config | SUPPORTED `/budget` | SUPPORTED `/budget` | SUPPORTED budget panel | `cost/governor.ts` |
| Sessions list | SUPPORTED | SUPPORTED `/sessions` | SUPPORTED sidebar | SUPPORTED | `state/repos/session-repo.ts` |
| Workspaces | SUPPORTED `--workspace` | SUPPORTED `Ctrl+W`, `/workspace` | N/A | SUPPORTED workspaces panel | `core/workspace.ts` |
| Skills | SUPPORTED | N/A | N/A | SUPPORTED skills panel | `src/skills` |
| Plugins | SUPPORTED | N/A | N/A | SUPPORTED plugins panel | `src/plugins` |
| MCP | SUPPORTED | N/A | N/A | SUPPORTED mcp panel | `src/mcp` |
| Capabilities | SUPPORTED | PARTIAL activity view | N/A | SUPPORTED capabilities panel | `src/capabilities` |
| Command palette | N/A | SUPPORTED `Ctrl+K` | SUPPORTED `Ctrl+K` | SUPPORTED | local command metadata only |
| Doctor / health | SUPPORTED `xr doctor` | SUPPORTED `/status` | SUPPORTED `/status` | SUPPORTED overview | `core/health.ts` |
| Context mentions (`@file`…) | N/A | N/A | **NOT IMPLEMENTED** | **NOT IMPLEMENTED** | no backend resolver — see §3 |
| Diff-staged per-hunk approval | N/A | N/A | **NOT IMPLEMENTED** | **NOT IMPLEMENTED** | not built — see §3 |

Bold = changed or newly truthful in Phase 12.

---

## 2. What Phase 12 changed in this matrix

| Row | Before | After |
|---|---|---|
| Tool-call visibility (Chat/Dashboard) | **Fabricated** — one hardcoded card ("Call provider hot-path routing / Streaming…") stamped "Completed execution" on every run; `tool_call`/`tool_result`/`usage` all dropped (0 references in `client-chat.ts`) | Real cards per tool, correlated call→result by event `id`, bounded argument summary, measured duration, unobserved outcomes marked as such |
| Truthful run status (all surfaces) | 3 free-form strings on an unconstrained `status: string`; TUI invented "planning"/"reading"/"thinking"; dashboard dropped all but 2 | 12-status canonical vocabulary in `src/core/ux-status.ts`; TUI footer and dashboard chip render the same labels from the same table |
| Loop progress events | Only `provider_ready` emitted from the loop | `compacting_context`, `generating`, `tool_running` (with tool name), `budget_stopped`, `finishing` added at verified points |
| Surface stream access | `executeOnSurface` had no stream sink, so the Shell structurally *could not* see structured events | `onStreamEvent` forwarded through the one shared surface entry — Shell, Telegram and Voice all get it by construction |
| **Chat header state** | `provider`/`model`/`workspace` were `localStorage` strings defaulting to `"Auto"`/`"Auto"`/`"Default"`; `approval`/`budget` were dead fakes | Hydrated from the daemon; unknown renders as `detecting…`; re-synced after each run so a fallback is reflected; dead fakes removed |
| **Mode control** | Cycled `Ask/Plan/Research/Agent` — `Research` is not a member of `Mode` — and the value was **never sent**, so the control was a no-op | Cycles the three real modes, validated against the union, and sent with the request |

---

## 3. Deliberate non-parity

These are **not** gaps to be papered over with UI. Each needs backend work first.

| Capability | Why absent |
|---|---|
| `@file` / `@folder` / `@session` / `@memory` / `@research` mentions | No mention resolver exists in the backend. The composer's `@` hint is a placeholder affordance, not a working feature. |
| Research / source events in the chat stream | The loop emits no such event type; the canonical union is `status · token · tool_call · tool_result · usage · done · error`. Research is a separate subsystem with its own panels. |
| `Retrying` / `Switching provider` statuses | `executeWithFallback` (`src/providers/gateway.ts`) is not on the loop's streaming path, so no such transition is observable mid-run. |
| Diff-staged per-hunk approval | Not implemented anywhere. |
| Private "Thinking" panel | Deliberately excluded. No chain-of-thought is exposed on any surface. |

`test/ux-status.test.ts` pins the last part of this: the vocabulary must **not**
declare `searching_web`, `reading_source`, `retrying` or `provider_switching`
until something really emits them.

---

## 4. Command surface inventory (verified)

**TUI slash commands** (`shell/app.ts` `handleSlashCommand`):
`activity · audit · budget · clear · config · context · dashboard · exit · export-audit · help · home · inspect · local · logs · memory · mode · model · models · notice · notifications · overview · palette · quick · quit · research · security-lab · serve · sessions · settings · status · workspace · workspaces`

**TUI views** (`SHELL_VIEW_ORDER`):
`home · chat · sessions · workspaces · research · activity · audit · memory · status · settings`

**Dashboard chat slash commands** (`client-chat.ts`):
`/budget · /clear · /memory · /plan · /status`

**Dashboard panels** (`data-panel`):
`about · audit · automation · budget · business · capabilities · chat · control · dashboard · devices · downloads · files · integrations · mcp · memory · models · notifications · plugins · providers · research · sessions · settings · shield · skills · voice · workspaces`

The TUI is the power-user surface (broadest command set, keyboard-first); the
dashboard is the overview surface (broadest panel set). Chat stays a primary
action, not another dashboard card.

---

## 5. Terminology parity

The same words on every surface, from one table:

| State | CLI | TUI | Dashboard |
|---|---|---|---|
| Waiting on a human | "awaiting approval" | "Waiting for approval" | "Waiting for approval" |
| Tool in flight | "▸ tool ⚙ name(args)" | "Running tool · name" | "Status: Running tool · name" |
| User interrupt | "⏸ cancelled — interrupted at your request" | "Stopping current run at the next checkpoint." | "Cancellation requested" |
| Budget stop | "⏸ stopped — reason" | "Stopped by budget · reason" | "Status: Stopped by budget" |

Durable execution states keep their own established vocabulary
(`src/execution/inspection.ts`: `STATE_LABEL`, `OUTCOME_LABEL`,
`RECOVERY_STATE_LABEL`) — reused, not duplicated, and aligned on
`awaiting_approval` = "awaiting approval".
