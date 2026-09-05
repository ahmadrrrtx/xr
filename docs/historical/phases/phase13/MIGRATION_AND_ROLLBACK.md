# XR 7.0 — Migration and Rollback Guide

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**From:** XR 6.1.0 (Enterprise)
**To:** XR 7.0.0 (Supremacy)

---

## 1. Migration summary

XR 7.0 is **additive**. There is no destructive migration, no data conversion
step, and no change to how XR executes work.

| Area | Change | Action required |
|---|---|---|
| Evaluation subsystem | New `src/evaluation/` | None — inert until you run `xr evaluate` |
| CLI | New `xr evaluate` (aliases `eval`, `benchmark`) | None |
| CLI catalog | `xr business` now appears in help (it was missing) | None |
| Storage | Two new tables created lazily on first `--save` | None |
| Workflow integrity | Content hash strengthened (security fix) | **Read §3** |
| README | Provider count corrected to a single accurate figure | None |
| Version | `6.1.0` → `7.0.0`, codename `Enterprise` → `Supremacy` | None |

Existing workspaces, workflows, capabilities, policies, audit chains, backups,
and deployment profiles continue to work unchanged.

---

## 2. New storage

On the first `xr evaluate run --save`, two tables are created in the existing
workspace database (`~/.xr/xr.db`):

- `evaluation_runs` — append-only run bodies with integrity digests
- `evaluation_scenario_index` — per-scenario index for history queries

No new datastore, no daemon, no network service. If you never run `--save`,
nothing is written.

---

## 3. Workflow definition integrity (breaking-by-design security fix)

### What changed

XR ≤ 6.1 computed a published workflow definition's `contentHash` over only:

```
definitionId, version, node id + kind, entryNodeIds
```

That meant a published definition's **executable content** was not covered. A
stored definition could be modified — swapping a tool node's command, changing
its target capability, lowering its risk tier, or flipping `requiresApproval` to
`false` — and `verifyIntegrity()` would still return `true`. `WorkflowEngine`
relies on that check when publishing and loading definitions.

XR 7.0 hashes the **full definition**: every node in its entirety plus the
definition metadata that affects behaviour.

### What you must do

**Nothing is required.** Definitions published before XR 7.0 keep working:

```ts
inspectIntegrity(def)
// { valid: true, level: "legacy_v1", detail: "...Re-publish this definition
//   to obtain full-content integrity coverage." }
```

The legacy scheme is retained (`hashDefinitionLegacyV1`) precisely so no stored
workflow breaks on upgrade. A compatibility contract test enforces this.

**Recommended:** re-publish important workflows to upgrade them to full-content
coverage:

```bash
xr evaluate compatibility        # confirms legacy definitions still load
```

Re-publishing a definition through the normal versioning path stamps the v2
hash automatically.

### Threat model note

This is a non-keyed hash. It provides tamper **evidence** against modification
of stored or transported definitions — not authenticated integrity against an
attacker who can also rewrite the stored hash. Capability/package signing covers
that separate case.

---

## 4. Rollback

### 4.1 Disabling evaluation without disabling XR

The evaluation subsystem is inert unless invoked. To stop using it, simply stop
running `xr evaluate`. No background process, scheduler, or hook runs on its own.

To disable specific suites programmatically, construct the runner with a subset:

```ts
new EvaluationRunner(ALL_SUITES.filter((s) => s.id !== "trust"))
```

XR production operation is unaffected either way.

### 4.2 Rolling back the release

```bash
npm install -g @rrrtx/xr@6.1.0
```

The `evaluation_runs` and `evaluation_scenario_index` tables remain in the
database and are simply unused by 6.1. **Do not drop them** — they hold
historical evidence.

### 4.3 Rolling back the workflow hash

If you must return to 6.1, definitions published under XR 7.0 will carry a v2
hash that 6.1 cannot verify. Either:

- keep the 7.0 definitions and stay on 7.0, or
- re-publish affected definitions on 6.1 (which restamps the legacy hash).

This is the one forward-incompatibility in the release, and it exists because
the old hash was not safe.

### 4.4 Result and certification integrity

- **Never roll back by deleting negative results.** Use invalidation:
  ```ts
  repo.invalidate(runId, "scenario integrity compromised", "release-owner");
  ```
  The body and original digest are preserved; the run is excluded from default
  listings and marked transparently in reports.
- When a scenario registry changes incompatibly:
  ```ts
  repo.invalidateForRegistryChange(currentDigest, "scenario semantics changed", "owner");
  ```
- When a run is invalidated, revoke certifications built on it:
  ```ts
  revokeForInvalidatedRun(records, runId);
  ```

### 4.5 Schema/report version rollback

Result bodies carry `schemaVersion`. Reading a run written under a different
schema version still verifies its digest and reports the version difference in
`integrityDetail`, rather than failing or silently misinterpreting it.

---

## 5. Post-upgrade verification

```bash
bun run typecheck
bun test
bun run set-version:check

xr evaluate run --offline            # 38 scenarios, 14 dimensions
xr evaluate compatibility            # must report no breaking change
xr evaluate claims                   # must be clean
xr evaluate verify                   # stored result integrity
```

Expected: all suites pass, no hard gate violations, no breaking contract change.

---

## 6. What did NOT change

- the runtime kernel and service registry;
- the execution fabric and its state machine;
- trust classification, placement, and isolation behaviour;
- memory/context semantics, consent, and retrieval;
- the workflow engine's execution behaviour (only the integrity hash changed);
- capability install/update/rollback;
- enterprise policy, audit, SLO, incident, backup, and release systems;
- local/cloud/hybrid deployment semantics;
- any user-visible safety control.
