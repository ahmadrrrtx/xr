# `xr` — the XR coding agent (CLI)

A coding agent for your terminal. Run it in a project directory: it reads your
code, proposes edits, and asks before it writes or runs anything.

```sh
npm i -g @rrrtx/xr        # or: bun i -g @rrrtx/xr
cd your-project
xr                        # interactive REPL (in a terminal)
xr "explain src/router.ts"        # one-shot turn
xr ask "add a unit test for parse()" -d   # preview the change, write nothing
```

The package has no postinstall script and no native build step. A single
binary can be built with `bun run build:cli` (writes `dist/xr`).

## Modes

| Invocation | What happens |
| --- | --- |
| `xr` (in a TTY) | Interactive REPL. One turn per line. `/help`, `/clear`, `/setup`, `/exit`. Ctrl+C cancels a turn; Ctrl+D or Ctrl+C at an empty prompt exits. |
| `xr "<task>"` / `xr ask "<task>"` | One coding turn, then exit. Without a terminal, edits and commands are denied unless you pass `--approve-all` and type `yes`. |
| `xr -p "<question>"` / `--print` | Answer on stdout only, read-only tools. Nothing is written. |
| `echo log | xr "why did this fail"` | Piped stdin is attached to the task. |
| `-d` / `--diff` | Shows each proposed edit as a unified diff and writes nothing. Shell commands are shown, not run. |
| `--json` | Machine-readable JSONL events on stdout (see below). |
| `--help`, `--version` | Printed without starting the engine. |

A command word always wins over a task: `xr status` runs the status command, not
a prompt. If you type a single word that is one edit away from a command, XR
runs it as a task and prints a hint (`Did you mean the command \`xr status\`?`).

## Flags

| Flag | Meaning |
| --- | --- |
| `-p`, `--print` | Print mode (read-only tools by default). |
| `-d`, `--diff` | Preview only: record proposed diffs, write and run nothing. |
| `--json` | Emit JSONL events instead of the formatted transcript. |
| `-a`, `--approve-all` | Approve every edit and command without asking. Dangerous commands still ask. Non-interactive use needs a typed `yes` (see Safety). |
| `-m`, `--model p/m` | Provider and model for this run. |
| `--budget <usd>` | Spend ceiling for this turn (must be positive). When it is reached the run stops with exit 4. |
| `--max-steps <n>` | Tool-step cap for one turn, 1 to 200 (default 20). |
| `--tools a,b` | Restrict the toolset (for example `--tools read_file,search_code`). An unknown name is refused before anything runs. |
| `--cwd <dir>` | Run as if started in `<dir>`. It must exist. |
| `--config <dir>` | Use another XR home directory (its `config.json` is read). |
| `--no-history` | Do not save this session's prompts to the history file. |

## Tools

| Tool | What it does | Approval |
| --- | --- | --- |
| `read_file` | Read a file in the project. | none |
| `list_dir` | List a directory. | none |
| `search_code` | Search the project for a pattern. | none |
| `fetch_url` | Fetch a web page (egress policy applies). | none |
| `web_search` | Search the web. | none |
| `ask_followup` | Ask you a question mid-turn. | answer prompt |
| `write_file` | Create or overwrite a file. | edit |
| `patch_file` | Replace one exact, unique text span in a file. Refuses an empty match, zero matches, or several matches. | edit |
| `run_command` | Run a shell command in the project. | shell (see Limitations) |

Print mode and `-d` use the read-only set unless `--tools` adds more.

## Approvals

Every edit and command is shown before it runs.

- **Edits:** `y` allow once · `n` deny · `a` allow all edits this session · `d` show the full diff · `v` edit the content in `$EDITOR` before writing.
- **Shell commands:** `y` · `n` · `a` allow all commands this session · `d` details · `k` cancel the turn.
- **Flagged shell commands** (for example `sudo`, paths under `~`, credential files, `curl … | sh`): `y` · `n` · `d` · `k`. Session allow (`a`) is never offered for these.

Enter alone is not consent. A deny is a real answer: the model is told, and the
turn continues.

## Safety

- **Non-interactive runs deny by default.** Without a terminal, an edit or a command
  is refused and the reason is printed. The run still finishes.
- **`--approve-all` needs a typed `yes`.** Outside a terminal it prints a red
  warning and reads `yes` from `/dev/tty`. If there is no `/dev/tty`, it refuses
  with exit 1 and nothing runs.
- **Dangerous commands always need a human.** The coding agent's shell approval
  never auto-approves these, even with `--approve-all`. The list covers `sudo`,
  `doas`/`su`, `mkfs`, `dd` to a device, `shutdown`/`reboot`, `chmod 777`,
  recursive `chown`, fork bombs, force-pushes, `git reset --hard`/`clean -f`,
  reads of `.env`, SSH, AWS, or credential files, `env`/`printenv`, `~`/`$HOME`
  paths, system directories, `curl`/`wget` piped to a shell, reverse shells,
  `crontab`/`launchctl`/`systemctl`, and recursive `rm`.
- **The engine's own guard still runs first.** Some of these patterns (for
  example `rm -rf` and `curl … | sh`) are blocked by the engine's security guard
  before the approval prompt is shown, so XR refuses them outright. This is
  deliberately stricter than the prompt-only behaviour in the brief. It is
  recorded as an open decision (see Limitations).
- **Every refusal is recorded.** In `--json` mode the final `done` event lists
  each denied action as `{tool, kind, target, reason}`, where `reason` is
  `diff-only`, `non-interactive`, or `user-declined`. Approvals and denials are
  also written to the engine's audit log.
- **Keys are never plaintext.** The first-run wizard stores provider keys in
  the OS keychain (or the engine's encrypted store). Keys are typed hidden and
  are not written to `config.json` or the prompt history.
- **Spend is capped.** The engine applies a per-task budget (default
  `budget.perTaskUsd` in the engine config). `--budget <usd>` sets it for one
  turn. Reaching it stops the run with exit 4.

## Project context

- **Rules:** `.xr/rules.md` is loaded into the system prompt. If it is absent,
  the first of `AGENTS.md`, `.cursorrules`, `.clinerules`, `.github/CLAUDE.md`
  is used.
- **References in a prompt:** `@path/to/file.ts` attaches the file;
  `@path/to/file.ts:10-40` attaches lines 10 to 40; `@dir/` attaches a
  directory listing.
- **Repo map:** the project's file list is built with `git ls-files` when the
  project is a git repo, otherwise a bounded walk. `.gitignore` is honoured in
  both cases, and `.xrignore` (same syntax) adds more exclusions. Generated
  trees such as `node_modules` are always skipped.
- **Shell output** is truncated to its last 40 lines, unless the command fails
  (then the last 200) or you ask for more.

## Configuration

XR uses the engine's config at `$XR_HOME/config.json` (`XR_HOME` defaults to
`~/.xr`; `--config <dir>` overrides it). The first run asks for a provider. The
wizard offers Ollama (no key), OpenAI, Anthropic, or a custom OpenAI-compatible
endpoint, and writes its completion marker to `$XR_HOME/coder-setup.json`
(mode 0600). Run `/setup` in the REPL to repeat it.

Prompt history is saved to `$XR_HOME/cli-history`. Entries that look like they
contain a credential are not saved.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The turn finished. |
| 1 | Error (bad flags, provider failure, `--approve-all` not confirmed). |
| 2 | Cancelled (Ctrl+C, `k`). |
| 3 | An approval was denied and the turn did not complete. |
| 4 | The spend ceiling or budget was reached. |

Note: 2 is also the shared parser's usage code, so a malformed flag (for example
`--budget -2`, which the parser reads as a flag) can exit 2 as well. Read the
stderr line; it says which case it was.

## `--json` events

One JSON object per line. The events are:

- `prompt`: the task text.
- `token`: model text, streamed. Tool output is never emitted as `token`.
- `tool`: a tool call, with `status` (`running`, `ok`, or `error`) and, when
  finished, a truncated `output`.
- `error`: the reason, if the turn failed.
- `done`: `stopped` (`done`, `max_steps`, `error`, `budget`, `approval`, or
  `cancelled`), `steps`, and `denials` as described under Safety.

## Limitations (read before relying on it)

- **Shell commands are blocked under the default config.** The engine runs shell
  commands in an isolated environment, and it refuses to run when the global
  `security.egressAllowlist` is non-empty (the default). Until that is decided,
  `run_command` reports `blocked: isolation verification failed`. The only
  workaround is an empty allowlist, which also disables the web tools for that
  user. This affects both the REPL and one-shot use.
- **No real-model acceptance was run.** The end-to-end tests use a scripted
  OpenAI-compatible mock. Behaviour against a real model is untested.
- **The wizard's default model names may be stale.** It shows a default and
  lets you type any model id.
- **Legacy commands are still registered.** The `xr` surface is unchanged for
  `run`, `providers`, `config`, and the other legacy commands. Hiding or
  removing them is a separate decision.
- **Not yet built:** git auto-commit with `/undo` (a pattern from Aider, which
  would make every turn reversible). It changes the user's repo, so it is not
  on by default.

## Development

```sh
bun test test/cli/coder            # unit + end-to-end (spawns src/index.ts, mock provider)
bun run build:cli                  # dist/xr, single executable
bun src/index.ts --help
```

The end-to-end tests start a local mock provider and use temporary homes and
projects. They do not touch `~/.xr`.
