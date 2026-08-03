# ADR-0017 — Versioned public API with generated contract artifacts

- **Status:** accepted (Phase 8 · T1)
- **Owner:** daemon/api · **Review:** 2026-08-03

## Context
The daemon's HTTP surface grew organically: routes were hand-described in
docs, no machine-readable schema existed, clients were ad-hoc, and a
"breaking change" was defined by whoever remembered. Constitution Art. XI
(APIs are contracts), Art. XVIII (stability is demonstrated, not promised),
and Art. XXVII (breaking changes need a deprecation path) all require more.

## Decision
1. **Versioned mount** — the public API lives under `/api/v1`; the legacy
   unversioned paths remain as one-to-one aliases during the v1 window
   (negotiated removal per `docs/api/COMPATIBILITY.md`), never a silent cut.
2. **Single route registry** (`src/daemon/routes/registry.ts` +
   `contract.ts`): every route declares id, method, path, and zod schemas
   once — handlers, OpenAPI, and the typed client all consume the same entry.
3. **Generated artifacts, byte-compared in CI**: `docs/api/openapi.json`
   (`bun run api:schema:generate` / `--check` gate) and
   `src/clients/daemon-client.generated.ts` (`client:generate` / `client:check`).
   Hand-editing generated output fails CI.
4. **Breaking-change detection**: `scripts/api-compat.ts` diffs the committed
   schema against the regenerated one; removals, type tightenings, and
   required-field additions fail the gate unless the change went through the
   deprecation policy in `docs/api/COMPATIBILITY.md`.
5. **Server truth stays server-side**: schemas are zod-validated at the
   boundary (400 `problem` responses), so the contract is enforced — not just
   documented — even for clients that ignore the OpenAPI.

## Consequences
- API "stability" is a *demonstrated property*: schema + policy + an enforced
  detector, satisfying the Phase-8 claim rule (no stability claim without all
  three).
- A new route is one registry entry + regenerated artifacts; drift between
  docs and behaviour is structurally impossible.
- Future `/api/v2` follow the same registry; mounts are additive.

## Tests
`test/api/v1-versioning.test.ts`, `test/api/openapi.test.ts`,
`test/api/client.test.ts`, `test/api/compat.test.ts` (30 tests); CI job
`api-contract`.
