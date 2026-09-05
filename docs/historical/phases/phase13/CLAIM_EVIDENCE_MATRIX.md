# XR 7.0 — Public Claim / Evidence Matrix

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Every public XR claim, its classification, and the evidence behind it.
This document mirrors `src/evaluation/claims.ts`, which is **machine-checked**:
`xr evaluate claims` fails if a benchmark-verified claim's supporting scenario
did not pass.

Classifications:

| Class | Meaning |
|---|---|
| `verified_by_benchmark` | a benchmark scenario substantiates it |
| `verified_by_contract` | a test or typed contract substantiates it |
| `documented_limitation` | true within stated bounds; the bounds are published |
| `product_vision` | direction and vocabulary, **not** a technical claim |
| `unsupported` | must never be published as fact |

---

## The matrix

### `claim.local-first` — verified by benchmark
> XR is local-first: it runs fully on your machine with no cloud dependency.

**Evidence:** `deployment.profile-portability`, `intelligence.locality-policy-enforced`
**Does not prove:** that every optional feature works offline. Cloud providers,
web research, and remote workers require network access by definition; the
local subset is what is measured.

### `claim.byok` — verified by contract
> BYOK — bring your own key; XR is not locked to one vendor.

**Evidence:** `intelligence.routing-explainable`, `test/intelligence/`, `test/config/`
**Does not prove:** that every listed provider is currently functional; provider
health is a runtime property.

### `claim.spend-capped` — verified by contract
> Spending is capped by an explicit budget that blocks work before it overruns.

**Evidence:** `test/cost.test.ts`
**Does not prove:** anything about spending incurred outside XR, or provider-side
pricing changes.

### `claim.tamper-evident-audit` — verified by benchmark
> The audit log is tamper-evident via a SHA-256 hash chain.

**Evidence:** `enterprise.audit-chain-detects-tampering`, `test/enterprise/audit-export.test.ts`
**Does not prove:** tamper *prevention*. An attacker with write access to the
whole chain and its head can rebuild it; off-host retention and export signing
address that separate threat model.

### `claim.no-telemetry` — verified by benchmark
> XR sends no telemetry; the dashboard is loopback-only.

**Evidence:** `intelligence.locality-policy-enforced`, `deployment.profile-portability`, `test/daemon.test.ts`
**Does not prove:** the network behaviour of third-party plugins, MCP servers, or
the models you configure. The offline subset asserts no unexpected egress
*within instrumented XR contracts*.

### `claim.sandboxed` — documented limitation
> Risky actions run under isolation appropriate to their risk tier.

**Evidence:** `trust.risk-escalation`, `trust.placement-sufficiency`, `trust.fail-closed-without-isolation`
**Does not prove:** uniform isolation strength. Isolation is **host-dependent**.
On a machine with no container runtime or namespace sandbox, XR fails closed for
Tier 2 work rather than providing isolation it does not have. Available backends
are recorded in every run's provenance.

### `claim.durable` — verified by benchmark
> Work is durable: interrupted tasks can be recovered rather than silently lost.

**Evidence:** `durability.recovery-after-restart`, `durability.duplicate-effect-refused`
**Does not prove:** that every action can be automatically re-run. Non-idempotent
effects are deliberately **not** auto-retried; a correct refusal counts as
correct recovery.

### `claim.injection-defense` — documented limitation
> XR detects prompt-injection and context-poisoning attempts before they enter memory.

**Evidence:** `context.injection-detection`, `context.instruction-write-refused`, `context.trust-clamping`
**Does not prove:** protection against novel attacks. Detection is measured
against XR's own signature corpus; an attack with no lexical signature is not
represented. This is defence-in-depth, not a guarantee.

### `claim.enterprise-governance` — verified by benchmark
> Enterprise policy can be administered centrally without ever weakening a user's visible safety controls.

**Evidence:** `enterprise.policy-cannot-loosen-safety`, `test/enterprise/policy.test.ts`
**Does not prove:** coverage of keys outside the safety-relevant registry, which
resolve most-specific-wins by design. Operational controls depend on the
deploying organization following documented process.

### `claim.no-external-certification` — verified by benchmark
> XR does not hold SOC 2, ISO 27001, HIPAA, PCI-DSS, or FedRAMP certification.

**Evidence:** `enterprise.no-false-certification-claim`
**Does not prove:** anything positive — this is a statement of what XR does *not*
claim. Evidence packs are self-assessments prepared for an independent assessor.

### `claim.provider-count` — verified by contract
> XR ships 26 built-in providers (16 hosted + 10 local runtimes).

**Evidence:** `src/providers/presets.ts#PRESETS`
**Does not prove:** product quality. Provider count is deliberately **not scored**
by the benchmark suite, and the number does not prove every provider is
reachable, correctly keyed, or performing well.
*(XR 7.0 corrected an earlier README inconsistency that stated both "20+" and "12+".)*

### `claim.ai-operating-system` — product vision
> XR is an AI Operating System.

**Evidence:** none — and none is claimed.
**Status:** this is product vision and architectural vocabulary. XR is precisely
a *single-machine AI runtime and application platform with OS-like service,
policy, workspace, and extensibility layers*. It is **not** an operating-system
kernel.

### `claim.superiority` — unsupported (standing prohibition)
> XR is the best / fastest / most secure AI agent platform.

**Status:** no such claim is shipped, and none may be. XR executes **no
competitor** in its benchmarks, so it has no evidence for any comparative
superiority claim. `assertNoUnsupportedSuperiorityClaim()` enforces this in the
test suite. This entry exists so the prohibition is explicit and permanent.

---

## How to check this yourself

```bash
xr evaluate claims          # the matrix, audited against the latest runs
xr evaluate limitations     # what the benchmarks do not measure
xr evaluate gaps            # gaps evaluation found, with owners
```

`xr evaluate claims` exits non-zero if any non-vision claim lacks current
evidence.
