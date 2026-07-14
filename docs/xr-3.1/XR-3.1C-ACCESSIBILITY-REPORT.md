# XR 3.1C — CLI Accessibility Report

**Baseline:** `XR-3.1-ACCESSIBILITY-STANDARDS.md` §1, §3, §4

---

## 1. Standards mapping

| Requirement | Implementation |
|---|---|
| Color never sole channel | Status uses ✓ / ! / ✗ + text (`statusMark`) |
| `NO_COLOR` | Global flag + env in `parseGlobalFlags` / theme |
| Non-TTY plain behavior | Theme detect; spinners degrade in `Spinner` |
| `--json` machine-readable | Global + per-command `emit()` |
| `--quiet` | Suppresses non-essential human lines |
| Help ≤ ~80 cols | Padded columns ~38 + dim descriptions |
| Meaningful exit codes | `EXIT` map 0/1/2/3/4/5/130 |
| Errors explain remediation | `printError` What / Why / Fix / See |
| No raw stacks by default | Only `--debug` / `XR_DEBUG=1` |
| Screen-reader friendly lists | Linear tables; section headers as text |

---

## 2. Keyboard / interaction

CLI is non-fullscreen (except Shell). Interactive prompts reuse existing readline helpers (`confirm`, `ask`, `password`) with clear defaults. Non-interactive environments should pass flags (`--yes`) or use JSON commands that do not prompt.

---

## 3. Testing performed

| Test | Result |
|---|---|
| `NO_COLOR=1 xr budget` | PASS — readable monochrome output |
| Piped output | PASS — no crash |
| `--json` on budget/audit/workspace | PASS |
| Unknown command message structure | PASS |

---

## 4. Residual gaps

| Gap | Severity | Plan |
|---|---|---|
| Not all legacy subsystem CLIs use `cli/output` yet | Low | Progressive adoption; theme already shared |
| YAML emitter is minimal | Low | Sufficient for flat/nested objects |
| Braille-specific audits | Low | Text-only mode via `XR_TEXT_ONLY` (theme) available |
