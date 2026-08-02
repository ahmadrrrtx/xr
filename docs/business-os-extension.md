# Business OS — Governed Extension (Phase 7 · T8)

> Constitution Art. XVI + Part Eight: Business OS is a **governed extension
> package (L5) over a thin L0 contract** — not a kernel module. It is
> **default-excluded** until each module passes its effect-verification
> gate. No in-kernel business domain schema; no second engine; no simulated
> success.

## Where things live

| Concern | Location |
|---|---|
| Thin L0 contract (kernel) | `src/core/business-l0.ts` — records, artifacts, identity, audit (`xr_l0_records`, `xr_l0_artifacts`; migration 3) |
| Business OS extension | `extensions/business-os/` — manifest.json, src/, effect-specs.ts, effect-verification.ts |
| Kernel provider | `src/core/providers/business.ts` — registers `Tokens.BusinessL0` always; loads the extension lazily when config-enabled AND effect-verified |
| CLI | `xr business` — resolves the extension via `Tokens.BusinessLoader`; reports the exclusion reason when not active |
| Daemon routes | `/api/business/*` — extension metadata via dynamic import |

## The thin L0 contract (kernel)

```ts
BusinessL0 {
  putRecord/readRecord/queryRecords   // durable business records (any module/entity)
  putArtifact/readArtifact/artifactsFor // content-hashed evidence artifacts
  identityFor(actor)                  // normalized user/worker/system identity
  audit/auditSince                    // hash-chained, tamper-evident audit
  contractVersion                     // BUSINESS_L0_VERSION = 1
}
```

The kernel holds **only** this. No `biz_*` table, no CRM/HR/finance schema,
no domain logic. The extension manifest pins the L0 contract version it
targets (`l0ContractVersion: 1`).

## Default-exclusion policy

The extension loads only when BOTH hold:

1. `config.business.enabled = true` (operator opt-in), AND
2. every requested module passes its **effect-verification** tests.

Effect verification runs each module's deterministic effect tests against a
**scratch database** (never user data): create a contact → `biz_contacts`
row exists; record an expense → `biz_expenses` row with the right amount;
deploy a worker → `biz_workers` row exists; etc. A module with no passing
effect test is **excluded**; if a *requested* module is unverified the whole
extension stays excluded (fail-closed) with the reason recorded
(`xr business status`).

```bash
bun run extensions/business-os/effect-verification.ts   # verify all modules
```

## Authoring a Business OS module

1. Add `extensions/business-os/src/modules/<name>/index.ts` following the
   existing module pattern (constructor takes `{ db, bus, audit, … }` from
   the extension wiring; writes go through the same single-writer store).
2. Add a deterministic effect spec in `extensions/business-os/effect-specs.ts`:
   `{ module, tests: [{ id, name, run(store) → { ok, effect } }] }`. The
   test MUST assert a real persisted side effect (row/event/audit).
3. Run the harness: your module is `verified` only when every test passes.
   Until then it is excluded from default loads — that is the point.

## Execution

Business modules run through the canonical execution envelope; the
`ExecutionBridge` records `succeeded` ONLY after a deterministic effect
verifier confirms the side effect landed. Without a verifier, the outcome
is `failed` (fail-closed) — never an assumed success (Art. XVI.4).

## Data preservation & reversibility

User data lives in the SAME workspace store before and after the move
(`biz_*` tables are untouched; the extension reads them through its
`BusinessDatabase` adapter). The move is reversible: the extension is a
self-contained package; `src/business` is gone, but the code, tables, and
CLI/daemon surfaces are preserved, and the L0 contract is versioned.

## Boundaries

`kernel-no-business-extension` (dependency-cruiser + architectural test):
no `src/` module may statically import `extensions/business-os/`. The
kernel provider uses `new URL(...)` dynamic imports only.
