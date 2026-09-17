# XR — UX Audit (current surfaces)

> Evidence date 2026-09-17. Tags: [OBSERVED] / [INFERRED] / [RECOMMENDED].
> Surfaces audited: web Control Center (dashboard), TUI Shell, CLI, VS Code extension, onboarding wizard.

## 1. Web Control Center ("XR — Mission Control", nav label "XR Control v3.1F")

**Architecture:** server-rendered single HTML document (~106 KB) from TS template modules (`src/daemon/dashboard/page-*.ts`, `markup.ts`), vanilla-TS client behaviors (`client-*.ts`), token CSS (`style-tokens.ts`: --bg/--surface/--border/--text/--muted/--cyan/--violet/--green/--red/--amber, radii sm/lg/xl, sidebar/inspector widths, mono/sans fonts). No framework, no router: 23 panels toggled client-side. [OBSERVED]

**Information architecture (as shipped):**
- Primary nav (11): Home(dashboard), Chat, Runs(sessions), Agents, Resources(?), Models(providers), Extensions(skills), Memory, Trust, Guardrails(approvals), Settings. [OBSERVED nav buttons]
- Panels (23): dashboard, chat, sessions, agents, providers, skills, memory, approvals, settings, about, audit, automation, budget, capabilities, control, files, mcp, models, plugins, research, shield, voice, workspaces. [OBSERVED data-panel attrs]
- Settings sub-panes (6): general, providers, local, budget, trust, voice. [OBSERVED]
- Composer: "Universal Composer" w/ Pin/Branch/Export/Inspector/Archive; side rails: Sessions Feed, Active Workspace, Durable Memory peek, Approvals queue, Tool timeline; Skills inspector rail w/ category quick-filters. [OBSERVED]
- Global: ⌘K palette hint, letter shortcuts ("g then a key jumps areas"), skip link + a11y tests (axe, WCAG 2.2 tags — skipped without Playwright). [OBSERVED]

**UX assessment:**
- *Strengths:* honest empty states; keyboard map; a11y intent; single-page speed; inspector patterns; approvals/memory/tool-timeline rails are the right atoms.
- *Problems:*
  1. **Cockpit, not workstation.** 23 panels = every backend subsystem exposed as navigation (violates progressive disclosure). [INFERRED vs product brief]
  2. **No project gravity.** Workspaces exist but there is no file tree/editor/terminal/diff surface; "files" panel is a list+diff viewer, not a workspace. [OBSERVED]
  3. **Runs are lists.** Sessions panel lacks run anatomy (plan/agents/tools/files/approvals/cost/artifacts) in one narrative view. [INFERRED from panel markup]
  4. **Chat-first but work-second.** The composer is strong; execution visibility lives in rails, fragmenting attention. [INFERRED]
  5. **Voice/computer-control are panels**, not modes — no ambient presence, no state machine UI. [OBSERVED]
  6. **Visual language**: dark cockpit w/ glows; brand cyan/violet used as accents but no cohesive type/space system; SVG icons minimal/absent (text-heavy). [OBSERVED]
  7. Brand duality: dashboard header uses ASCII banner (▀▄▀ █▀█), not the official logo/avatar. [OBSERVED]

## 2. TUI Shell (`xr` default)

- Fullscreen; startup workspace picker modal; status bar w/ model; Alt+P model switch; `/model` command; sessions list; spinner pipeline ("startup pipeline: boot/link/sync"). [OBSERVED pty run]
- *Strengths:* fast, keyboard-complete, operator-grade. *Problems:* text-only brand; no visual execution anatomy; approvals inline text; not a place for editor/diff work. [INFERRED]
- Verdict: keep as first-class operator surface; share terminology/state with Desktop via daemon. [RECOMMENDED]

## 3. CLI

- ~40 verbs, grouped help (Work/Context/Intelligence/Extensions/Trust/System), formats text/json/yaml/markdown, honest MOVED shims. [OBSERVED]
- *Strengths:* information architecture of the CLI help is actually the best IA in the product (grouped by intent). [INFERRED] Reuse its grouping vocabulary for Desktop nav. [RECOMMENDED]

## 4. Onboarding

- `xr onboarding` wizard (re-runnable); daemon onboarding routes (status/provider/complete). [OBSERVED]
- *Problems:* terminal form-flow; no "meet XR" moment; no workspace/permissions/skills choices in one guided narrative; first-launch of daemon ≠ onboarding. [INFERRED]

## 5. VS Code extension

- Status-bar cost meter + "Ask XR about selection" + open dashboard. [OBSERVED]
- *Assessment:* correct minimal bridge; selection→agent is the seed of the editor AI loop the rebuild generalizes. [INFERRED]

## 6. Cross-surface coherence

- Terminology drift: "Control Center" (web) vs "Shell" (TUI) vs "Mission Control" (title) vs "XR Control v3.1F" (nav). Runs = sessions = executions. Guardrails vs approvals vs trust. [OBSERVED]
- State sharing: all surfaces read the same daemon/state — good. But each renders its own mental model. [INFERRED]

## 7. KEEP / REUSE / REBUILD / REMOVE

| Disposition | Items |
|---|---|
| KEEP (concept) | composer atoms (pin/branch/export/inspector), approvals rail, memory peek, tool timeline, keyboard map, a11y discipline, honest empty states |
| REUSE (code) | dashboard as headless fallback only; CSS token discipline (re-tokened); client SSE plumbing patterns |
| REBUILD | IA (9→5 primary areas), runs anatomy view, project workspace, skills library UX, MCP connection UX, voice mode UI, computer-control cockpit, onboarding experience, design system |
| REMOVE | 23-panel cockpit nav; ASCII banner branding; panel-per-subsystem exposure; duplicate business views |

## 8. Top UX problems (ranked for the rebuild)

1. No single "home of work": user lands in a cockpit, not a workspace. → New Home + Work surface.
2. Execution is invisible as a narrative. → Run anatomy + live task view.
3. Capabilities (65 skills, 165 capabilities, MCP, plugins) are lists, not a library. → Capability Library.
4. Trust is a panel, not a felt system. → Approval moments w/ risk legibility everywhere.
5. Voice/computer-control lack mode presence. → Ambient modes w/ avatar states.
6. Brand is absent where it matters (ASCII banners). → Official logo/avatar system-wide.
7. Onboarding is a form. → First-launch experience sequence. [RECOMMENDED]
