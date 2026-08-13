# 03 — User Personas

**Date:** 2026-08-13. Personas drive information architecture, onboarding and
the empty states. XR's mission explicitly serves both non-technical users and
advanced developers (mission §0, §39).

## Persona map

| # | Persona | Skill | Primary surfaces | Core jobs | Fears | Success metric |
|---|---|---|---|---|---|---|
| P1 | **First-Timer "Ayesha"** | Non-technical (marketing ops) | GUI dashboard, chat, onboarding | Ask questions, summarize docs, draft content | Cost, privacy, "breaking something", blank screens | First answer in < 3 min, zero terminal |
| P2 | **Prosumer "Daniyal"** | Technical but not a dev (analyst/ops) | GUI + occasional CLI | Research reports, automation, file handling, budget control | Silent spending, data leaving machine | Plans a multi-step task, approves confidently |
| P3 | **Developer "Zain"** | Software engineer | CLI/TUI first, dashboard second | Coding agent, refactors, MCP/skills, workflows | Context loss, no control over tool calls | Runs a full workflow from the TUI, monitors in GUI |
| P4 | **Power/Trust "Samira"** | Security-conscious operator / sysadmin | CLI, audit, policies, budget | Governance: approvals, budgets, audit verify, local-only ops | Tampering, secrets, supply chain | `xr audit verify` green; spends capped |
| P5 | **Hands-busy "Omar"** | Anyone in voice context | Voice, floating companion | Voice tasks while doing something else | Interruptions, wrong wake | Voice task runs through governed pipeline |

## Job stories (shared across personas)

1. When I open XR, **I want to understand what it can do without reading
   docs**, so I can try it immediately. → Empty state, onboarding, suggested
   prompts.
2. When I ask for something, **I want to see what XR is doing**, so I trust
   it. → Agent-state line, tool timeline, streaming.
3. When XR wants to act, **I want to know what/why/risk before I decide**, so
   I stay in control. → Approval cards.
4. When I pick a model, **I want to know local vs cloud and rough cost**, so I
   don't overspend or leak. → Locality badge, model cards.
5. When I come back, **I want to resume where I left off**, so I don't repeat
   myself. → Sessions/history, resume.
6. When something fails, **I want an honest reason and a next step**, so I can
   recover. → Error states (11-ui-state-model.md).

## Persona-driven requirements (traceable)

| Requirement | Personas | Where it lands |
|---|---|---|
| GUI onboarding with skip | P1, P5 | Phase B (roadmap) |
| Locality badges (local/cloud/offline) | P1–P5 | Phase A |
| Suggested prompts + capability chips | P1, P2 | Phase A (empty state) |
| Budget visibility in composer | P2, P4 | Phase A |
| What/why/risk approvals | P2, P3, P4 | Phase C |
| Keyboard-first TUI parity | P3, P4 | Phase D (polish) |
| Voice state avatar + offline path | P5 | Phase E |
| Context transparency (%, last-N) | P3 | Phase A |
| Audit + trust surfaces stay first-class | P4 | Keep (no regression) |

## Design tensions & resolutions

- **P1 wants simplicity; P4 wants density.** Resolve with progressive
  disclosure (already in sidebar) + density setting (existing `DENSITY`
  tokens: compact/default/cozy).
- **P5 wants voice everywhere; everyone wants quiet.** Voice is opt-in,
  hold-to-talk or explicit wake, local-first; never persistent listening
  (real constraint already in `src/voice/`).
- **P2 fears spending; P3 hates friction.** Budget caps are enforced at
  runtime (not UI-only); UI shows remaining + warns — calm, not scary.
- **P3 wants raw power; P1 wants plain language.** Same feature, two labels
  ("Add capability" / "Manage MCP · Skill · Plugin"), same underlying
  registry (mission §17).
