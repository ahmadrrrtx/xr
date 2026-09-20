# Phase 3 — Omni depth, budget truth, drift legibility, brand integration

Status: implemented, verified 2026-09-19. Branch `phase2/elite-workstation`.

Phase 3 closes the "control plane" half of the findings list: the omni palette
becomes a real command surface over models/MCP/workspaces, money becomes
visible in the statusbar, MCP contract drift becomes readable where it lives,
runs become exportable product data, objects gain contextual menus — and the
six owner-supplied brand assets are wired through the brand gate.

## Scope delivered

| Item | Where | Real engine surface |
|---|---|---|
| F-8 omni palette depth | `commands/registry.ts`, `components/Palette.tsx` | `GET /providers`, `GET /mcp`, `GET /workspaces`, `POST /providers/set`, `POST /workspaces/switch` |
| F-11 budget meter | `poll.ts`, `components/AppShell.tsx` | `GET /budget` (30s poll; button hidden unless month>0 or cap>0 — no fake zero) |
| MCP drift card | `screens/Library.tsx` | `POST /mcp/pin-diff` rendered inline (changed/added/removed, −/+ semantic rows) |
| Runs export | `screens/Runs.tsx` | client-built blob from `GET /sessions/:id` verbatim — `.md` summary + `.json` engine record |
| Context menus (files/runs/skills/messages) | `components/ContextMenu.tsx` + `Workspace/Runs/Library/Work` | files: Open/Ask XR/Copy path · runs: Open/Export md/Export json/Copy id · skills: detail sheet/Run in Work/Enable/Copy id · chat bubbles: Copy/Edit-into-input/Send-again/Follow-up |
| Agents board v2 | `screens/Teams.tsx`, `prism2.css` | dependency edges + per-node burn bars were already engine-driven; Phase 3 adds failure halos (`halo-fail`, pulsing, reduced-motion safe) and review halos (`halo-wait`) |
| Skill detail sheet examples/run | already engine-real upstream (inspect report + declared commands seeding Work) — verified, not re-built |
| Brand integration | `Brand.tsx`, `Onboarding.tsx`, `Settings.tsx`, `Workspace.tsx` | new registered renders only |

## Brand assets (owner-supplied, gate-enforced)

- `xr-terminal-splash.png` (89 KB) → terminal empty-state MOTD.
- `xr-readme-hero.png` (1.7 MB) → Settings ▸ General ▸ About hero + identity kv.
- `xr-superior-hero-3.png` → onboarding Ready step banner only (cinema zone;
  step-0 stays the calm lockup by design law).
- Originals archived in `assets/brand/*-original.png`.
- `scripts/desktop-brand-check.ts --write` → REGISTRY.json 38 entries;
  verify: `38 registered · 37 modules scanned · 0 violations`.
- No webp conversion was possible in this sandbox (no ffmpeg available);
  the readme hero ships as PNG inside the lazy Settings chunk.

## Verification

- `tsc --noEmit && vite build` green.
- Full suite: 3,363 pass / 19 skip / 0 fail (~155s). (Two transient failures
  were environment-only: a placeholder key stored in `~/.xr` during capture
  polluted the fresh-install onboarding test, and the sandbox snapshot had
  dropped `.git` — both fixed: key removed, history rebuilt from upstream.)
- Live captures `audit/screens3/`: 01 onboarding Ready (superiority hero),
  02 Settings About hero, 03 terminal splash MOTD, 04 file context menu,
  05 palette omni model results (`openrouter · …` routes the engine),
  08 team board live (edges + burn bars), 09 runs context menu,
  10 skill context menu, 11 palette skill hits ("run in Work"),
  12 failure halos on failed execution nodes with live `[TASK.FAILED]`
  transcript.
- DoD watch: a real 3+-role team run (memory_manager → planner → researcher
  workers → reviewer → synthesis) was started through
  `POST /agents/workflows` and watched live on the board; the workers failed
  honestly against an unprovisioned model and the board reported it (halos,
  failed count, audit trail) — no faked success state.

## Git note

The sandbox snapshot did not preserve `.git`; history was rebuilt by
grafting the upstream clone (base `b531837`). Prior local commit hashes
(e4198ca/1629996) therefore do not exist in this environment; Phase 2 + 3
work lands as fresh commits on `phase2/elite-workstation` with identical
content and an intact upstream ancestry.

## Remaining program

- Phase 4: voice productization (F-3), team presets, updater signing UX.
- Phase 5: light-theme parity audit (F-10), density polish, a11y sweep.
