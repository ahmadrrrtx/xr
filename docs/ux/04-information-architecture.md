# 04 — Information Architecture

**Date:** 2026-08-13. Principle (mission §7): *the user should NOT need to
understand XR's internal architecture to use XR.* But: every surface must
still map 1:1 to real runtime capabilities (no invented features).

## 1. One mental model

```
                    XR
                     │
        ┌────────────┼────────────┐
     CHAT         WORKSPACE     SYSTEM
   (do things)   (see things)  (control things)
        │             │             │
   · Ask XR        · Sessions   · Providers & models
   · Agent mode    · Files      · Local models
   · Voice         · History    · Security & approvals
   · Research      · Activity   · Budget & spend
   · Tasks         · Audit log  · Skills / MCP / Plugins
                     · Memory    · Voice & computer control
                                 · Settings / About
```

Three verbs only: **ASK** (chat), **SEE** (workspace), **CONTROL** (system).
Everything in the product fits one of the three — this is the test for any new
nav item.

## 2. Mapping the current dashboard to the model (verify-only, no new features)

| Mental slot | Current dashboard panels (real) | Status |
|---|---|---|
| CHAT | Chat, Sessions, Research | ✅ |
| SEE | Dashboard/Overview (bento), Files, Audit, Memory, Downloads | ✅ |
| CONTROL | Providers, Models, Skills, Plugins, MCP, Capabilities, Business, Control (computer use), Shield, Budget, Voice, Automation (scheduled tasks), Integrations (webhooks), Notifications, Settings, Devices, About | ✅ all real |

The existing sidebar groups map cleanly; **no new nav invented**. We keep the
sidebar groups but tighten labels so they speak user language:

| Current group label | Proposed | Why |
|---|---|---|
| Mission Hub | **Start** | "Mission" is internal-flavored; P1 doesn't know what a mission is |
| AI Resources | **Ask** | Chat-language |
| Platforms & Tools | **Capabilities** | User language for skills/MCP/plugins ("Add capability" per mission §17) |
| Governance & Trust | **Guard** | Calm, honest; shield/audit/budget/control live here |
| Core Services | **System** | Settings/automation/integrations |

## 3. Progressive disclosure rules

1. **Default view for a new user:** Start → Chat (empty state with guidance).
   Dashboard bento remains one click away, not the landing view — the mission
   says "The CHAT should be the heart of XR" (§8) while the dashboard answers
   "What is XR doing?" (§20).
2. **Sidebar sections collapse** (already shipped: `aria-expanded` disclosure,
   default only "Start here" open — evidence `t4-sidebar-disclosure-default.png`).
3. **Advanced areas** (MCP config, policy, business extension) always behind a
   collapsed group or the command palette — never in the default flow.
4. **Every advanced control has a plain-language name + one-line why** in a
   tooltip (already partially there via `title`/tooltips).

## 4. Navigation contract (GUI ↔ TUI ↔ CLI)

One command grammar across surfaces (mission §39):

| Concept | GUI | TUI | CLI |
|---|---|---|---|
| Chat | Chat panel | `g c` | `xr "…"` |
| Sessions | Sessions panel | `g s` | `xr sessions` |
| Models | Models panel + chip | `Alt+P` / `/model` | `xr providers set` / `xr models set` |
| Mode | Composer mode chip (Ask/Plan/Research/Agent) | `Shift+Tab` / `/mode` | `--mode` flags |
| Approvals | Inline Allow/Deny | approval overlay | `xr approvals` |
| Memory | Memory panel | `g m` | `xr memory` |
| Audit | Audit panel | `g a` | `xr audit verify` |
| Budget | Budget panel + chip | status bar | `xr budget` |
| Palette | `Ctrl+K` / `⌘K` | palette overlay | `xr help` |

**Rule:** no concept exists on one surface with a different name on another.

## 5. What we deliberately do NOT add

- No "admin dashboard" duplicate of bento.
- No fictional categories (e.g., "AI OS launcher") not backed by runtime.
- No tab-per-route explosion: panels stay, IA changes are label + hierarchy +
  default view only.
