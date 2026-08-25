# XR UX Architecture

**Phase:** 12 — UX Unification
**Date:** 2026-08-26
**Repository state:** `main` @ `cc37607` (787 commits), Bun 1.3.14 (pinned)
**Status:** Implemented (Phases C, D, E + documentation). See
`PHASE_12_IMPLEMENTATION_MATRIX.md` for the pre-implementation analysis and
`SURFACE_PARITY.md` for the capability matrix.

> This document describes XR as it is **in the code**, verified against the
> files cited. Where the brief asked for something XR cannot honestly do yet,
> that is stated rather than papered over.

---

## 1. The principle

```
                      XR CORE
                         │
        ┌────────────────┼────────────────┐
        │                │                │
       CLI              TUI          Dashboard
        │                │                │
        └────────────────┼────────────────┘
                         │
                shared state / API
                         │
        Agent · Execution · Tools · Memory
        Research · Security · Providers
        Sessions · Audit
```

CLI, TUI, Dashboard and Chat are **presentation and control surfaces over one
agent**. They are not four products, and they must never become four
implementations. The backend is the only source of truth.

The failure mode this architecture exists to prevent is concrete, and XR had it:
for a single run, the core loop emitted canonical events, the Control Center
silently discarded the tool events and rendered a fabricated progress card, and
the Shell ignored the event stream entirely and invented its own status words.
One run, three descriptions.

---

## 2. Surface responsibilities

| Surface | Owns | Must never own |
|---|---|---|
| **CLI** (`src/cli`, `src/commands`) | Argument parsing, fast paths, text output, exit codes | Agent state, provider selection logic |
| **TUI / Shell** (`src/interfaces/shell`) | Keyboard model, layout, rendering, local overlays | Execution, policy decisions, its own status vocabulary |
| **Dashboard** (`src/daemon/dashboard`) | Browser rendering, panels, HTTP calls to the versioned API | Business logic, direct privileged operations, browser-only sessions |
| **Chat** | Conversation rendering, composer, stream consumption | Its own event semantics |

Rule of thumb: if a value can be *computed* rather than *rendered*, it belongs
behind the API, not in a component.

---

## 3. The shared state model

### 3.1 One execution path

Every surface reaches the same loop:

```
surface → executeOnSurface() / AgentService.execute()
        → runEnvelope()          (src/core/execution/runner.ts — the only loop caller)
        → runAgent()             (src/core/agent.ts)
        → Provider · Tools · Policy · Memory · Audit · Checkpoints
```

`src/services/surface-execution.ts` exists precisely so long-lived surfaces
(Shell, Telegram, Voice) get the same envelope as the CLI without booting a
kernel — same registry, same policy, same evidence, same loop.

The chat HTTP route is an **adapter**, not an agent:

```
HTTP → validate → authenticate → acquire lane → AgentService.runTask()
     → canonical events → SSE
```

### 3.2 Sources of truth

| State | Source of truth | Cached copies |
|---|---|---|
| Provider / model | `XRConfig.defaults` + `providerGateway` | daemon health cache (bounded 2500 ms, TTL'd) |
| Active workspace | `WorkspaceManager` | none |
| Execution / task state | `src/execution` records (`ExecutionState`) | none — surfaces read, never invent |
| Run status (in-flight) | `ChatStreamEvent` stream | per-surface display label only |
| Memory | `MemoryStore` per workspace | none |
| Security | `XRShieldService` + policy evaluation | none |
| Cost / budget | `CostGovernor` + cost repo | none |
| Audit | hash-chained audit repo | none |

A surface may **render** a label for a state. It may not **hold** a competing
copy of the state.

### 3.3 The canonical status vocabulary

`src/core/ux-status.ts` — kernel module, **zero imports**, so every layer may
consume it (`kernel-stays-kernel`, `.dependency-cruiser.cjs`).

| Status | Label | Tone | Emitted from |
|---|---|---|---|
| `preparing` | Preparing | active | `shell/app.ts` (provider build + health) |
| `provider_selection` | Selecting provider | active | `chat.routes.ts` (immediate ack) |
| `provider_ready` | Provider ready | active | `core/agent.ts` |
| `generating` | Generating | active | `core/agent.ts` (model turn in flight) |
| `tool_running` | Running tool | active | `core/agent.ts` (tool name in `message`) |
| `compacting_context` | Compacting context | active | `core/agent.ts` |
| `awaiting_approval` | Waiting for approval | **wait** | `execution/state-machine.ts` |
| `budget_stopped` | Stopped by budget | warn | `core/agent.ts` |
| `cancelled` | Cancelled | warn | `chat.routes.ts` |
| `finishing` | Finishing | active | `core/agent.ts` (summary + session close) |
| `done` / `error` | Done / Error | ok / error | terminal |

Tones are neutral (`idle · active · wait · ok · warn · error`). The kernel names
**no colours**; each surface maps tone onto its own palette (`src/ui/tokens.ts`,
dashboard CSS variables).

**Honesty rule.** A status is declared only if something really emits it. The
brief's `Searching web`, `Reading source`, `Retrying` and `Switching provider`
are deliberately **absent**: no such event exists on the streaming path. A label
for an event that never fires is fake progress by another name. A test pins this
(`test/ux-status.test.ts`), so adding one requires a deliberate change.

`ChatStreamEvent.status` is typed `RunStatus`, so a typo'd or invented status is
a compile error. The **wire** contract stays permissive (`z.string()`, loose
object) for pre-Phase-05 consumers; unknown ids are humanised, never dropped.

### 3.4 No duplication across the browser boundary

The served dashboard client is a concatenated template-literal string
(`src/daemon/dashboard/client-script.ts`) and cannot `import`. The vocabulary is
therefore **interpolated** from the kernel module — the same pattern
`style-tokens.ts` already uses for `COLOR`. A test executes the interpolated JS
and asserts it equals the TypeScript tables, so the browser copy cannot drift.

---

## 4. Interaction model

### 4.1 Streaming

The canonical event contract (OpenAPI: `src/daemon/routes/schemas.ts`):

```
status · token · tool_call · tool_result · usage · done · error
```

All surfaces must consume **all** of it. Dropping a type is how a UI starts
lying. The Control Center previously consumed 3 of 7.

Rendering rules:

1. The first event arrives the instant the stream opens — never a silent wait.
2. Tokens render as they arrive; no `Loading…` for long-running work.
3. `tool_call` opens a card, `tool_result` closes **the same card** (correlated
   by event `id`).
4. A tool whose result never arrives is marked as unobserved — never as success.
5. Tool arguments are summarised and bounded (120 chars); full detail stays in
   the collapsible body. Tool output is **data**, rendered escaped, never
   visually merged with XR's own instructions.

### 4.2 Progressive disclosure

The conversation stays clean; detail expands on demand. The Shell has an
agent-detail level (`Ctrl+T`: none / brief / detailed) governing how much of the
real tool/step timeline is shown. Dashboard tool cards are collapsible with
`aria-expanded`.

### 4.3 Approvals

Approval is a real gate, never a UI affordance:

```
surface → authenticated API → capability request → policy → approval → execution → audit
```

The Shell prompts through the same `approve` callback the CLI uses
(`promptConfirm` → `executeOnSurface({ approve })`). The Control Center renders
the real control plane (`/api/control/pending` → action / risk level / reason /
reversibility / preview). No button may execute a privileged operation directly.

### 4.4 Interruption

Cancellation is **cooperative** and the UI says so.

- Shell: `Esc` / `Ctrl+C` → `runAbort.abort()`; a pending approval is denied
  first (fail-closed); the loop wraps up at its next checkpoint. The notice reads
  "Stopping current run at the next checkpoint" — not "stopped".
- Dashboard: aborts the fetch, which signals the run; the announcer reads
  "Cancellation requested", and any in-flight tool card is marked
  "Interrupted — no result reported."

Never claim a process stopped when it has only been asked to.

---

## 5. Keyboard map

| Key | CLI | TUI / Shell | Dashboard |
|---|---|---|---|
| `Enter` | — | send | send |
| `Shift+Enter` | — | newline | newline |
| `Esc` | — | overlay → interrupt → focus → exit | close palette / modal |
| `Ctrl+K` | — | command palette | command palette |
| `Alt+P` | — | provider/model selector | — (panel + `Alt+P` hint) |
| `Shift+Tab` | — | cycle mode (agent/plan/ask) | — |
| `Ctrl+T` | — | agent detail level | — |
| `Ctrl+N` | — | notifications | — |
| `Ctrl+J` | — | quick actions | — |
| `Ctrl+W` | — | workspace picker | — |
| `Ctrl+L` | — | clear chat view | — |
| `Ctrl+D` | — | exit (empty input) | — |
| `g` + letter | — | navigate (chords) | letter shortcuts navigate |
| `?` | — | keyboard help | keyboard help / palette |
| `/` | — | command mode | command mode |

Verified in `src/interfaces/shell/app.ts` (key dispatch), `src/ui/terminal.ts`
(key parsing), `src/daemon/dashboard/client-panels-c.ts` (browser keys).

Shortcut conflicts are resolved by precedence in the Shell: overlay → interrupt
→ focus → exit prompt. `Ctrl+K` is free of browser conflict; `Cmd+K` is used on
macOS in the browser surface.

---

## 6. Status vocabulary across surfaces

One word list, three renderers:

| Layer | Mechanism |
|---|---|
| Kernel | `RUN_STATUS_LABEL` / `RUN_STATUS_TONE` (`src/core/ux-status.ts`) |
| TUI | `busyLabelForEvent()` (`shell/types.ts`) → footer + spinner |
| Dashboard | `xrStatusLabel()` / `xrStatusTone()` (interpolated) → status chip + polite live region |
| Execution records | `STATE_LABEL` / `OUTCOME_LABEL` / `RECOVERY_STATE_LABEL` (`src/execution/inspection.ts`) — the durable-state vocabulary, unchanged and not duplicated |

`awaiting_approval` deliberately reads "Waiting for approval" in **both**
vocabularies.

---

## 7. Research, memory and security UX

- **Research** — rendered from real runs (`/api/research`, Shell research view).
  Research progress is **not** part of the chat stream today; no research or
  source event type is emitted by the loop, so the chat does not claim one.
- **Memory** — status is shown, never dumped. The Shell surfaces memory actions
  through `MemoryStore`; the dashboard `/memory` reads the real store. Privacy
  controls remain in config.
- **Security** — state is legible but quiet: shield status, blocked/total from
  the real injection lab, audit chain valid/intact. Tool output is framed as
  untrusted data (`src/security/tool-output.ts`, GAP-003).

---

## 8. Accessibility

- The stream announcer is `aria-live="polite"` and is never given focus;
  streaming updates do not steal focus.
- Colour is never the only signal: statuses carry text labels, tool cards carry
  status words, the bento matrix has a plain-text digest (`#bento-summary`).
- Tool cards are `role="button"` with `tabindex="0"` and `aria-expanded`.
- The palette is a modal combobox with focus trap and focus restoration.
- Contrast tokens are AA-verified (`muted` raised to `#7A8FB0`, ≥4.5:1).
- The TUI is fully keyboard-operable; mouse optional.
- `prefers-reduced-motion` is honoured in the dashboard.

---

## 9. Performance budgets

| Target | Measured this phase |
|---|---|
| `xr --version` | 34–42 ms |
| `xr --help` | 35–38 ms |
| Dashboard first useful paint | two-stage `loadDashboard`; light cells paint before provider/model cells |
| Command palette | local command metadata only — no backend call to render |
| Provider selector | cached state; async refresh |

Rules that must not regress:

- No heavy import in the `--version` / `--help` fast paths (literal-path dynamic
  imports; `test/perf/binary-smoke.test.ts`).
- No synchronous heavy work added to CLI/TUI startup or dashboard first paint.
- The status vocabulary is a static table — zero cost to render.

---

## 10. What is explicitly NOT implemented

Stated plainly so no surface pretends otherwise:

| Brief item | Why absent |
|---|---|
| `@file` / `@folder` / `@session` / `@memory` / `@research` mentions | No backend mention resolver exists. The composer's `@` hint is documentation, not a working feature. |
| Research / source **stream** events | The loop emits no such event type. |
| `Retrying` / `Switching provider` statuses | `executeWithFallback` (`src/providers/gateway.ts`) is not on the loop's streaming path. |
| Diff-staged per-hunk approval | Not built. |
| Chain-of-thought "Thinking" panel | Deliberately excluded — no private reasoning is exposed. |

Each of these needs backend work first. Adding the UI alone would violate the
no-fake-functionality rule.
