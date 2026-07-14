# XR 3.1C — Competitive CLI Research Summary

**Purpose:** Extract best practices (not copies) for XR’s professional CLI.  
**Surfaces studied:** AI coding agents, developer CLIs, terminal UX products.

---

## 1. AI coding agents

| Product | Strengths | Practices adopted for XR |
|---|---|---|
| **Claude Code** | Instant feedback, star-burst busy state, plan/ask/agent modes, Shift+Tab mode cycle, excellent interrupt | Mode vocabulary already in Shell; CLI exposes `ask`/`plan`/`run` + `--mode`; spinner subsystem retained |
| **Codex CLI** | Scriptable non-interactive runs, clear exit behavior | Free-form `xr "task"` + `--json` + exit codes |
| **Gemini CLI** | Provider/model switching clarity | `providers` / `models` first-class; status header shows active pair |
| **OpenCode / Aider / Goose / OpenHands** | Task-first UX, repo context, predictable flags | Task-as-default when argv is natural language; workspace scoping |
| **Continue.dev** | Config discoverability | `xr config get/set/path` + topic help |

**Avoided:** cloning any single agent’s flag dialect or slash-only model.

---

## 2. Developer tools

| Product | Strengths | Practices adopted |
|---|---|---|
| **Git** | Subcommand hierarchy, excellent help, plumbing vs porcelain | Grouped catalog; progressive disclosure |
| **Docker / kubectl** | Noun-verb (`resource action`), wide `--help` | `xr workspace list`, `xr audit verify` |
| **npm / pnpm / Bun** | Fast start, scripts, clear errors | Fast paths for version/help/serve; Bun entry retained |
| **uv / Cargo / Poetry** | Opinionated happy path + power flags | `xr` → Shell; power via subcommands |
| **Terraform** | Plan vs apply separation | `plan` vs `run`/`agent` modes |
| **gh CLI** | Beautiful help, examples, aliases | Examples in every catalog entry; aliases map |
| **Azure / AWS CLI** | Machine output (`--output json`) | Global `--json` / `--format` |

---

## 3. Terminal UX (Warp, Ghostty, WezTerm, iTerm2, Windows Terminal)

| Idea | XR application |
|---|---|
| Fast perceived launch | Version/help <150ms warm Bun path measured |
| No color when not a TTY | Theme `detectColorMode` + `--no-color` + `NO_COLOR` |
| Copy-friendly blocks | Tables + plain text; export markdown for audit/session |
| Discoverability without docs | `xr help`, topic help, did-you-mean |

---

## 4. Cross-cutting best practices (extracted)

1. **Porcelain defaults, plumbing available** — pretty human output; `--json` for scripts.  
2. **Stable exit codes** — 0/1/2/3/4/5/130 documented.  
3. **Did you mean** — edit-distance suggestions on unknown commands.  
4. **Global flags before command flags** — shared parser.  
5. **Help teaches** — quick start first, not alphabetical dump.  
6. **Errors remediate** — never leave the user without a next step.  
7. **Lazy init** — don’t boot the universe for `--version`.  
8. **Aliases, not renames** — never break muscle memory.  
9. **One vocabulary** across GUI/TUI/CLI.  
10. **Quiet is sacred** — `--quiet` / pipes stay clean.

---

## 5. Explicit non-goals

- Replacing the Shell or Control Center.  
- Changing provider/MCP/plugin backend contracts.  
- Adding a new package manager or REPL language.  
- Mimicking a competitor’s brand voice or glyph set (XR tokens win).
