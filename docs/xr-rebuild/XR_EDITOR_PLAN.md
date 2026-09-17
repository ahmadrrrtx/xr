# XR — Integrated Editor Plan

> Goal: editor that serves the agent loop, not an IDE clone. [RECOMMENDED] unless noted.

## 1. Positioning
- Workspace pane set: Explorer · Editor · Search · Diffs · Problems · Terminal · Git · Preview · Agent sidecar.
- The loop: **select code → ⌘⏎ Ask XR → XR analyzes → proposes edits → runs tests (shell tool, placement-applied) → diff view → approve → apply** (existing approvals + file tools [OBSERVED]).

## 2. Technology
- **CodeMirror 6** core (WebKit/WebView2-safe, small, themable on XR tokens); language packs top-20 languages; LSP deferred to Phase 5+ (problems pane v1 = engine-side lint/test output + git conflict markers).
- **xterm.js** terminals; PTY sessions owned by engine (NEW route `/api/v1/pty/*` w/ placement policy; shells inherit workspace trust mode).
- Diffs: engine-computed (`/files/diff` [OBSERVED]) rendered in semantic gutter; three-way merge helper later.

## 3. AI-native editor behaviors
| Behavior | Mechanism |
|---|---|
| Ask on selection | selection + file context → Work sidecar task |
| Agent edits | AI gutter glyph + pending-diff chip; user approves per hunk or file |
| Explain/trace | read-only annotation drawer citing symbols |
| Test runner | shell tool output → Problems/Output pane w/ rerun button |
| Refactor preview | multi-file diff set w/ per-file approve |
| Conflict guard | file-watched; human edit during agent edit → pause agent on that file (research: Cursor conflict-awareness) |

## 4. States & safety
- Writes only via engine file tools (audit + approvals apply); editor Save = user write (audited as user action).
- Large repos: virtualized tree, .gitignore-aware, watch limits; binary preview fallback.
- Unsaved buffer protection across engine restarts (local draft store, restore sheet).

## 5. Non-goals (Phase scope)
No debugger UI, no extension marketplace inside editor, no LSP refactorings pre-P5.

## 6. DoD checkpoints
P2: open/edit/save/diff/terminal/ask-on-selection/approve-apply on 3 OSes, WebKit+WebView2 parity tests green. P5: problems-from-LSP optional, merge helper.
