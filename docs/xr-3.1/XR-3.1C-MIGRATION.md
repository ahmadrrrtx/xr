# XR 3.1C — CLI Migration Notes

**From:** XR 3.1.x CLI (ad-hoc help + partial registration)  
**To:** XR 3.1C professional CLI  
**Breaking changes:** **None intended.** Legacy commands remain.

---

## 1. What users should do

Nothing required. Upgrade package and continue using existing scripts.

Optional upgrades for clarity:

| Old habit | Preferred 3.1C |
|---|---|
| `xr verify-log` | `xr audit verify` (alias kept) |
| `xr "…" --mode ask` | `xr ask "…"` |
| `xr "…" --mode plan` | `xr plan "…"` |
| Dumping config only | `xr config get defaults.provider` |
| Grep logs manually | `xr logs` / `xr audit tail` |

---

## 2. Script authors

- Prefer `xr <cmd> --json` for stable machine output.  
- Rely on exit codes documented in `xr help scripting`.  
- Set `NO_COLOR=1` or `--no-color` in CI.  
- `XR_WORKSPACE=<id>` selects workspace without flags.

---

## 3. Plugin / skill authors

- No host ABI change (`PLUGIN_API_VERSION` unchanged).  
- Command registration path unchanged (`kernel.commands.register`).  
- New top-level names (`audit`, `session`, `ask`, `plan`, `logs`, `attacks`) are reserved — avoid colliding plugin command names with these.

---

## 4. Internal file moves

| Before | After |
|---|---|
| `src/commands/help.ts` monolithic | re-exports `src/cli/help.ts` |
| `src/index.ts` inline routing | `src/cli/router.ts` |
| Ad-hoc flags per command | `src/cli/flags.ts` globals + local |

Backend services, providers, MCP, memory engines: **untouched contracts**.

---

## 5. Rollback

Revert the 3.1C commit / package version. No data migration is performed by the CLI layer. Config and SQLite stores remain compatible.
