# Reversibility and Approval Model (XR 5.1)

Every governed action gets an honest reversibility class and a matching
approval strength — decided by the deterministic classifier
(`src/environment/classify.ts`), never by a model. XR does not claim rollback
capability that does not exist.

## Reversibility classes

| Class | Meaning | Approval impact |
|---|---|---|
| `reversible` | Effect ephemeral or fully undoable by XR | `none` when also safe + non-coordinate |
| `compensatable` | A defined compensation step exists (pre-image restore, relaunch, undo-where-supported) | `standard` (unless sensitive value → `strong`) |
| `irreversible` | No rollback exists; effect may be permanent | `strong`, auto-approval structurally disabled |
| `unknown` | Reversibility cannot be established from here | **treated as irreversible** → `strong` |

The control-layer boolean (Phase 3) is a **floor, never a ceiling**: if the old
classifier says irreversible, we are irreversible; if it says reversible, the
environment layer may still downgrade to `compensatable` or `unknown` because
target effects cannot be certified.

## Per-action truth table

| Action | Reversibility | Compensation note |
|---|---|---|
| `wait_ms`, `move`, `scroll`, `focus`, `screenshot` | reversible | no residue |
| `app` / `open` / `editor` | compensatable (close what was opened) when base-reversible, else irreversible | close/quit the launched thing |
| `close` | compensatable | relaunch — **unsaved work is not recovered** (stated, not hidden) |
| `type` / `key` | compensatable or irreversible per base | in-app undo *where the target app supports it* — not guaranteed |
| `system clipboard_write` | compensatable | restore prior clipboard if captured beforehand |
| `click` / `drag_drop` | **unknown — always** | pointer events land on whatever the OS hits at delivery time; hit-testing the intended target is a perception question XR cannot certify |
| `browser`: `extract`/`screenshot`/`wait` | reversible | read-only |
| `browser`: `new_tab`/`close_tab`/`switch_tab`, `close` | compensatable / reversible | tab lifecycle |
| `browser`: `goto` | compensatable when base-reversible | navigate back |
| `browser`: fill/type/press/click/upload/drag/submit | unknown or irreversible | in-page compensation *before submission at best*; post-submit effects are not compensatable |
| `file`: `read`/`list` | reversible | — |
| `file`: `write`/`mkdir` | compensatable | **pre-image captured before execution** |
| `file`: `move` | compensatable | move back (compensating transaction) |
| `file`: `delete` | **irreversible** | no compensation — ever. XR never claims a restore for deletes. |
| `computer_use` | unknown | treated as irreversible; strong approval |

## Compensation specs

`CompensationSpec.scope` is honest about what compensation can do:

- `reversible_action` — effect fully undoable by XR.
- `compensating_transaction` — a defined inverse operation exists
  (restore pre-image, move back). Executed only with approval; never silent.
- `best_effort` — relaunch, in-app undo, navigate-back: attempted on request,
  success not guaranteed, partial results disclosed.
- `none` — delete, unknown-reversibility pointer actions: **no
  compensation is offered, because offering would be a false claim.**

## Filesystem pre-image (the one real pre-state capture)

`providers/filesystem.ts` captures a pre-image **before** a compensatable file
write/mkdir executes:

- `write` over an existing file ≤ 1 MiB → full prior content captured in
  memory; over 1 MiB → note only ("compensation limited to deletion of the
  written file"); new file → compensation = remove the written file.
- `mkdir` → compensation = remove the directory if empty.
- `move` → source path recorded so the entry can be moved back.
- `delete` → **no pre-image, no compensation** — irreversible by contract.

Pre-images live in memory for the action's record scope; they are never
written to a shadow directory, never retained as a backup system.

## Approval strengths

| Strength | When | Mechanics |
|---|---|---|
| `none` | safe + reversible + non-coordinate | runs directly under control permissions |
| `standard` | sensitive/destructive risk or compensatable effects | existing Phase 3 approval prompt (CLI and dashboard race; one decision wins) |
| `strong` | irreversible, unknown reversibility, sensitive value, or coordinate-without-high-confidence | **explicit approval mandatory; auto-approval structurally disabled; voice confirmation alone never releases it** (see VOICE.md) |

Sensitive values (`type`/`browser` fill with `sensitive:true`) force `strong`
approval **and** the value is redacted from every record, audit event, and
echo — the approver sees length, not content.

## Cancellations and mid-run stops

- Approvals are per action; a denial records outcome `denied` and stops the
  caller's loop where the caller is a loop (`computer_use` stops immediately on
  deny/block/uncertain/circuit-open).
- Sessions close via `closeEnvironmentSession()` with cleanup (see
  RECOVERY.md); `xr env close-all` sweeps every non-terminal session.
- The kill switch (`XR_ENVIRONMENT_DISABLED=1`, `environment.enabled:false`,
  or per-modality flags) fails closed at the gate, before anything executes.
