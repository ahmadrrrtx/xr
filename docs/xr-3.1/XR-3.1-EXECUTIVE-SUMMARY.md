# XR 3.1A — Executive Summary
> Product Experience Research & Master UX Architecture

**Status:** Foundation document for all downstream spec work.
**Audience:** Product, design, engineering leadership, and implementation agents.
**Scope:** Product experience only. Backend is frozen.

---

## 1. The thesis

XR has built what may be the most ambitious AI-agent backend ever shipped in a single open-source project:

- Local-first + BYOK hybrid provider engine
- Code-enforced cost governor
- Tamper-evident SHA-256 audit chain
- Prompt-injection defense lab
- Egress allow-list
- Skills runtime + marketplace
- MCP, plugins, multi-agent workflows
- JARVIS-level computer control (vision + action)
- Durable memory with RAG
- Source-first research mode
- Voice wake/speak
- Business OS modules (CRM, finance, HR, etc.)
- Cross-platform (Linux/macOS/Windows/Termux)
- Telegram bot remote
- VS Code extension

**The backend is not the problem.**

The problem is that none of this power feels like one product. It currently feels like 6 different products wearing the same cyan logo:

1. A CLI tool
2. A terminal REPL (the old TUI)
3. A fullscreen TUI shell (the new one)
4. A browser dashboard ("Mission Control")
5. A marketing website
6. A VS Code extension / Telegram bot / voice surface

Each surface uses its own navigation model, its own layout language, its own vocabulary, and — critically — its own idea of what "XR" is.

## 2. Why XR feels slow

XR does not feel slow because it is slow. It feels slow because:

| Perceived slowness | Real cause |
|---|---|
| "Takes forever to start" | `xr` historically booted the kernel, registered every command, and initialized stores before giving the user anything to look at. The user is staring at a blank prompt while dependency resolution happens. |
| "Chat feels laggy" | Dashboard chat calls `/api/chat` which calls `provider.chat()` (non-streaming) and emits one SSE `text` blob at the end. The user sees nothing for the entire generation. |
| "Screens take forever to load" | Dashboard panels fire 4–7 parallel `fetch()`es per panel load (dashboard hits 7 endpoints). Each shows its own spinner. No skeleton, no optimistic state, no shared cache. |
| "CLI commands feel heavy" | Even `xr --version` historically booted a kernel. (Fixed in `src/index.ts` fast-path, but the pattern lingers in other entry points.) |
| "TUI redraws jitter" | TUI re-renders on a 100ms ticker and rewrites the entire alternate screen every state change, regardless of what changed. There is no damage-region tracking. |
| "Website feels like a different app" | Website uses Syne + Jakarta Sans + Framer Motion + Tailwind glassmorphism. TUI uses JetBrains Mono + ASCII boxes. Dashboard uses a third hybrid. No shared motion or spatial system. |
| "Onboarding drags" | Onboarding runs 4 sequential async checks (internet, hardware, Ollama, providers) before the first question is answered. No progress composition. |

The fix is not "make the backend faster." The backend is already fast (the provider hot path is a single HTTP call with streaming). The fix is **perceived performance architecture**: lazy boot, streaming everywhere, optimistic UI, shared state, and a zero-blank-screen startup.

## 3. Why XR feels fragmented

Fragmentation is not a skin problem. It is an **information architecture** problem.

There is no canonical answer to:

- "Where do I go to do X?"
- "What mode am I in?"
- "What is XR doing right now?"
- "How much money have I spent this session?"
- "Which workspace am I in?"
- "How do I get back to where I was?"

Each surface answers these questions differently:

| Question | CLI | TUI | Dashboard | Website |
|---|---|---|---|---|
| "Where am I?" | cwd prompt | Sidebar "XR shell" | Topbar title | URL |
| "What mode?" | `--mode` flag | Composer `[agent]` | Provider chip | N/A |
| "How much spent?" | End-of-task | Status bar | Budget panel | N/A |
| "What's it doing?" | Streaming lines | Spinner + timeline | Refresh button | N/A |
| "How do I switch context?" | `cd` + re-run | Ctrl+W | Workspaces panel | N/A |
| "What commands exist?" | `xr help` | Ctrl+K | ⌘K palette | CTA buttons |

Different answers to the same mental-model question is the definition of fragmentation.

## 4. How XR becomes ONE operating system

XR 3.1A establishes **one substrate** that every surface renders:

```
┌──────────────────────────────────────────────────────────────┐
│                    XR EXPERIENCE KERNEL                      │
│  (not backend kernel — this is the UX contract)             │
│                                                              │
│  • Session     • Workspace    • Mode        • Budget        │
│  • Provider    • Model        • Memory      • Activity      │
│  • Approvals   • Plugins      • Skills      • Audit         │
│  • Research    • Voice        • Shield      • Computer      │
└──────────────────────────────────────────────────────────────┘
          ▲               ▲                ▲               ▲
          │               │                │               │
     ┌────┴────┐    ┌─────┴─────┐   ┌──────┴─────┐   ┌────┴────┐
     │  TUI    │    │ Dashboard │   │  CLI/Shell │   │ Website │
     │ (term)  │    │ (browser) │   │ (pipe)     │   │(marketing│
     │         │    │           │   │            │   │ + docs) │
     └─────────┘    └───────────┘   └────────────┘   └─────────┘
```

Every surface renders the **same state object**, answers the **same questions**, uses the **same vocabulary**, and supports the **same command palette**.

The user should be able to move from `xr` (TUI) to `xr serve` (Dashboard) to `xr "task"` (CLI) to VS Code without re-orienting. Same XR. Same brain. Same identity.

## 5. Three non-negotiable design commitments

### Commitment 1: The Composer is the universal input
There is exactly one place where a user tells XR what to do: the **composer**. It lives at the bottom of the TUI, the bottom of the Dashboard chat, and is the grammar of the CLI (`xr "<composer content>"`). It understands slash commands, natural language, @-mentions (files, skills, providers), and #tags (modes, workspaces).

### Commitment 2: The Status Bar is the universal ground-truth
There is exactly one strip of UI that always tells you: workspace · mode · provider/model · spend · activity · trust state. It is the last line of the TUI, the topbar chips in the Dashboard, and the PS1-adjacent line in CLI mode. Same values, same order, same colors, everywhere.

### Commitment 3: The Command Palette is universal
Ctrl/Cmd+K works in the TUI, in the Dashboard, and (by documentation) on the website. It exposes the same canonical set of actions with the same names and the same keyboard mnemonics. Learning it once means knowing XR.

## 6. What these documents deliver

| Document | Purpose |
|---|---|
| `XR-3.1-EXECUTIVE-SUMMARY.md` | This file. The one-pager that sells and anchors the redesign. |
| `XR-3.1-PRODUCT-EXPERIENCE-AUDIT.md` | Evidence-based audit of every current surface, with specific lines/files cited. |
| `XR-3.1-COMPETITIVE-RESEARCH.md` | Deep research across AI coders, TUIs, chat apps, dashboards, onboarding. |
| `XR-3.1-UX-RESEARCH.md` | User-centered findings: cognitive models, pain points, jobs-to-be-done. |
| `XR-3.1-DESIGN-PHILOSOPHY.md` | The north-star principles that every future decision must pass. |
| `XR-3.1-DESIGN-SYSTEM.md` | Tokens, typography, motion, spacing, color, elevation, voice. |
| `XR-3.1-INFORMATION-ARCHITECTURE.md` | The canonical map of XR — objects, relationships, hierarchy. |
| `XR-3.1-NAVIGATION-ARCHITECTURE.md` | How the user moves through XR across surfaces. |
| `XR-3.1-USER-JOURNEYS.md` | The nine journeys that matter and how they must behave. |
| `XR-3.1-COMPONENT-STANDARDS.md` | Every UI primitive, specified (not implemented). |
| `XR-3.1-PERFORMANCE-STANDARDS.md` | Hard numbers: startup <300ms, first-token <200ms, etc. |
| `XR-3.1-ACCESSIBILITY-STANDARDS.md` | WCAG 2.2 AA, keyboard-only, reduced-motion, colorblind, terminal a11y. |
| `XR-3.1-IMPLEMENTATION-ROADMAP.md` | Phased plan across 6 milestones with exit criteria. |

## 7. The headline promise we are making to users

> **"XR feels like one fast, trustworthy operating system — whether you use it from a terminal, a browser, a phone, or your voice. It always knows where you are, what it is doing, and what you have spent. It never surprises you. It never feels like multiple products glued together."**

That is the bar. If any change does not move XR closer to this promise, it does not ship.
