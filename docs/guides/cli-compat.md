# XR CLI — Cross-Command Compatibility & Scripting Guide

**Audience:** scripts, CI pipelines, and wrappers around the `xr` binary.
**Contract status:** everything on this page is pinned by tests
(`test/phase0/cli-spine.test.ts` black-box exit codes,
`test/ux/onboarding-yes.test.ts` prompt/`--yes` semantics,
`scripts/golden-path.ts` end-to-end). If you observe behavior contradicting
this page, it is a defect — file a
[false-claim report](https://github.com/ahmadrrrtx/xr/issues/new?template=false_claim.yml).

---

## 1. Exit codes

Defined in `src/cli/flags.ts` (`EXIT`); the router propagates each command's
reported `process.exitCode` (so a failed command never exits 0 silently).

| Code | Name | Meaning in practice |
|---|---|---|
| 0 | OK | Success. |
| 1 | ERROR | Generic failure; also doctor's **not-runnable** verdict (`xr doctor` exits 1 when no task can run — see §5). |
| 2 | USAGE | Bad invocation — unknown command, malformed flags, missing required argument. |
| 3 | NETWORK | Network-only failure paths (update/fetch surfaces). |
| 4 | DENIED | Policy/consent denial paths. |
| 5 | NOT_FOUND | Missing-resource paths. |
| 130 | INTERRUPT | POSIX SIGINT convention (128+2). Since the A-19 cancellation work, `xr run` / free-form task invocations **set** this when the user interrupts: the first SIGINT aborts the run cooperatively — the agent loop stops at its next checkpoint, the session is audited `session.cancelled`, the result is an honest `stopped: "cancelled"` (never a fake completion) — and a second SIGINT force-exits immediately. In pipelines, 130 means *stopped by the user*, distinct from 1 (*failed*). |

**Scripting rule:** test `== 0` vs `!= 0` for control flow; use 2/3/4/5 only
as diagnostics. Verdict-bearing commands document their own non-zero meanings
(doctor below); treat any undocumented non-zero as failure.

## 2. Global flags (every registered command)

Parsed in order by `parseGlobalFlags`; boolean and `--flag=value` forms both
work. Unknown flags pass through to the command — a typo is therefore a
*command* error, never a silent ignore.

| Flag | Effect |
|---|---|
| `--json` / `--yaml` / `--format json\|yaml\|markdown\|text` | Machine-readable output where the command supports it. |
| `--quiet` / `-q` | Minimize chatter (errors still print). |
| `--verbose`, `--debug` | More diagnostics; `--debug` also sets `XR_DEBUG=1` for the process. |
| `--no-color` | Disable ANSI styling (also honors `NO_COLOR`). |
| `--yes` / `-y` | Non-interactive consent at prompt defaults — **per-command semantics in §3**. |
| `--dry-run` | Plan-only where implemented (e.g. agent tasks). |
| `--workspace` / `-w` | Target workspace. |
| `--mode agent\|plan\|ask` | Agent execution mode for task commands. |
| `--provider`, `--model`, `--budget`, `--max-tokens`, `--resume <id>` | Task routing/cost/session controls. |
| `--` | End of flags — everything after is positional. |

Short forms are exact only (`-h -v -q -y -w -o`); no bundling (`-qy` is not
parsed as two flags). Global flags are **re-injected into command args** by
the router, so `xr --yes onboarding` and `xr onboarding --yes` are equivalent.

## 3. `--yes` semantics per command

`--yes` always means "answer every prompt at its documented default". What
the defaults are is the contract:

| Command | `--yes` behavior |
|---|---|
| `xr onboarding` | All wizard defaults: hybrid/local mode by connectivity, default workspace name/theme, **no provider keys**, no optional deps, no import. Recorded caveats: no keys get configured (run `xr provider` after), and if Ollama is installed **and running**, the default-true consent pulls the recommended model (multi-GB). |
| `xr install` / `xr repair` / `xr update` / `xr reset` / `xr control setup` | `approved()` returns the prompt's default; **fail-closed on non-TTY**: without `--yes` on a non-interactive shell these commands decline rather than prompt (`!isTTY → false`). System-level actions additionally require `--allow-system`. |
| `xr uninstall` | Confirms removal; `--keep-data`/`--purge` choose the data outcome. |

## 4. Scripting environment variables

| Variable | Effect |
|---|---|
| `XR_HOME` | Config/state root (default `~/.xr`). Bound once at process start — set it before launching, not between commands. |
| `XR_JSON=1` or `XR_OUTPUT=json` | Equivalent of `--json` globally. |
| `XR_QUIET=1` | Equivalent of `--quiet`. |
| `XR_DEBUG=1` | Debug output. |
| `XR_WORKSPACE=<id>` | Equivalent of `--workspace`. |
| `NO_COLOR=1` | Disable ANSI (also honored transitively). |
| `CI=true` / `XR_CI=1` / `GITHUB_ACTIONS` / `GITLAB_CI` | Non-interactive mode: no spinners/color; TTY-dependent behavior disabled. |
| `XR_TRUST_HARDENED=0\|false` | Opt out of fail-closed isolation (logged + audited; see `docs/security/`). |

## 5. Verdict & JSON contracts worth scripting against

- **`xr doctor`** — answers *"can XR complete a task now?"*: exit 0 ⇔ runnable;
  exit 1 with a reason + one remediation when not. `xr doctor --json` is the
  stable machine-readable form. `"ready"` for a provider means *key present +
  endpoint answering*, **not** key-validated (register #11).
- **`xr status --json`** — installation/component health (not task readiness):
  `{ platform, summary, checks }`.
- **`xr env capabilities --json`** — real host capability probe (isolation
  backend, browser, desktop tools).
- **`xr attacks --json`** — deterministic injection screen report.
- **`xr verify-log`** — exit 0 ⇔ tamper-evident audit chain intact.

## 6. Interactive prompts under piping (post-F-2 contract)

- An **EOF on stdin resolves each prompt at its default** (asks → default
  string, informational confirms → their default).
- **Consent gates fail closed on EOF**: a closed/vanished stdin is never read
  as approval (`approvePrompt` denies). Gate your scripts with explicit
  `--yes`/flags, never with closed stdin.
- **Do not pipe answer *sequences*.** The wizard reads each question through
  its own readline interface and buffered input can be dropped between
  questions — a sequence hangs or misaligns. Scripted flows use `--yes`
  (onboarding) or the command's flags.

## 7. `config.envOverrides` (deployment redirection)

For deployments that must redirect provider-class endpoints without editing
user env, the schema-validated config contract (10 tests pin it):

```jsonc
// ~/.xr/config.json
{
  "envOverrides": { "providers.openrouter.baseUrl": "OPENROUTER_BASE_URL" },
  "envOverridesLocked": false
}
```

Each entry maps a **schema-root-relative, string-leaf** config path to an env
var name (`^[A-Z][A-Z0-9_]*$`). Values are re-validated against the config
schema on load; refused entries land in `loadConfig()` warnings, never
silently applied. `envOverridesLocked: true` disables the mechanism entirely.
Path segments `__proto__`/`prototype`/`constructor` are refused.

## 8. Version & channel compatibility

- Supported platforms/channels and their tiering:
  [`docs/release/SUPPORT_MATRIX.md`](../release/SUPPORT_MATRIX.md).
- Update/rollback per channel:
  [`docs/release/CHANNELS.md`](../release/CHANNELS.md).
- The v1 HTTP API contract is guarded in CI (`api:compat` — 100 operations);
  see [`docs/api/`](../api/).

---

*Written 2026-08-08 against `chore/xr-launch-cleanup` (7.1.0 RC); every claim
verified against `src/cli/flags.ts`, `src/interfaces/cli.ts`,
`src/install/system.ts`, `src/interfaces/onboard.ts`, `src/config/config.ts`.*
