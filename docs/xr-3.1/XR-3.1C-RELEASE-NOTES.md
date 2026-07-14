# XR 3.1C — Release Notes (CLI Experience)

**Codename:** Professional CLI  
**Version line:** 3.1.x (package remains 3.1.5 unless cut as 3.1.6)  
**Date:** 2026-07-14

---

## Highlights

XR’s command line is now a **first-class product surface**, aligned with the Shell redesign:

- Shared design language (tokens, glyphs, modes, trust vocabulary)
- Canonical command catalog with examples and related commands
- Global flags (`--json`, `--quiet`, `--workspace`, `--mode`, …)
- Structured errors (What / Why / Fix)
- Did-you-mean for typos
- New commands: `audit`, `session`, `ask`, `plan`, `logs`, `attacks`
- Legacy aliases preserved (`verify-log`, `skill`/`skills`, …)

---

## New commands

| Command | Purpose |
|---|---|
| `xr audit tail\|verify\|export` | Tamper-evident audit log |
| `xr session list\|show\|export` | Session history |
| `xr ask "…"` | Read-only mode |
| `xr plan "…"` | Plan-only mode |
| `xr logs` | Recent activity |
| `xr attacks` | Injection defense lab |

---

## Improved commands

- `xr help` — grouped, topic-aware, scripting guide  
- `xr config` — `get` / `set` / `path`  
- `xr budget` / `workspace` — design-system chrome + `--json`  
- `xr doctor --perf` — CLI microbenchmarks  
- `xr run` — safer errors, status header, usage errors  

---

## Developer notes

- Entry: `src/index.ts` → `src/cli/router.ts`  
- Catalog: `src/cli/catalog.ts`  
- Output: `src/cli/output.ts`  
- Docs: `docs/xr-3.1/XR-3.1C-*.md`

---

## Upgrade

```bash
# existing install paths still apply
xr --version
xr help
xr doctor --perf
```

No config migration required.
