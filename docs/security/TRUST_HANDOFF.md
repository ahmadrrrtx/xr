# XR — Trust-Handoff Protection

**File:** `src/security/trust-handoff.ts` (NEW), wired into `src/tools/files.ts`
(`writeFileTool`). Single source of truth — CLI and any future daemon file-write route
MUST import `classifySensitiveWrite` so the policy cannot diverge.

## Threat
**TRUST HANDOFF:** the agent obeys every rule inside its sandbox, but writes a
configuration/executable file that a *separate trusted component* later reads and
**executes OUTSIDE the sandbox**, after the agent's turn ends. The agent never runs the
malicious code; a Git/IDE/CI/OS component does. Documented incidents: GitPwned
(`git show --output=./.git/config`, CVSS 8.6), Cursor CVE-2026-48124 Stop hook
(CVSS 8.5), Antigravity macOS Seatbelt gap, VS Code task execution.

## Classification (centralized, `TRUST_HANDOFF_RULES`)
| Class | Examples | Behavior |
|---|---|---|
| `TRUST-HANDOFF` | `.git/config`, `.git/hooks/*`, `.git/*`, `.claude/settings.local.json`, `.claude/settings.json`, `.vscode/tasks.json`, `.vscode/settings.json`, `.vscode/launch.json`, `*.code-workspace`, shell rc (`.bashrc`/`.zshrc`/…) | Explicit human approval; shows trusted consumer + implication |
| `EXECUTABLE-CONFIG` | `package.json`, `Makefile`, `justfile`, `Taskfile*`, `Dockerfile`, `docker-compose*`, `compose*`, `.github/workflows/*`, `.gitlab-ci.yml` | Explicit human approval |
| `REQUIRES-APPROVAL` | `.env`, `.env.*` | Explicit human approval (secret exposure) |
| `SAFE` | `src/*`, `README.md`, `docs/*`, `tsconfig.json`, … | Normal flow, no extra gate |

Matching is case-insensitive, on both the normalized path and basename, and reduces an
absolute workspace path to its relative form before matching. **Ordinary project files
are NOT over-blocked** (verified by test).

## Behavior in `writeFileTool`
1. `classifySensitiveWrite(path, cwd)` is computed for every write.
2. If `requiresApproval`, XR audits `write_file.trust_handoff` (classification, ruleId).
3. The human approval prompt is **enriched** with: the classification, the **trusted
   component** that could consume the file, the **execution implication**, and a preview
   containing the diff + implication text.
4. The human still must approve (the tool already requires approval). **A model's own
   "approval" never counts as the required human approval.** There is intentionally **no
   `--force` that silently disables the gate** — if a force path is ever added it must
   still surface the classification and be auditable.

## Why not a silent block?
Blocking every legitimate `package.json`/`Dockerfile`/`.env` write would break normal
development. The control is **deny-by-informed-consent**: the risk is made *visible and
explicit* at the one moment a human is already in the loop (the write approval), which is
exactly where trust handoff should be intercepted.

## Daemon parity
The daemon currently exposes **read-only** file routes (`src/daemon/routes/files.routes.ts`
list/read/diff); it has **no file-write endpoint**. Therefore the single CLI write path
is the only trust-handoff surface today, and `trust-handoff.ts` is the shared module any
future daemon write route must call. This keeps CLI and daemon security decisions
**equivalent** (the spec's requirement) without inventing a daemon write capability.

## Tests
`test/security/trust-handoff.test.ts` — 16 cases: each required path class, nested
paths, case-insensitivity, absolute→relative reduction, non-over-blocking of safe files,
rule-set coverage.

## Residual risk
- The gate is **application-level** and relies on the human reading the implication. A
  user who approves despite the warning can still write a malicious config — but that is
  now an *informed, audited, explicit* decision, not a silent agent action.
- XR cannot prevent *another tool* (e.g., a separate IDE) from writing these files; it
  can only govern its own `write_file` tool. Defense for the broader workspace is OS/
  agent-ecosystem scope.
