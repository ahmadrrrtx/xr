# XR 3.1A — User Journeys
> The nine journeys that define XR 3.1A. Every journey must work flawlessly across surfaces.

Each journey below specifies:
- **Actor:** who the user is
- **Trigger:** what starts the journey
- **Preconditions:** what must already be true
- **Flow:** the ideal interaction steps
- **Postconditions:** what must be true at the end
- **Acceptance criteria:** the concrete behaviors that mean "this journey works"
- **Surface parity:** how the journey differs (or doesn't) across Shell / Control Center / CLI

These journeys are the test plan for the product experience. If any journey fails, XR 3.1A does not ship.

---

## Journey 1: First-run setup (new user)

**Actor:** A developer who just ran `curl … | bash` for the first time.
**Trigger:** Running `xr` for the first time (no config exists).
**Preconditions:** Install script completed; binary is on PATH.

### Flow
1. User runs `xr` in their terminal.
2. Terminal shows XR animated brand frame (~660ms) while doing hardware detection in the background.
3. Welcome card appears, not a wall of questions:
   - Headline: "Welcome to XR."
   - Sub: "Set up takes about a minute. You can change everything later."
   - Three cards (selectable with arrow keys, Enter to confirm):
     - **🟢 Local-only** (recommended offline)
     - **⚡ Hybrid** (recommended online) — pre-selected if internet detected
     - **☁ BYOK Cloud**
   - "Skip and use defaults (local Ollama)" link at bottom.
4. User picks Hybrid.
5. Next card: "Local model". XR shows detected hardware, recommended model, and a single switch "Auto-install recommended model (qwen2.5:7b · ~4.7GB)" default-on. Ollama auto-installs if missing (with permission); shows real progress bar during pull.
6. Next card (only if Hybrid/Cloud chosen): "Cloud providers." Shows a list of providers with "Add key" buttons. Empty keys are fine — user can add them later. Optional step, no required input.
7. Final card: "You're ready." Shows summary (mode, model, providers configured) and a big "Start" button. One checkbox: "Send anonymous crash reports (off by default)" — unchecked by default.
8. User presses Enter.
9. User lands in Shell, composer focused, with a starter prompt suggestion ("Try asking me: what's in this directory?") visible in the composer placeholder. First-run hint chips visible below composer: `/help` `Try asking anything` `Check status`.
10. If user types their first question and presses Enter, XR responds. First success within 60 seconds of completing setup.

### Postconditions
- `~/.xr/config.json` exists with valid defaults.
- Default workspace is created (`default`), cwd set to the directory where `xr` was first run.
- If local install was accepted, Ollama is running and recommended model pulled; health check passes.
- Budget defaults to $0.25 per-task hard cap if cloud is configured; unlimited if local-only.
- Approvals default to on for shell/file-write/send.
- Memory defaulted to on, with conservative injection.

### Acceptance criteria
- **Time from "xr" to first composable prompt:** <90 seconds on a broadband connection; <30 seconds when skipping local model install.
- User never sees a CLI question that requires typing (all selections with arrow keys/Enter).
- User can complete setup without providing any API key.
- Cancel (Esc) at any step saves partial progress; running `xr` again resumes setup from the last step.
- Progress bar shown during Ollama download (not an indeterminate spinner).
- If any step fails (no internet, disk full, permission denied), error state explains what failed and how to fix it (with a "Copy fix command" button), and offers "Skip for now."

### Surface parity
- **Shell (TUI):** Primary surface for onboarding. Full experience.
- **Control Center:** If user runs `xr serve` before `xr onboarding`, Control Center shows a first-run banner that links back to terminal onboarding, or (post-3.1) offers an in-browser setup flow.
- **CLI:** `xr onboarding` re-runs the same wizard in interactive CLI mode (not full TUI) using ink/blessed-style single-column prompts for terminals that can't do alt-screen.

---

## Journey 2: Ask a quick question (drive-by)

**Actor:** Any user.
**Trigger:** User wants a quick answer without ceremony.
**Preconditions:** XR is already installed and configured with at least one working provider.

### Flow A (Shell/Control Center)
1. User is in XR. Composer is focused.
2. User types: "how do I reverse a list in Python?"
3. User presses Enter.
4. Composer collapses; streaming starts immediately in message pane; status bar shows running indicator and live cost ticker.
5. XR answers in ask-mode if the question is informational (no tool calls needed). Answer streams token-by-token.
6. After answer: composer returns, ready for next question. Cost of this exchange shown in message meta.

### Flow B (CLI)
1. User runs: `xr "how do I reverse a list in Python?"`
2. Terminal shows 1-line header (`● default  ask  ollama/qwen2.5:7b`).
3. Answer streams to stdout as it's generated.
4. After completion: 1-line footer summary (`✓ done · 812 tok · $0.0000 · 1.4s`).
5. Exit code 0.

### Acceptance criteria
- **First token appears within 500ms** of Enter (for local) or within 1s (for cloud), even for slow providers. A thinking indicator appears before the first token if model is actually thinking.
- Answer is complete and accurate.
- No approval prompts for informational questions (no tools called).
- Works in piped mode (`xr "..." | pbcopy` copies just the answer, no header/footer).
- `--mode ask` is implied if the query is a question with no actionable verb; user can override.

---

## Journey 3: Run a multi-step coding task (core loop)

**Actor:** Security-conscious developer.
**Trigger:** User wants XR to execute a real task that involves reading files, running commands, and editing code.
**Preconditions:** XR in agent mode; working directory is a project.

### Flow
1. Composer focused. User types: "refactor src/auth.ts to use async/await and add unit tests."
2. User presses Enter.
3. (Optional, if plan mode default): XR produces a numbered plan in the main pane with checkboxes; user can edit/reorder/uncheck steps; "Run plan" button.
4. Execution begins. Activity timeline shows each tool call:
   - `◆ read  src/auth.ts` (green when done, duration)
   - `◆ write src/auth.ts` (opens inline diff preview, ✓ applied)
   - `◆ shell npm test` (streams live output in a collapsed block, expandable)
   - Any failing step: turns amber, XR explains why and proposes recovery.
5. For destructive or networked actions (shell, file write, external fetch), XR shows an **approval prompt**:
   - Modal/overlay: "Run shell command: `npm install bcrypt`?"
   - Shows working directory, full command, why it's needed.
   - Buttons: Allow · Deny · Always allow `npm install *` in this workspace · Edit command.
6. User allows/denies per call.
7. At any point, user can type in composer (interrupt, redirect, add info) even while XR is running — XR pauses to incorporate.
8. When complete: success checkmark, summary of what changed, files modified, tests result, total cost, total time.
9. Summary ends with "What next?" suggestion chips ("Review diff" "Run tests" "Commit changes" "Explain the changes").
10. Composer returns for next instruction.

### Acceptance criteria
- Every tool call appears in the timeline within 50ms of being initiated.
- Approval prompts show full command preview, never "allow access?" without specifics.
- "Always allow" rules are scoped (per workspace, per command prefix) and reviewable/editable in Settings → Trust.
- User can interrupt (Ctrl+C/Esc) at any time; partial work is preserved; user is told "stopped after step 4 of 7" with option to resume.
- Diffs for file changes are shown inline (unified-diff format, +green/-red) before Apply if auto-accept is off.
- Cost accumulates live in status bar; if budget ceiling is reached mid-task, execution halts, user is prompted, and nothing is rolled back silently.
- After task, user can press `u` (like `undo`) to revert file changes to the pre-task git state (requires git repo; warns if not).

### Surface parity
- **Shell:** Inline in the three-pane layout; tool calls collapse to one line, Expanded shows full output.
- **Control Center:** Same timeline in main pane; output blocks rendered with syntax highlighting; side inspector shows current tool detail.
- **CLI:** Output streams with prefix glyphs (`◆` for tool calls, `…` for thinking, answer lines plain); approvals appear as interactive Y/n prompts.

---

## Journey 4: Deep research with citations

**Actor:** Researcher / knowledge worker.
**Trigger:** "Research the current state of local LLMs for code, compare the top 3 options."
**Preconditions:** Research mode enabled; network access (or configured local research sources).

### Flow
1. User types `/research "current state of local LLMs for code, compare top 3" --deep` in composer.
2. XR enters research mode. Shows plan: queries to run, sources to check.
3. XR fans out searches, fetches pages, ranks by trust, extracts claims with citations (numbered superscripts).
4. Findings appear in a **Research Artifact** (right side in Shell/CC; full-screen in CLI). Sections populate as sources complete:
   - Executive summary (fills in last)
   - Key findings (each with citation numbers)
   - Comparison table
   - Contradictions (flagged with ⚠)
   - Sources (full citations with URLs, retrieval date, credibility badge)
5. User can click a citation number to jump to source; click source to open URL or show fetched snippet.
6. While research runs, user can still ask follow-up questions in composer (piped into the research context).
7. On completion: report artifact is finalized. "Export" button: Markdown, PDF, or copy to clipboard.
8. Report is saved as a session, accessible from Research tab later.

### Acceptance criteria
- Every factual claim has at least one numbered citation.
- No fabricated sources (citations are to real pages fetched during research).
- Contradictions between sources are explicitly flagged, not silently resolved.
- Progress: "Scanned 12 sources · 8 claims · 3 contradictions" indicator updates live.
- User can cancel mid-research and keep partial findings.
- Exported Markdown includes full source list and retrieval timestamps.
- Research respects egress allow-list (doesn't fetch from blocked domains).

---

## Journey 5: Switching models mid-session

**Actor:** Developer who wants to try a smarter model for a hard subtask.
**Trigger:** Current model is stuck; user wants to switch to Claude Opus for one question.
**Preconditions:** Anthropic API key configured.

### Flow
1. XR is stuck or giving mediocre answer.
2. User presses `Alt+P` (or clicks model chip in status bar).
3. Model picker popover appears, searchable. Favorites pinned at top; current model highlighted; local models shown with green dot, cloud with $/1k tokens label, latency when available.
4. User types `claude-opus`, selects, Enter.
5. Popover closes. Status bar now shows `anthropic/claude-opus-4`. A small amber note "next messages use claude-opus-4 (rate: $15/$75 per M tok)" appears as a transient composer hint.
6. Next user message routes to new model. The previously running generation (if any) was already completed or interrupted by Esc before switching — switching does not interrupt running streams.
7. (Optional) User types `/model ollama/qwen2.5:7b` to switch back after the hard question.

### Acceptance criteria
- Switch is one keystroke + fuzzy type + Enter; no navigation to Settings.
- Switch takes effect on next message; running generations are not silently cancelled.
- Picker shows price and latency for each model (where known) so user understands cost.
- Picker allows "Set as default for this workspace" checkbox; default persists.
- Favorite models are user-configurable in Settings; default favorites include the model chosen at onboarding and the 3 most-used models.

---

## Journey 6: Staying within budget

**Actor:** Cost-conscious developer with a strict cloud budget.
**Trigger:** Running tasks throughout a work session with a hard $5/day cap.
**Preconditions:** Budget configured: $0.25/task hard cap, $5/day soft cap, $50/month soft cap.

### Flow
1. Status bar shows spend in real time: `$0.83 / $5 day  ·  $12.40 / $50 mo`. Color turns amber at 80% of any cap, red at 95%.
2. During a task, cumulative cost climbs toward $0.25/task cap. At 90%, a subtle warning appears inline (not a modal): "approaching task budget ($0.22 / $0.25)."
3. At 100%, execution **stops before the next model call**. Over-budget overlay appears:
   - "Task budget ($0.25) reached."
   - Shows meter: spent $0.25, next call estimated at ~$0.03.
   - Options: "Add $1.00 and continue", "Switch to local model and continue", "Stop here" (default — fail closed).
4. User adds budget; execution resumes.
5. At end of day: approaching $5 daily soft cap, warning chip appears: "$4.72 / $5 today". No hard stop (soft cap), but user is prompted once; subsequent warnings are silent (status bar only).
6. At any time, user can click spend chip to open Budget panel: per-task/day/month, per-model breakdown, per-provider breakdown, recent cost events, export CSV.

### Acceptance criteria
- The hard cap is enforced **before** a model call is made, not after (code-enforced in `cost/governor.ts`).
- Spend indicator in status bar updates within 1s of every model call completing.
- Warnings are non-modal; they don't interrupt typing or thinking.
- "Stop here" is the default button on the budget-overrun dialog (fail-closed).
- Switch-to-local option works only if a local model is available and healthy.
- Budget panel data matches the audit log exactly (reconcilable).
- No XR upgrade, provider change, or plugin action can silently raise the cap.

---

## Journey 7: Installing and using a Skill

**Actor:** Developer who wants specialized capability.
**Trigger:** "I want XR to be good at React code reviews."
**Preconditions:** Marketplace registries synced.

### Flow
1. User opens Marketplace (Ctrl+K "marketplace", or `g m`, or `/marketplace`).
2. User searches "react" in Marketplace search.
3. Results: skill cards with name, icon, publisher, trust badge (official/verified/community), short description, star rating, install count.
4. User clicks "React Expert" card. Inspector panel shows:
   - Description
   - What it adds (slash commands, workflows)
   - **Permissions it needs** (file read, shell access? — explicitly listed)
   - Dependencies
   - Examples
   - Changelog
   - Publisher info
   - "Install" button
5. User clicks Install. If the skill requires permissions beyond read-only file access, a confirmation modal explains "this skill can run shell commands in your project" with an explicit "I understand" checkbox.
6. Install completes in <2 seconds; button becomes "Enabled ✓".
7. Composer shows a transient confirmation: "React Expert installed — try `/react-review` or just ask me to review React code."
8. User closes Marketplace. The slash command `/react-review` appears in the `/` menu.
9. User runs `/react-review src/App.tsx`. Skill activates; output is framed (skill name as badge next to response).
10. Later: user can disable or remove the skill from Marketplace → Installed tab.

### Acceptance criteria
- Permissions are shown in plain language before install, not buried in a manifest.
- Skills marked `dangerous` (any network, shell, or write permission) require an explicit typed confirmation for first install.
- Installed skills appear in the slash menu immediately, no restart required.
- Skill output is visually distinct (badge of skill name/color) so user knows when a skill is active.
- Auto-updates for skills are off by default; user can enable per-skill.
- Discovery: recommended skills appear in Home/Overview "Try these skills" section for the user's detected stack.

---

## Journey 8: Switching workspaces (context isolation)

**Actor:** Developer working on two projects.
**Trigger:** Moving from project A to project B.
**Preconditions:** Two workspaces exist: `client-app`, `api-server`. User is in `client-app`.

### Flow
1. User presses Ctrl+W (Shell) or clicks workspace chip in status bar.
2. Workspace Picker overlay appears:
   - Search box at top
   - Currently active highlighted with green ●
   - Each row shows: id · display name · path · session count · last active
   - "Create new workspace" option at top
3. User selects `api-server`, presses Enter.
4. UI switches instantly (optimistic): sidebar workspace label updates, sessions list refreshes in background, composer stays focused.
5. A small toast: "Switched to api-server (~/code/api-server)."
6. Memory, sessions, audit, and budget for `api-server` are now isolated from `client-app`. Asking XR "show me the database schema" answers from `api-server` context, not `client-app`.
7. If XR had background tasks running in `client-app`, they keep running; status bar background indicator shows count ("2 background tasks"); user can switch back and see progress.

### Acceptance criteria
- Switch completes in <200ms perceived (UI responds instantly; state loads async).
- Memory from other workspace does not leak (memory queries are scoped).
- Audit logs for each workspace are separate and verify independently.
- cwd for shell commands is the workspace root, not XR's startup directory.
- Workspace picker is fuzzy-searchable by name or path.
- User can open Control Center in two browser tabs, each pointing to a different workspace (URL: `/workspaces/api-server/...`).

---

## Journey 9: Auditing what XR did (trust & verify)

**Actor:** Security-conscious developer, or CISO evaluating XR.
**Trigger:** After a long session, user wants to see exactly what happened and prove it hasn't been tampered with.
**Preconditions:** At least one completed session; audit chain intact.

### Flow
1. User opens Audit Log (g a, or "Audit Log" sidebar item, or `/audit`).
2. Audit view shows:
   - Filter bar (time range, event type, session, severity)
   - Chain-verification status chip top-right: green "✓ Chain intact" or red "✗ Chain broken" with explanation
   - List of entries: timestamp · event · detail (truncated) · hash (short)
3. User can click any entry to see full detail (event, full args/result, session id, hash, previous hash, workspace).
4. User clicks "Verify chain" — XR walks every entry in the workspace chain, recomputes hashes, confirms integrity. Progress bar; result: green "2,847 entries verified, chain intact" or shows first mismatch.
5. User clicks "Export signed report" → generates a Markdown file (`xr-audit-<workspace>-<timestamp>.md`) containing:
   - Workspace metadata, XR version, time range
   - Every entry in the range
   - Starting hash, ending hash
   - Signature (hash of final state) and a note that `xr verify-log <file>` can re-verify
6. For compliance review: user can filter to "all shell commands," "all network calls," "all file writes" and export only those.

### Acceptance criteria
- Chain verification is mathematically real (SHA-256 chained), not cosmetic.
- Audit log is append-only from the UX; no "delete entry" button exists (bulk prune is a separate, destructive, password-confirmed action in Settings, and prunes are themselves audited).
- Entries recording API calls redact API keys (already enforced in backend; verify in UI no key leaks).
- Export is formatted for non-technical readers too (summary page first, raw entries in appendix).
- Loading the audit view does not block other activity (lazy-paginated, 50 entries at a time).
- User can search by free text across entry details.

---

## Cross-journey quality bars (apply to every journey)

These apply to every journey above:

1. **First paint in <100ms** after any keystroke/navigation.
2. **Streaming is real** — token-by-token, not chunk-at-end.
3. **Status bar always reflects truth** (workspace, mode, model, spend, activity).
4. **Interrupts always work** (Esc/Ctrl+C) within 200ms.
5. **Errors are plain-language and actionable** (not stack traces to end users).
6. **No modal without a way out** (Esc, cancel button, decline button with safe default).
7. **Every action is undoable or approvable before the fact.**
8. **Keyboard-only works for every step**; mouse is optional.
9. **Nothing leaves the machine without an auditable entry and (when applicable) an approval.**
10. **Consistent vocabulary** across all surfaces (see IA §1 for canonical terms).

If a journey implementation fails two or more of these bars, it does not ship in 3.1A.
