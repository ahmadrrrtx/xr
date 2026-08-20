# XR Surface Parity

Phase 12 capability matrix. Goal: **coherent behavior**, not identical feature count.

Legend: **SUPPORTED** · **PARTIAL** · **NOT APPLICABLE**

Backend source is the authority. UI must not reimplement it.

| Capability | CLI | TUI | Chat | Dashboard | Backend source |
|---|---|---|---|---|---|
| Start task | SUPPORTED (`xr run` / `xr ask` / `xr plan`) | SUPPORTED (composer) | SUPPORTED (`POST /api/chat`) | SUPPORTED (New task → chat) | AgentService / execution fabric |
| Continue session | SUPPORTED (`xr session`) | PARTIAL (session list; resume is inspect + new prompt) | PARTIAL (local thread cache; `/session` lists durable rows) | SUPPORTED (inspect steps; no fake resume API) | WorkspaceStore sessions |
| Interrupt | SUPPORTED (Ctrl+C in a run) | SUPPORTED (Esc / Ctrl+C → abort + checkpoint wait) | SUPPORTED (Esc / stream cancel) | SUPPORTED (palette Interrupt) | AbortSignal → loop `stopped:"cancelled"` |
| Provider switch | SUPPORTED (`xr providers set`) | SUPPORTED (Alt+P, `/model`) | SUPPORTED (`/model`, `/provider`) | SUPPORTED (Providers panel, Alt+P) | `config.defaults` + `/api/providers/set` |
| Model switch | SUPPORTED (`xr models set`) | SUPPORTED (`/model`) | SUPPORTED (`/model`) | SUPPORTED (Models panel) | same + `/api/models/select` |
| Tool approval | SUPPORTED (CLI confirm) | SUPPORTED (confirm overlay) | SUPPORTED (`/api/chat/approve`) | SUPPORTED (control pending + chat approve) | `approve()` in the run; policy still gates |
| Memory status | SUPPORTED (`xr memory`) | SUPPORTED (Memory view, `/memory`) | SUPPORTED (`/memory`) | SUPPORTED (Memory panel) | MemoryStore + `/api/memory` |
| Research status | SUPPORTED (`xr research`) | SUPPORTED (Research view, `/research`) | SUPPORTED (`/research`) | SUPPORTED (Research panel) | research jobs + `/api/research` |
| Security status | SUPPORTED (`xr doctor`, audit) | SUPPORTED (`/permissions`, Shield via status) | SUPPORTED (`/permissions`) | SUPPORTED (Shield, Audit) | Shield + config.security |
| Session list | SUPPORTED | SUPPORTED | SUPPORTED (`/session`) | SUPPORTED | `/api/sessions` |
| Audit | SUPPORTED (`xr audit`) | SUPPORTED (Audit view) | PARTIAL (`/status` chain bit) | SUPPORTED (Audit panel) | hash-chained store |
| Budget | SUPPORTED (`xr budget`) | SUPPORTED (`/budget`) | SUPPORTED (`/budget`) | SUPPORTED (Budget panel) | cost store + `/api/budget` |
| Command palette | NOT APPLICABLE | SUPPORTED (Ctrl+K, local items) | NOT APPLICABLE | SUPPORTED (Ctrl+K / ⌘K) | local metadata |
| Streaming tokens | PARTIAL (CLI prints as available) | PARTIAL (live assistant line + timeline) | SUPPORTED (SSE token events) | SUPPORTED (same chat) | Phase 05 `ChatStreamEvent` |
| Plan mode | SUPPORTED (`xr plan`) | SUPPORTED (`/mode plan`, Shift+Tab) | SUPPORTED (Plan chip + `/plan`) | PARTIAL (chat mode chip) | `Mode = plan` (no tool exec) |
| Doctor | SUPPORTED (`xr doctor`) | PARTIAL (`/doctor` → status + honest CLI pointer) | PARTIAL (`/doctor` does not fake a doctor pass) | NOT APPLICABLE | `xr doctor` CLI |
| Context compact | PARTIAL (engine auto) | PARTIAL (`/compact` explains; no fake switch) | PARTIAL (same) | NOT APPLICABLE | context engine microcompact |
| @file mentions | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE (not faked) | PARTIAL (Files panel “Ask XR” inserts a path) | `/api/files` (read-only) |
| Repo intelligence | SUPPORTED (`xr repo`) | NOT APPLICABLE as a view | PARTIAL (agent seed when index ready) | NOT APPLICABLE | Phase 11 `src/repo` |

Notes:

- **PARTIAL** means the surface tells the truth and routes to the real backend, without pretending a missing API exists.
- Chat `localStorage` threads are not a second session store.
- Computer-control approvals (`/api/control/*`) and chat tool approvals (`/api/chat/approve`) are different queues on the same human-only rule.
