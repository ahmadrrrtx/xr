# XR · Phase 2 — Core Workspace (slice 1: engine foundations + the panes that use them)

**Branch:** `phase2/core-workspace` (stacked on `phase1/foundation-hardening`, PR #127) · **PR:** #128
**Scope source:** `docs` master plan §Phase 2 (G-05 PTY, G-06 editor v2 hunk review, G-08 UI state) + design delta v3 P2 rows.

Every "proven" statement below names the test or lane that produced it. Where a claim could not be
produced from this environment, it says so.

---

## 1. What landed

| Item | Engine (trusted layer) | Desktop | Proof |
|---|---|---|---|
| **G-05 real terminal** | `/api/terminal/pty` — a pseudo-terminal through `Bun.spawn({ terminal })` (openpty on Linux/macOS, ConPTY on Windows, **no native addon**, so the compiled sidecar ships it unchanged). Consent is **per session**: one durable high-tier approval whose reason states that keystrokes run as the user and are not policy-inspected. Enforced: cwd inside the project root (400 before any approval), policy gate on the shell binary, session cap (429), per-message input cap, 4 MB output high-water mark with **reported** drops, shell killed on client disconnect / DELETE / daemon stop, XR credentials stripped from the shell environment. | `+ shell` → xterm.js pane in its own lazy chunk (297 KB; Workspace chunk unchanged). Every state shown is an engine event. Keystrokes → engine; size → engine; closing the tab aborts the stream and the **engine** kills the shell. The command runner remains as `+ runner`, labelled "per-command approval". | `test/daemon/terminal-pty.test.ts` (real shell, every OS in the parity matrix — the Windows job is the ConPTY proof); renderer lane G-05 (real Chromium vs real engine): approval banner states the trust model → Approve → pid shown → typed `printf` → its **output** rendered → close tab → engine lists 0 sessions. |
| **G-06 hunk review** | `files.diff` returns hunks with content-addressed ids (sha256 of old-side start + body); `POST /files/hunks/revert` reverse-applies chosen hunks via `git apply -R` of a subset patch after one approval whose preview shows exactly those hunks (preview.ts gains a patch-shaped write preview). Stale ids / changed files → 409 with the live hunks, never guessed; mtime guard before **and** after the approval wait. | The diff card (previously a raw JSON dump) is `HunkReview`: hunks, +/− counts, **Reject** per hunk; the buffer reloads from disk after a revert. Accept is deliberately not a button (the tree already has the change); staging stays in the Git card. | `test/daemon/files-hunks.test.ts` (real git repo: two edits → two hunks; revert one; the other survives byte-for-byte with its id; denial changes nothing; stale id 409); renderer lane G-06: README edit → hunk → Reject → untouched until approval → approve (preview shows the hunk) → git reverts → README byte-identical to HEAD → card says "no working-tree changes". |
| **G-08 UI state** | migration 12 (`ui_state`), `src/state/ui-state.ts`, `GET/PUT /api/state/ui`: per-workspace opaque JSON; enforced: key shape, ≤ 256 KB per value, ≤ 256 keys per workspace, all-or-nothing patches, per-key `updatedAt`. No approval (not a side effect on files or machine). | not wired yet (next slice: tabs/layout/drafts + crash-recovery sheet). | `test/state/ui-state.test.ts` (repo budget contract + both routes through the daemon handler). |
| Router | `route({ pattern })`: exact path shapes for parameterised routes, so `…/{id}/input` and `…/{id}/resize` (same prefix, same method) validate their own bodies — the contract layer validates against the first matching route. | | `test/daemon/terminal-pty.test.ts` (resize body no longer rejected by the input schema). |
| Contract | OpenAPI regenerated (163 operations), typed client regenerated (879 lines; size register updated with the reason). | | `api:schema:check`, `client:check`. |
| Phase 1 carry-overs | `restoreFrom()` refuses while another instance shares the connection (the copy landed on a **live WAL database**) and when the strict close failed (instance re-bound to the untouched file, failure reported). Suite exit closes and **reports** stores left open by tests. | | `test/state/close-releases-file.test.ts` (two instances → refused, both usable, no bytes copied; alone → restored, chain valid); enterprise satellite backup tests 23/23. |

## 2. Measurements that decided the design

| Question | Measurement (bun 1.3.14, Linux) | Consequence |
|---|---|---|
| Does bun have a PTY? | `typeof Bun.Terminal === "function"`; a spawned `sh` reports `stty size` = 30×100 and `tty` = `/dev/pts/0` | Engine-owned PTY with no native addon; the "needs node-pty" note in `terminal.routes.ts` was true for bun < 1.3 and is corrected. |
| How does an interactive shell die? | `proc.kill()` (SIGTERM) → interactive bash **ignores it**, `await proc.exited` never settles; `SIGHUP` → shell and its foreground `sleep 30` gone in ~1 ms; closing the PTY master → same | Kill = SIGHUP → 2 s grace → SIGKILL; Windows: close console + terminate. |
| Can two prefix routes share a prefix? | Resize body rejected with "Request body does not match the published schema … expected string, received undefined (data)" — validated against the **input** route | `route({ pattern })`. |
| Output backpressure | `ReadableStream` with `ByteLengthQueuingStrategy(4 MB)`: `desiredSize ≤ 0` means the client is not draining | Drop + report (`output_dropped` with the byte count), never unbounded buffering. |

## 3. Deliberately not done in this slice / deferred

- Pane manager (drag-split/resize/snap, layouts, per-workspace layout memory) — next slice, on top of G-08.
- UI-state wiring in the renderer, auto-save (1 s debounce), crash-recovery resume sheet.
- Palette v2, approvals v2 (HoldButton D-V3-6, OS notification Approve/Deny), motion-law CI assertions (D-V3-2), undo/redo, drop zone, window-state persistence, icon set v2.
- Per-tab **env** for PTY sessions: not exposed (no consumer yet; the shell inherits the user's environment minus XR credentials).
- Hunk **accept/stage** as a separate action: `git.stage` per file exists; per-hunk staging (`git apply --cached`) is not built until a screen needs it.
- The 65-file test-hygiene sweep: the count is now printed at the end of every run (`[suite-tmp] N WorkspaceStore connection(s) were still open at exit`); the sweep itself is still owed.

## 4. Not runtime-proven here (be explicit)

- ~~ConPTY behaviour on Windows~~ — **proven**: Cross-Platform Windows parity job 105988175290 (PR #128, `abc9c87`) ran `terminal-pty.test.ts` against real `cmd.exe` under ConPTY: all six route tests pass (denial spawns nothing; approved session echoes input and applies resize; disconnect kills the shell; credentials absent in the child; cap = 429). The POSIX-only `stty size` assertion is skipped there by design. The first Windows run on this PR (job 105986895650) also passed every PTY test; its single failure was a test EOL assumption in the hunk test (git's `core.autocrlf` on the runner), fixed as such.
- Lane status on the PR head `abc9c87`: CI ✓ · Channel Install ✓ · Supply Chain ✓ · Cross-Platform Linux ✓ macOS ✓ **Windows ✓** · Desktop App (cargo test Windows, clippy, Linux/macOS/Windows bundles) ✓. The Architecture job caught the core tree ceiling (143,430 > 142,500) on the first run — raised to 144,000 in `scripts/size-gate.ts` with the reason, per ADR-0028.
- xterm rendering inside WebKitGTK / WebView2 (the renderer lane runs Chromium): the pane uses the DOM renderer (no WebGL addon) precisely to keep the parity risk low; a Tauri-session check is still owed.
- Reduced-motion end to end in the new pane: the only transition is the foot colour and it is disabled under `prefers-reduced-motion`; not measured in a real OS setting.
