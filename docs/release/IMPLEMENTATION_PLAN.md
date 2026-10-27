# Evidence-backed release-candidate implementation plan

Created after Phase 0 baseline on 2026-10-26, commit `e25afd362e80485340a322e60a97a04d41b6bd51`. Status starts OPEN; updates require executed acceptance tests, not just code. Findings are classified in SECURITY_AUDIT and RELEASE_AUDIT. Use existing architecture/tooling; one build/test lane at a time, Bun 1.4.2, ~2 GB RAM, CARGO_BUILD_JOBS=1. No model weights or competitor/container installs.

## Task register

| ID / phase / status | Finding + evidence | Severity / user risk | Specific fix | Tests / objective completion | Dependencies / resource impact |
|---|---|---|---|---|---|
| RC-000 / 0 / COMPLETE | No current-session evidence; old audits not proof | Informational / false readiness | Source map, threat/release audit, baseline logs, progress/decisions | Six audit documents, exact commands/exit codes, clean initial tree recorded; done before implementation | None; read-only discovery, segmented core ~147s, no native build |
| RC-101 / 1 / VERIFIED stamped1.1.1-rc.1; public authority1.0.0 unchanged | Missing desktop/lock identity coverage, incorrect prerelease lexical compare (`release-manifest.ts`) | Medium / mislabeled packages | Extend authoritative stamp/check kinds; strict tag/channel validator; candidate1.1.1-rc.1 stamped through authority, publicVersion stays 1.0.0 | Mutation tests: every target mismatch rejects; rc.9<rc.10; tag/withdrawn mismatch rejects; existing release/channel gates green | RC-000; lightweight Bun/files |
| RC-102 / 1,6 / VERIFIED local enforcement; production/native CI BLOCKED | `release.yml` restamps after build; desktop publishes before journey | High / substituted or wrong-version artifacts | Enforce commit/tag identity before builds, remove late rewrite; gated draft attach; separate preview/stable publishing paths | Negative tag/signing/workflow regressions; artifact checksums/versions inspection; no release published by local work | RC-101, RC-207; CI-only native evidence BLOCKED |
| RC-201 / 2 / COMPLETE (both real Linux mechanisms) | Confirmed unshare read-only remount modifies host fixture (`baseline-sandbox-effect-probe.log`) | Critical / unauthorized writes | Drop all namespace capabilities, no-new-privileges before untrusted exec; controls self-probed, fail closed | Real remount attempt against read-only canary fails, host bytes unchanged, workspace write still works; both available Linux mechanisms; repeat effect probe | RC-000; util-linux already installed; sub-second fixtures |
| RC-202 / 2 / VERIFIED Linux; native/container limits BLOCKED/NOT RUN | `limitScript` ignores errors; isolated cancellation not threaded | High / runaway or wrongly reported confinement | Validate and enforce OS resource controls; terminate process tree on abort; accurate enforcement metadata | Invalid/unavailable controls cannot execute marker; bounded timeout/output/child cancellation tests; no large resource attack | RC-201; one process at a time; optional lightweight bwrap install only |
| RC-203 / 2 / COMPLETE | Anthropic catch-all endpoint fallback sends key/prompts outside registered selection | High / secret/data exposure, unbounded request | Remove implicit ANTHROPIC_BASE_URL fallback, use existing explicit custom-provider route; errors redact through shared provider error normalizer | Mock failure with fallback env opens no second socket; auth/rate/abort timeout tests; no key in errors | RC-000; deterministic HTTP mocks |
| RC-204 / 2,3 / VERIFIED deterministic; live NOT RUN | Legacy/gateway fallback violates opt-in/locality and may silently change tool capabilities | High / privacy and accounting bypass | Shared per-hop admission policy; cross-provider explicit opt-in AND provider preferences/locality; forbid unsupported fallback/accounting paths rather than pretend safe | Tests for disabled fallback, no_cloud/private/local restrictions, provider switch consent, cancellation, capability minimums; zero forbidden requests | RC-203, RC-301; deterministic; maintain existing router |
| RC-205 / 2 / VERIFIED full Linux regression and root/desktop audit | Zod 3.25.76 vulnerability GHSA-mrhx-c7xc-m3w5; `baseline-dependency-audit.log` | High / denial of service | Upgrade only required dependency to patched v4, adapt record/default/error API with compatibility tests; do not import vulnerable v3 compatibility path | Typecheck, config/API/schema and core tests; audit no high/critical production finding; malformed large payload rejected boundedly | RC-000; frozen lock update, one package; ~35s typecheck |
| RC-206 / 2,3 / VERIFIED governed deterministic | Zero assumed cloud pricing, regex ambiguity, empty retry drops usage; `core/agent.ts`, pricing table | High / uncontrolled spend and false meter | Exact sourced rate metadata, unavailable state not zero; request cap and output ceiling; record every attempted/empty call before retry; forbid hidden cross-model repricing | Empty/error retry records first cost; token/request denial before next network request; unknown pricing + monetary limit stops; estimates explicitly labeled | RC-301; deterministic budget/store tests |
| RC-207 / 2,6 / VERIFIED executable full security gate; production scans/CI NOT RUN | Scattered gates; malformed audit result can be interpreted as no blocking findings | High / false release pass | Central executable security command using real repo gates; strict scanner output parser; existing vulnerability/secret/SBOM checks wired into release/desktop workflows | Malformed/error scanner JSON rejected; normal/denied tests pass; security command fails on real defect; documented skips cannot claim PASS | RC-201..206, RC-101; sequential checks, no heavyweight scanner fleet |
| RC-301 / 3 / VERIFIED metadata/contracts; live NOT RUN | Old defaults; capability catalog no current lifecycle/provenance/validation-state distinction | Medium / retired or incompatible models | Extend existing catalog/descriptor metadata with versioned offline curated registry and last-known-good discovery; official sources dated 2026-10-26; discovered/configured/reachable/compatible/agent-validated/recommended separate | Exact IDs and API-feature tests; deprecated or unknown entries excluded from Auto; failed refresh keeps configured model/cache; no live network on startup; no model recommended as benchmark-proven without evidence | RC-000; official docs read, no paid API |
| RC-302 / 3 / VERIFIED governed deterministic; live NOT RUN | Native schema/Anthropic tool result mapping not multi-turn safe; latest OpenAI needs Responses for tools | High / broken primary agent journey | Normalize existing tool schema representation; preserve per-conversation native tool identities and provider continuation as needed; add Responses adapter within factory only if required | Mock HTTP roundtrip two tool turns + tool results, parallel provider instances, invalid args, tool schema validation; optional explicit live canary remains separate | RC-301, RC-203; small adapter, no SDK/dependency rewrite |
| RC-303 / 3,4 / VERIFIED preview/source/renderer; native GUI BLOCKED | Auto exists in intelligence plane but surface/config journey is obscure | Medium / surprise provider/data choice | Expose first-class Auto/manual in existing CLI/provider and desktop model UI; preview selected target/reason before execution; safe setup compatibility probe and cost explanation | Preference persistence, constrained no-candidate reason, no silent provider change, manual recovery; renderer typecheck/build; actual GUI journey distinct | RC-204, RC-301, RC-302; UI changes only in existing components |
| RC-401 / 4 / VERIFIED independent home/engine; native lifecycle BLOCKED | Desktop sidecar inherits CLI XR_HOME; settings can mutate CLI global defaults (`engine.rs`) | Medium / configuration/data conflicts | Explicit independent desktop engine home using same core/schema; preserve legacy data in place, document migration/import; bundled sidecar remains self-sufficient | Home resolution and no-CLI-mutation tests; standalone binary smoke; no global install/shell edits; native lifecycle tests if toolchain feasible | RC-000; Rust std-only logic + Bun integration |
| RC-501 / 5 / VERIFIED deterministic15/15; optional live/competitor NOT RUN | Existing domain benches/golden path lack unified 15-task agent evidence/metrics | Medium / unrepeatable performance claims | Versioned deterministic fixture suite over real governed runner, machine-readable metrics/commit, smoke/full modes; optional explicit live run and comparison instructions | Success/test rates, denial correctness, unauthorized side effects=0 mandatory, retries/tokens/cost-unavailable/wall time/version; temporary fixtures only; restart/audit/model selection covered | RC-201, RC-206, RC-301; seconds, no real model or competitor install |
| RC-601 / 6 / VERIFIED local artifacts/negative enforcement; trusted signing BLOCKED | Missing stable OS signature enforcement and artifact-level desktop checks | High / untrusted public installer | Extend signing planner + existing workflows/checksum/verifier; fail stable without cert/notary, updater stays disabled until provisioned; owner promotion explicit | Negative signing tests, missing/invalid signature negatives, local CLI package inspection/checksum tamper rejection, native Linux build if feasible; OS signing remains BLOCKED without credentials | RC-102, RC-207; toolchains sequential; up to ~1.4 GB single Rust job |
| RC-602 / 6 / VERIFIED CLI binary/npm lifecycles; native install/update BLOCKED | Artifact generation not installation/upgrade proof | High for stable / unusable packages or data loss | Existing journey matrix extended where missing; run local CLI clean-home lifecycle; attempt Linux native toolchain only if resource-safe | CLI packed install/start/safe task/denial/cancel/restart/uninstall real effects; platform journey evidence for every supported installer; never fake a GUI PASS | RC-401, RC-601; Windows/macOS and signing external blockers |
| RC-701 / 7,8 / COMPLETE local audit/report/handoff; release NOT READY | Need fresh final-tree audit, owner-ready handoff | High / falsely promoted release | Re-run applicable checks in safe order, record PASS/FAIL/BLOCKED/NOT RUN/N/A per gate, inventory artifacts and residual blockers, provide patch/source archive | Final report with exact commands/exit logs, truthful platform/model matrix, review bypasses, no secrets or owner changes; stable only if all required gates pass | All prior tasks addressed or explicitly BLOCKED, not silently omitted |

| RC-208 / 2,4 / VERIFIED deterministic; native GUI BLOCKED | `desktop/src/stores/onboarding.ts:finishOnboarding` writes `modelChoice` including API key to generic settings and ignores failed engine secret save | High / plaintext credential persistence, misleading success | Whitelist persisted non-secret choice, purge legacy settings in place, explicit provider choice, engine-only key save; failure actionable, clear transient key | Fake key never in persisted settings/snapshot; save failure cannot complete setup; migration removes old key without echoing it | RC-203, RC-401; pure mapper tests + renderer build, no new dependencies |
| RC-402 / 3,4 / VERIFIED shared contracts; native GUI BLOCKED | Desktop TS/Rust budget tables retain old models and invent unknown 5/15 rates; picker misclassifies non-major/custom providers as local | High / fabricated cost/locality/readiness | Source current model facts from existing canonical registry, explicit unavailable pricing, no provider inference that overrides selected row, explained Auto/manual setup; engine remains authoritative meter | Current/future dated rate tests, unknown-price denial, explicit provider model wire mapping; no saved-state overwrite or fabricated health | RC-301, RC-206, RC-303; existing components and shared data only |

## Execution sequence and scope discipline

1. Phase 1 extend identity machinery; keep current public channel unchanged. Changes and relevant tests first; candidate stamping after choosing non-colliding preview identity.
2. Phase 2 close the real kernel-boundary vulnerability before more capabilities. Harden process/resource and alternate request paths, patch vulnerability, accounting/privacy, central gates.
3. Phase 3 extend—not replace—the intelligence catalog/router. Current official catalog IDs are research evidence, **not live account compatibility**. Add deterministic protocol tests before recommending the newest families.
4. Phase 4 separate homes/entry journeys, not engines; no arbitrary UI redesign or fabricated health data.
5. Phase 5 deterministic agent fixture benchmark, then optional live protocol/instructions; no unsupported superiority claim.
6. Phase 6 existing release/signing workflow hardening, package inventory and native build assessment; prepare drafts only; external production actions blocked.
7. Phase 7 fresh tests/path review; Phase 8 handoff with honest readiness. A blocked certificate/platform does not stop unrelated safe implementation.

## Closure policy

COMPLETE means acceptance commands actually pass with linked logs. IMPLEMENTED / verification pending is not COMPLETE. BLOCKED records exact missing credential/platform and safe next action. A high/critical residual must disable its unsafe path or block release; it cannot be waived by prose. Full desktop baseline formatting debt is tracked separately, not hidden or rewritten en masse to inflate closure.

## Additional confirmed IPC finding (Phase 4 path review)

| ID / phase / status | Finding + evidence | Severity / user risk | Specific fix | Tests / objective completion | Dependencies / resource impact |
|---|---|---|---|---|---|
| RC-209 / 2,4 / VERIFIED scope/IPC/pure shipped tests; actual OS integration BLOCKED | Native `keychain_get/set/delete` accept arbitrary service/account strings; JS helpers are unused for new writes but per-window capabilities still expose them | High / a compromised permitted renderer can address unrelated OS-store accounts (actual OS access unexecuted) | Scope recovery reads/deletion to known historical XR desktop provider accounts, reject CLI/global foreign accounts; disable legacy writes so new credentials must use governed engine broker | Execute pure shipped scope validator; negative foreign-service/CLI-account tests; static wiring and IPC drift gate; full native integration remains separate | RC-208, RC-401; Rust std-only harness and existing generator, no OS credentials read |

### RC-603 — SBOM and verification false completeness (added Phase6 reconnaissance)

* Finding/evidence: `scripts/sbom.ts` writes SRI base64 directly into CycloneDX
  hex hash content, metadata root has no matching dependency ref, and only root
  Bun dependencies are inventoried. `verify-release.ts` silently omits requested
  missing sums/SBOM/provenance and treats parsed subject hashes as provenance,
  not authenticated builder evidence. Root release CI does not supply provenance.
* Severity/risk: HIGH artifact-trust/release-claim defect; not a demonstrated
  compromise. Incomplete/malformed inventory or skipped requested checks can
  appear verified. Dependency graph completeness must not be fabricated.
* Fix/tests: valid decoded digests/refs and explicit flat inventory scope;
  optional combined root/renderer/Cargo locked inventory; strict requested-input
  checks, duplicate/path-safe sums, DSSE subjects, actual SLSA verifier in CI,
  exact cosign identity + signed sums/SBOM. Tampered/missing/wrong-subject/invalid
  inventory regressions, actual generated schema validation and local artifact
  inspection. Crypto fixtures never stand in for production OIDC evidence.
* Dependencies: RC-101/102/601; official schema and verifier digest. Resource:
  small parsers/fixtures and one JSON inventory, no local heavy scanner install.
* Status: VERIFIED schema/negative/local integrity; production authenticity BLOCKED. Completion: negative tests fail closed, applicable local
  artifacts validate; trusted CI signatures/provenance remain BLOCKED until run.

* Final local disposition: **VERIFIED schema/negative/local integrity; production authenticity BLOCKED**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-604 — Docker frozen install fallback (Phase6 reconnaissance)

* Evidence: Dockerfile `bun install --frozen-lockfile --production || bun install
  --production` silently resolves a different tree; runtime defaults root.
* Severity/risk: HIGH reproducibility and unnecessary runtime-privilege gap,
  not a demonstrated container escape. Fix frozen/ignore-scripts only and a
  dedicated nonroot image user; document existing-volume ownership migration.
* Tests: source/contract negatives, native Linux file authority tests; actual
  container build/install remains NOT RUN without owner/container resources.
* Dependencies: RC-201/202/601. Resource: no local container installation.
* Status: IMPLEMENTED; container build/runtime NOT RUN; no PASS for container behavior without execution.

* Final local disposition: **IMPLEMENTED; container build/runtime NOT RUN**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-605 — Stale dev engine cache and unnecessary PR signing exposure

* Evidence: `compile-sidecar.ts --if-missing` skips solely on binary existence,
  so same-version security edits can keep executing an old engine. Desktop
  bundle steps pass raw Apple/Windows/updater signing secrets on same-repo PRs,
  though development builds do not require them.
* Severity/risk: HIGH stale governed-policy execution / unnecessary CI secret
  exposure; no credential exposure was attempted or demonstrated.
* Fix/tests: source/tool/target/lock fingerprint + binary digest cache checks
  (not an authenticity claim), same executable for compilation; fail/recompile
  absent/stale/tampered metadata. Tag-only raw signing credentials and explicit
  signing environment. Pure cache negatives + actual Linux compile/cache/smoke;
  workflow data tests ensure raw certificate/key values are never PR env inputs.
* Dependencies: RC-101/208/601; resource: one sequential Linux sidecar compile,
  cheap hash-only reuse on identical inputs. Status: VERIFIED negative cache/tag-only credentials and actual Linux build/cache/smoke.

* Final local disposition: **VERIFIED negative cache/tag-only credentials and actual Linux build/cache/smoke**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-606 — Unknown tariff with USD threshold disabled can reach invalid ledger settlement

* Finding: attempt admission checks an unknown tariff only through a monetary
  threshold; a token-only/no-USD embedding could send a request then compute
  NaN for the NOT NULL USD ledger. A failed settlement is fail-closed against
  retry, but an already-sent request should not become unrecordable usage.
* Severity/risk: HIGH accounting defect, not an absolute billing-limit claim.
  Require a finite explicit/sourced tariff before any governed paid attempt,
  even when dollar thresholds are disabled; refuse overflowed projections.
  Local zero provider-token fees and explicitly declared fixture/operator
  zero rates remain valid; hardware/billing remain unavailable estimates.
* Tests: zero requests/rows with unknown or overflowed prices and USD disabled;
  known-price/local/synthetic loops and full governed suite must still pass.
* Dependencies: RC-206/302. Resource: tiny per-attempt validation. VERIFIED unknown/USD-disabled/nonfinite admission refusal.

* Final local disposition: **VERIFIED unknown/USD-disabled/nonfinite admission refusal**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-607 — Preview identity still projected into stable package-manager templates

* Fresh stamp evidence: RC identity10 surfaces matched, bootstrap installers
  stayed public1.0.0, but `channel:check` wanted Homebrew/Scoop/WinGet RC paths.
  `channel-manifest.ts` used identity.version rather than publicVersionOf.
* HIGH release-channel separation defect, not a publication (none performed).
  Canonical committed stable templates must derive publicVersion; explicit
  stable-artifact output projection remains isolated and never edits authority.
* Tests: independent preview/development identity with stable public version;
  no RC URL/version/path in stable templates, projection/checksum negatives,
  repeat release/channel/claim gates, preserve historical version directories.
* Dependencies RC-101/102; cheap pure render/tests. Status VERIFIED stable-template isolation and tag/channel regressions.

* Final local disposition: **VERIFIED stable-template isolation and tag/channel regressions**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-608 — Final full-suite integration/layering regressions

* Full segmented evidence (459/459 files,166s,<284MiB peak) exposed legacy
  unpriced scripted-provider fixtures, two new upward kernel imports, manager
  construction outside the existing BudgetService factory, stale health/source
  assumptions and three reviewed oversized/generated-file deltas. Do not hide
  these by deleting tests, changing isolation, allowing unknown tariffs, or
  relaxing the dependency rules.
* Fix: move shared immutable facts/abort contract to L0 leaves with compatibility
  re-exports; reuse BudgetService factories; declare synthetic test tariffs and
  actual model IDs, keep policy/no-effect tests substantive; regenerate ownership
  and record narrowly justified generated/contract growth. Re-run affected groups,
  then canonical segmented parity and black-box lanes separately.
* Risk: MEDIUM architecture/compatibility/test gap, not new vendor validation.
  Dependencies RC-206/301/607; bounded sequential tests. VERIFIED layers/ownership/size and full governed Linux suite.

* Final local disposition: **VERIFIED layers/ownership/size and full governed Linux suite**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-609 — Offline provider selection and CLI timer cleanup

* Final lifecycle trace: CLI `providers set --force` still invoked warm/canary
  despite promising no canary; redundant Promise.race timers kept successful
  short-lived commands alive. Existing state machine already owns cleared
  deadlines. Add an explicit no-network configured-only force path and reuse
  its deadline boundary for normal probes. Extract selection/measurement
  handlers to remove the existing providers.ts size waiver rather than widen it.
* Tests: real CLI explicit force emits no probe; configured capabilities/tariff
  are declared in controlled fixture, normal selection state-machine regressions,
  source/dependency/size gates. No authentication/agent validation inferred.
* Severity MEDIUM UX/offline-contract defect; small bounded handlers. VERIFIED real offline force-selection/no probe, cleared deadlines, module split.

* Final local disposition: **VERIFIED real offline force-selection/no probe, cleared deadlines, module split**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-610 — Telemetry decorator lost managed-attempt provenance

* Consented real daemon fallback integration exposed duplicate primary admission/
  settlement: `withTurnMetrics` did not forward managesAttempts and snapshotted
  id/label. Structured Bun ConnectionRefused also normalized to unknown, refusing
  a consented hop. Fix decorator contract/provenance and only known structured
  transport codes; unknown/auth/accounting/cancel errors stay terminal.
* HIGH accounting/functional defect. Tests: actual daemon loopback fallback with
  explicit local/cross-provider consent, exact2settlements (one failed primary,
  one actual fallback), telemetry cannot trigger replay, existing refusal suites.
* Keep metrics best-effort, never swallow accounting/audit. No live vendor claim.
  Dependencies RC-204/206/302. VERIFIED actual managed fallback receipts and independent SQLite rows; telemetry failures cannot replay; bounded deterministic tests.

* Final local disposition: **VERIFIED actual managed fallback receipts and independent SQLite rows; telemetry failures cannot replay**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.

### RC-611 — Debian prerelease ordering in real artifact builder

* Artifact inspection found build-deb emitted semver1.1.1-rc.1 literally as
  Debian Version; dpkg interprets rc.1 as a revision after the stable upstream,
  so a preview can incorrectly outrank1.1.1. Derive Debian1.1.1~rc.1 from the
  canonical semver, ignore semver build metadata in package ordering, reject
  invalid control versions. Remove a swallowed write to file.deb/. before
  the actual write. No independent product version is introduced.
* MEDIUM upgrade correctness. Test pure mapping/invalid input + actual dpkg
  comparison and artifact control/payload inspection; no system installation.
* Dependencies RC-101/601; tiny pure builder/tests. VERIFIED mapping/invalid versions/dpkg ordering and real payload inspection.

* Final local disposition: **VERIFIED mapping/invalid versions/dpkg ordering and real payload inspection**. See RELEASE_CANDIDATE_REPORT and selected final command evidence.


### RC-612 — Windows-local host alias (owner signing handoff)

* Evidence: compile-sidecar resolved host keys windows-x64/arm64, but a native
  Node/Bun Windows process supplies win32-x64/arm64. Without explicit target
  env, local Windows build failed; matching native target was mislabeled cross.
* Fix: normalize only the platform alias, retain explicit supported-target and
  unknown-host refusal. No signing policy or product version change.
* Tests executed:19sidecar/release cases PASS, full Node types exit0 and
  identity/channel/CI-policy checks exit0. Native Windows execution remains CI.
* Severity MEDIUM build defect; dependencies RC-401/605, tiny pure resolver.
  Status VERIFIED unit/type amendment; remote Windows CI NOT RUN at preparation.
