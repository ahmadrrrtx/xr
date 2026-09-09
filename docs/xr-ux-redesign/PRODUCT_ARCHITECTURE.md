# XR Product Architecture — Post-Redesign

## Core Identity

**XR is an AI Operating System** — a local-first, provider-neutral agent runtime that unifies chat, automation, tool orchestration, memory, and governance into a single coherent system.

## Product Pillars

### 1. Ask → Plan → Act → Review
The fundamental user loop. Users express intent; XR decomposes, executes, and surfaces results.

### 2. Local-First, Cloud-Optional
All data, configuration, and audit trails live on the user's machine. Cloud models are tools, not dependencies.

### 3. Trust by Design
Every consequential action passes through a human-readable approval gate. Audit is tamper-evident.

### 4. Composable Capabilities
Skills, plugins, and MCP servers extend XR's abilities. Each has a manifest, permissions, and provenance.

## User Surfaces

| Surface | Purpose | Priority |
|---------|---------|----------|
| **Web Dashboard** | Primary control center — chat, runs, agents, memory, approvals | P0 |
| **CLI** | Terminal-native power — scripting, automation, CI | P0 |
| **TUI** | Keyboard-first interactive sessions | P1 |
| **Marketing Site** | Discovery, documentation, marketplace | P1 |

## Information Architecture (Redesigned)

### Primary Navigation
1. **Home** — Command center: "What would you like XR to do?"
2. **Chat / Work** — Conversational workspace with live execution
3. **Runs** — Activity timeline, history, inspection
4. **Agents** — Workers: create, configure, monitor

### Secondary Navigation
5. **Extensions** — MCP, plugins, skills marketplace
6. **Memory** — Persistent context, notes, project knowledge
7. **Settings** — Configuration, providers, trust, security

### Removed / Merged
- ~~Dashboard~~ → Home (consolidated)
- ~~Models~~ → Settings → Providers (collapsed)
- ~~Guardrails~~ → Settings → Trust (merged)
- ~~Resources~~ → Distributed across relevant surfaces
- ~~Workspace~~ → Settings → General (merged)

## Mental Model for Users

Users think: "I ask XR to do something."

They do NOT think about:
- Daemon architecture
- Provider routing
- Execution envelopes
- RAG ledgers
- Policy internals

These are implementation details revealed only on demand.
