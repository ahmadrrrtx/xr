# XR — Competitive & Ecosystem Research

> Research date 2026-09-17. Method: current web sources (cited). No rankings, no scores.
> Separation: **FACT** (observed in sources) · **INTERPRETATION** (product design read) · **INSIGHT** (UX principle for XR).

## 1. Claude Code / Claude desktop (Anthropic)

- FACT: April 2026 desktop redesign: multi-session sidebar, automatic Git worktree per session, drag-and-drop pane layout (sessions/terminals/editors/previews), integrated terminal, in-app file editor, HTML+PDF preview, rebuilt diff viewer; "Routines" scheduled automation (Apr 2026); "Agent view" session manager (May 2026); "Dynamic workflows" across tens-to-hundreds of parallel subagents with self-checking (May 2026). ([eigent.ai analysis](https://www.eigent.ai/blog/claude-code-desktop-redesign), [claude.com](https://claude.com/product/claude-code), [Reddit r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1slictc/claude_code_on_desktop_redesigned_for_parallel/))
- FACT: terminal + IDE extensions + web + desktop share the same agentic workflows; permission prompts before file/command changes. ([claude.com](https://claude.com/product/claude-code))
- INTERPRETATION: the unit of UI is the *session/task pane*, arranged freely; the app is an orchestration surface, not a chat.
- INSIGHT for XR: panes-as-work (agent pane, terminal pane, editor pane, preview pane) with per-task isolation (XR already has partitions/workflows) — adopt the *pane grammar*, keep XR's single-spine execution.

## 2. Cursor

- FACT: Cursor 2.0 agent-first interface: up to 8 parallel agents in isolated git worktrees; Agents Window (Cursor 3, Apr 2026) managing agents across repos/envs/machines; Background Agents 1.0 (May 2026) run plan→execute→review across multiple repos without an open editor, dispatchable from editor or web dashboard, each with persistent workspace, tool-permission scope, structured change log; subagents (v2.4); `/worktree`, `/best-of-n`; Automations (event-driven); Design Mode; conflict-awareness pauses agents when humans edit touched files. ([consumertechwire](https://consumertechwire.com/news/cursor-ships-background-agents-multi-repo-may-2026/), [agentmarketcap](https://agentmarketcap.ai/blog/2026-04-05/cursor-april-2026-agent-mode-overhaul-background-agents-ide-convergence), [codecademy](https://www.codecademy.com/article/cursor-2-0-new-ai-model-explained), [baeseokjae](https://baeseokjae.github.io/posts/cursor-agent-best-practices-2026/))
- FACT (community): worktree parallelism pain = merge/port conflicts; coordination layer (file claims) is the unsolved gap. ([r/cursor](https://www.reddit.com/r/cursor/comments/1rxg2b7/parallel_agents_git_worktrees_realworld_experience/))
- INTERPRETATION: "the editor is no longer the unit of work; the task is."
- INSIGHT for XR: XR Desktop's primary object = **Task/Run**, with workspaces as context; multi-agent view shows ownership/conflict awareness (XR partitions + leases already model this — surface it).

## 3. OpenAI Codex / ChatGPT desktop

- FACT: Codex CLI: sandbox modes (read-only / workspace-write / danger-full-access) × approval policies (on-request / never; `untrusted` retired v0.149); extra-sandbox-permission requests; granular reject-with-feedback; `--approve-for-me` auto-review; agents dashboard (search/start/open/rename/stop); portable Agent Plugins; MCP 2026-07-28 opt-in; conversation sections. ([blakecrosley guide](https://blakecrosley.com/guides/codex), [OpenAI docs](https://developers.openai.com/codex/agent-approvals-security))
- FACT: ChatGPT desktop (Windows, Mar 2026): worktrees, scheduled tasks, Git, built-in browser, file previews, plugins, skills; OS-level sandbox (restricted tokens, filesystem ACLs, dedicated sandbox users); escalation requires explicit approval; network off by default. ([OpenAI](https://developers.openai.com/codex/app/windows), [windowsforum](https://windowsforum.com/threads/openai-codex-arrives-on-windows-with-native-sandbox-and-agentic-workflows.404026/))
- FACT: subagents inherit parent sandbox/approval mode; approvals from background threads surface in an overlay with source label. ([OpenAI docs](https://developers.openai.com/codex/subagents))
- INSIGHT for XR: XR's tiered placement + approvals already matches/exceeds this model; the UX gap is *legibility*: Codex names modes ("workspace-write", "on-request") — XR should name its modes in human terms ("Careful / Balanced / Autonomous") mapped onto trust tiers, and label cross-thread approvals.

## 4. Google Gemini CLI → Antigravity 2.0

- FACT: Gemini CLI retired Jun 18 2026; Antigravity CLI (Go) + Antigravity 2.0 desktop: async background multi-agent orchestration, shared harness CLI/desktop/SDK, Managed Agents API w/ persistent isolated Linux sessions, native voice commands, scheduled tasks; skills/hooks/subagents/extensions carried over as plugins. ([Google dev blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/), [inventivehq](https://inventivehq.com/blog/gemini-cli-deprecated-antigravity-cli-migration), [ofox](https://ofox.ai/blog/google-antigravity-2-explained-gemini-desktop-agent-platform-2026/))
- INSIGHT for XR: one harness, many surfaces (CLI/TUI/desktop/API) is the industry end-state — validates XR's single-spine + daemon design; voice commands arriving as first-class desktop input validates XR voice mode.

## 5. Others (Devin, Windsurf, Cline/Roo, Aider, Copilot, Raycast-class)

- FACT: landscape sorts into IDE-embedded (Cursor, Windsurf, Copilot), terminal-first (Claude Code, Codex, Aider), autonomous cloud (Devin $500/mo ticket-in→PR-out); BYOM is Cline/Aider's wedge; most engineers run two tools. ([jobsbyculture](https://jobsbyculture.com/blog/ai-coding-agents-compared-2026), [aibuilderclub](https://www.aibuilderclub.com/blog/best-ai-coding-agent-2026), [techsy](https://techsy.io/en/blog/best-ai-coding-agents-2026))
- INTERPRETATION: nobody owns the *local-first, provider-neutral, audited workstation* slot: cloud/subscription or IDE-fork or terminal. XR's BYOK+local+audit+trust stack is a differentiated wedge.
- INSIGHT: XR must not clone an IDE fork; it should be the *agent workstation* that BYOK users trust — editor included but agent-first.

## 6. Computer-use & desktop agents

- FACT: Claude Computer Use (Mar 2026, macOS first) inside Claude Cowork/Code: screenshot→reason→act loop; permission-first (asks before new apps); stop anytime; category blocks (trading, crypto, banking, adult); Dispatch phone→desktop pairing; Anthropic recommends sandboxes. ([popularaitools](https://popularaitools.ai/blog/claude-computer-use-agent-2026), [siliconangle](https://siliconangle.com/2026-03-23/anthropics-claude-gets-computer-use-capabilities-preview/), [developersdigest](https://www.developersdigest.tech/blog/claude-computer-use))
- FACT: Microsoft Agent Workspace = isolated RDP child session, low-privilege accounts (isolation-first, zero visibility of user desktop); OpenAI Operator folded into ChatGPT Work (2025→2026). ([zylos research](https://zylos.ai/research/2026-07-16-desktop-agent-uis-ambient-computing/))
- FACT: perception approaches split accessibility-tree vs pixels; EU AI Act Art.50 transparency binds 2026-08-02; interruption cost/notification budgets now design metrics. ([zylos research](https://zylos.ai/research/2026-07-16-desktop-agent-uis-ambient-computing/))
- INSIGHT for XR: computer control UX = *always-visible control cockpit* (what/why/app/permission/stop) + isolation-first placement (XR trust backends) + category blocklist defaults + ambient "XR is acting" indicator system-wide.

## 7. MCP & extension supply chain

- FACT: DSN'26 study of 67,057 servers across 6 registries: hijack/squatting conditions widespread; 833 vulnerable servers, 18 suspicious tool descriptions; hosts don't verify LLM-selected tools. ([arXiv/DSN](https://arxiv.org/html/2510.16558))
- FACT: tool poisoning = signature MCP attack (Invariant Labs SSH-key PoC; GitHub issue→PR exfil); MCPoison CVE-2025-54136 (Cursor config trust persistence); TrustFall (auto-exec project MCP in Claude Code/Cursor/Gemini CLI/Copilot, default-yes trust prompts); Miasma worm (73 repos, June 2026); Amazon Q CVE-2026-12957/8; Microsoft June 2026: MCP descriptions = supply-chain assets; OWASP MCP Top-10 #3. ([chatforest](https://chatforest.com/guides/mcp-ecosystem-2026-state-of-the-standard/), [CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-auto-execution-20260701/))
- FACT: defense tooling emerged: agent-scan (Snyk), AgentSeal, Cisco scanner, Enkrypt, SurePath, Miggo. ([chatforest](https://chatforest.com/guides/mcp-ecosystem-2026-state-of-the-standard/))
- INSIGHT for XR: MCP UX must show *provenance + pinned metadata + diff-on-change re-approval*; XR's allowlist+grants are the base; add pinning (SEC-01).

## 8. Voice agent UX

- FACT: turn-taking gap targets: <800 ms p95 feels human; 350–450 ms support-style, 500–700 ms w/ visible thinking signal for clinical/financial; barge-in pipeline: VAD energy→voice-classify→min-duration; TTS flush ~60 ms; LLM cancel ~40 ms; backchannel vs content classification; semantic end-of-turn; state machine LISTENING/USER_SPEAKING/THINKING/AGENT_SPEAKING/INTERRUPTED; stash partial utterances; never lose in-flight tool work on interrupt; barge-in OFF for confirmations/mandatory info. ([futureagi eval](https://futureagi.com/blog/evaluating-voice-ai-agents-2026/), [futureagi barge-in](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/), [famulor](https://www.famulor.io/blog/ai-voice-agent-barge-in-interruptions-enterprise-guide), [callsphere](https://callsphere.ai/blog/vw7d-voice-agent-barge-in-turn-taking-2026), [dev.to state machine](https://dev.to/jackm-singularity/voice-agent-turn-taking-stop-live-ai-calls-from-talking-over-users-590b))
- INSIGHT for XR: voice mode = explicit state machine UI on the avatar (idle/listening/thinking/working/speaking/interrupted/stopped/error/waiting-approval); approvals never barge-in-able; interrupt preserves work (XR checkpoints make this native).

## 9. Desktop shell technology

- FACT: 2026 consensus: Tauri v2 ≈ 2–12 MB installer, ~30–85 MB idle RAM, <1 s start, least-privilege native APIs, Rust core, OS webview variance; Electron ≈ 80–200 MB, 100–450 MB RAM, identical Chromium rendering, mature updater/signing ecosystem. ([intuz](https://www.intuz.com/blog/react-native-vs-electron-js/), [pkgpulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026), [buildmvpfast](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026), [openreplay](https://blog.openreplay.com/comparing-electron-tauri-desktop-applications/), [tibicle](https://tibicle.com/electron-vs-tauri-2026-desktop-framework-guide))
- INSIGHT for XR: XR's heavy engine is already an external Bun daemon; the shell needs webview + native trimmings, not a Node main process → **Tauri v2** fits (small, secure, sidecar-friendly); Electron only if editor fidelity demands bundled Chromium (mitigation: CodeMirror6 works on WebKit/WebView2). See Desktop Architecture doc.

## 10. Synthesis — principles XR adopts (not copies)

1. Task/run is the primary object; sessions/panes arrange around it.
2. Parallel agents with isolation (worktrees/partitions) + conflict awareness.
3. Background/async work with durable resume (XR checkpoints) + notifications.
4. Named autonomy modes mapped to enforcement (Careful/Balanced/Autonomous ↔ trust tiers).
5. Supply-chain legibility for MCP/skills/plugins (pin, diff, re-approve).
6. Computer control = visible cockpit + isolation-first + category blocks.
7. Voice = state-machine presence on the official avatar, sub-second feedback, work-preserving interrupts.
8. One harness, every surface (desktop/TUI/CLI/API) — same terminology, same state.
9. Local-first BYOK + audited trust is XR's wedge; never trade it for cloud lock-in.
10. Editor serves the agent loop (select→ask→diff→approve→apply), not the reverse.
