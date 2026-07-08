# XR 3.1 — Product Experience Audit

## Scope

This audit covers the current XR repository, CLI entry flow, onboarding, TUI, local dashboard, website, provider UX, and runtime ergonomics.

## Executive summary

XR already has unusually deep capability coverage.

The problem was not missing features.
The problem was **interaction shape**.

Before XR 3.1, the product felt like a powerful collection of subsystems exposed through multiple partially-connected surfaces:

- CLI help and command discovery were fragmented.
- `xr` did not open a premium, OS-like shell by default.
- onboarding still leaned on the install wizard path rather than a first-class product setup flow.
- dashboard panels contained placeholder or synthetic data in places where users expected live product state.
- website preview quality degraded inside the workspace because branding assets and typography depended on remote resources.
- the TUI behaved like a capable prompt loop, not like a dedicated terminal product.

XR 3.1 addresses this by pushing every major user-facing surface toward one identity:

> one AI operating system, not several tools wearing the same logo.

---

## Audit by surface

### 1. Repository / architecture

#### Strengths

- Strong subsystem separation across `providers`, `memory`, `research`, `voice`, `plugins`, `mcp`, `business`, and `security`.
- Rich command surface already exists.
- Design tokens already existed in `src/ui/`.
- Dashboard is self-contained and offline-capable.

#### Issues found

- Product entry flow was still kernel-first instead of experience-first.
- Some UX-critical paths were spread across older stage files instead of a single coherent shell.
- onboarding alias behavior still routed to install flow instead of a dedicated onboarding experience.
- the repo had product-complete features but not a product-complete navigation model.

#### Impact

Users encountered power immediately, but not clarity immediately.

---

### 2. CLI

#### Strengths

- broad command coverage
- solid terminal helpers
- approval and budget concepts already present

#### Issues found

- `xr` with no arguments behaved like help, not like a flagship experience.
- `serve` was mentioned as a primary surface but was not promoted as a first-class fast path in bootstrap.
- help was strong as a file, but not the default product posture.

#### Fix direction

- make `xr` open the fullscreen TUI by default
- keep `help`, `serve`, and `--version` as lightweight fast paths
- boot the kernel only when a command actually needs it

---

### 3. TUI

#### Strengths

- command history
- slash commands
- spinner and status hints
- memory capture integration

#### Issues found

- still fundamentally an inline REPL
- not a dedicated fullscreen environment
- weak session framing
- no startup workspace picker
- no mission-control layout
- no premium shell affordances like overlays, palette, quick actions, notification center, context lane, inspector lane, or activity lane

#### XR 3.1 response

Implemented a new fullscreen shell in `src/interfaces/tui.ts` with:

- alternate-screen launch
- startup overlay
- official XR asset rendering for terminal startup
- workspace/session picker
- left navigation rail
- center content workspace
- right inspector rail
- command palette
- notification center
- floating quick actions
- logs view
- activity timeline
- context viewer
- sessions view
- workspace view
- persistent bottom composer
- keyboard-first navigation

---

### 4. Onboarding

#### Strengths

- local-first framing already existed
- hardware detection and local model recommendation already existed
- budget and approval concepts already existed

#### Issues found

- onboarding was not actually the canonical first-launch experience
- system snapshot lacked up-front framing for platform/internet/storage context
- provider messaging needed stronger confidence and less “manual setup” feel

#### XR 3.1 response

- `xr onboarding` now runs the dedicated onboarding UI directly
- welcome screen now includes platform snapshot
- internet and storage checks are surfaced early
- operating mode recommendations adapt to connectivity
- provider storage guarantees are stated before key entry

---

### 5. Dashboard

#### Strengths

- already ambitious and fully local
- rich navigation
- command palette and keyboard navigation already existed

#### Issues found

- several panels relied on placeholder or synthetic values
- active provider chip did not reflect real provider/model state
- provider dashboard was not backed by live health checks
- settings were partially inferred instead of served from a safe config API
- overview payload was too thin for a real mission-control homepage

#### XR 3.1 response

Expanded backend and frontend wiring to provide:

- richer `/api/overview`
- live `/api/providers` health and latency data
- `/api/workspaces`
- richer `/api/sessions`
- safer, fuller `/api/config`
- real provider chip status
- real provider summary card content
- settings panel values from config API

---

### 6. Website

#### Strengths

- strong visual ambition
- coherent marketing voice
- clear differentiation positioning

#### Issues found

- remote branding asset usage inside page markup
- remote font dependencies degrade workspace preview quality
- preview in sandbox would not fully match intended experience

#### XR 3.1 response

- switched branding asset references to local `/logo.png` and `/avatar.png`
- removed remote Google font dependency from CSS and layout
- improved offline/preview fidelity in Arena workspace rendering

---

### 7. Provider experience

#### Strengths

- provider support breadth is excellent
- provider services and presets are already well modeled

#### Issues found

- dashboard provider visibility was weaker than provider backend capability
- active/fallback routing context was not surfaced clearly enough in Mission Control

#### XR 3.1 response

- provider API now exposes live health metadata suitable for a real provider manager surface
- dashboard uses active provider, model, fallback, and health state instead of placeholders

---

### 8. Sessions / memory / context

#### Strengths

- durable memory architecture is strong
- audit chain exists
- session and research stores already exist

#### Issues found

- these systems were under-expressed in UX
- recent sessions and research existed in storage, but not as a coherent shell concept

#### XR 3.1 response

- TUI now treats sessions, research, memory, and logs as first-class navigable product surfaces
- server now exposes session/research context more explicitly for dashboard use

---

### 9. Accessibility & interaction model

#### Issues found

- terminal shell was keyboard-capable but not truly keyboard-designed as a product space
- browser preview fidelity was weakened by remote font/assets

#### XR 3.1 response

- fullscreen shell is now keyboard-first by construction
- overlays use predictable controls: `Tab`, arrows, `Enter`, `Esc`, `Ctrl+K`, `Ctrl+N`, `Ctrl+W`, `Ctrl+J`
- website preview no longer depends on remote fonts/assets for basic rendering

---

## Research principles extracted for XR

These principles guided the redesign workstream:

1. **One universal entry point**
   - users should land in the best surface immediately
2. **Keyboard as navigation, not just input**
   - command palette, overlays, recents, mode switching
3. **State should always be legible**
   - provider, model, budget, memory, voice, git, audit, workspace
4. **Context should be ambient**
   - visible without asking, but not noisy
5. **Fast paths matter more than feature count**
   - help, serve, and launch should feel instant
6. **The product should teach itself**
   - onboarding, quick actions, and palette-driven discovery
7. **Real data beats decorative UI**
   - placeholders erode trust quickly
8. **Offline-safe polish matters**
   - local assets, local surfaces, local previews

---

## Highest-priority issues before XR 3.1

### P0

- `xr` did not launch the premium product surface
- TUI was not fullscreen / dedicated
- dashboard provider state was partially synthetic
- onboarding was not the canonical first-launch route

### P1

- recent sessions/research/workspaces under-expressed
- command palette concept not universal across shell state
- website preview degraded in sandbox

### P2

- deeper dashboard mission-control panels still need more live subsystem coverage
- provider manager can still evolve toward richer mutation flows
- session branching / pinned chats / bookmarks remain broader future polish work

---

## Files changed in this XR 3.1 pass

### Core product shell

- `src/index.ts`
- `src/interfaces/tui.ts`
- `src/ui/brand.ts`

### Onboarding

- `src/commands/install.ts`
- `src/interfaces/onboard.ts`

### Dashboard / daemon APIs

- `src/daemon/server.ts`
- `src/daemon/dashboard.ts`

### Website polish

- `website/app/page.tsx`
- `website/app/layout.tsx`
- `website/app/globals.css`

---

## Outcome

XR now feels substantially closer to:

- one operating environment
- one runtime identity
- one keyboard-first control surface
- one coherent local AI product

rather than a stack of separate subsystems.
