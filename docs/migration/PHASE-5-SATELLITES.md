# Phase 5 — Satellites, renames, and the deprecation timeline

**Applies to:** upgrading from XR 1.0.0 to the first post-Phase-5 release.
**ADRs:** [0027](../adr/0027-xr-shield-is-the-enforcement-boundary.md) (naming) · [0028](../adr/0028-satellite-extraction.md) (extraction)

---

## TL;DR

If you use XR as an agent runtime — `xr "…"`, providers, tools, MCP, plugins, skills, voice, Telegram, the daemon, research, repo intelligence — **nothing changes.** Do not read the rest of this page.

Three things moved:

| You typed | Now |
|---|---|
| `xr shield …` | `xr hygiene …` (old verb still works, prints a notice) |
| `xr enterprise …` / `xr ent …` | `bun add -g @rrrtx/xr-enterprise`, then `xr-enterprise …` |
| `xr evaluate …` / `xr eval …` | `bun add -g @rrrtx/xr-enterprise`, then `xr-enterprise evaluate …` |
| `xr business …` / `xr biz …` | `bun add -g @rrrtx/business-os`, then `xr-business …` |

Nothing was deleted. Everything is maintained, tested, and released — just not inside the core repository.

---

## 1. Why core got smaller

Core carried **33,759 LOC** of enterprise and business-operating-layer code that **no user had ever installed or invoked**. It contributed zero daemon routes and zero agent tools, and it cost review time, security-audit surface, CI minutes, and release-gate weight on a project maintained by one person.

Phase 5 moved it to packages where it can be found, installed, and maintained on its own schedule.

```
core:  154,426 LOC  →  130,742 LOC   (−23,684 · −15.3%)
```

**No enforcement was removed.** Not one policy check, guard, trust decision, approval, egress rule, or audit signature. The shrink is entirely surface that never sat on an execution path — verified by `bun run boundaries` (567 modules, 0 violations) and the full security suite.

### What deliberately stayed

`src/research` (5 agent tools, 11 versioned API operations, voice integration) and `src/repo` (6 agent tools, agent context seeding) were on the extraction list in the original plan. The import census showed they are **live runtime capabilities**, not unused surface — extracting them would have removed operations from a versioned API contract and degraded the agent. They stay, and they are core. See ADR-0028 for the evidence table.

---

## 2. `xr shield` → `xr hygiene`

`xr shield` scanned your *host* — processes, startup items, miners, privacy settings. It never governed what an agent was allowed to do. The name implied otherwise, and both independent audits flagged it.

**"XR Shield" now names the thing that actually enforces:** capability policy, the action guard, the trust lattice and placement, consent/approvals, egress control, execution integrity, and the signed audit chain. See ADR-0027 for the component table.

```bash
xr hygiene status     # canonical
xr shield status      # still works, prints a deprecation notice · removed in 2.0.0
```

For importers:

```ts
// old — still works via a re-export shim, removed in 2.0.0
import { XRShieldService } from "src/security/shield.ts";

// new
import { SystemHygieneScanner } from "src/hygiene/scanner.ts";

// the actual boundary
import { XR_SHIELD_COMPONENTS, evaluatePolicy, checkAction } from "src/xr-shield/index.ts";
```

Your `shield-state.json` and quarantine data are **untouched** — no migration, no data change.

---

## 3. Installing a satellite

```bash
# enterprise governance: policy, authority, audit export, SLOs, incidents,
# supply chain, DR, releases, certification evidence, evaluation harness
bun add -g @rrrtx/xr-enterprise
xr-enterprise policy show
xr-enterprise evaluate run --offline

# business operating layer (default-off extension, unchanged semantics)
bun add -g @rrrtx/business-os
```

Typing a relocated verb on core prints where it went and **exits 2** — a moved feature must not look like a working one (Cmdt 2):

```
  xr enterprise has moved out of core

  What:   organization policy, delegated authority, audit export, SLOs, …
  Where:  @rrrtx/xr-enterprise  (https://github.com/ahmadrrrtx/xr-enterprise)

  Install: bun add -g @rrrtx/xr-enterprise
  Then:    xr-enterprise enterprise …
```

### Business OS behaviour is unchanged

Still default-off, still gated on config **and** per-module effect verification, still fail-closed. The only difference: when it is enabled but not installed, the exclusion reason says so explicitly instead of failing on a missing path. `/api/v1/business/*` endpoints still exist and still return honest empty/503 payloads when the extension is absent — exactly as before.

---

## 4. Deprecation timeline (re-based)

Deprecations written before the 1.0.0 re-baseline pointed at **"removal in 8.0.0"** — a version that no longer exists on this line. Orphaned deadlines are not deadlines. All of them are now retargeted to **2.0.0**:

| Surface | Status | Removal |
|---|---|---|
| `runAgent` alias (ADR-0002) | deprecated, honoured | **2.0.0** |
| `AgentDeps.extraTools` (ADR-0003) | deprecated, honoured | **2.0.0** |
| `xr memory` CLI (ADR-0006) | working alias | **2.0.0** |
| `user_memory` table + engine (ADR-0006) | system of record | **2.0.0**, after a dated notice + reversible migration |
| Legacy `/api/*` mounts | served with `Deprecation`/`Sunset` headers | **≥ 2.0.0** |
| `xr shield` (ADR-0027) | working alias + notice | **2.0.0** |
| `src/security/shield.ts` (ADR-0027) | re-export shim | **2.0.0** |
| `xr enterprise` / `evaluate` / `business` (ADR-0028) | relocation notice, exit 2 | **2.0.0** |

`2.0.0` has no date yet. When it gets one, it lands here and in `CHANGELOG.md` in the same commit (Art. XXVII: announce → warn → migrate → remove).

---

## 5. Rollback

Nothing to roll back. There is **no data migration, no config migration, and no schema change** in Phase 5 — it is subtraction and renaming. Reinstalling the previous version restores the previous CLI surface exactly.

---

## 6. For contributors

```bash
# core
bun install && bun test          # runs test/ only — satellites are separate
bun run boundaries               # enforces: core imports nothing from satellites/

# a satellite
cd satellites/xr-enterprise && bun test
```

Working on core and an extension together? Use `bun link @rrrtx/business-os` rather than a relative path. The path fallback was removed on purpose: it would reintroduce the coupling the extraction removed, and `test/architecture/satellite-isolation.test.ts` fails the build if it comes back.
