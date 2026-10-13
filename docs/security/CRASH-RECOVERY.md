# Crash recovery — what XR remembers, and what it never sends

Phase 27 adds a recovery screen to the desktop shell. Because "crash handling"
is the classic place a product quietly starts uploading things, this document is
the contract: what is written to disk, what a report contains, and why there is
no telemetry in it.

## The rule

**XR tells you it was interrupted, shows you what it recorded, and sends nothing
unless you send it.** There is no crash endpoint, no background uploader, no
"anonymous usage data" toggle to leave on by accident. The crash path is the one
place a user is least able to consent, so it is the one place collecting
automatically would be least defensible.

## The dirty flag

| | |
| --- | --- |
| Path | `$XR_HOME/crash-dirty.json` (`~/.xr/crash-dirty.json` by default) |
| Written | once per launch, immediately after the engine sidecar has been spawned |
| Deleted | only by the clean-exit path (`RunEvent::Exit`, after `stop_sidecar` returned) |
| Meaning | "this session started and did not finish" — nothing more |

Contents (no data, only provenance):

```json
{
  "pid": 41217,
  "startedAt": 1760000000000,
  "version": "0.2.0",
  "consecutiveInterruptions": 1,
  "engineSpawnFailed": false
}
```

Whys that matter:

- **A malformed flag still counts as an interruption.** If something wrote the
  marker and the parse fails, the screen appears with `version: "unknown"`. Hiding
  a crash because the marker is unreadable would be the wrong failure mode.
- **The flag is cleared by whichever choice you make.** It is not a permanent
  "you crashed once" record; the screen appears once per interruption.
- **`consecutiveInterruptions` is what turns a mystery into a diagnosis.** Two in
  a row is a crash loop, and the screen changes its copy — and offers the
  engine-less start — rather than repeating the same calm paragraph.
- **`engineSpawnFailed` is set by a launch that never linked** (8 seconds after
  spawn, if there is still no port). That is what makes "the engine is what is
  crashing" a fact rather than a guess.

## The shell's own log

The engine keeps logs; the shell used to keep nothing, so a shell-side crash left
no evidence at all.

| | |
| --- | --- |
| Path | `$XR_HOME/logs/shell.log` |
| Cap | 256 KB, rotated by keeping the newest half (`crash::SHELL_LOG_MAX_BYTES`) |
| Rotation | at a line boundary, before an append that would exceed the cap — a partial line can never be read back as a real one |
| Contents | session start/stop lines, engine up/down observations, recovery decisions, close-to-hide events |

One line per event, prefixed with a millisecond timestamp. No prompts, no
messages, no file contents, no environment.

## The crash report

Assembled locally, only when the user asks for it, by `crash_report`:

| Section | Source |
| --- | --- |
| Provenance | version, OS, architecture, `XR_HOME`, generation time |
| The interrupted run | the flag's contents |
| Shell log tail | last 100 KB of `logs/shell.log` |
| Engine log tails | the three newest `logs/*.log` files, 100 KB each |
| Live engine stderr | the bounded in-memory tail from the current session, when there is one |

Written to `$XR_HOME/crash-reports/xr-report-<epoch-ms>.txt`, with the file's
path, size and source list shown to the user **before** anything else happens.
The action offered is a `mailto:` draft with the summary filled in; the file is
attached by the user, from their own mail client.

### Redaction

Applied to the whole report, and unit-tested (`crash.rs::redaction_*`):

| Redacted | Becomes |
| --- | --- |
| The user's home directory | `$HOME` |
| `Bearer <value>` | `Bearer [redacted]` |
| `token=` / `token: ` / `"token": "` and the same for `api_key`, `apikey`, `secret`, `password`, `access_token` | `[redacted]` |
| Values beginning `sk-`, `ghp_`, `gho_`, `github_pat_`, `xai-`, `AKIA` (12+ chars after the prefix) | `[redacted]` |
| Any run of 32+ hex characters (the engine's pairing token is 48) | `[redacted]` |

Deliberately **not** redacted: ports, localhost URLs, model names, error
messages, commit-ish short hashes, ordinary words. Over-redaction is its own bug
— a report nobody can read is a report nobody sends, and the thing that makes
these reports useful is the engine's own error text.

The direction of the trade is stated in the code: a false positive costs a
reader one line of detail; a false negative mails a token to a bug tracker.

## What recovery does to your work

| Choice | Sessions / chats / workspaces | Runs that were in flight |
| --- | --- | --- |
| Resume | unchanged | marked `killed`, note "App was interrupted" |
| Start fresh | unchanged | dropped entirely |
| Start without the engine | unchanged | same as resume; the sidecar is not spawned this session |

The distinction between `killed` and `completed` is the honest one: a run that
was cut off did not succeed, and the Control Room must not draw a green tick for
it. (Before this phase the persisted store settled every in-flight run as
`completed`, which was optimistically wrong in exactly the case a user cares
about.)

Why the webview owns the rows and Rust owns the fact: there is no runs table in
the database — runs live in the renderer's store, persisted to `localStorage`
under `xr.brain`. Rust knows *that* the app was interrupted; the renderer knows
*which* runs existed. Splitting it any other way would mean fabricating a
database table to hold data the shell never sees.

## The engine-less start, and attaching to your own engine

If the previous session's engine never came up — or this is the second
interruption in a row — the screen offers **Start without the local engine**:
the shell skips the spawn entirely (`engine::skip_spawn`), so a broken engine
binary cannot take the app down twice. Chat history is local, so the app remains
useful.

Attaching to an engine you already run (`xr serve --port 3141`) asks for that
engine's token, because XR's daemon authenticates even on loopback:

- `GET /api/v1/health` is open by design, so it proves *something* is there. It
  is **not** what a token is validated against.
- `GET /api/v1/capabilities` requires a bearer token, so it is what
  `verify_external_token` calls: 200 means the token works; 401/403 means it does
  not, and the error says so without echoing the value.
- The token is used in memory and never written to the settings store or a log.

An attached engine is reported honestly: `engine_link.mode` is `"external"` and
`spawned` is `false`, so nothing claims the shell owns a process it does not —
including the teardown path, which will not try to SIGTERM somebody else's
engine.

## Sandbox interaction

Crash recovery is deliberately sandbox-agnostic, but two Linux details are worth
recording:

- On Linux the engine is spawned with `PR_SET_PDEATHSIG` **and** the engine
  watches its parent pid. A shell killed with `SIGKILL` therefore cannot orphan
  the engine: the kernel delivers the signal, and the engine's own watch is the
  second belt. This is why "start without the engine" can be a *decision* rather
  than a race — the previous engine is already gone.
- Under Flatpak the paths above live inside the sandbox's `XR_HOME`
  (`/var/data/xr`, set in the manifest). The report is written there, and the
  user mails it from the host by way of the per-app data directory; nothing about
  recovery needs `--filesystem=host`.

## Testing this path

Without a GUI, the path is proven in two layers:

1. **Unit** — flag lifecycle, malformed flag, log rotation and its boundary
   behaviour, tail reads, every redaction rule, report assembly, the token
   verifier against a non-XR server, and the URL encoder for the mail draft.
2. **Dev command** — `crash_simulate` writes the flag and calls
   `exit(1)`: a real crash, no teardown, no flag cleanup. It refuses to run in a
   release build unless `XR_ALLOW_CRASH_SIM=1`, because a button that can kill a
   user's app must not ship enabled. The macOS Developer menu carries it as
   "Simulate Crash"; `Settings → About` exposes it in dev builds.
