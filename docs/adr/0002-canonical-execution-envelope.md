# ADR 0002 — The Canonical Execution Envelope

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** Every consequential agent action, on every surface
**Supersedes:** The four independent entry points into the agent loop
**Constitutional basis:** Art. III.2 (one source of truth per concern), Art. VI.3
(one execution envelope), Art. VI "Violations" (*"A surface calling `runAgent`
directly, bypassing the service"*), Art. IX/XIV (governance choke point)

---

## Context

The Phase-2 audit found **four** production call-sites invoking the agent loop
directly:

| Call-site | Line at audit | Path |
|---|---|---|
| `src/services/agent-service.ts` | 258 | the intended one |
| `src/interfaces/shell/app.ts` | 564 | direct `runAgent` |
| `src/telegram/bot.ts` | 179 | direct `runAgent` |
| `src/voice/pipeline.ts` | 155 | direct `runAgent` |
| `src/execution/adapters/agent-adapter.ts` | 183 | direct `runAgent` (fabric) |

Phase 0 · T8 had bridged the *tool set* for the three interactive surfaces
(`services/extensibility-bridge.ts`), and its own header stated the boundary:
*"Phase 0 explicitly forbids unifying the execution envelope — that is Phase 2."*

The consequence was not merely duplication. Each surface hand-built `AgentDeps`,
so behaviour genuinely diverged: only the `AgentService` path assembled a
scope-filtered context package, audited the routing decision, and used the typed
repos. Shell passed the legacy monolithic `store` handle instead. Two surfaces
could answer the same question differently, and nothing detected it.

## Decision

**1. One canonical lifecycle.** `src/core/execution/envelope.ts` defines eight
ordered phases:

```
intent → plan → policy → placement → action → observation → evidence → outcome
```

The envelope is a plain, inspectable value, not a class — an architectural test
walks it.

**2. One loop caller.** `src/core/execution/runner.ts` is the only module
permitted to invoke the agent loop. `src/core/agent.ts` exports `runAgentLoop`
(renamed from `runAgent`); the historical name remains as a deprecated alias for
out-of-tree callers.

**3. Two entry shapes, one path.**

- `AgentService.execute(request)` — for kernel-booted callers (CLI, daemon).
- `executeOnSurface(request)` — for long-lived surfaces that own their
  `WorkspaceStore` and deliberately do not boot the kernel.

The second is **not** a second execution path: it constructs the same
`ExecutionEnvelope`, populates it from the same `buildToolRegistry`, and calls
the same `runEnvelope`. It exists because Shell/Telegram/Voice are long-lived
processes, and booting a kernel per interaction would violate the lazy-boot
guarantee (Art. VI.4, Art. XII). Forcing them through `AgentService` would have
traded one constitutional violation for another.

**4. Compatibility preserved.** `AgentService.runTask` / `runScopedTask` remain
as delegating wrappers (Art. XXVII: no stable surface broken without a
deprecation cycle). They are thin passthroughs to `execute()`, so there is one
code path, not two.

## Enforcement

`test/core/no-bypass.test.ts` fails the build if any module outside
`core/execution/runner.ts` imports the loop. The scan is:

- **static** — `import` / `export … from` specifiers, resolved to real paths;
- **dynamic-aware** — `await import()` specifiers, which a purely static reading
  (and dependency-cruiser's default configuration) would miss;
- **comment- and string-stripped**, so a doc comment quoting the forbidden call
  is not a false positive and a string literal cannot hide a real one;
- **negative-controlled** — a seeded rogue surface must be detected, so a green
  result means something.

`.dependency-cruiser.cjs` encodes the same rule (`only-runner-imports-agent-loop`)
for the CI job.

## Consequences

**Positive.** One choke point to govern (Art. IX/XIV) — policy, audit, context
assembly and tool arbitration now apply identically everywhere by construction
rather than by careful duplication. The three interactive surfaces gained
context assembly and routing audit they never had. Adding a surface is now a
matter of populating an envelope.

**Negative.** One extra indirection between a surface and the loop, and
`SurfaceId` must be extended when a genuinely new surface is added. Both are
accepted: Art. VI states the indirection *is* the price of correctness.

**Deletion budget (ADR-8).** `services/extensibility-bridge.ts` (109 LOC) was
deleted — its guarantee is now structural rather than bolted on.

## Reversibility

No persisted state changed; the envelope is in-memory. Reverting means restoring
the deleted bridge and the four direct call-sites — mechanical, and every step
is in one commit.

## Removal schedule

| Item | Status | Removal |
|---|---|---|
| `services/extensibility-bridge.ts` | **removed** in Phase 2 | done |
| direct `runAgent` call-sites (4) | **removed** in Phase 2 | done |
| `runAgent` deprecated alias | retained for out-of-tree callers | **8.0.0** |

## Non-claims

This ADR does not claim risk-tiered isolation. `EnvelopePlacement.placement`
**records** where work ran (`in_process` today) so the fabric has a field to
reason about; enforcing tiers is Phase 4.
