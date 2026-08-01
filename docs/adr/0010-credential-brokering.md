# ADR-0010 — Credential Brokering (Secrets Outside Sandboxes)

- **Status:** Accepted (Phase 4 · T4)
- **Owner:** Trust/Security Lead
- **Date:** 2026-08-01
- **Constitution:** Art. IX.5 (secrets scoped to task/workspace, revocable,
  never globally exposed, never logged), Art. XIV.1 (untrusted code isolated).

## Context

Secrets were process-global: `hydrateSecrets()` wrote provider keys into
`process.env`, children inherited them, and the plugin worker bootstrap
SHIPPED raw secret values into the worker's address space (`init` message).
A compromised plugin or a leaked child env exposed every key. Research
(R4/R5 in docs/security/phase4/RESEARCH.md) shows the robust pattern: keep
raw values OUTSIDE the sandbox; broker task-scoped, revocable handles.

## Decision

1. **`CredentialBroker`** (`src/runtime/trust/credentials.ts`) is the only
   holder of raw values: in-memory, task-scoped refs with TTL, `redact()`
   for logs, `assertClean()` before persisting, `revoke*` on completion.
2. **Plugin workers bootstrap with NAMES ONLY** (`secretNames`); the
   `secrets.get` capability is PROXIED to the main thread, which resolves
   the value transiently (never persisted, never logged, never in
   workerData). Compatibility: the `getSecret*` API surface is unchanged.
3. **Trust-path children get explicit env only** — no ambient
   `process.env` inheritance on sandboxed runs (backends already strip env).
4. **Provider-key hydration into `process.env` remains for the provider
   plane** (LLM calls need keys in the host process); the broker path is the
   boundary for anything that crosses into untrusted code. This split is
   documented; full elimination of process-global keys is tracked in the
   known-limitations register (Phase 10 identity work).

## Consequences

- A compromised plugin or MCP server cannot read or exfiltrate raw secrets
  that were never in its address space.
- Secrets never appear in sandbox processes, logs, or children (proven by
  `test/trust/credentials.test.ts` and the worker-protocol types).
- Migration: no data change; `secrets.get` semantics preserved (now
  async-proxied).
