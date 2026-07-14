# XR 3.1C — Compatibility Report

---

## 1. Backend freeze

| Area | Status |
|---|---|
| Providers / routing | Unchanged |
| Plugins host ABI | Unchanged |
| MCP manager | Unchanged |
| Skills runtime APIs | Unchanged (defensive index fix only) |
| Memory engine | Unchanged |
| Research engine | Unchanged |
| Shell (`interfaces/shell`) | Unchanged |
| Control Center (`daemon`) | Unchanged |
| Onboarding | Unchanged entry |

---

## 2. CLI compatibility matrix

| Surface | Compatible? | Notes |
|---|---|---|
| `bin/xr.cjs` launcher | Yes | Still spawns Bun → `src/index.ts` |
| Bare `xr` → Shell | Yes | |
| `xr serve` | Yes | Fast path retained |
| `xr "task"` | Yes | Routes to `run` |
| Plugin contributed commands | Yes | Same registry |
| Config file format | Yes | |
| Workspaces DB | Yes | |
| npm package name `@rrrtx/xr` | Yes | version 3.1.5 |

---

## 3. Alias compatibility

All catalog aliases resolve through `registryNameFor` / `resolveCommandName`.  
Critical legacy: `verify-log`, `skill`/`skills`, `plugin`/`plugins`, `--tui`, `health`→doctor, `ws`→workspace.

---

## 4. Intentional behavior changes (non-breaking)

1. Richer help layout and topics.  
2. Unknown near-miss commands exit **2** with suggestions (previously might have been sent to the agent as a one-word task when distance is small).  
3. Errors prefer structured remediation over `fatal:` one-liners.  
4. `xr config` gains get/set/path without removing dump-all default.

---

## 5. Skill index fix

`src/skills/search-index.ts` now null-safe on `permissions`, `dependencies`, `contributions`.  
This unblocks kernel start when a skill manifest is incomplete — **compatibility fix**, not a feature.
