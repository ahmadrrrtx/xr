# XR 3.1 — Redesign Plan & File-by-File Implementation Map

## Release intent

XR 3.1 is a **polish release**.

It is not a new-capability release.
It is a coherence, launch feel, discoverability, and runtime ergonomics release.

## Design objective

Every interface should answer the same product question:

> “What is XR doing, where am I, what can I do next, and what will it cost or change?”

---

## Product pillars

### 1. One identity

CLI, TUI, dashboard, and website should all communicate:

- local-first trust
- spend-capped execution
- premium developer ergonomics
- OS-like control surfaces

### 2. One launch story

- install
- run `xr`
- pick workspace/session
- start working

### 3. One discoverability model

- command palette
- quick actions
- startup picker
- sidebar navigation
- status everywhere

### 4. One system truth

- provider/model
- budget/spend
- memory/research/voice
- workspace/cwd
- audit/git/runtime

---

## Implemented workstreams

## A. Boot flow redesign

### File
- `src/index.ts`

### Problem
XR booted the kernel too early and did not promote the best user surface.

### Change
- default `xr` now opens the fullscreen TUI
- `help`, `serve`, and `version` are fast paths
- kernel boot is deferred until command execution actually needs it

### UX win
Launch feels intentional and premium instead of utility-first.

---

## B. Fullscreen Shell redesign (XR 3.1 definitive experience)

### Files
- `src/interfaces/tui.ts` (entry re-export)
- `src/interfaces/shell/*` (app, render, layout, types)
- `src/ui/tokens.ts`, `theme.ts`, `primitives.ts`, `terminal.ts`, `icons.ts`, `ansi.ts`
- `src/ui/brand.ts`, `src/ui/css-vars.css`
- `docs/xr-3.1/XR-3.1-SHELL-IMPLEMENTATION.md`

### Problem
The old TUI was powerful but structurally still a prompt loop with full-screen redraws.

### Change
Rebuilt the Shell from the XR 3.1 research docs:

- design-token substrate shared with future Control Center / website
- alternate screen + clean restore + bracketed paste
- damage-region (line-diff) rendering
- animated startup from official logo/avatar assets
- three-pane responsive layout (sidebar · main · inspector)
- universal composer + status bar + command palette
- g-chord navigation, Esc priority stack, readline basics
- notifications, quick actions, help, mode/model overlays
- views: overview, chat, sessions, workspaces, research, activity, audit, memory, status, settings

### UX win
XR behaves like a professional native terminal application — one product identity, keyboard-first, high signal.

---

## C. Onboarding redesign

### Files
- `src/commands/install.ts`
- `src/interfaces/onboard.ts`

### Problem
Onboarding was conceptually strong but not actually the canonical first-launch product flow.

### Change
- `xr onboarding` now runs the dedicated onboarding UI directly
- added platform snapshot
- added internet and storage checks
- improved mode recommendation framing
- clarified provider key handling

### UX win
Users get a calmer setup path with stronger trust signals and less config anxiety.

---

## D. Dashboard data integrity upgrade

### Files
- `src/daemon/server.ts`
- `src/daemon/dashboard.ts`

### Problem
Dashboard quality was limited by placeholder values and thin overview APIs.

### Change
Added and/or expanded:

- richer overview payload
- live provider health payloads
- safe config payload
- workspace list payload
- richer sessions payload
- provider chip state wiring
- provider overview card wiring
- settings values from backend config

### UX win
Mission Control now reflects real XR state instead of decorative approximations.

---

## E. Website preview reliability upgrade

### Files
- `website/app/page.tsx`
- `website/app/layout.tsx`
- `website/app/globals.css`

### Problem
The in-app preview depended on remote assets and fonts.

### Change
- switched logo/avatar usage to local assets
- removed remote Google font dependency from preview path

### UX win
The website now renders more faithfully in offline/sandbox preview environments.

---

## File-by-file implementation plan

## 1. `src/index.ts`

### Purpose
Product bootstrap and launch routing.

### Responsibilities now
- route default launch to TUI
- keep non-kernel fast paths fast
- boot the kernel only for real command execution
- treat `serve` as a first-class surface

### Why it matters
This file defines first impression quality.

---

## 2. `src/ui/brand.ts`

### Purpose
Official XR terminal branding layer.

### Responsibilities now
- render terminal-safe official logo and avatar frames
- provide ANSI-safe helpers for width and padding
- separate product branding from layout logic

### Why it matters
Brand consistency across shell surfaces is now enforceable.

---

## 3. `src/interfaces/tui.ts`

### Purpose
Dedicated fullscreen XR shell.

### Responsibilities now
- startup flow
- workspace/session launching
- core navigation shell
- shell overlays
- chat/task composer
- slash-command routing
- activity and logs framing
- memory capture inline handling

### Why it matters
This is the new primary XR surface.

---

## 4. `src/commands/install.ts`

### Purpose
Command adapter layer.

### Responsibilities now
- point onboarding to the real onboarding UX instead of generic install flow

### Why it matters
Makes first-launch and re-onboarding behavior product-correct.

---

## 5. `src/interfaces/onboard.ts`

### Purpose
Guided first-time setup.

### Responsibilities now
- welcome framing
- system snapshot
- local model guidance
- provider recommendation path
- budget/security/memory/voice preferences

### Why it matters
Onboarding is now clearer, calmer, and more trust-forward.

---

## 6. `src/daemon/server.ts`

### Purpose
Local HTTP product backend.

### Responsibilities now
- provide richer overview state
- expose live provider health
- expose workspace list
- expose richer sessions data
- expose safe config values for UI

### Why it matters
The dashboard is only as good as the truth source behind it.

---

## 7. `src/daemon/dashboard.ts`

### Purpose
Mission Control UI.

### Responsibilities now
- reflect active provider/model correctly
- show live provider health in overview/providers panels
- read settings from real config payloads
- surface richer live state from daemon

### Why it matters
This turns the dashboard from “feature wall” into “system console.”

---

## 8. `website/app/page.tsx`

### Purpose
Marketing surface.

### Responsibilities now
- use local official brand assets

### Why it matters
Improves preview fidelity and keeps branding consistent.

---

## 9. `website/app/layout.tsx`

### Purpose
Global website shell.

### Responsibilities now
- avoid external font dependency for preview-critical rendering

### Why it matters
Matches Arena’s offline preview constraints.

---

## 10. `website/app/globals.css`

### Purpose
Global visual system.

### Responsibilities now
- avoid remote font import dependency

### Why it matters
Supports portable rendering and more resilient previews.

---

## Performance report

## What improved directly in this pass

### Launch path
- `xr` default path no longer boots the full kernel just to show a product entry surface.
- `help`, `serve`, and `version` avoid unnecessary subsystem startup.

### TUI responsiveness
- shell rendering is timer-driven and state-dirty-based.
- overlays reuse the same render loop instead of spawning nested UIs.

### Dashboard correctness over fake rendering
- provider summary now uses live API state.
- overview now includes richer data in a single payload, reducing client-side guesswork.

### Website preview reliability
- local assets and no remote fonts reduce broken preview states.

## Known remaining performance work

- full runtime profiling for plugin and MCP loading still needs measured instrumentation
- provider health fan-out in dashboard can be cached more aggressively later
- some repository-wide TypeScript debt exists outside this XR 3.1 polish scope

## Constraint note

The sandbox used for this implementation did not include Bun, so end-to-end runtime benchmarking of the Bun-native app stack was not completed inside this environment.

---

## Migration impact

### End-user impact
- `xr` now opens fullscreen TUI by default
- `xr onboarding` now opens the dedicated onboarding wizard
- dashboard shows more real state and fewer placeholders

### Developer impact
- new terminal branding helper in `src/ui/brand.ts`
- product boot flow in `src/index.ts` is now experience-first

### Compatibility note
Command surfaces remain available. The change is primarily in launch posture and interaction design.

---

## Validation checklist

### Launch
- [ ] `xr` opens fullscreen shell
- [ ] `xr help` returns immediately
- [ ] `xr serve` returns local URLs and stays running
- [ ] `xr onboarding` runs the dedicated onboarding flow

### TUI
- [ ] startup overlay appears
- [ ] workspace list can be navigated with keyboard
- [ ] command palette opens with `Ctrl+K`
- [ ] notifications open with `Ctrl+N`
- [ ] quick actions open with `Ctrl+J`
- [ ] views cycle with `Tab`
- [ ] slash commands work from composer

### Dashboard
- [ ] active provider chip matches backend state
- [ ] providers panel shows real provider health
- [ ] overview page renders memory/research/provider summary
- [ ] settings panel reflects config API values

### Website
- [ ] logo renders from local asset
- [ ] avatar renders from local asset
- [ ] preview works without remote font loading

---

## Release recommendation

XR 3.1 is suitable as a product-polish milestone once:

- manual smoke testing is done on Bun runtime
- `xr`, `xr onboarding`, and `xr serve` are verified on all supported OSes
- keyboard navigation in the TUI is exercised in real terminals
- dashboard endpoint regressions are checked end-to-end
