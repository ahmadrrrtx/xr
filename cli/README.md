# xr: coding agent in your terminal

`xr` is a coding agent that runs in your project folder. It reads your code,
proposes edits, and runs commands, asking before anything that changes files or
runs a shell command. This page covers the command line only. The engine,
providers, and desktop app are documented elsewhere.

```
xr                          open the coding REPL in this folder (needs a terminal)
xr "fix the failing test"   run one coding task, then exit
xr -p "explain src/cli"     read-only answer: no edits, no commands
cat log.txt | xr "why?"     piped stdin becomes context for the task
xr --help   xr --version
xr shell                    the full-screen Shell (previously the bare `xr`)
```

Other commands (`xr run`, `xr ask`, `xr serve`, `xr doctor`, …) keep their
existing meaning. `xr run` is the full engine runner. `xr ask` answers without
tools.

## First run

When you run `xr` in a terminal and no model is configured, a short wizard asks
for a provider and a model, then (if the provider needs one) an API key. The key
is stored in XR's secret store, never in `cli.json`. To run the wizard again,
move or delete `cli.json` and run `xr` once more.

## Approvals

Every edit and every shell command goes through an approval. The prompt lists
the choices that apply:

| Prompt | Keys |
| --- | --- |
| Edit a file | `[y/n/a/d/v]` |
| Run a command | `[y/n/a/d/k]` |

- `y` allow this one action
- `n` refuse it (the model is told and can try another way)
- `a` allow every action of this kind for the rest of the session
- `d` show the full diff or the full command first
- `v` open the proposed file in `$VISUAL` / `$EDITOR` and apply your version
- `k` stop the current turn (shell prompts only)

Reads (`read_file`, `list_dir`, `search_code`) never ask.

### Dangerous commands always ask

Some commands always prompt, in every mode, including `--approve-all`, and
config allow rules cannot override them:

- recursive delete (`rm -r…`), deletes at the filesystem root
- `sudo`, `mkfs`, `dd` to a device, `shutdown` / `reboot`
- pipes from `curl` or `wget` into a shell, `eval` of remote content
- `git push --force`, recursive `chmod` / `chown`
- commands that can expose secrets (`printenv`, `~/.ssh`, `~/.aws`, `.netrc`)

With no terminal to ask on (piped or CI runs), these are **refused**, not run.

### Precedence

Rules are evaluated in this order. The first match wins:

1. `permissions.deny` rules → refused
2. dangerous-command guard → ask (refused without a terminal)
3. `permissions.ask` rules → ask
4. plan mode → edits and commands refused
5. `permissions.allow` rules → allowed
6. session grants (`a`), `--approve-all`, or `auto-edit` for edits → allowed
7. otherwise → ask (refused without a terminal)

Rule syntax: `shell:npm test*`, `edit:src/*`, `network:https://docs.*`. The part
before the colon is the action kind. The rest is a glob.

## Flags

| Flag | Meaning |
| --- | --- |
| `-p`, `--print [prompt]` | Read-only print mode. Only the read tools are offered (`read_file`, `list_dir`, `search_code`, `fetch_url`), so no edit or shell tool exists in the run. Reads the prompt from stdin when no value is given. |
| `-a`, `--approve-all` | Skip approvals except the dangerous-command guard. Asks you to type `yes` first. Refused when there is no terminal to confirm. |
| `-d`, `--diff` | Propose only. Prints each proposed edit as a unified diff and writes nothing. Commands are not run. |
| `-m`, `--model <id>` | Model id. Must be in the provider's known list. |
| `--provider <id>` | Provider id, for example `groq`, `ollama`, `anthropic`. |
| `--tools <list>` | Narrow the tool set: `read`, `search`, `edit`, `shell`, `web`, comma-separated. |
| `--cwd <dir>` | Work in a different folder. |
| `--config <file>` | Use a different `cli.json`. |
| `--no-history` | Do not read or write the REPL history file. |
| `--max-tokens <n>` | Token budget for the whole task (all model calls together). When the budget is used up, the task stops with "budget limit reached" and exit 1. It does not limit output per request and does not affect rate limits. |
| `--json` | Emit JSON Lines events instead of formatted text (see below). |
| `--no-color` | Plain output. Also honored: `NO_COLOR`. |

## Context: @mentions, rules, and the repo map

- `@src/a.ts` attaches a file. `@src/a.ts:10-40` attaches lines 10 to 40.
  `@src/` attaches up to 20 files from a folder.
- Mentions are limited to the working directory. Secret-looking files (`.env`,
  keys, credential stores) are never attached.
- Project rules are read from the first file that exists, in this order:
  `.xr/rules.md`, `AGENTS.md`, `.cursorrules`, `.clinerules`,
  `.github/CLAUDE.md`, `CLAUDE.md`. Rules are instructions to the model, not
  enforcement. Enforcement lives in the permission rules above.
- The repo map lists project files. It honors `.gitignore` (through git when
  the folder is a repository) and `.xrignore`, which uses the same syntax.

## REPL

- `/help`, `/clear` (forget this conversation), `/exit`, `/quit`
- `Ctrl+C` during a turn cancels that turn. At an empty prompt, press `Ctrl+C` twice within two seconds to exit.
- `Ctrl+D` exits.
- History is kept in `~/.xr/cli-history` (`0600`). Use `--no-history` to skip it.

## Configuration

`~/.xr/cli.json` (or `$XR_HOME/cli.json`, `--config`, or `$XR_CLI_CONFIG`):

```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "permissions": {
    "allow": ["shell:npm test*", "shell:bun test*"],
    "ask": ["shell:git commit*"],
    "deny": ["shell:npm publish*"]
  }
}
```

Precedence for provider and model: flags, then environment (`XR_PROVIDER`,
`XR_MODEL`), then `cli.json`, then the provider's default model. Unknown keys
are ignored. A malformed file is an error that names the file.

Provider keys can come from the environment (`GROQ_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XR_API_KEY`). The coder reads them in memory and never writes
them to disk. The wizard stores a key in XR's secret store instead.

## JSON Lines (`--json`)

One JSON object per line on stdout. Keys are stable.

| `type` | Fields |
| --- | --- |
| `init` | `lines` (banner text) |
| `thinking` | none |
| `token` | `content` (a text delta) |
| `tool` | `id`, `tool`, `status` (`running`, `ok`, `error`), `args` or `output` |
| `approval_request` | `kind`, `tool`, `target`, `decision`, optional `diff` |
| `notice` | `level` (`info`, `warn`, `error`), `message` |
| `summary` | `stopped`, `steps`, `files_changed`, `commands_run`, `denied`, `auto_denied`, optional `meter` |

`summary` is always the last line. It reports what happened, not whether the
task succeeded. Check the exit code and the diff as well.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Finished, with no refused actions |
| `1` | Error (model returned an error, step or budget limit reached) |
| `2` | Usage error (no prompt, or `--tools` selects no available tool) |
| `3` | Network: the provider could not be reached |
| `4` | Denied: an action needed approval and was refused or auto-rejected |
| `130` | Cancelled (Ctrl+C) |

A run that finishes but refused an action exits `4`, because the work may be
incomplete. Exit `0` does not prove the task succeeded.

## Building a standalone binary

```
bun run build:binary:local      # dist/xr-<platform>, compiled with bun --compile
```

`bin/xr` runs `dist/<platform>` when it exists, and falls back to
`bun run src/index.ts` otherwise. There are no install scripts (no `postinstall`).

## Privacy

Prompts, attached files, search results, and command output are sent to the
provider you chose. With a local provider (for example `ollama`) they stay on
your machine. `fetch_url` and `web_search` contact the sites they query.
