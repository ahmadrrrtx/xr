# 05 — User Flows

**Date:** 2026-08-13. Each flow is grounded in real runtime paths. States
(loading/empty/error/offline) are specified in `11-ui-state-model.md`; the
flow list drives the roadmap (`12-implementation-roadmap.md`).

## 1. Onboarding (GUI-first, CLI parity) — target ≤ 3 min to first value

```
Install/launch
  → Welcome (logo + avatar hero; "XR is your local AI agent — it works with
     your own provider key or a model on your machine.")
  → Choose how to run: Cloud (BYOK) · Local model · Both (recommended)
       each with one-line explanation + cost/privacy signal
  → Provider setup: pick preset → API key (masked) → Test connection (real
     health probe) → model select
  → Hardware detection (real: detectHardwareSpecs) → recommended local model
     with size/storage/expected speed → optional download (never silent;
     shows size + consent; offline-safe)
  → Permissions & security (plain language; defaults safe) → Budget cap
     (optional, one number)
  → Ready: first-prompt screen (suggested prompts) → first task runs through
     the real pipeline → success state shows audit entry ("your first action
     was recorded — you can verify it anytime")
Recovery: every step resumable; failures honest (offline → "skip cloud, use
local"); skip anywhere; progress persisted (reuse config/state keys).
```

## 2. First chat (P1)

```
Empty state (avatar + "What can I help with?" + 4 suggested prompts bound to
real commands) → type or click → composer shows locality (local/cloud) +
model + mode → stream → tool timeline cards expand → approval card if needed
(WHAT/WHY/RISK + Allow/Deny) → result with copy/export → session saved.
```

## 3. Provider / model switch

```
Provider chip (sidebar+topbar) → models panel → choose preset → configure
key (masked, stored via secrets vault) → Test (real health()) → choose model
→ locality badge updates → composer chip updates. Same path as TUI Alt+P,
same config keys.
```

## 4. Local model path

```
Models → Local runtime (Ollama detected via ollamaStatus) → hardware summary
(real) → recommended class (recommendLocalModel) → download size + consent →
pull with progress (real) → verify (testOllamaModel) → set active → offline
badge. Storage/network states honest.
```

## 5. Approvals (mission §18)

```
Agent requests consequential action → card: WHAT (tool+args) / WHY (agent's
stated reason) / RISK (risk class from guard) → Allow / Deny / (Detail)
→ outcome feeds the same approval store the CLI uses; denied ⇒ tool never
runs (runtime-enforced). Keyboard: Tab to buttons, Enter to confirm.
```

## 6. Voice (mission §12/§13) — honest scoping

```
Voice panel shows REAL state: available backends (STT/TTS), mic permission,
wake word status, offline path note. Start → mic on (hold-to-talk or wake) →
avatar state ring: listening → thinking → speaking (state from real
pipeline events) → stop. If browser mic/STT is not implemented in the
daemon, the panel honestly says "Voice runs via `xr voice …` in the
terminal" with a copyable command — no fake buttons (F-1).
Floating companion mode: spec'd as future; requires daemon event path.
```

## 7. Budget guard

```
Budget panel (real spend from src/cost) → set daily/monthly/task caps →
warning threshold → composer shows remaining as task runs → runtime stops
honestly at cap ("budget stop") → UI explains and offers: raise cap, switch
to local, or resume. Never a soft-fake meter.
```

## 8. Return & resume

```
Sessions panel: list (title, model, time) → open → full history → continue →
branch/pin/archive (already built) → export markdown (built). CLI parity:
`xr sessions`, `--resume`.
```

## 9. Skills / MCP / Plugins (mission §17)

```
One "Add capability" entry (palette + sidebar) → catalog from real registry
(skills marketplace / mcp manager / plugin loader) → search/filter → install
→ permissions shown before enabling → enable/disable/update/remove →
health + trust status visible. Beginner and advanced labels, same registry.
```

## 10. Coding workspace (mission §15)

```
Spec (Phase G, honest): chat-in-context + file cards + diff preview +
terminal panel (xterm.js, deferred) + approvals. Only what the runtime
supports today ships: file tools, git tools, workspace files panel, chat
with artifacts. Advanced editor = future, labeled experimental.
```

## Flow cross-check with mission §34 (final product standard)

| Mission step | Flow | Status |
|---|---|---|
| Install → open → understand | Onboarding 1 | Phase B |
| Configure provider/local | Flow 3–4 | Mostly exists; polish |
| Start chat → see work → approve → results | Flow 2, 5 | Exists; elevate |
| Voice → tools → files → skills → MCP → tasks → return | Flows 2, 6, 8, 9 | Phases A–F |
