# ADR 0004 — One Routing Authority (retiring `providers/routing.ts`)

**Status:** Ratified (Phase 2, 2026-07-31)
**Applies to:** Model/provider selection and fallback on every path
**Supersedes:** `src/providers/routing.ts` (`ProviderRouter`) — **deleted**
**Constitutional basis:** Art. III.2, Art. VI.3 (one provider/model plane),
Art. IV.4 (fail closed), Inviolable P5 (*authority is never granted by
intelligence*), Art. II (local-first sovereignty)

---

## Context

`ProviderRouter` *looked* like a facade: it already delegated model **selection**
to `IntelligenceRouter`. It was not one. It retained two independent behaviours
that could contradict the router it delegated to.

### Defect 1 — a narrower, divergent locality derivation

`providers/routing.ts:126-138` derived locality itself, recognising only three
conditions and forcing `local_only`. It did **not** recognise `private_only` or
`no_cloud`, both of which `intelligence/router.ts:49-132` honours. A workspace
configured `no_cloud` therefore received **no locality constraint at all** on
this path.

### Defect 2 — an unguarded exhaustion fallback

`providers/routing.ts:147-155`, when the router reported `unavailable`:

```ts
const primaryId = overrides?.provider ?? this.config.defaults.provider;
const primary = registry.createProvider(primaryId, this.config, primaryModel);
```

No policy check. A `no_cloud` or `local_only` workspace whose local runtime was
momentarily unavailable was silently handed the configured default — commonly a
**cloud** provider. Data leaves the machine in exactly the configuration that
forbade it, with no error and no audit of the downgrade.

This is a **security defect**, not merely duplication: it is a data-egress
policy bypass in a product whose identity is local-first sovereignty.

### Defect 3 — a dependency cycle

`intelligence/index → intelligence/service → providers/routing → intelligence/router`.

## Decision

**1. `RoutingService` (`src/intelligence/routing-service.ts`) is the sole
authority.** It is the only code that turns a routing decision into a
`Provider`. `src/providers/routing.ts` is **deleted** — the retirement reaches
removal, not just a facade (Part 13.5).

**2. Locality is enforced on every path.** Selection, exhaustion **and**
fallback. One predicate, `localityAllowed(policy, locality)`:

| policy | local | private | cloud | hybrid | unknown |
|---|---|---|---|---|---|
| `any` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `local_only` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `private_only` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `no_cloud` | ✓ | ✓ | ✗ | ✗ | ✗ |

**Ambiguity denies** (Art. IV.4): an unrecognised provider's locality is
`unknown` and is refused under every restrictive policy. XR does not assume a
provider it cannot classify is safe.

**3. Fail closed, explainably.** When no compliant provider exists, the call
raises `LocalityPolicyViolation` naming the policy, the refused provider and its
locality, plus a concrete remedy. It never silently downgrades the user's
guarantee.

**4. Phase-0 · T11 fallback diversity is carried over, not dropped.** A fallback
must change the destination — a different provider, or at minimum a different
model. The shipped defaults (`provider: ollama`, `fallbackProvider: ollama`)
made same-target fallback the common case, which is how *"Primary provider
(ollama) failed … Falling back to ollama"* came to describe retrying a dead
endpoint against itself. The rule is now **also** locality-filtered, so a
fallback can never be the bypass the primary path forbids.

**5. Legacy compatibility preserved.** The `RoutingStrategy` vocabulary
(`primary`/`localFirst`/`cloudFirst`/`hybrid`/`cheapest`/`fastest`),
`localModels.routing`, manual pins, and `FallbackProvider`'s legible label all
behave as before.

## Enforcement

`test/intelligence/locality-invariant.test.ts` — 90 tests. The security property
is asserted as an **effect**: under a restrictive policy with a cloud default,
the call must either resolve to a compliant provider or throw — it must never
return the cloud default. Both outcomes are checked; the pre-Phase-2 behaviour
(silently returning OpenAI) fails both.

**Mutation-tested.** The gate initially scored **0.43**, meaning most operator
flips inside the router went undetected. A survivor probe identified the
untested branches; the fallback-diversity + locality decision and the
local-preset lookups were extracted into pure exported predicates
(`legacyFallbackAllowed`, `isLocalPreset`, `findBestLocalTarget`) and pinned by
truth tables. **Score 0.43 → 0.71**, above the 0.6 gate.

## Consequences

**Positive.** A data-egress bypass is closed. One authority to audit. Dependency
cycle #1 dissolved. The extraction of pure predicates is better design
independent of testing: a decision function with no I/O.

**Negative.** A workspace with a restrictive policy and no compliant runtime now
**fails** where it previously (silently, wrongly) succeeded. That is the
intended behaviour change — the prior success was a lie about the user's privacy
guarantee. The error message names the remedy.

## Reversibility

No persisted state. `FallbackProvider` moved module but is otherwise unchanged.
Reverting is a code revert; a one-commit restoration of the deleted file.

## Removal schedule

| Item | Status | Removal |
|---|---|---|
| `src/providers/routing.ts` | **deleted** in Phase 2 | done |
| `RoutingStrategy` legacy vocabulary | retained (config compatibility) | no date — stable surface |
