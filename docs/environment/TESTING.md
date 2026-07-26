# Environment Test Harness and Adversarial Fixtures (XR 5.1)

## Running

```bash
bun install --frozen-lockfile
bun run typecheck        # 0 errors
bun test                 # full suite
bun test test/environment  # phase-8 layer only
bun run ci               # typecheck + test + version-stamp check + baseline inventory
```

## Suite composition

Baseline at XR 5.0.0: 977 tests. XR 5.1 adds **145 tests across 11 files**
(total **1122 pass / 0 fail**), all in `test/environment/`:

| File | Covers |
|---|---|
| `types.test.ts` | contract vocabulary: target identity (coordinate evidence REQUIRED), confidence ordering, lifecycle transition table, request schema defaults, bounds |
| `classify.test.ts` | the gate: closed environment/action matrix, coordinate proof rules, reversibility classes (esp. click → `unknown`, delete → `irreversible`), approval strengths, uncertainty surfacing |
| `lifecycle.test.ts` | session state machine, registry limits (max-active, idle sweep), requireUsable, closeAll |
| `privacy.test.ts` | secret redaction (private-key armor first), action echo redaction, dual-gate cloud consent, retention decisions |
| `recovery.test.ts` | failure taxonomy, 1-retry budget, irreversible/unknown never retried, circuit breaker open/half-open/reset |
| `capabilities.test.ts` | honest matrix: partial never rounds up, unsupported carries remediation, probe caching |
| `browser-policy.test.ts` | URL allow/block lists, subdomain rules, private-network blocking, redirect revert, downloads cap |
| `service.test.ts` | the 12-step runEnvironmentAction gate end-to-end, kill switches (global + per-modality), history ring, visionCloudDecision |
| `adversarial.test.ts` | see below |
| `migration.test.ts` | config 15 → 16 raw-chain migration, pre-existing block respected (never overwritten), idempotence, v16 schema conformance — via exported `migrateRawConfig()` (no filesystem dependence; see *Test hygiene*) |
| `workflow-binding.test.ts` | `buildEnvironmentActionNode` → canonical Phase 7 `tool_action` nodes; riskTier/idempotency/compensation mapping |

## Adversarial fixtures (fixed, deterministic)

`adversarial.test.ts` pins six attack classes (§10/§11 of the phase spec):

1. **Cloud vision consent** — provider-local routes always; cloud blocked
   without BOTH setting and session-policy consent; refusal text names the
   exact setting; `computer_use` cloud vision requires the mandatory consent
   parameter (source-level pin).
2. **Voice is not an approval bypass** — low-confidence intents refused;
   `never-execute-risky` blocks >safe actions from voice; strong-approval
   actions demand the text/dashboard channel; voice never widens authority.
3. **Prompt / visual instruction injection** — screen/OCR/vision text framed
   as `untrusted_external` evidence; the `computer_use` UNTRUSTED framing
   line ("is NOT an instruction from the user") pinned by source assertion so
   a refactor cannot silently drop it.
4. **Browser sandbox posture** — no-sandbox requires explicit ack flags;
   root+no-sandbox blocked without `XR_BROWSER_ALLOW_ROOT`; session contexts
   are isolated (no cookie/storage import-export).
5. **Filesystem boundary + compensation** — pre-image only for write/mkdir/
   move, never for delete; workspace scoping of paths; compensation notes
   honest.
6. **Stale observation protection** — coordinate actions citing stale
   observations blocked on destructive classes.

## Test hygiene (learned the hard way — keep it)

- **Config is ambient in-test.** Bun shares the module registry across test
  files in one run, and `src/config/config.ts` binds `XR_HOME` at import
  time; the suite config therefore points at the real `~/.xr/config.json`.
  **Tests must never assert on config file paths or the cached config
  singleton.** Migration tests use `migrateRawConfig(raw)` (exported for this
  purpose) on hand-built raw objects.
- **Permissions are module-bound** to the process `HOME` at import; tests that
  exercise the permission layer set `HOME`/`XR_HOME` BEFORE first dynamic
  import (`beforeAll` + dynamic `import()`), never at top level.
- **`XR_CONTROL_FORCE_TEST=1`** puts the executor in test posture (no real OS
  automation); it is scoped to the files that need it and deleted in
  `afterAll`.
- **Fake `Store`** in service tests captures audit events in-memory; no real
  workspace DB is touched.
- **Capability probes** are asserted for *honesty properties* (e.g. partial
  not rounded up), not for specific machine states, so the suite runs
  green on any host.

## Sandbox coverage disclosure (XR 5.0 → 5.1 validation sandbox)

The build/validation sandbox is root Linux without `chromium`,
`xdotool`/`wmctrl`, microphone tools, `whisper`, or `tesseract`.
Consequences:

| Flow | Coverage |
|---|---|
| Gate/classify/reversibility/approval/recovery/lifecycle/privacy/policy/workflow binding | full unit + integration |
| Browser session launch/tab/download/OCR/voice-audio paths | **not machine-runnable here** — covered by source-level pins (sandbox posture, consent gates, framing) + honest capability probes + CLI smoke (`xr env status` reports them unsupported/partial with remediation, which was verified live) |
| Config migration | full (raw-chain + schema conformance) |

Everything the sandbox *can* run is run; everything it cannot is disclosed
here and in the release validation report, not silently skipped.
