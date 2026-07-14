# XR 3.1C — CLI Audit

**Date:** 2026-07-14  
**Scope:** Professional CLI experience redesign (command surface only)  
**Policy:** Backend APIs frozen; Shell design language shared; legacy aliases preserved  

---

## 1. What the CLI was

XR’s CLI had grown stage-by-stage. Power was complete; the *product* was not:

| Symptom | Evidence |
|---|---|
| Felt like multiple tools | Help mixed Stage labels, emoji chrome, “TUI/dashboard” vocabulary vs Shell “Shell / Control Center” |
| Inconsistent verbs | `use` vs `set` vs `switch`; `plugins` vs `plugin`; `skill` vs `skills` |
| Hidden functionality | `verify-log` and `attacks` advertised in help but not always registered as first-class commands |
| Weak discoverability | Flat help walls; no “Did you mean…?”; weak topic help |
| Uneven flags | Some commands accepted `--json`; no global flag contract |
| Error quality | Raw `fatal:` + message; stacks for everyone when something threw |
| Status vocabulary drift | Budget used 💰 emoji; providers used 🏠☁️; Shell used design-system glyphs |
| Config surface incomplete | `xr config` only dumped JSON — no get/set/path |
| Missing IA commands | No `session`, `audit`, `logs`, `ask`, `plan` top-level commands |

---

## 2. Registered commands (pre-3.1C)

From `src/index.ts` registration:

`run`, `install`, `onboarding`, `doctor`, `status`, `repair`, `update`, `reset`, `config`, `budget`, `providers`, `models`, `voice`, `speak`, `listen`, `control`, `research`, `memory`, `plugins`, `plugin`, `mcp`, `skill`, `skills`, `agents`, `shield`, `workspace`

Fast paths: bare `xr` → Shell, `help`, `--version`, `serve`.

---

## 3. Duplication & inconsistency map

| Area | Issue | 3.1C resolution |
|---|---|---|
| Skills | `skill` + `skills` dual registry names | Catalog treats both as canonical aliases; both still registered |
| Plugins | `plugins` manager + `plugin` run shorthand | Documented; both kept |
| Verify | Help said `xr verify-log` | Alias → `xr audit verify` |
| Security lab | Help said `xr attacks` | First-class `attacks` command |
| Workspace switch | Only `use` | `use` + `switch` + `select` |
| Modes | Only via `--mode` on run | `xr ask`, `xr plan`, and `--mode` |
| Help | Monolithic `commands/help.ts` | `cli/catalog.ts` + `cli/help.ts` |
| Output | Mixed `interfaces/cli` + ad-hoc ANSI | `cli/output.ts` sharing theme tokens/glyphs |
| Version | Hardcoded string in index | Still fast-path; JSON enrich via `--json` |

---

## 4. Design goals applied

1. **One clear purpose** per command (catalog descriptions).  
2. **Human-readable by default**, **`--json` when requested**.  
3. **Consistent global flags** (`cli/flags.ts`).  
4. **Safe defaults** (deny destructive; budget caps untouched).  
5. **Excellent help** with examples + related commands.  
6. **Helpful error recovery** (What / Why / Fix / See).  
7. **No command explosion** — prefer subcommands (`audit tail|verify|export`).  
8. **Backwards compatible** — legacy names remain aliases.

---

## 5. Shell alignment checklist

| Shared concept | Shell | CLI 3.1C |
|---|---|---|
| Vocabulary | workspace, session, mode, provider, model, budget, shield, audit | same |
| Glyphs | `src/ui/icons.ts` | status marks + icons in CLI chrome |
| Colors | tokens / theme | `xrCyan` / `xrGreen` / … |
| Modes | agent / plan / ask | same flags + commands |
| Status strip idea | bottom bar | `statusHeader()` one-liner on runs |
| Errors | errorState primitive | `printError` What/Why/Fix |
| NO_COLOR / reduced motion | theme | honored via flags + env |

---

## 6. Residual risks (accepted)

| Risk | Notes |
|---|---|
| Repo-wide `tsc` still fails | Pre-existing Category B (business OS, shield command, etc.) — **0 errors in 3.1C CLI paths** |
| Kernel `onStart` skill index | Fixed defensive optional chaining (latent crash on incomplete manifests) |
| Interactive prompts in CI | Existing command handlers; non-TTY rules documented in help scripting |
| Full multi-OS terminal matrix | Manual operator checklist in deliverables |
