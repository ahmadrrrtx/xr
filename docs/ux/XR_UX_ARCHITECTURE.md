# XR UX Architecture

**Phase 12 — UX Unification.** Surfaces are windows into one agent. They must not become competing agent implementations.

Identity: **XR — The AI Agent You Can Actually Trust** (`src/ui/tokens.ts` `BRAND_META`, official assets in `assets/logo.png` and `assets/avatar.png`). Do not invent a logo or a second palette.

---

## 1. Principles

1. **One core.** CLI, TUI, Dashboard, and Chat consume XR core (AgentService / execution fabric / policy / memory / research / providers). UI never executes privileged work itself.
2. **Honesty.** No fake buttons, no invented status, no slash command without a backend. If a capability is missing, say so.
3. **Progressive disclosure.** The conversation is user → XR → work. Tools, sources, cost, latency, plan, and audit stay collapsed until useful.
4. **Truthful progress.** Never “Loading…” for a long-running turn. Use the shared status vocabulary.
5. **Fail closed.** Approvals are human-only. Timeouts and disconnects deny. The model cannot approve itself.
6. **Fast paths stay fast.** `--version` / `--help` must not import dashboard, memory, research, or provider discovery.

---

## 2. Surface responsibilities

| Surface | Job | Not its job |
|---|---|---|
| **CLI** | Commands, doctor, scripting, fast paths | A second agent loop |
| **TUI (Shell)** | Keyboard-first conversation + overlays | Recreating the dashboard |
| **Dashboard** | Overview, sessions, providers, memory, research, security, budget, audit, settings | Blocking first paint on every endpoint |
| **Chat (in dashboard)** | Primary work surface: streaming, tools, approvals | Browser-only fake sessions as source of truth |

Backend sessions (`GET /api/sessions`, `xr session`) are the durable record. Dashboard chat threads in `localStorage` are a **view cache** (drafts/pins), not a second agent.

---

## 3. Shared state model

Source of truth is the daemon/CLI runtime:

| Concern | Source | Surfaces read |
|---|---|---|
| Provider / model | `config.defaults` + `/api/providers` + `/api/providers/set` | CLI, TUI (`/model`, Alt+P), Dashboard, Chat |
| Mode | `agent` \| `plan` \| `ask` (`src/core/types.ts`) | TUI Shift+Tab, Chat mode chip (Ask/Plan/Agent) |
| Session | workspace store | CLI `xr session`, TUI Sessions, Dashboard Sessions, Chat `/session` |
| Task / tools | execution fabric stream events | TUI timeline, Chat tool cards |
| Memory | MemoryStore + `/api/memory` | TUI Memory, Dashboard Memory, Chat `/memory` |
| Research | research jobs + `/api/research` | TUI Research, Dashboard Research, Chat `/research` |
| Security | Shield + `requireApproval` | TUI `/permissions`, Dashboard Shield, Chat `/permissions` |
| Approvals | `approve()` in the run + `/api/chat/approve` or TUI confirm overlay | TUI, Chat |

Labels live in `src/ui/ux-vocabulary.ts`. Slash commands live in `src/ui/slash-catalog.ts`. Do not duplicate these tables in a component.

---

## 4. Interaction model

```
USER message
    → XR status (Selecting provider / Generating / Running tool / …)
    → tokens
    → tool cards (collapsed)
    → approval if required (human)
    → sources if research/web tools ran
    → final answer
```

Plan / Act:

```
PLAN (mode=plan, no tool execution) → REVIEW → ACT (mode=agent) → VERIFY
```

Research is a **composer flag** (may allow web/research tools on that turn). It is not a fourth mode.

---

## 5. Keyboard shortcuts

Shared contract (`SHORTCUTS` in `src/ui/ux-vocabulary.ts`):

| Shortcut | Action |
|---|---|
| Enter | Send |
| Shift+Enter | Newline (web composer) |
| Esc | Interrupt active run (truthful: wait for checkpoint) or dismiss overlay |
| Ctrl+K / ⌘K | Command palette (local metadata; no heavy fetch to open) |
| Alt+P | Provider/model switcher |
| / | Command mode / focus composer |
| ? | Help (TUI overlay; dashboard palette) |
| Shift+Tab | Cycle mode (TUI: agent/plan/ask) |
| Ctrl+T | Agent-detail none/brief/detailed (TUI; real tool timeline, not chain-of-thought) |

Windows/Linux use Ctrl; macOS accepts metaKey for the palette.

---

## 6. Status vocabulary

Canonical labels (`STREAM_STATUS_LABEL`):

Preparing · Selecting provider · Generating · Running tool · Searching web · Reading source · Waiting for approval · Retrying · Switching provider · Compacting context · Finishing · Cancellation requested · Blocked by XR Shield

Cancellation copy: **“Cancellation requested. Waiting for a safe checkpoint…”** — never claim the process has already stopped.

Locality: **LOCAL / CLOUD / OFFLINE / SETUP** (same words on TUI status bar and dashboard badges).

---

## 7. Approval UX

1. Policy evaluates the tool.
2. If approval is required, the run **pauses** and emits `approval_required` (id, tool, reason, summarized args, preview).
3. Human decides via TUI confirm overlay or `POST /api/chat/approve { id, approved }`.
4. Timeout, abort, and unknown id **deny**.
5. Decision is audited. Execution still goes through the same policy boundary.

Dashboard computer-control approvals remain on `/api/control/pending` + `/api/control/approve` (different queue, same human-only rule).

---

## 8. Streaming UX

Chat SSE (`POST /api/chat`) is an HTTP adapter over AgentService. Events:

`status` · `token` · `tool_call` · `tool_result` · `usage` · `done` · `error` · plus `approval_required`

The client must not treat “no tokens yet” as frozen: the first event is `provider_selection`. Research/source **progress** is shown when those tools run (`web_search`, `research_*`, `fetch_url`) — the chat contract does not invent a parallel research SSE.

---

## 9. Research UX

Jobs and citations come from Phase 10 (`/api/research`, `/api/research/jobs`). Chat `/research` lists real jobs. Empty copy: “No research yet.” + how to start. Firecrawl output is never dumped raw.

---

## 10. Memory UX

Memory is local, scoped, and consent-gated (Phase 09). Chat `/memory` hits `/api/memory`. The composer Memory chip controls the inspector peek — it does not disable kernel memory config. Empty copy teaches “remember …” / `xr memory add`.

---

## 11. Security UX

Shield is always on. The Shield composer chip is **status, not a kill switch**. Blocked actions: “Blocked by XR Shield” + reason. No internal detector dump.

---

## 12. Accessibility

- Keyboard: palette, composer, nav (`aria-current`), Enter/Space on `role="button"`.
- Streaming updates use a **polite** live region (`#xr-stream-announcer`, `#chat-run-status`). They must not steal focus.
- Colour is never the only status channel (words + glyphs).
- `prefers-reduced-motion` collapses pulses (existing dashboard rule).

---

## 13. Performance budgets

| Path | Rule |
|---|---|
| CLI `--version` / `--help` | Existing fast path; no new heavy imports |
| TUI palette open | Local command metadata only |
| Dashboard first useful paint | Shell first; chat-first routes do **not** wait on `/api/providers`+`/api/models` bundle |
| Chat TTFT | Phase 05 measurement; UX must not add a blocking health wait |
| Provider switch UI | Immediate local response; refresh asynchronously |

If a budget cannot be met: measure, document, do not fake the number.

---

## 14. Competitor principles (borrowed, not copied)

Documented in full in `docs/ux/02-competitive-research.md` and the Phase 12 report. Short form:

| Source | Why it works | XR adaptation | Not copied |
|---|---|---|---|
| Claude Code | Plan vs act; status line; Esc cancels | `plan`/`agent`/`ask`; status bar; truthful interrupt | Branding, permission-mode cycling UI |
| Gemini CLI | Review then apply | Approvals before writes | Free-tier / Google account flow |
| Goose | Explicit tool approval | Human `approve()` | Recipe YAML as the product |
| OpenClaw | Single-writer session; thinking-level | Lane per session; Ctrl+T on **real** timeline | Dialectical memory product |
| Hermes | Density without mascots | Information-dense TUI | Multi-channel gateway |
| Windsurf Cascade / Cline | Plan/Act + per-step approve | Plan mode + approval cards | Extension store, YOLO `-y` |

XR identity, local-first, BYOK, spend caps, and hash-chained audit stay XR’s.
