# XR 5.1 — Environment Interaction OS

**One governed contract for browser, desktop, filesystem, application, voice, and vision.**

The Environment Interaction OS is not "more browser/voice/vision features." It is
the single layer through which XR perceives and acts in digital environments
while preserving risk classification, approval, trust/placement, authority scope,
budget, execution history, durable recovery, context/provenance, reversibility,
and human control.

```
entry (xr control · xr env · voice · agent tools)
        │
        ▼
runEnvironmentAction  ── the ONLY way in ──  src/environment/service.ts
  kill-switch → schema → environment compatibility → target proof →
  staleness → capability → privacy/consent → risk+reversibility+approval →
  permission → session → execute (control.runAction) → bounded recovery → record
        │
        ▼
existing primitives: control/browser · control/executor · control/files ·
control/vision · voice/* — unchanged in ownership, hardened where audited.
```

## The universal contract

Every action is described by the triple in `src/environment/types.ts`:

| Concept | Type | Notes |
|---|---|---|
| Environment | `browser \| desktop \| filesystem \| application \| voice \| vision` | Closed set. Cross-environment actions fail closed. |
| Session | `EnvironmentSession` | Lifecycle `discover→provision→ready→active⇄paused→failed/closing→closed/quarantined`; scoped to workspace/task; bounded (max active, idle sweep, action budget). |
| Target | `semantic \| coordinate \| resource \| application \| none` | **Coordinate targets require evidence** — a fresh observation reference. |
| Interaction | `semantic \| coordinate \| structural \| stream` | Semantic-first; coordinate is elevated risk + approval. |
| Confidence | `high \| medium \| low \| unknown` | `unknown` is never treated as certain. |
| Reversibility | `reversible \| compensatable \| irreversible \| unknown` | Honest classes — XR never claims rollback where none exists. |
| Approval | `none \| standard \| strong` | Strong = irreversible/unknown/sensitive-value — auto-approval structurally disabled. |
| Observation | `EnvironmentObservation` | Typed evidence: provenance, confidence, sensitivity, staleness. References only — never raw media (path+sha256+bytes). |
| Outcome | `succeeded \| failed \| denied \| blocked \| cancelled \| uncertain` | `uncertain` = side effect unknown — always user-visible. |
| Record | `EnvironmentActionRecord` | Safe to serialize: redacted action echo, gate decisions, evidence refs, compensation note. |

## Contract guarantees (the developer checklist)

For any action you can always answer:
1. **What authority does it get?** `assessEnvironmentAction()` → risk level,
   permission scope (control permissions), reversibility, approval strength,
   and placement notes. The classifier decides — never the model.
2. **How is it approved?** `none` (safe+reversible), `standard` (existing CLI +
   dashboard racing prompt), `strong` (explicit only, never auto-approved).
3. **How is it observed?** `observeEnvironment()` records typed observations;
   coordinate actions must cite a FRESH one (`staleObservationMs`).
4. **How is it cancelled?** `closeEnvironmentSession()` closes sessions with
   cleanup; in-flight CLI steps stop at the next action; `computer_use` stops on
   denial/circuit/uncertainty immediately.
5. **How is it cleaned?** Provider cleanup on `closing`; cleanup state recorded
   (`succeeded/partial/failed`); cleanup defects quarantine the session.
6. **What happens when perception is uncertain?** Low confidence is user-visible
   (`assessment.uncertainty`), coordinate actions are blocked below medium
   confidence, stale observations block, and `unknown` outcomes quarantine.

## Integration map

| Phase | Consumed by Phase 8 how |
|---|---|
| 1 Kernel/CLI | `xr env` command group; doctor check; catalog/help/JSON modes |
| 2 Execution | execution goes through `control.runAction` (same gate as agent tool path); no private executor |
| 3 Trust | control-adapter trust records remain authoritative; env adds fail-closed gates, never widens authority |
| 4 Durability | `env.session.*` / `env.action.*` audit events are the durable trail; sessions checkpoint lifecycle; cleanup/quarantine persisted in audit |
| 5 Intelligence | `visionCloudDecision()` routes local/cloud via consent + provider locality (`isLocal`); no routing changes |
| 6 Context | extracts typed `untrusted_external`; observations are evidence with provenance; never instructions |
| 7 Workflow | `buildEnvironmentActionNode()` compiles actions to canonical `tool_action` nodes with riskTier/idempotency/compensation |

## Files

- `src/environment/types.ts` — contract vocabulary (+ zod schemas at the boundary)
- `src/environment/classify.ts` — deterministic gate classification
- `src/environment/lifecycle.ts` — session state machine + registry
- `src/environment/service.ts` — the governed entry point
- `src/environment/providers/{browser,desktop,filesystem,voice,vision}.ts`
- `src/environment/{privacy,recovery,capabilities,observations,audit,workflow-binding}.ts`

Guides: [BROWSER](./BROWSER.md) · [DESKTOP](./DESKTOP.md) · [VOICE](./VOICE.md) ·
[VISION](./VISION.md) · [REVERSIBILITY](./REVERSIBILITY.md) ·
[RECOVERY](./RECOVERY.md) · [PLATFORM_SUPPORT](./PLATFORM_SUPPORT.md) ·
[TESTING](./TESTING.md) · [USER_GUIDE](./USER_GUIDE.md)
