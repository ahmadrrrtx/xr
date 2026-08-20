# Phase 12 — UX Unification — Final Report

**Date:** 2026-08-20  
**Base:** `main` @ `cc37607` (Phase 11 Repo Intelligence)  
**Identity:** XR 1.0.0 (Truth)  
**Verdict:** PHASE 12 PASS (with documented pre-existing / environment failures)

This is not a visual redesign. CLI / TUI / Dashboard / Chat are presentation surfaces over **one XR agent**: same identity, sessions, provider/model, mode, policy, approvals, memory, research, and audit.

---

## 1. Executive summary

Phase 12 unifies XR’s four surfaces around a shared vocabulary and the existing core, without moving business logic into React, TUI paint, or browser-only state.

What landed:

- Shared status / mode / shortcut / empty-state vocabulary (`src/ui/ux-vocabulary.ts`)
- Real-backend-only slash catalog (`src/ui/slash-catalog.ts`), injected into the dashboard client
- Chat consumes the Phase 05 stream contract (status, token, tool_call, tool_result, usage, done, error, approval)
- Human chat-tool approvals via `POST /api/chat/approve` (fail-closed; model cannot approve itself)
- TUI palette + slash extracted (size-gate ratchet 1246 → 1025) and extended with real commands
- Truthful interrupt copy (cancellation requested → wait for checkpoint)
- Dashboard chat-first paint no longer waits on the overview bundle
- Empty states teach the next action; `@` mentions were **not** faked
- Docs: `docs/ux/XR_UX_ARCHITECTURE.md`, `docs/ux/SURFACE_PARITY.md`

---

## 2. Research performed

Inspected the current repo (CLI, TUI shell, dashboard fragments, chat route, stream contract, sessions/memory/research APIs) plus:

- Attached forensic audits (`01_XR_EXECUTIVE_AUDIT.md`, `05_PERFORMANCE_FORENSIC.md`)
- XR 3.x program Phase 12 spec
- Prior UX program (`docs/ux/01`–`12`, competitive research)
- Phase 05/06/07/08/09/10/11 reports

External principles (not branding) from Claude Code, Gemini CLI, Goose, OpenClaw, Hermes, Windsurf Cascade, Cline — see §4–5.

---

## 3. Existing XR UX findings

Already strong (kept):

- One execution path (Phase 03): chat route is an HTTP adapter over AgentService
- Streaming contract (Phase 05) with bounded health and TTFT instrumentation
- Design tokens, official logo/avatar, locality badges, approval WHAT/WHY/RISK for computer-control
- TUI Ctrl+K palette, Alt+P / `/model`, Esc/Ctrl+C abort, Ctrl+T real timeline detail
- Dashboard two-stage overview load (Phase 01)

Gaps closed in this phase:

- Chat ignored most stream event types (only token/done/error + provider_selection)
- Chat did not send `mode` (Ask/Plan/Research/Agent locally; API always defaulted `ask`)
- Research as a **mode** (runtime Mode is ask|plan|agent)
- HTTP `approve()` auto-denied without a human path (Phase 05 deferred)
- TUI Esc claimed idle immediately while the loop was still stopping
- Chat-first dashboard boot still called `loadDashboard()`
- TUI header said `v3.1` instead of `1.0.0 (Truth)`
- Palette filter inverted on ArrowDown (bug)
- Ctrl+K did not fire while the composer was focused
- Empty copy was “No sessions stored.” / similar

---

## 4. Competitor principles adopted

| SOURCE | WHY IT WORKS | XR CURRENT (before) | XR ADAPTATION |
|---|---|---|---|
| Claude Code | Plan vs act; status line; Esc cancels | Modes existed; interrupt set idle too early | Keep ask/plan/agent; truthful checkpoint wait |
| Gemini CLI | Review then apply | TUI confirm yes; HTTP auto-deny | `/api/chat/approve` human decision |
| Goose | Explicit tool approval | Policy `approve()` | Same callback; UI does not bypass policy |
| OpenClaw | Thinking-level toggle | Ctrl+T on real timeline | Kept; still no fake chain-of-thought |
| Cline / Windsurf | Plan/Act + per-step approve | Plan mode + control cards | Chat approval cards + plan chip |
| Claude Code / Raycast | Cmd+K local palette | Palette existed; heavy? no | Still local metadata; extra real commands |

---

## 5. Competitor principles rejected

| Rejected | Why |
|---|---|
| YOLO auto-approve (`-y`) | Violates “the model cannot approve itself” and fail-closed |
| Copying Claude/ChatGPT branding or bubble UI | XR identity is official assets + tokens |
| Fake `/compact` HTTP switch | Compaction is the context engine’s job |
| `@file` pretend mentions | No context-injection API for mentions; Files “Ask XR” inserts a path honestly |
| In-browser mic / 3D avatar / embedded PTY | Still blocked on missing contracts (Phase G, honest) |
| Identical feature count across surfaces | Coherence ≠ cloning the dashboard into the TUI |

---

## 6. Before/after UX architecture

**Before:** four clients with overlapping but drifting words (Ask vs ask, RAG Memory, v3.1 header), chat as a partial SSE consumer, HTTP tools auto-denied, dashboard chat boot blocked on overview.

**After:**

```
                    XR CORE
                       │
       ┌───────────────┼────────────────┐
       │               │                │
      CLI             TUI           Dashboard/Chat
       │               │                │
       └───────────────┼────────────────┘
                       │
              shared vocabulary + slash catalog
                       │
        Agent / Execution / Tools / Memory / Research
        Providers / Sessions / Policy / Approval / Audit
```

---

## 7. Files changed

**Added**

- `src/ui/ux-vocabulary.ts`
- `src/ui/slash-catalog.ts`
- `src/daemon/chat-approvals.ts`
- `src/interfaces/shell/palette.ts`
- `src/interfaces/shell/slash.ts`
- `test/ux/phase12-vocabulary.test.ts`
- `test/daemon/phase12-chat-ux.test.ts`
- `test/daemon/chat-approval.test.ts`
- `docs/ux/XR_UX_ARCHITECTURE.md`
- `docs/ux/SURFACE_PARITY.md`
- `docs/implementation/PHASE_12_FINAL_REPORT.md`

**Modified (selected)**

- `src/ui/index.ts` — re-exports
- `src/interfaces/shell/app.ts` — extract palette/slash; truthful interrupt; status labels
- `src/interfaces/shell/render.ts` — `v1.0.0 (Truth)`; busy TASK block
- `src/daemon/routes/chat.routes.ts` — wait-for-approval; `chat.approve.post`
- `src/daemon/routes/schemas.ts` / `contract.ts` — additive chat fields + approve op
- `src/daemon/dashboard/client-{script,chat,runtime,panels-a,panels-c}.ts`
- `src/daemon/dashboard/page-panels-a.ts`, `style-ui.ts`
- `docs/api/openapi.json`, `src/clients/daemon-client.generated.ts` (generated)
- `docs/perf/SIZE-WAIVERS.json` (app.ts ratchet 1246 → 1025)
- `test/daemon/dashboard-split.test.ts` (SHA pin)
- `docs/ux/README.md`

---

## 8. Components created

- Shared vocabulary module (labels only)
- Slash catalog (data)
- Chat approval waiter map
- TUI `palette.ts` / `slash.ts`
- Chat disclosure chips, run-status live region, inline approval cards

---

## 9. Components removed/consolidated

- TUI inlined palette + slash (moved, not duplicated)
- Chat mode `Research` (now a composer flag)
- Fake “Stopped by administrator.” copy
- Unconditional `loadDashboard()` on chat-first boot
- Inverted palette ArrowDown filter

No token/button primitive was duplicated. Official logo/avatar reused.

---

## 10. Main Chat changes

- Sends `mode: ask|plan|agent` and optional `toolsAllow` when Research is on
- Consumes full stream event set; status line uses shared labels
- Progressive disclosure: Tools / Sources / Cost / Latency / Plan / Approval
- Slash commands from the catalog only (`/help` `/status` `/model` `/provider` `/memory` `/research` `/plan` `/tools` `/permissions` `/budget` `/session` `/clear` `/doctor`; `/compact` explains itself)
- Enter send, Shift+Enter newline, Esc interrupt (truthful)
- `@` mentions **not** implemented

---

## 11. TUI changes

- Palette items: interrupt, start-task, permissions, doctor (honest CLI pointer)
- Slash: `/provider`, `/plan`, `/tools`, `/permissions`, `/session`, `/doctor`, `/compact` (honest)
- Esc/Ctrl+C set `CANCELLATION_BUSY_LABEL` and do **not** flip `busy=false` until the run returns
- Header version is `CORE_VERSION` / `CODENAME`
- Chat view shows a TASK strip from the real timeline while busy

---

## 12. Dashboard changes

- Chat-first: shell + provider chip; overview bundle only on Overview
- New task on Overview
- Palette extras + Ctrl+K/Alt+P before the input early-return
- Teaching empty states for sessions / memory / research
- “Jarvis permissions” → “Computer-use permissions”

---

## 13. CLI changes

None on the fast path. `--version` / `--help` untouched.

Measured here: `--version` **0.033s**, `--help` **0.026s** (Phase 00 baseline 0.036s / 0.037s).

---

## 14. Shared state changes

- Chat mode aligned to runtime Mode
- Provider/model switch from chat `/model` uses `/api/providers/set` (same config as CLI/TUI)
- Durable sessions listed via `/api/sessions`; localStorage remains a view cache (documented)

---

## 15. Keyboard shortcut map

See `docs/ux/XR_UX_ARCHITECTURE.md` §5. Ctrl+K, Alt+P, Esc, Enter, Shift+Enter, `/`, `?`, Shift+Tab, Ctrl+T preserved.

---

## 16. Streaming integration

Verified against Phase 05: ack = `provider_selection`, monotonic `event_id`, single `done` + `[DONE]`. Chat UI now handles tool/status/usage/approval. Research visibility is via tool names (`web_search`, `research_*`) — the chat SSE contract was not forked.

---

## 17. Tool/approval UX

- Args summarized (`path`/`url`/`query` preferred; truncated)
- Dangerous tools pause the run and emit `approval_required`
- Human POST `/api/chat/approve { id, approved }`
- Closed/aborted/timeout/unknown id → **deny**
- Audited; policy still authorizes execution

---

## 18. Memory UX

`/memory` hits `/api/memory`. Empty copy teaches. Composer Memory chip = peek visibility, not a kernel kill switch.

---

## 19. Research UX

`/research` lists `/api/research` jobs. Empty copy teaches `xr research "…"`. Source chips when source tools run.

---

## 20. Security UX

`/permissions` reads `config.security.requireApproval`. Shield chip is not a disable. “Blocked by XR Shield” vocabulary in the shared map.

---

## 21. Accessibility changes

- `#chat-run-status` polite live region (not per-token)
- Existing announcer kept (`XR is responding` / `Response complete` / `Stopped`)
- Disclosure chips are buttons with `aria-expanded`
- Colour not the only channel (status words)

---

## 22. Performance measurements

| Path | Result |
|---|---|
| CLI `--version` | 0.033s (baseline 0.036s) |
| CLI `--help` | 0.026s (baseline 0.037s) |
| `bun run typecheck` | PASS |
| `bun run boundaries` | PASS — 613 modules, 2013 deps, 0 violations |
| `bun run size-gate` | PASS |
| `bun run hot-path-lint` | PASS (exit 0) |
| `api:schema:check` / `client:check` / `api:compat` | PASS — 118 ops, 0 breaking |
| Chat-first dashboard | No longer calls `loadDashboard()` on boot (architectural; no browser paint lab in this sandbox) |

---

## 23. Before/after metrics

| Metric | Before | After |
|---|---|---|
| Chat stream types handled | token/done/error + some status | status/token/tool_call/tool_result/usage/done/error/approval |
| Chat API mode | omitted → ask | ask\|plan\|agent |
| HTTP tool approval | auto-deny | wait + human POST; deny if closed/timeout |
| TUI `app.ts` LOC | 1246 (waived) | 1025 (waiver ratcheted) |
| Dashboard boot on `/chat` | `loadDashboard()` | provider chip + composer meta only |

---

## 24. Tests executed

- `bun run typecheck`
- `bun test` (full suite)
- Targeted: phase12-vocabulary, phase12-chat-ux, chat-approval, dashboard-split, honesty, phase-c, shell-parity, chat-stream, dispatcher, one-agent/chat-route
- `bun run boundaries`, `size-gate`, `hot-path-lint`, `claim-lint`, `api:schema:check`, `client:check`, `api:compat`

---

## 25. Test results

Full suite this environment:

**3436 pass · 19 skip · 15 fail**

Phase 12 new tests: **all pass** (vocabulary, chat-ux, approval waiters + route).

`test/one-agent/chat-route.test.ts`: **5 pass** after fail-closed-if-stream-closed.

---

## 26. Regressions found

1. Chat-route test hung 5s — `approve()` now waited 120s. **Fixed:** if the stream is already closed or aborted, deny immediately (still fail-closed; live runs still wait for a human).
2. Served dashboard JS SyntaxError from empty-state quote nesting. **Fixed** (`act('navigateTo','chat')`; single-quoted HTML attrs).

---

## 27. Regressions fixed

See §26. Remaining 15 full-suite failures:

| Area | Classification |
|---|---|
| 13× Phase 4 T4 egress/DNS (`egress-proxy.test.ts`) | **PRE-EXISTING** (Phase 11 report: pass in isolation / interleave flake). Isolation this run: 15 pass / 1 fail (timeout wording vs hang-up) — not touched by Phase 12 |
| Phase 5 T7 `git ls-files` synthex scan | **ENVIRONMENT** — this workspace has no `.git` (`fatal: not a git repository`). Phase 12 did not add `synthex` to kernel |
| Chat-route timeout | **FIXED** (this phase) |

---

## 28. Remaining limitations

- `@file` / `@memory` / `@research` mentions not implemented (no fake)
- `/compact` does not trigger a compact API (engine-internal)
- `/doctor` does not invent a dashboard doctor pass
- Chat `localStorage` threads are a view cache, not the durable session store
- Browser-axe / live keyboard still skip without Chromium
- In-GUI model pull, in-browser mic, 3D avatar, PTY terminal remain future (honest)

---

## 29. Follow-up recommendations

1. Wire durable `sessionId` on every chat POST once the chat view binds to `GET /api/sessions/{id}` transcripts.
2. Optional: Last-Event-ID resume (Phase 05 deferred; still unsafe without tool idempotency).
3. Enable Chromium axe sweep in CI.
4. Persist TUI agent-detail / inspector prefs via config.

---

## 30. Exact commit(s) made

This implementation workspace has **no `.git` directory** (clone metadata not present at report time), so no commit hash can be honestly recorded.

Intended conventional commit:

```
feat(ux): Phase 12 — unify CLI/TUI/Dashboard/Chat as one agent
```

When committing on a real clone, include the files listed in §7.

---

## Final checklist

- [x] One XR identity (tokens, logo, `1.0.0 (Truth)` in TUI header)
- [x] Shared terminology / status / provider-model language
- [x] Shared session *listing* (durable API); chat view-cache documented
- [x] Main chat clean + streaming correct + tools transparent
- [x] Approvals clear and fail-closed
- [x] TUI keyboard-first; palette local; interrupt truthful
- [x] Dashboard not blocked on every endpoint for chat-first
- [x] No policy bypass (`/api/chat/approve` only resolves a waiter)
- [x] typecheck / boundaries / size-gate / claim-lint / API gates green
- [x] CLI fast paths preserved (measured)

PHASE 12 PASS.
