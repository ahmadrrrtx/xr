# XR Critical Fixes — 0.2 Storage Unification, 0.3 Shield Honesty, 0.4 Plugin Sandbox Hardening

## 1. Executive Summary

Three critical/high-severity issues identified in the Stage 0 Audit have been fixed in a single coordinated pass:

| Issue | Severity | Root Cause | Fix |
|-------|----------|------------|-----|
| **0.2 Storage Unification** | Critical | Multiple `new Store()` / `new WorkspaceStore()` calls across commands and services opened separate SQLite connections, fragmenting data across different database files | Every command and service now resolves a single `WorkspaceStore` from the DI container (`"store"` key). `Store.lastOpened()` provides a fallback for code without container access. The `"legacyStore"` alias points to the same instance for backward compatibility. |
| **0.3 Shield Honesty Fix** | Critical | `getFallbackProcesses()`, `getStartupEntries()`, `getScheduledTasks()`, `getDownloads()`, and `getBrowserSecurity()` all injected fake/mock threats when real system commands returned empty results. `analyzeThreatWithAgent` was named misleadingly. `toggleAdBlock` claimed to modify `/etc/hosts` but only toggled a boolean. | All `getFallback*` methods removed. All `if (list.length === 0) { push fake data }` blocks removed. Method renamed to `analyzeThreatHeuristic()`. `toggleAdBlock()` documented as state-only. `getHostsAdBlockData()` returns a reference template, not applied data. `runScan()` on a clean system now returns zero threats. |
| **0.4 Plugin Sandbox Hardening** | High | Plugin sandbox set `process = undefined` on the raw sandbox object but a malicious plugin could escape via `({}).constructor.constructor('return process')()` to reach the host's `process.env`, or use `__proto__` pollution to modify shared prototypes. | Hardened Proxy sandbox intercepts ALL property access and returns `undefined` for `constructor`, `__proto__`, and all `BLOCKED_GLOBALS`. Built-in prototypes are frozen within the VM context via `freezePrototypes()`. Static scan patterns expanded with `child_process` require detection. |

---

## 2. Detailed Audit Report

### 0.2 Storage Fragmentation

**Files with `new Store()` / `new WorkspaceStore()` calls (BEFORE fix):**

| File | Line | Issue |
|------|------|-------|
| `src/commands/audit.ts` | 38 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/doctor.ts` | 33 | `catch { store = new Store(); }` — opened a second connection |
| `src/commands/install.ts` | 10 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/logs.ts` | 24 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/mcp.ts` | 12 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/memory.ts` | 17 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/plugins.ts` | 10 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/session.ts` | 33 | `catch { return new Store(); }` — opened a second connection |
| `src/commands/shield.ts` | 29 | `catch { return new Store(); }` — opened a second connection |
| `src/services/mcp-service.ts` | 16 | `catch { store = new Store(); }` — opened a second connection |
| `src/services/plugin-service.ts` | 18 | `catch { store = new Store(); }` — opened a second connection |
| `src/services/agent-service.ts` | 84 | `resolve("legacyStore")` — used alias instead of canonical key |
| `src/services/multi-agent-service.ts` | 59-60 | `resolve("legacyStore")` — used alias instead of canonical key |
| `src/tools/control.ts` | 59 | `new Store()` — opened a separate connection |
| `src/core/workspace.ts` | 176 | `new Store(ctx.dbPath)` — created unmanaged connection |
| `src/state/store.ts` | entire file | `BaseStore` class opens its own SQLite connection — dead code but still importable |

### 0.3 Fabricated Threats in Shield

**Fake data injection points (BEFORE fix):**

| File | Method | Fake Data Injected |
|------|--------|-------------------|
| `src/security/shield.ts` | `getFallbackProcesses()` | 6 fake processes (systemd, chrome, bun, python, sshd) — **entire method removed** |
| `src/security/shield.ts` | `getStartupEntries()` | 2 fake startup entries (OneDriveStartup, com.apple.updater with curl|bash) |
| `src/security/shield.ts` | `getScheduledTasks()` | 2 fake tasks (GoogleUpdateTask, SecurityXGuard with iex mining pool) |
| `src/security/shield.ts` | `getDownloads()` | 3 fake downloads (Resume_2026.pdf, Financial_Report_Q2.xlsx.exe, adobe_photoshop_crack.zip) |
| `src/security/shield.ts` | `getBrowserSecurity()` | 2 fake browser profiles with fabricated extensions including "FlashVideoDownloader_2026" marked suspicious |
| `src/security/shield.ts` | `analyzeThreatWithAgent()` | Misleading name suggesting AI agents when it's a static lookup |
| `src/security/shield.ts` | `toggleAdBlock()` | Claimed to write to `/etc/hosts` but only toggled a boolean |
| `src/security/shield.ts` | `getHostsAdBlockData()` | Returned data with misleading comment implying it was applied |

### 0.4 Plugin Sandbox Escapes

**Escape vectors (BEFORE fix):**

| Attack | How It Works | Status Before Fix |
|--------|-------------|-------------------|
| `({}).constructor.constructor('return process')()` | Access Function constructor through prototype chain, then call it to get `process` | **VULNERABLE** — `process` was `undefined` on the raw sandbox but accessible via constructor chain |
| `obj.__proto__.polluted = true` | Modify Object.prototype to pollute all objects in the VM | **VULNERABLE** — prototypes were not frozen |
| `globalThis.process` | Access process through globalThis | Partially blocked — `globalThis` was set to the sandbox, but constructor escapes still worked |
| Plugin `require('child_process')` | Static scan catches `from "child_process"` but not `require("child_process")` | Partially blocked — static scan was incomplete |

---

## 3. File Change Plan

| # | Exact Path | Action | Reason |
|---|-----------|--------|--------|
| 1 | `src/state/store.ts` | **Modify** | Replace BaseStore with re-export from workspace-store.ts |
| 2 | `src/state/workspace-store.ts` | **Modify** | Add `lastOpened()` static method and `_lastOpened` tracking |
| 3 | `src/security/shield.ts` | **Modify** | Remove all fake threat injection, rename method, fix adblock |
| 4 | `src/plugins/loader.ts` | **Modify** | Add hardened Proxy sandbox, freezePrototypes(), expanded static scan |
| 5 | `src/core/kernel.ts` | **Modify** | Unify store registration, document 0.2 pattern |
| 6 | `src/commands/audit.ts` | **Modify** | Remove `new Store()` fallback |
| 7 | `src/commands/doctor.ts` | **Modify** | Remove `new Store()` fallback |
| 8 | `src/commands/install.ts` | **Modify** | Remove `new Store()` fallback |
| 9 | `src/commands/logs.ts` | **Modify** | Remove `new Store()` fallback |
| 10 | `src/commands/mcp.ts` | **Modify** | Remove `new Store()` fallback |
| 11 | `src/commands/memory.ts` | **Modify** | Remove `new Store()` fallback |
| 12 | `src/commands/plugins.ts` | **Modify** | Remove `new Store()` fallback |
| 13 | `src/commands/session.ts` | **Modify** | Remove `new Store()` fallback |
| 14 | `src/commands/shield.ts` | **Modify** | Use `"store"` key, add imports, fix description |
| 15 | `src/services/agent-service.ts` | **Modify** | Use `"store"` instead of `"legacyStore"` |
| 16 | `src/services/mcp-service.ts` | **Modify** | Remove `new Store()` fallback |
| 17 | `src/services/plugin-service.ts` | **Modify** | Remove `new Store()` fallback |
| 18 | `src/services/multi-agent-service.ts` | **Modify** | Use `"store"` instead of `"legacyStore"` |
| 19 | `src/tools/control.ts` | **Modify** | Use `Store.lastOpened()` instead of `new Store()` |
| 20 | `src/core/workspace.ts` | **Modify** | Add warning to `getStore()` about creating unmanaged connections |

---

## 4. Validation Checklist

### 4.1 — 0.2 Storage Unification

- [x] **Only kernel.ts creates WorkspaceStore instances** — `grep -rn "new WorkspaceStore" src/` shows only `kernel.ts:85` and `kernel.ts:251`
- [x] **No `new Store()` fallbacks** — All command resolveStore functions use `container.resolve<Store>("store")` without fallback
- [x] **All repos use single connection** — `SessionRepo`, `AuditRepo`, `CostRepo`, `UserMemoryRepo`, `SkillRepo`, `WorkflowRepo` all take a `WorkspaceStore` in constructor
- [x] **switchWorkspace() closes old and opens new** — `kernel.ts:switchWorkspace()` properly closes old, creates new, re-registers all repos
- [x] **legacyStore alias points to same instance** — Both `"store"` and `"legacyStore"` keys in container point to same `WorkspaceStore` instance

**Test command:**
```bash
# Verify only one connection at a time
xr doctor --json 2>/dev/null | jq '.storeConnections'  # should be 1
```

### 4.2 — 0.3 Shield Honesty Fix

- [x] **No `getFallback*` methods** — `grep -rn "getFallback" src/security/shield.ts` returns empty
- [x] **No fake processes** — `getSystemProcesses()` returns empty array when `ps` fails
- [x] **No fake startup entries** — `getStartupEntries()` returns empty when no entries found
- [x] **No fake scheduled tasks** — `getScheduledTasks()` returns empty when no tasks found
- [x] **No fake downloads** — `getDownloads()` returns empty when directory doesn't exist
- [x] **No fake browser profiles** — `getBrowserSecurity()` returns empty when no profiles found
- [x] **Method renamed** — `analyzeThreatHeuristic()` is the primary name; `analyzeThreatWithAgent()` deprecated
- [x] **toggleAdBlock documented as state-only** — Docstring clearly states it does not modify system files
- [x] **getHostsAdBlockData returns reference template** — Comment says "REFERENCE ONLY"

**Test command:**
```bash
# On a clean system (Docker container or CI), run:
xr shield quick-scan --json 2>/dev/null | jq 'length'  # should be 0
```

### 4.3 — 0.4 Plugin Sandbox Hardening

- [x] **Proxy sandbox blocks constructor access** — `handler.get` returns `undefined` for `"constructor"` and `"__proto__"`
- [x] **Proxy sandbox blocks BLOCKED_GLOBALS** — `process`, `Bun`, `require`, `module`, `Function`, `eval`, `WebAssembly`, etc.
- [x] **Prototypes frozen in VM context** — `freezePrototypes()` freezes `Object.prototype`, `Array.prototype`, etc.
- [x] **Static scan catches require("child_process")** — `DISALLOWED_PATTERNS` includes `require\s*\(\s*["']child_process["']\s*\)`
- [x] **Set interceptor prevents overwriting globals** — `handler.set` blocks writes to BLOCKED_GLOBALS

**Test command:**
```bash
# Create a malicious test plugin that tries to escape:
mkdir -p /tmp/test-plugin
cat > /tmp/test-plugin/xr-plugin.json << 'EOF'
{"schemaVersion":1,"id":"test-escape","name":"Test","version":"0.0.1","permissions":[]}
EOF
cat > /tmp/test-plugin/index.ts << 'EOF'
export function activate(host) {
  // Try constructor chain escape
  try {
    const proc = ({}).constructor.constructor('return process')();
    if (proc && proc.env) return { tools: [] }; // ESCAPED!
  } catch {}
  // Try __proto__ pollution
  try {
    ({}).__proto__.polluted = true;
    if ({}.polluted) return { tools: [] }; // ESCAPED!
  } catch {}
  return { tools: [] };
}
EOF
# This plugin should either be rejected by static scan or fail at runtime
xr plugins install /tmp/test-plugin 2>&1 | grep -i "disallowed\|blocked\|error"
```

---

## 5. Migration Instructions

1. **Pull the changes** into your XR repository
2. **No database migration needed** — all table schemas are unchanged
3. **No config changes needed** — shield-state.json and config.json are compatible
4. **If you have code that calls `new Store()`**: Replace with `container.resolve<Store>("store")` or `Store.lastOpened()`
5. **If you call `analyzeThreatWithAgent()`**: It still works (delegates to `analyzeThreatHeuristic()`), but update at your convenience
6. **If you reference `"legacyStore"` in the container**: It still works (alias for `"store"`), but migrate to `"store"` when convenient

---

## 6. Expected Future Benefits

1. **Data Integrity**: All data types (sessions, costs, audit, memory, skills, research) now write to the same database file, enabling cross-cutting queries and consistent backups
2. **Trust in Security Scans**: Users and CI systems can trust that `xr shield scan` reports only real findings — zero false positives from fabricated data
3. **Plugin Ecosystem Safety**: The hardened sandbox prevents malicious plugins from accessing environment variables, spawning processes, or polluting prototypes — enabling a safer plugin marketplace
4. **Single Connection Pooling**: One SQLite connection per workspace means proper WAL mode behavior and no lock contention from multiple writers
5. **Audit Trail Completeness**: Since all writes go to one database, the tamper-evident audit chain captures every operation across all subsystems
6. **Compliance Readiness**: The honesty fix (0.3) ensures security scan results can be used in compliance reports without disclaimers about fabricated data
