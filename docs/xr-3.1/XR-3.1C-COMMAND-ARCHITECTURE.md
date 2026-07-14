# XR 3.1C — Proposed Command Architecture

Canonical hierarchy (IA §5 + catalog). Legacy aliases in parentheses.

```
xr                              → Shell (default)
xr shell | --tui | tui          → Shell
xr serve [--port n]             → Control Center
xr help [topic|command]         → discovery
xr version | -v | --version     → version

# Work
xr run "<task>" [flags]         (task|do|exec)
xr ask "<question>"
xr plan "<task>"
xr research …
xr agents …                     (agent)
xr control …                    (computer)
xr voice … | speak | listen

# Context
xr workspace list|create|use|switch|delete   (ws|workspaces)
xr session list|show|export                  (sessions)
xr memory …
xr config [get|set|path|…]                   (cfg|settings)

# Intelligence
xr providers …                  (provider)
xr models …                     (model)
xr budget [status|set|reset]    (cost|spend)

# Extensions
xr skills …                     (skill|marketplace)
xr plugins … | plugin …
xr mcp …

# Trust
xr shield …                     (security)
xr audit tail|verify|export     (verify-log|log*)
xr attacks                      (lab|security-lab)

# System
xr doctor [--json] [--perf] [--network]   (health|check)
xr status | update | repair | reset | install | onboarding
xr logs [--limit n]
```

\* `log` resolves to `logs` for activity; `verify-log` maps to `audit verify`.

## Global flags

```
--help -h
--version -v
--json
--yaml
--format text|json|yaml|markdown
--quiet -q
--verbose
--debug
--no-color
--yes -y
--workspace <id>  -w
--mode agent|plan|ask
--model <name>
--provider <id>
--budget <usd>
--max-tokens <n>
--dry-run
--resume <sessionId>
```

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | success |
| 1 | general error |
| 2 | invalid usage |
| 3 | network / auth |
| 4 | security / denied |
| 5 | not found |
| 130 | interrupted |

## Routing rules

1. Fast path: version, help, serve, shell — **no kernel**.  
2. Known command / alias → kernel + registry execute.  
3. Otherwise free-form argv → `run` (agent task).  
4. Near-miss single tokens → usage error + did-you-mean (exit 2).
