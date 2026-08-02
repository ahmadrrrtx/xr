# ADR-0016 — Business OS Decoupling (governed extension over thin L0)

- **Status:** accepted (Phase 7 · T8)
- **Owner:** runtime/kernel · **Review:** 2026-08-02

## Context
Constitution Art. XVI + Part Eight: Business OS is a governed extension
package (L5) over a thin L0 contract, default-excluded until each module
passes an outcome/effect-verification gate; no in-kernel business domain
schema; no second engine; no simulated success. `src/business/**`
(36 files, 10,777 LOC) sat in the kernel with a provider that imported the
class directly and an ExecutionBridge that recorded `outcome:'succeeded'`
without verifying any effect.

## Decision
1. **Thin L0 contract** `src/core/business-l0.ts` (v1): records, artifacts
   (content-hashed), identity normalization, audit — over the existing
   single-writer store; two additive tables `xr_l0_records` /
   `xr_l0_artifacts` (migration 3). No domain schema in the kernel.
2. **Move** `src/business/**` → `extensions/business-os/**` (git rename,
   import fixups; the extension is packaged with `manifest.json` declaring
   `l0ContractVersion`, modules, and the effect-verification policy).
3. **Effect verification** `extensions/business-os/effect-verification.ts`
   + `effect-specs.ts`: deterministic per-module effect tests against a
   SCRATCH database (row persisted / event persisted / audit appended).
   All 15 modules verified.
4. **Default exclusion**: `BusinessServiceProvider` registers the L0 token
   always; the extension token is null until (a) `business.enabled` AND
   (b) every requested module passes effect-verification. Loaded
   dynamically (`new URL(...)` — no static kernel import; enforced by the
   `kernel-no-business-extension` boundary rule). Failure is fail-closed
   with a recorded reason.
5. **No simulated success**: `ExecutionBridge.executeBusinessAction` now
   requires a deterministic effect verifier; without one (or on failure)
   the outcome is `failed`, never an assumed `succeeded`.
6. **Data preserved**: the extension reads/writes the SAME workspace store
   (`biz_*` tables untouched); verified by test. The move is reversible
   (the extension is a self-contained package; `src/business` is gone but
   the code is intact under `extensions/`).

## Consequences
- ~10.8k LOC out of the kernel; boot carries no business code unless opted in.
- Art. XXIV deletion budget satisfied by the move.
- CLI (`xr business`) and daemon routes resolve the extension through the
  L0 contract + loader; when excluded they report the reason.
- L0 is versioned (`BUSINESS_L0_VERSION = 1`); the extension manifest pins
  the contract version it targets.

## Tests
`test/business/decoupling.test.ts` (9: no kernel schema/static import;
default exclusion; 15/15 module verification; unproven exclusion; data
preservation via L0; L0 records/artifacts/audit; ExecutionBridge
effect-verification; manifest; provider gate).
