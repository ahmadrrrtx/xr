# XR 3.1F — CONTROL CENTER ARCHITECTURE SPECIFICATION
> Information, Navigation, and Component Primitives

This document specifies the structural mechanics of the XR 3.1F Control Center:
1. Information Architecture (Site Map, Objects, and URL routes).
2. Navigation Architecture (Keybindings, layouts, and panels focus).
3. Component Architecture (Web primitives and TUI equivalents).

---

## 1. Information Architecture

Mission Control operates as a single-page application (SPA) structured around a high-density, centralized state.

### 1.1 Structural Objects Model

```
Control Center SPA
├── Sidebar (Brand Lockup, Grouped Section Items, Connection Pill)
├── Topbar (Breadcrumbs Tracker, Status-Chips, Palette Button)
├── Main Workspace (View Switcher Panel)
└── Collapsible Right-Rail Inspector (Context Summary, Approvals, Tool Timeline)
```

### 1.2 URL Routing Matrix

The UI utilizes pushState-based SPA hash-routing to enable direct URL deep-linking:

| Active URL hash | Targeted View Panel | Main Component Composition |
|---|---|---|
| `#home` | `panel-dashboard` | Health Bento, Stat Cards, Logs list, hardware specs |
| `#chat` | `panel-chat` | Side list, active chat, composer, inspector |
| `#sessions` | `panel-sessions` | Total metrics cards, sessions list, steps detail |
| `#workspaces` | `panel-workspaces` | Workspace card, switcher rows, creation form |
| `#providers` | `panel-providers` | Routing presets card, cloud key manager, presets grid |
| `#models` | `panel-models` | Local AI selector, Specs checker, runtimes list |
| `#memory` | `panel-memory` | Stats, search field, durable memory timeline |
| `#research` | `panel-research` | Research stats, latest report card, runs log |
| `#voice` | `panel-voice` | Voice control status card, wake commands list |
| `#control` | `panel-control` | Permissions, approvals, action logs, stop button |
| `#skills` | `panel-skills` | Marketplace banner, categories, grid, skill details |
| `#plugins` | `panel-plugins` | Plugin summary, active plugin list, catalog search |
| `#mcp` | `panel-mcp` | MCP registry form, connection list |
| `#business` | `panel-business` | Business OS CRM dashboard |
| `#shield` | `panel-shield` | Shield EDR panel, scans, processes kill PID, startup tasks, downloads, browser, Dojo lab |
| `#audit` | `panel-audit` | Verify logs, cryptographic logs ledger list |
| `#budget` | `panel-budget` | Cap limit input fields, cost charts, spend ledger |
| `#files` | `panel-files` | Produced artifacts lists |
| `#downloads` | `panel-downloads` | Downloads folder security logs |
| `#devices` | `panel-devices` | Sync state, VS code extension keys |
| `#automation` | `panel-automation` | Scheduled cron automation list |
| `#integrations` | `panel-integrations` | Webhooks API, port listening details |
| `#notifications` | `panel-notifications` | Alerts list |
| `#settings` | `panel-settings` | Category forms list, setting search |
| `#about` | `panel-about` | Build metadata, timezone, data export |

---

## 2. Navigation Architecture

Navigation in Mission Control follows the universal, keyboard-first, and back-button responsive patterns of the XR ecosystem:

### 2.1 Mnemonic Keyboard Shortcuts
- **Universal Chords**:
  - `?` or `Cmd+K` or `Ctrl+K`: Open command palette search overlays.
  - `Esc`: Close open modals, palette, popovers, or cancel streaming.
  - `/`: Immediately focus Chat Universal Composer.
- **Go-to Mnemonics (`g` + key within 1 second)**:
  - `g + d` -> Home Dashboard
  - `g + c` -> Chat Sessions
  - `g + t` -> Recent Sessions History
  - `g + w` -> Workspaces switcher
  - `g + p` -> Cloud Providers
  - `g + m` -> Durable Memory
  - `g + r` -> Research Runs
  - `g + s` -> Shield Security
  - `g + a` -> Audit Log
  - `g + .` -> Core Settings

### 2.2 Collapsible Multi-pane focus
- **Sidebar**: Can be toggled to a compact icon-rail via viewport resizing, fitting 80-column constraints perfectly.
- **Collapsible Inspector**: Snaps in/out on the Chat page to detail tools output and pending authorizations, returning focus to the primary composer textarea instantly when closed.

---

## 3. Component Architecture

XR 3.1F enforces standard visual structures for all web atomic components:

### 3.1 Primary Buttons
- **Color**: bg `#00D4FF` (cyan), text `#001018` (dark), 600 weight.
- **Shadow**: `0 0 15px rgba(0, 212, 255, 0.2)`.
- **States**: hover scales up with brightness 1.1, focus triggers a cyan glow ring, pressed shifts translateY 1px.

### 3.2 Badges
- **Anatomy**: 2px 6px padding, 4px radius, monospace font.
- **Styles**:
  - `badge-green`: bg `rgba(0, 255, 136, 0.12)`, text `#00FF88`, border `rgba(0,255,136,0.2)`.
  - `badge-cyan`: bg `rgba(0, 212, 255, 0.12)`, text `#00D4FF`, border `rgba(0,212,255,0.2)`.
  - `badge-amber`: bg `rgba(245, 158, 11, 0.12)`, text `#F59E0B`, border `rgba(245,158,11,0.2)`.
  - `badge-red`: bg `rgba(255, 77, 77, 0.12)`, text `#FF4D4D`, border `rgba(255,77,77,0.2)`.

### 3.3 Cards
- **Anatomy**: bg `#0B1120` (surface), border `#1E293B` (divider), 12px radius, 16px padding.
- **State**: Hover highlights borders with `--cyan` or `--green` to signal active interaction state.
