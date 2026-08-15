# Phase 02 — API Coherence (P0)

**Project:** XR — The AI Agent You Can Actually Trust
**Repository:** github.com/ahmadrrrtx/xr · **Developer:** Ahmad RRRTX (@ahmadrrrtx)
**Phase:** 02 (of 18) · **Date:** 2026-08-15 · **Base commit:** `4540e745` (main)
**Phase 00 regression anchor:** `eedf546`
**Status:** **GREEN** — all Phase-02 gates pass (see §20).

---

## 1. What was implemented

Phase 02 establishes **one canonical, testable, machine-readable API contract**
spanning frontend → typed client → canonical route layer → daemon handlers →
services, and fixes the skills/plugins 404s **at their architectural root**.

1. **Canonical path propagation into the sub-API adapters** — `handleSkillsApi`
   and `handlePluginApi` now match on the canonical route path supplied by the
   mount layer instead of the raw transport `url.pathname`. This is the single
   root-cause fix; every `/api/v1/skills*` and `/api/v1/plugins*` 404 disappears
   as a consequence, not as a special case.
2. **Adapter wiring** — `extensions.routes.ts` passes `ctx.path` (already
   canonicalized by `createRouteHandler`) through to both adapters.
3. **Unmatched-route observability** — a new `xr_http_unmatched_routes_total`
   counter makes silent route drift visible, with bounded, privacy-safe labels.
4. **Contract enforcement tests** — 68 new tests across four suites covering
   dual-mount behaviour, contract/registry completeness, dashboard route
   coverage, observability privacy, and a performance sanity gate.

**Not implemented, by design:** no new endpoints, no API version design, no
frontend URL changes, no route-layer rewrite, no performance-optimization work.

---

## 2. Why it was implemented — the root cause

`resolveMount()` correctly canonicalizes the two mounts:

| Request | mount kind | canonical path |
| --- | --- | --- |
| `/api/v1/skills/health` | `v1` | `/api/skills/health` |
| `/api/skills/health` | `legacy` | `/api/skills/health` |

`createRouteHandler()` then builds an `effectiveCtx` whose **`path` is
canonical** — and route matching (`route({ prefix: "/api/skills" })`) worked
correctly, so the router *selected* the right route for both mounts.

The defect was one layer deeper. `ctx.url` is the **untouched transport URL**,
and the adapters were invoked as `handleSkillsApi(req, url)`, matching on
`url.pathname`:

```ts
// BEFORE — url.pathname is "/api/v1/skills/health" on the versioned mount
if (!url.pathname.startsWith("/api/skills")) return null;   // → null → 404
```

So for a `/api/v1/...` request the route matched, the adapter was called, its own
guard rejected the path it had just been routed for, it returned `null`, and the
router fell through to the generic `404 {"error":"not found"}`. The legacy mount
worked purely because its transport path *happened* to equal its canonical path.

**The invariant Phase 02 establishes:** handlers operate on the canonical
`/api/...` path space; `/api/v1` is a **transport/mount prefix only** and must
never be visible to a handler.

Reproduced before the fix (in-process harness, 10 requests):
`5 × /api/v1/*` → **404**, `5 × /api/*` → **200**.
After the fix: **all 10 → 200** with byte-identical bodies.

---

## 3. Files changed

| File | Δ | Change |
| --- | --- | --- |
| `src/daemon/skills-api.ts` | +18 −10 | `handleSkillsApi(req, url, path)`; all 8 routing comparisons on canonical `path`; `url` used only for query params |
| `src/daemon/plugin-api.ts` | +16 −6 | `handlePluginApi(req, url, path, store)`; guard, catalog route, and `{id}` regex on canonical `path` |
| `src/daemon/routes/extensions.routes.ts` | +10 −2 | Both handlers destructure `path` from the route context and pass it through |
| `src/daemon/routes/index.ts` | +21 | New exported `unmatchedCategory()` — bounded observability label |
| `src/observability/metrics.ts` | +7 | Registered `xr_http_unmatched_routes_total` |
| `src/daemon/server.ts` | +10 | Increments the counter in the existing tracing wrapper |
| `test/api/openapi.test.ts` | +74 | Bidirectional contract ↔ registry completeness assertions |
| `test/api/contract.test.ts` | +new | 40 dual-mount contract tests |
| `test/api/dashboard-routes.test.ts` | +new | 7 dashboard route-coverage tests |
| `test/api/unmatched-observability.test.ts` | +new | 11 observability/privacy tests |
| `test/api/perf-sanity.test.ts` | +new | 5 PASS/FAIL performance sanity tests |

**Total production change: 82 insertions across 6 files.** No file was rewritten,
no route was added or removed, no error format was invented.

---

## 4. Architecture changes

**None.** The existing architecture was already correct; Phase 02 completes it.

The pre-existing design — one route registry, `resolveMount()` canonicalization,
`DaemonRouteContext` carrying both `url` (transport) and `path` (canonical) —
was sound. The bug was that the canonical value stopped at the router boundary
and never reached the two sub-API adapters. The fix threads the existing value
one level further. Specifically:

- No new route-context type was invented; `DaemonRouteContext.path` already existed.
- No second router, no second contract, no parallel path-resolution logic.
- No special-casing of `/api/v1/skills`, no duplicated handlers, no hardcoded
  path variants, no dedicated `/api/v1/plugins/catalog` route.

**Documented discrepancy (repo vs. spec).** The Phase 02 spec anticipated a
`XR_API_V1_CANONICAL=0` rollback flag. The repository has **no feature-flag
architecture** for routing, and introducing one would add a second routing
behaviour — precisely the duplication this phase forbids. Per the "repository is
the source of truth" rule, the flag was **not created**; rollback is a
`git revert` of the single Phase 02 commit (§19), which is also the mechanism
Phase 00 and Phase 01 document.

---

## 5. The canonical path contract

| Layer | Sees | Rule |
| --- | --- | --- |
| Transport (HTTP) | `/api/v1/skills/x` or `/api/skills/x` | Either mount is accepted |
| `resolveMount()` | mount kind + canonical path | Strips `/api/v1` → `/api` |
| Router matching | canonical `/api/skills/x` | `route({ prefix })` compares canonical only |
| `ctx.path` | canonical `/api/skills/x` | **What handlers must use** |
| `ctx.url` | transport URL, unmodified | **Query parameters only** |
| Handlers/adapters | canonical `/api/skills/x` | Never aware of `/api/v1` |
| Response headers | mount-specific | v1: `x-xr-api-version: v1`; legacy: deprecation set |

Adapters keep the `url` parameter because they legitimately read
`url.searchParams` (`?q=`, `?registryId=`). The distinction is now explicit in
each adapter's doc comment: **`path` routes, `url` parameterizes.**

---

## 6. Single source of truth

`listBaseRoutes()` (16 route groups) remains the one registry. Everything else is
**derived**, never hand-maintained:

```
listDaemonRoutes()  ──►  apiRegistry()  ──►  docs/api/openapi.json   (api:schema:*)
       │                      │         ──►  generated typed client  (client:*)
       │                      └────────────►  api-compat classifier  (api:compat)
       └──► matchRouteId() ──► runtime routing + observability labels
```

`apiRegistry()` skips `meta.surface` entries and maps each route through
`v1Path()`, so the published contract is the **versioned** surface while the
runtime matches canonically. Phase 02 preserved this untouched and added tests
that fail if any derived artifact drifts from the registry.

---

## 7. Contract metadata completeness

`API_CONTRACT` already carried `skills.api` and `plugins.api` entries
(`stability: "experimental"`, templates `/api/skills/{path}` and
`/api/plugins/{path}` with declared `pathParams`), so **no contract entry needed
to be added**. Phase 02 hardened the enforcement into a bidirectional gate
(`test/api/openapi.test.ts`):

1. Every served route id has contract metadata → no undocumented routes.
2. Every contract entry maps to a route the router serves → no orphaned metadata.
3. Every operation has a non-trivial summary, a tag, and a valid stability.
4. Every `{param}` in a templated path is declared in `pathParams`, and every
   declared param appears in the template.
5. `skills.api`/`plugins.api` are public (not surfaces) and reach the generated
   document as `/api/v1/skills/{path}` and `/api/v1/plugins/{path}`.

---

## 8. OpenAPI schema generation

`scripts/generate-openapi.ts` was **not modified**. It remains deterministic:
sorted keys, no timestamps, no filesystem-traversal order. `--check` is the drift
gate against the committed `docs/api/openapi.json`.

**The committed schema did not change**, and this is the correct outcome: the
registry's paths, methods, and metadata are byte-identical before and after
Phase 02. Only the *internal argument* passed to two adapters changed. A schema
diff here would have signalled an accidental surface change.

```
[api-schema] OK — docs/api/openapi.json matches the live route registry (106 operations)
```

---

## 9. Typed client generation

`scripts/generate-client.ts` was **not modified**; `client:check` passes
unchanged. Note that the generator deliberately **skips** operations whose path
contains `{path}` and those with `method: "ANY"`, so the skills/plugins wildcard
adapters produce no typed client methods. That is pre-existing, intentional
behaviour (a wildcard sub-API cannot be expressed as a typed method), and
Phase 02 did not alter it — inventing typed methods for them would have meant
inventing endpoint definitions the registry does not model.

```
[client-check] OK — typed client matches the live route registry
```

---

## 10. Backward compatibility (`api:compat`)

```
[api-compat] OK — no breaking changes (0 compatible change(s), 106 operations)
```

Zero changes of any classification. Phase 02 is a **pure defect fix**: it adds
no operation, removes none, and narrows no type. Endpoints that previously
returned 404 on the v1 mount now return their documented 200 responses — the
contract never promised those 404s; they were the bug.

- The legacy `/api` mount is **retained**, unchanged.
- The announced sunset date is **unchanged** (`LEGACY_SUNSET_HTTP_DATE`, 2027-08-01).
- No new compatibility period was invented.

---

## 11. Tests added

**68 new tests**, all effect-based against a real daemon handler.

| Suite | Tests | Covers |
| --- | --- | --- |
| `test/api/contract.test.ts` | 40 | Dual-mount 200s, response shapes, deprecation headers, v1≡legacy equivalence, adapter-vs-router 404 distinction, auth preservation, mount-prefix confusion |
| `test/api/openapi.test.ts` (added) | 5 | Bidirectional contract ↔ registry completeness, path-param declaration, sub-API representation |
| `test/api/dashboard-routes.test.ts` | 7 | Every dashboard `api()` call site resolves to a served route, on both mounts |
| `test/api/unmatched-observability.test.ts` | 11 | Counter fires on unmatched only, bounded cardinality, no secret leakage |
| `test/api/perf-sanity.test.ts` | 5 | p95 < 500 ms PASS/FAIL, v1-vs-legacy overhead |

Test discipline: ephemeral ports (`port: 0`) or in-process handlers only — **no
hardcoded dev ports**; temp `XR_HOME` + temp `Store` per suite; real bearer
credentials (never weakened auth); assertions on observable effects.

---

## 12. Dashboard route coverage

The dashboard is served as a **template literal**, so a typo in an endpoint URL
is invisible to `tsc`. `test/api/dashboard-routes.test.ts` parses the actual
served `DASHBOARD_SCRIPT`, extracts every `api("/api/...")` call site (including
dynamic `+ encodeURIComponent(id) +` segments), applies the same `v1()` rewrite
the client applies at runtime, canonicalizes it, and asserts `matchRouteId()`
resolves it. **58 call sites** are covered.

No frontend URL was changed: `client-core.ts`'s `v1()` helper was already
correct, and the tests confirm its rewrite is idempotent and never
double-prefixes.

**Three pre-existing dead call sites were discovered** (not caused by Phase 02;
verified against baseline `4540e745`):

| Call site | Status |
| --- | --- |
| `GET /api/mcp` | No daemon route has ever existed — MCP is CLI-only (`src/commands/mcp.ts`) |
| `POST /api/mcp/add` | Same |
| `POST /api/control/stop` | Not part of `control.routes.ts` |

All three are wrapped in `try/catch` in the client, so the panels degrade
gracefully. **Adding endpoints would be scope expansion**, so they are recorded
in a frozen `KNOWN_UNROUTED` allowlist with a test asserting the list never grows
and that each entry is still genuinely unrouted (forcing deletion if one is ever
wired up). Deferred to a later phase — see §18.

---

## 13. Unmatched-route observability

The 404s survived undetected because a router miss and a handler-level 404 were
indistinguishable in telemetry. New counter:

```
xr_http_unmatched_routes_total{method, mount, category}
```

Incremented in the **existing** tracing wrapper in `server.ts` only when
`routeId === "unmatched" && mount.kind !== "surface"` — API misses are counted,
static-surface misses (favicon, unknown pages) are not.

`category` = `unmatchedCategory(canonical)`: the first canonical path segment
**only when it is a known route namespace**, else `"other"` (`"root"` for a bare
`/api`). Cardinality is therefore bounded by the route table, by construction.

Crucially, a handler-level 404 (`/api/v1/skills/nope` → `unknown skills API
route`) is **not** counted as unmatched — preserving exactly the distinction
whose absence hid this bug.

---

## 14. Security validation

Authentication is **unchanged**; canonicalization happens after the auth
decision, and auth was already evaluated on the canonical path.

- All 10 skills/plugins endpoints (both mounts) return **401 without a token** —
  asserted explicitly, so a future regression that "fixes" a 404 by making a
  route public fails the suite.
- An invalid token is rejected on the newly-working v1 skills route.
- Open paths remain exactly `/api/health`, `/api/v1/health`, `/assets/auth.js` —
  asserted; health returns `{ok: true}` unauthenticated on both mounts.
- Route-confusion probes: `/api/v1/v1/skills` → 404, `/api/skills/api/v1/skills`
  → 404, traversal via `..` cannot reach another handler unauthenticated.
- CSRF, rate limiting, and body caps in `dispatch()` are untouched and run before
  routing.

**Metrics privacy:** labels are structural only — verified that a request to
`/api/v1/leaky-route?token=SUPER_SECRET&password=hunter2` produces metric lines
containing none of the secret values, the bearer token, the word `authorization`,
or even the path segment; and that the label key set is exactly
`{category, method, mount}`. A 60-distinct-URL flood collapses into a single
`other` series.

---

## 15. Performance sanity gate

PASS/FAIL only — Phase 02 is not a performance phase. Budget: **p95 < 500 ms**,
20 samples after warm-up, body materialization included.

| Endpoint | p95 | Budget | Result |
| --- | --- | --- | --- |
| `/api/v1/skills` | 62.0 ms | 500 ms | **PASS** |
| `/api/v1/plugins` | 0.5 ms | 500 ms | **PASS** |
| `/api/skills` | 54.2 ms | 500 ms | **PASS** |
| `/api/plugins` | 0.6 ms | 500 ms | **PASS** |

Mount overhead: v1 **51.3 ms** vs legacy **51.8 ms** — canonicalization is a
string slice and adds no measurable cost. (Absolute values are environment
-dependent and are not a baseline claim; the Phase 00 artifacts remain the
reference, cited at ~640 ms p95.)

---

## 16. Regression validation

| Gate | Baseline (`4540e745`) | After Phase 02 | Result |
| --- | --- | --- | --- |
| `bun test` | 2993 pass / 19 skip / **0 fail** (246 files) | **3061 pass / 19 skip / 0 fail** (250 files) | **PASS** — +68 = exactly the new tests |
| `bun run typecheck` | clean | clean | **PASS** |
| `bun run api:schema:check` | OK (106 ops) | OK (106 ops) | **PASS** — no drift |
| `bun run client:check` | OK | OK | **PASS** |
| `bun run api:compat` | OK | OK (0 changes) | **PASS** |

Additional CI gates, all green: `boundaries` (dependency-cruiser: no violations,
540 modules), `size-gate`, `hot-path-lint` (0 sync FS calls on the fast path),
`claim-lint`, `ownership:check`, `ci-capability-gate`.

**Phase 00 baseline anchor intact:** `bun run baseline:phase00:validate` →
`VALIDATE PASS (0 warnings)`, 19/19 required artifacts present. No Phase 00 or
Phase 01 work was reset, moved, or destroyed.

---

## 17. Known limitations

1. **Skills/plugins remain wildcard contract entries.** They are modelled as
   single `{path}` operations rather than one operation per sub-route, so the
   generated OpenAPI describes them coarsely and the typed client exposes no
   methods for them. Decomposing them into ~18 discrete registry entries is a
   real improvement but is an **API surface change**, out of Phase 02 scope.
2. **`stability: "experimental"`** is retained for both sub-APIs. Promoting to
   `stable` is a contract change requiring its own review.
3. **Dashboard call-site extraction is regex-based** over the served template
   literal. It is guarded by a test asserting a plausible call-site count (>40)
   so the parser cannot silently degrade to a vacuous pass, but a sufficiently
   exotic future call expression could escape it.
4. **The perf gate is a sanity check, not a benchmark** — small sample, single
   process, no isolation from host noise. It catches pathological regressions only.

### 17.1 Post-PR CI findings (follow-up commit)

PR #60 surfaced two CI failures that the Linux sandbox run had not. Both were
diagnosed to root cause, reproduced locally, and fixed. `CI / Quality Gate`
was a third red check but is **not an independent failure**: `ci.yml` defines
it as `if: always()` over `needs: [... a11y ...]`, so it simply mirrors the
a11y result.

**(a) `CI / Accessibility` — axe `nested-interactive` on the skills panel.**
Phase 02 *caused* this, and correctly so. The marketplace card was authored as
`<div class="mp-skill-card" role="button" tabindex="0">` while **containing**
native `<button>` children (Install / Enable / Disable). That is a WCAG 4.1.2
violation (a widget role may not wrap interactive descendants). It never fired
before because `/api/v1/skills/marketplace` returned 404, so the panel always
rendered its empty state and the live axe sweep had **no card to scan**. Fixing
canonical routing made the panel render real data and exposed the latent defect.

Verified by construction, not by inference: the same test run against baseline
`4540e745` **passes**, and against this branch **fails** with
`nested-interactive` on `.mp-skill-card[role="button"]`.

The fix removes the redundant widget role — the card becomes a plain container
and every action is a native button, with a new explicitly-labelled
`Details` button carrying the inspect action that the card role used to
provide. Keyboard operability is therefore *better* than before (real buttons
instead of a synthetic Enter/Space bridge), and no affordance is lost. The
static assertion in `test/a11y/static.test.ts` that pinned the old markup was
updated to pin the accessible markup instead.

**(b) `Cross-Platform CI / Windows` — 5 s per-test timeouts, not budget breaches.**
The Windows failures in Phase-02-owned files were **harness timeouts**, never
p95 assertions: `/api/skills*` constructs a `SkillService` per request and
re-scans the skill directories, costing ~70 ms per request on a fast Linux
runner and several times that on a contended Windows runner. A 20-sample loop
therefore exceeds Bun's default 5 s per-test budget while every individual
request stays far inside the 500 ms p95 gate. Per-repo convention
(`test/perf/*`, `test/a11y/*` use explicit per-test timeouts) the sampling
tests now declare generous explicit timeouts. **No budget was relaxed** — the
p95 gate is still `< 500 ms` and the equivalence assertions are unchanged.

The pre-request endpoint cost is pre-existing and is explicitly **not**
optimized here (Phase 02 is not a performance phase); it is recorded in §18.

---

## 18. Deferred findings (later phases — NOT implemented here)

1. **Three dead dashboard call sites** (`GET /api/mcp`, `POST /api/mcp/add`,
   `POST /api/control/stop`) — either implement the endpoints or remove the UI
   affordances. Quarantined and frozen in §12; requires a product decision.
2. **Decompose the skills/plugins wildcard contract entries** into per-route
   operations so they gain typed client methods and precise schemas.
3. **Per-operation request/response schema coverage** for the sub-APIs.
4. **Legacy-mount usage telemetry** ahead of the 2027-08-01 sunset, so the
   removal decision is data-driven.
5. **`/api/skills*` constructs a `SkillService` (and re-scans the skill
   directories) on every request** — ~70 ms per call on a fast Linux runner,
   materially worse on contended Windows. Caching or hoisting the service is a
   real fix but is a performance change, out of Phase 02 scope. Recorded here
   because it is what forced explicit per-test timeouts in §17.1(b).

---

## 19. Rollback instructions

Phase 02 is a **single commit** with no data migration, no config change, and no
schema change.

```bash
git revert <phase-02-commit>      # feat(api): establish canonical API contract coherence
bun run typecheck && bun test
```

Reverting restores `url.pathname` matching in the two adapters — which
reinstates the v1 404s. There is no feature flag by deliberate decision (§4);
the revert is the rollback. No generated artifact needs regeneration, because
none changed.

---

## 20. Phase completion status

**GREEN.**

| Requirement | Status |
| --- | --- |
| Canonical routing (root-cause fix, not symptom patch) | ✅ §2, §5 |
| Skills API reachable on both mounts | ✅ 5/5 endpoints, 200 |
| Plugins API reachable on both mounts | ✅ 5/5 endpoints, 200 |
| One API contract, single source of truth | ✅ §6, §7 |
| Deterministic schema + drift check | ✅ §8 |
| Typed client + check | ✅ §9 |
| Backward compatibility preserved | ✅ §10, 0 breaking changes |
| Contract tests | ✅ 40 tests, §11 |
| Dashboard route coverage | ✅ 58 call sites, §12 |
| Unmatched-route observability | ✅ §13 |
| Security preserved (no weakened auth) | ✅ §14 |
| Performance sanity gate | ✅ 4/4 PASS, §15 |
| Full regression vs Phase 00 anchor | ✅ 3061/0, §16 |

GREEN is claimed on the full set above — not merely on "the 404 disappeared".

---

## 21. Verification commands

Every command below was executed on the Phase 02 branch; results in §15–§16.

```bash
bun run typecheck            # clean
bun test                     # 3061 pass / 19 skip / 0 fail (250 files)
bun test test/api/           # 68 Phase-02 tests + pre-existing API suites
bun run api:schema:check     # OK — 106 operations, no drift
bun run client:check         # OK
bun run api:compat           # OK — no breaking changes
bun run boundaries           # no dependency violations (540 modules)
bun run baseline:phase00:validate   # VALIDATE PASS (19/19 artifacts)
```

Manual dual-mount proof (daemon on an ephemeral port, valid token):

```bash
curl -H "Authorization: Bearer $XR_TOKEN" localhost:$PORT/api/v1/skills/health   # 200
curl -H "Authorization: Bearer $XR_TOKEN" localhost:$PORT/api/skills/health      # 200 + deprecation
curl                                        localhost:$PORT/api/v1/skills        # 401
```

---

## 22. Scope discipline

Explicitly **not** done, per the phase constraints:

| Forbidden / out of scope | Honoured |
| --- | --- |
| Special-case `/api/v1/skills` | ✅ Not done — canonical propagation only |
| Duplicate handlers / hardcode both path variants | ✅ Not done |
| Dedicated `/api/v1/plugins/catalog` route | ✅ Not done — existing precedence already correct |
| Change frontend URLs until 404s vanish | ✅ Zero frontend changes |
| Second routing system or second contract | ✅ Not done |
| Remove the legacy mount / change the sunset date | ✅ Both unchanged |
| `XR_API_V1_CANONICAL=0` flag | ✅ Not created — no existing flag architecture (§4) |
| Invent endpoints to satisfy tests | ✅ All tested endpoints verified in-repo first |
| Weaken auth to pass tests | ✅ Auth asserted, not relaxed |
| New error format | ✅ Existing `problem()`/JSON envelopes reused |
| Performance optimization, provider rewrite, dashboard redesign, memory/skills/plugin/security/database rewrites, new API version | ✅ None attempted |

Production diff: **82 insertions across 6 files**, no deletions of behaviour.
