# Coding CLI contracts and current limits

The freeform coding entry (`xr`, `xr "task"`, `xr -p ...`) shares the engine with the general desktop and legacy commands. A source module existing in the engine does not imply every surface supports it.

## Supported safety controls

### Dry-run

```bash
xr --dry-run --budget 0.25 "propose a change to src/example.ts"
```

- `--dry-run` / `--dryRun` is forwarded through the coding request and session to the engine tool context.
- The built-in file writer checks `dryRun` **after approval and before writing**. The built-in shell simulates rather than invoking its executor.
- Explicit deny rules still apply; dry-run is not a permission bypass.
- JSONL turn summaries include `dry_run: true`, with no claimed changed files or executed commands for the simulated turn. Normal approved writes remain enabled without dry-run.
- This is **not** “no I/O” or “free inference”: provider/model calls, reads, network retrieval, audit/state updates and explicitly opened local editor previews may still occur. It is not a sandbox or a guarantee about arbitrary third-party tooling.
- Equality forms accept only literal `true` or `false`; a typo such as `--dry-run=maybe` is a usage error. `--diff=true|false` follows the same rule.

### Task limits

```bash
xr --budget 0.25 --max-tokens 12000 "inspect the failing test"
```

- The exact positive finite USD override and positive safe-integer token limit reach AgentService in both one-shot and interactive session construction.
- Missing, zero, negative, nonfinite, fractional-token or trailing-garbage values are rejected rather than silently discarded. Scientific notation is accepted when it resolves to a valid value.
- Limits are per engine task/turn. A multi-turn REPL is not a single session-wide financial allowance.
- **The USD value is not an absolute billing guarantee.** The existing governor can overshoot by a response, and unknown model prices cannot establish a USD bound. Pricing specificity, reservations, output headroom and complete settlement remain separate release-blocking work.
- Omitting a flag preserves the configured limit. Zero is not accepted as a CLI shortcut for an unlimited task.

### Shell approval identity

The production shell schema is `{ "cmd": "..." }`. Policy matching, dangerous-command review, previews and summaries use that canonical `cmd`, never an obsolete/decoy `command` field.

- Explicit deny rules outrank auto-approval.
- Dangerous commands still require a human even under approve-all; unattended requests are refused.
- Missing, non-string or blank `cmd` **approval requests** fail closed.
- Read-only policy cannot be upgraded to execution by ask rules, dangerous-command prompts, allow rules or session grants.
- Argument identity and execution isolation are separate controls. Fixing the coder policy does not fix unsupported execution/network placements.

## Explicitly unsupported coding-entry options

### Resume

`xr --resume <id>` is rejected **before kernel boot or model activity**, rather than silently starting a new task. Full durable coding-session restoration (conversation, working-directory identity, coding state and grant validity) is not implemented by this patch.

The existing engine checkpoint path remains:

```bash
xr run --resume <session-or-task-id>
```

That path has its own documented checkpoint/re-asking semantics; it is not represented here as full coding-REPL restoration.

### Execution mode

The coding entry currently supports `agent`. `xr --mode plan` and `xr --mode ask` are rejected instead of silently executing as agent. Use `-p` for the existing read-only coding answer or `--diff` for edit proposals. The legacy `xr run --mode plan|ask` paths remain available. Unknown engine/coding modes are usage errors; command-local vocabularies such as `xr install --mode minimal|local|byok|hybrid|full` are preserved and forwarded to their owning handler.

## Output and validation

- An admitted `--json` coding turn emits JSONL events, starting with `init`; dry-run notices follow initialization.
- The summary's `commands_run` lists shell tool calls that completed successfully, not every command that may have started. Identified failed or blocked shell calls appear separately in `commands_failed_or_blocked` with their reason. A failed command can already have caused side effects; an empty `commands_run` is **not** proof that nothing ran. Check the tool events and audit trail.
- Interactive `--diff` renders proposals after each turn, clears the previous turn’s proposals, and reports `no edits proposed` when the next turn has none.
- Startup/preflight validation uses the existing global CLI structured JSON error document. Consumers should not treat a preflight refusal as a started run.
- Usage errors exit 2 before cwd changes, stdin waits, kernel/wizard/provider activity for the preflighted options. Reaching a task limit is a different runtime outcome.

### Tool failure reasons (XR-LAUNCH-024)

A failed tool never surfaces as a bare `failed`. In `--json` mode the `tool` line with `"status":"error"` carries `output` (the tool's own message, the same text the model sees), `reason` (a stable code) and `next` (a short next step for a person). The terminal UI prints the message on the `✕` line and the code plus next step beneath it. The daemon chat stream's `tool_result` events carry the same `error`, `reason` and `next` fields.

Codes are a stable API: new codes may be added, existing codes are never renamed or reused. They never contain paths, commands or secret material. Source of truth: `src/core/tool-reasons.ts`.

- `denied:escape`: the path resolves outside the project root.
- `denied:secret-path`: a secret/credential file (`.env`, private keys, token files) was read, moved or referenced by a shell command.
- `denied:filesystem`: the filesystem authority refused the path (symlink, hard link, mount crossing, blocked path).
- `denied:dangerous-command`: the shell guard refused a destructive command.
- `denied:user`: the action was declined at the approval prompt (or by a configured deny rule).
- `denied:policy`: a capability grant, loop policy or other guard rule blocked the tool.
- `blocked:isolation-unavailable`: no verified sandbox is available and XR does not fall back to unsandboxed execution.
- `blocked:integrity`: the execution-integrity gate refused an unverified binary.
- `blocked:filesystem-unsupported`: file tools are unavailable on this platform (for example Alpine/musl).
- `missing:file`: the file or folder does not exist.
- `invalid:arguments`: the model sent malformed or incomplete arguments.
- `invalid:unknown-tool`: the model asked for a tool that is not available in this mode.
- `failed:stale`: the file changed while XR was working on it.
- `failed:too-large`: the file or folder exceeds the tool limit.
- `failed:binary`: the file is not UTF-8 text.
- `failed:cancelled`: the step was cancelled.
- `failed:command`: the shell command ran and exited non-zero.
- `failed:tool`: any other tool-reported failure.
- `error:exception`: the tool threw unexpectedly.

## Still not stable-release ready

This contract patch does **not** repair:

- symlink/junction-safe filesystem authority or sensitive-file defaults;
- canonical hard USD bounding, unknown-price handling or model-pricing specificity;
- authoritative desktop pause/revoke/cancellation across all owned workers;
- default shell host/network verification incompatibility;
- native installer/updater/permissions validation or production demo-data seeding.

Do not run untrusted repositories on the assumption that these boundaries are already complete. Do not infer native GUI behavior from source/unit/browser tests.

## Regression evidence

- `test/cli/coder/tool-contract.test.ts`: actual file/shell tools crossing the coder policy; only isolated shell execution is stubbed, so no dangerous command runs.
- `test/cli/coder/request-contract.test.ts`: strict parsed limits and programmatic preflight.
- `test/cli/coder/tool-reasons.test.ts`: each denial class through the real agent loop and tools, rendered by the real `CoderSession` + `JsonUI`/`TtyUI`.
- `test/e2e-blackbox/coder-contract.test.ts`: actual CLI subprocess, fresh HOME/workspace, real loopback-only provider, and filesystem/audit/output assertions. Includes an ordinary-write control to prevent “everything disabled” from passing as a fix.
- Existing policy/session tests use production `{cmd}` approvals, not the old synthetic `{command}` shape.
