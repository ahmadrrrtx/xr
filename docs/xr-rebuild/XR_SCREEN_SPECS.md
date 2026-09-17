# XR — Screen Specifications

> Format per screen: PURPOSE · GOAL · PRIMARY ACTION · SECONDARY · DATA · API · COMPONENTS · INTERACTIONS · STATES · PERMISSIONS · RESPONSIVE · KEYBOARD.
> APIs reference existing `/api/v1/*` ops [OBSERVED] unless marked NEW.

## S1 First Launch (Onboarding)
PURPOSE: meet XR, configure trust+providers, first success. GOAL: reach first completed task w/ one trust moment. PRIMARY: guided sequence MEET XR (avatar+tagline) → USAGE CHOICE (code/research/ops/general) → PROVIDER (cloud key or local detect) → MODEL TEST → WORKSPACE (pick folder) → MODE (Careful/Balanced/Autonomous) → OPTIONAL skills/MCP → TEST TASK → READY. SECONDARY: skip w/ safe defaults (Careful, local-first). DATA: provider catalog, local runtimes, workspaces. API: /onboarding/*, /providers, /models/test, /workspaces. COMPONENTS: StepRail, AvatarHero, ProviderCards, ModePicker, WorkspacePicker, TestTaskCard. STATES: engine-boot splash; provider-fail → retry/local fallback; empty workspace → create. PERM: folder access, keyring write. RESP: single column, min 720px. KEYS: Enter advance, Esc back. No re-onboarding after complete (status flag).

## S2 Home
PURPOSE: "What do you want XR to do?" GOAL: start or resume work in one action. PRIMARY: composer (send → Work). SECONDARY: continue cards, approvals badge, readiness strip. DATA: /overview, /approvals(pending), /sessions(recent), /health. COMPONENTS: Composer, ContinueCard×n, ApprovalBadge, ReadinessStrip, RecentRuns rail. STATES: empty (invitation+examples), engine-down (splash+retry), loading skeletons. KEYS: ⌘K palette, focus composer on open.

## S3 Work / Chat (live task)
PURPOSE: converse + execute + approve in one flow. GOAL: drive a task to result w/ full visibility. PRIMARY: send/stop. SECONDARY: attach, capability pin, mode/model pill, run inspector drawer, memory peek. DATA: SSE /chat stream, /approvals, /memory, /context. COMPONENTS: Transcript, ToolTimeline, InlineApproval, Composer, InspectorDrawer, CostMeter. STATES: streaming (presence pulse), waiting-approval (amber rail), error (cause+retry+audit link), over-budget (raise/stop dialog). KEYS: ⌘. stop, ⌘A approvals, ↑ edit last.

## S4 Active Task / Task Details (Run anatomy)
PURPOSE: understand one run completely. GOAL: inspect plan→tools→files→approvals→cost→artifacts. PRIMARY: tab navigation (Transcript/Plan/Files/Tools/Approvals/Cost/Artifacts). SECONDARY: resume/retry/duplicate/export/open-in-workspace. DATA: /sessions/{id}, /execution, /audit, /cost. COMPONENTS: RunInspector tabs, DiffList, ApprovalList, ArtifactGrid. STATES: running (live), interrupted (resume CTA), failed (error path), empty tabs hidden. KEYS: 1-7 tabs, ⌘E open workspace.

## S5 Project Workspace
PURPOSE: project gravity: files+editor+terminal+agent together. GOAL: select→ask→diff→approve→apply loop. PRIMARY: open editor/terminal panes. SECONDARY: git rail, problems, preview, agent sidecar. DATA: /files, /files/read|diff, git tools, PTY(NEW engine route), /chat (sidecar). COMPONENTS: ExplorerTree, TabStrip, EditorPane, TerminalPane, GitRail, AgentSidecar, PreviewPane. STATES: no-workspace (picker), large-repo (virtualized+ignore rules), agent-editing (AI gutter+diff pending). KEYS: ⌘P file, ⌘` terminal, ⌘⏎ ask-XR-on-selection.

## S6 Code Editor (pane spec)
PURPOSE: read/edit/review code w/ AI as collaborator. PRIMARY: edit+save. SECONDARY: multi-cursor, search, diff view, problems. DATA: /files/read, write via agent or user. COMPONENTS: CM6 instance, DiffViewer, ProblemList, SearchPanel. STATES: unsaved dot, conflict (reload sheet), binary (preview fallback). KEYS: standard editor map + XR additions.

## S7 Terminal (pane spec)
PURPOSE: shells owned by engine, visible in workstation. PRIMARY: type commands. SECONDARY: split, rename, kill. DATA: PTY sessions (NEW route; placement policy applies). COMPONENTS: xterm panes, status chip (cwd, workspace). STATES: exited (reopen), sandboxed chip when placement restricts. KEYS: ⌘⇧D split.

## S8 Agents (multi-agent workspace)
PURPOSE: see & steer team runs. GOAL: know who is doing what, progress, budget, failures. PRIMARY: open team run board. SECONDARY: message/correct agent, cancel node, view agent transcript, edit definitions (advanced). DATA: /agents, /agents/workflows/{id}, execution events. COMPONENTS: AgentBoard (nodes+edges), RoleChip, BurnBar, FailureHalo, AgentTranscript sheet. STATES: idle (create team run CTA), running (live rings), blocked-approval (amber node), failed (red halo+retry node). KEYS: ⌘⏸ pause run.

## S9 Runs (history)
PURPOSE: history as product data. PRIMARY: open run anatomy (S4). SECONDARY: filter (workspace/status/mode/cost), search, resume/duplicate/export. DATA: /sessions, /execution. COMPONENTS: RunRow list, FilterBar, CostSummary header. STATES: empty (first-run hint), thousands (virtualized+index search).

## S10 Library — Skills
PURPOSE: 65+ skills as discoverable library. PRIMARY: search/browse → detail sheet → run/configure. SECONDARY: categories, featured, recent, installed/enabled toggles, permissions view. DATA: /skills/*, marketplace store. COMPONENTS: CapabilityCard, CategoryRail, SkillDetailSheet (examples, required tools, permissions, provenance chips), RunPanel. STATES: legacy-md skills flagged "basic manifest", offline (cached catalog).

## S11 Library — MCP
PURPOSE: connections w/ trust legibility. PRIMARY: connect server (guided) → see tools granted. SECONDARY: health, activity log, enable/disable, raw config (advanced). DATA: /mcp/* (+republished routes). COMPONENTS: ConnectionCard, ToolGrantList, HealthDot, PinDiffSheet (SEC-01: metadata changed → re-approve). STATES: unreachable, unapproved-change (amber), quarantined.

## S12 Library — Plugins
PURPOSE: safe extensibility. PRIMARY: install/enable w/ sandbox status. SECONDARY: permissions, signing provenance, logs. DATA: /plugins/*. COMPONENTS: PluginCard, SandboxChip, ProvenanceSheet. STATES: unsigned (blocked w/ explanation), crashed worker (auto-quarantine notice).

## S13 Library — Integrations & Model Center
Integrations: browse 165 capability records; connect flows delegate to MCP/plugins/keys. Model Center: provider cards (connect/key/local), model picker w/ capability chips, test button, default/fallback assignment, cost hints, health/SLO strip. DATA: /providers*, /models*, /capabilities. SECURITY: keys→keyring only; test calls engine-side.

## S14 Memory
PURPOSE: what XR remembers, human-readable. PRIMARY: search/read entries. SECONDARY: forget/delete, scope edit, source link (run), add manual. DATA: /memory*. COMPONENTS: MemoryCard (what/why/source/scope), ScopeChip. STATES: empty, ACL-denied entries hidden w/ explanation.

## S15 Voice mode (overlay, not page)
PURPOSE: ambient spoken collaboration. PRIMARY: push-to-talk / wake toggle. SECONDARY: mute, stop, switch to text. DATA: voice pipeline WS (NEW audio channel over daemon), presence events. COMPONENTS: VoiceOverlay (avatar orb, state label, waveform), InterruptHint. STATES: idle/listening/thinking/working/speaking/interrupted/stopped/error/waiting-approval (barge-in disabled; sheet appears). LATENCY BUDGET: turn gap p95 ≤700ms w/ thinking signal; TTS flush ≤60ms; LLM cancel ≤40ms [RESEARCH-BACKED].

## S16 Computer Control cockpit (sheet + indicator)
PURPOSE: legible machine control. PRIMARY: watch current action + STOP. SECONDARY: permissions, app scope, session history, category blocks. DATA: /control/*, /environment/*. COMPONENTS: ControlCockpit, ActingIndicator (system-wide), AppChip, ScreenshotThumb. STATES: idle, acting (cyan ring), waiting-approval, blocked-category (explain), stopped-by-user.

## S17 Approvals / Trust Center
PURPOSE: one place for safety. Sections: Queue (pending w/ source labels), Modes (Careful/Balanced/Autonomous ↔ tiers), Audit (chain verify/export), Budgets, Network (egress allowlist), Permissions (grants/quarantine), Shield. PRIMARY: decide approvals (Deny/Allow once/Always+scope). DATA: /approvals, /trust, /audit, /budget, /capabilities, /shield. COMPONENTS: ApprovalSheet, ModeCard, AuditTable (mono hashes), BurnChart, GrantTable. STATES: empty queue (calm), chain-broken (red alarm w/ export forensic).

## S18 Settings
Sections: General (workspace defaults, language), Models→Model Center link, Local (runtime install helpers), Automations (triggers table+pause-all), Voice (devices, wake word), Privacy (data retention, telemetry opt-in), Advanced (raw config JSON, API playground, capability grants raw). PRIMARY: change setting w/ immediate effect+undo toast. DATA: /config, /triggers, voice settings.

## S19 System Health
PURPOSE: engine+platform readiness. PRIMARY: doctor view (providers/local/voice/desktop-control/audit chain). SECONDARY: repair actions, logs viewer, update channel. DATA: /health, /metrics, doctor internals. STATES: degraded rows w/ fix-it buttons (heritage of doctor honesty).

## S20 Search / Command Palette
PURPOSE: everything reachable. PRIMARY: fuzzy actions+nav+runs+skills+files. SECONDARY: inline calculators? no—keep scope: actions/nav/entities. DATA: client index + /sessions,/skills. KEYS: ⌘K, arrows, ⏎, ⏎ open in new window.

## S21 Notifications & Tray
Tray menu: New task, Voice, Pending approvals (count), Pause-all, Engine status, Quit. Notifications: approval-requested (action buttons), run-finished, run-failed, budget-80%, update-ready. Deep links xr://task|approve|workspace.

## S22 Compact / mobile-ish experience
PURPOSE: small-window & companion use. Behavior: nav collapses to icon rail → tab bar; Work remains primary; editor/terminal panes become tabs; cockpit/approvals full-screen sheets. (Desktop-first; no phone app promised.)

## S23 Error / Recovery surfaces
Engine-down splash (avatar dim + respawn progress); crash-recovery resume sheet (list interrupted runs → resume all/choose); offline provider fallback notice (intelligence router decision shown in plain language).

## S24 Empty-state gallery
Every surface ships an intentional empty state: one line of plain language + one primary action + avatar line-art; examples: Runs empty → "Your first task will live here."; MCP empty → "Connect your first tool source."
