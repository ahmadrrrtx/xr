# XR 3.1B — TypeScript Audit

**Date:** 2026-07-14  
**Auditor:** Principal Maintainer / Runtime Engineer (post-implementation)  
**Method:** Full `tsc --noEmit` on dirty workspace **and** clean `origin/main` clone.  
**Tooling:** `typescript@5.9.3`, `tsconfig.json` (`strict: true`, `noEmit: true`, Bun types).

---

## Executive finding

| Metric | Value |
|---|---|
| Total `error TS` diagnostics | **23** |
| Errors in XR 3.1B paths (`src/ui/*`, `src/interfaces/shell/*`, `src/interfaces/tui.ts`) | **0** |
| Errors on clean `origin/main` (no 3.1B files) | **23** (identical set) |
| Category A (introduced by 3.1B) | **0** |
| Category B (pre-existing) | **23** |
| Category C (exposed by 3.1B) | **0** |

**Verification command (reproducible):**

```bash
# Dirty tree (with 3.1B)
bunx tsc --noEmit 2>&1 | grep -c 'error TS'   # → 23

# Clean origin
git clone --depth 1 https://github.com/ahmadrrrtx/xr.git /tmp/xr-clean
cd /tmp/xr-clean && bun install && bunx tsc --noEmit 2>&1 | grep -c 'error TS'  # → 23

# Diff of error text: IDENTICAL
```

**Conclusion:** XR 3.1B did **not** introduce any TypeScript errors. The repository’s current `tsc` failures are entirely pre-existing backend/CLI debt outside the Shell redesign freeze boundary.

---

## Classification legend

| Category | Meaning | Action |
|---|---|---|
| **A** | Introduced by XR 3.1B Shell/UI redesign | **MUST fix** in this pass |
| **B** | Already present on `origin/main` before 3.1B | Document only; do not modify unless required for 3.1B compatibility |
| **C** | Pre-existing bug that 3.1B newly *exposes* at runtime/compile of Shell | Fix only if Shell cannot ship without it |

---

## Category A — XR 3.1B introduced

**None.**

Files audited for A (all typecheck clean):

| File | Role | `tsc` errors |
|---|---|---|
| `src/ui/tokens.ts` | Design tokens | 0 |
| `src/ui/theme.ts` | ANSI / color modes | 0 |
| `src/ui/index.ts` | Public UI API | 0 |
| `src/ui/ansi.ts` | Width-safe ANSI utils | 0 |
| `src/ui/icons.ts` | Glyph + nav vocabulary | 0 |
| `src/ui/primitives.ts` | TUI primitives | 0 |
| `src/ui/terminal.ts` | Terminal engine | 0 |
| `src/ui/css-vars.css` | CSS export (not TS) | n/a |
| `src/interfaces/tui.ts` | `runTUI` entry | 0 |
| `src/interfaces/shell/app.ts` | Shell controller | 0 |
| `src/interfaces/shell/render.ts` | Frame renderer | 0 |
| `src/interfaces/shell/layout.ts` | Geometry | 0 |
| `src/interfaces/shell/types.ts` | State types | 0 |

Consumers of rewritten `theme.ts` / `SYM` (`cli.ts`, `help.ts`, `onboard.ts`, `providers.ts`, `shield.ts`, `layout.ts`) still typecheck against `SYM` string fields — no new errors there from the redesign.

---

## Category B — Pre-existing (document only)

All of the following exist on clean `origin/main` with the same codes and locations. **None are under the 3.1B freeze surface. Do not fix in this stabilization pass.**

### B1 — Business OS

| # | File | Line | Code | Error (summary) | Root cause | Proposed fix (later milestone) |
|---|---|---|---|---|---|---|
| 1 | `src/business/modules/automation/engine.ts` | 229 | TS2367 | Comparison `"retry"` vs `"stop"` has no overlap | Narrowed union after earlier branch makes second compare dead | Restructure control-flow / use exhaustive switch on action kind |
| 2 | `src/business/modules/crm/index.ts` | 87 | TS2322 | `Contact \| null` not assignable to `{ before, after }` | Audit/diff payload shape wrong for update helper | Pass `{ before, after }` objects; handle null separately |
| 3 | `src/business/modules/crm/index.ts` | 87 | TS2739 | `Contact` missing `before`/`after` | Same call site | Same as #2 |
| 4 | `src/business/modules/crm/index.ts` | 185 | TS2345 | `{ contactId }` missing `page`/`limit` | `PaginationParams` required but only filter passed | Spread defaults: `{ page: 1, limit: 50, contactId }` |

### B2 — XR Shield CLI

| # | File | Line | Code | Error (summary) | Root cause | Proposed fix (later) |
|---|---|---|---|---|---|---|
| 5 | `src/commands/shield.ts` | 214 | TS2304 | Cannot find name `KNOWN_MINER_NAMES` | Symbol referenced but not imported/defined in file | Import from shield service module or define constant |
| 6 | `src/commands/shield.ts` | 214 | TS7006 | Parameter `m` implicit `any` | Follow-on from missing array type | Types once #5 fixed |
| 7 | `src/commands/shield.ts` | 224 | TS2304 | Cannot find name `KNOWN_MINER_NAMES` | Same | Same as #5 |
| 8 | `src/commands/shield.ts` | 224 | TS7006 | Parameter `m` implicit `any` | Same | Same as #6 |
| 9 | `src/commands/shield.ts` | 263 | TS2349 | Expression not callable; type `String` | `A.bold` used as value incorrectly in expression context with `scoreColor(A.bold(...))` — `A.bold` is a string ANSI code, not a function | Use `xrBold()` helper or template `${A.bold}...${A.reset}` |
| 10 | `src/commands/shield.ts` | 456 | TS2304 | Cannot find name `existsSync` | Missing `fs` import | `import { existsSync } from "node:fs"` |
| 11 | `src/commands/shield.ts` | 456 | TS2304 | Cannot find name `SHIELD_STATE_PATH` | Constant not in scope | Import/define path constant |
| 12 | `src/commands/shield.ts` | 457 | TS2304 | Cannot find name `SHIELD_STATE_PATH` | Same | Same |
| 13 | `src/commands/shield.ts` | 463 | TS2552 | Cannot find name `platform` (did you mean `osPlatform`?) | Wrong identifier | Use existing `osPlatform` or `process.platform` |
| 14 | `src/commands/shield.ts` | 465 | TS2304 | Cannot find name `spawnSync` | Missing import | `import { spawnSync } from "node:child_process"` |
| 15 | `src/commands/shield.ts` | 469 | TS2304 | Cannot find name `spawnSync` | Same | Same |

### B3 — Control / Kernel / Daemon

| # | File | Line | Code | Error (summary) | Root cause | Proposed fix (later) |
|---|---|---|---|---|---|---|
| 16 | `src/control/service.ts` | 152 | TS2339 | `reason` not on union branch `{ allowed: boolean }` | Permission result union not narrowed | Narrow with `'reason' in result` or unify return type |
| 17 | `src/core/kernel.ts` | 196 | TS2339 | `checkSpendLimits` missing on `BudgetService` | Method renamed/removed; kernel still calls it | Align service interface + kernel job, or remove job |
| 18 | `src/daemon/server.ts` | 270 | TS2304 | Cannot find name `isLocal` | Used without import | `import { isLocal } from "../cost/pricing.ts"` |

### B4 — Integrations / Security policies

| # | File | Line | Code | Error (summary) | Root cause | Proposed fix (later) |
|---|---|---|---|---|---|---|
| 19 | `src/integrations/credentials.ts` | 10 | TS2307 | Cannot find module `../core/database.js` | Dead/moved module path | Point to real store or delete dead code |
| 20 | `src/integrations/registry.ts` | 91 | TS2322 | `"bot_token"` not in auth union | Union incomplete for Telegram-style auth | Extend auth type union |
| 21 | `src/security/policies.ts` | 8 | TS2307 | Cannot find module `../core/database.js` | Same missing module family | Same as #19 |
| 22 | `src/security/policies.ts` | 9 | TS2307 | Cannot find module `../core/rbac.js` | Missing module | Implement or retarget import |
| 23 | `src/security/policies.ts` | 10 | TS2307 | Cannot find module `../core/audit.js` | Missing module | Implement or retarget import |

---

## Category C — Exposed by 3.1B

**None.**

Shell does not import Business OS, Shield command implementation internals, integrations credentials, or security policies modules. Kernel/daemon errors do not block `runTUI` load path:

```
src/index.ts → dynamic import("./interfaces/tui.ts") → shell/app.ts
```

Agent/provider/memory/cost are loaded only when a task runs; their public APIs typecheck for the call sites used by Shell.

---

## Build / script reality (`package.json`)

| Script | Command | Present? | Notes |
|---|---|---|---|
| typecheck | `tsc --noEmit` | **Yes** | Reports 23 pre-existing errors; does not isolate UI |
| test | `bun test` | **Yes** | Existing suite; not expanded by 3.1B |
| start / xr / dev | `bun run src/index.ts` (+ watch for dev) | **Yes** | Primary runtime |
| build | — | **No** | Project ships TypeScript source via Bun; no emit build |
| lint | — | **No** | Not configured |

**Recommendation (do not invent in this pass):**  
Optional later: `typecheck:shell` scoped include for `src/ui/**` + `src/interfaces/shell/**` + `src/interfaces/tui.ts` so CI can gate Shell cleanliness without waiting on Category B debt. Not added here (policy: do not invent scripts unless necessary).

---

## Git history note

Workspace `git log` is shallow / single tip (`fb03f55`). Classification against **pre-3.1B** used a fresh clone of `https://github.com/ahmadrrrtx/xr.git` at `origin/main` HEAD, which contains **none** of the 3.1B Shell files and still yields the **same 23 errors**. That is stronger evidence than shallow blame on a single commit message.

---

## Stabilization actions taken (minimal, 3.1B-only)

| Change | Category | Why allowed |
|---|---|---|
| `src/ui/terminal.ts` — perf log path uses `TEMP`/`TMPDIR`/`TMP` fallback instead of hard-coded `/tmp` | A-compat (Windows) | 3.1B file; cross-platform correctness |
| `src/interfaces/shell/app.ts` — remove unused `spawnSync` import | A hygiene | Dead import in 3.1B controller |

No Category B files modified.

---

## Sign-off

- [x] Every current `tsc` error classified  
- [x] Category A count = 0 (no must-fix TS debt from 3.1B)  
- [x] Category B fully listed with file/line/code/cause  
- [x] Category C = 0  
- [x] Verified against clean git tree, not guessed  
