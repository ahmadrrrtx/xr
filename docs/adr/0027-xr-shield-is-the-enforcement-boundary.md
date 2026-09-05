# ADR-0027 — "XR Shield" is the enforcement boundary, not the scanner

- **Status:** Accepted (Phase 5 · 2026-09)
- **Constitution:** Art. IX (isolation follows risk; every action attributable), Art. XIX.1 (documentation is source-accurate), Art. XXVII (deprecation cycle), Cmdt 6 (one source of truth per concern)
- **Supersedes:** nothing. **Amends:** the naming used across README, SECURITY.md, docs, and CLI.
- **Audit finding:** F-07 (both audits, independently)

> **Numbering note.** The Phase 5 plan called for this to be "ADR-0024". That number was already taken (`0024-enterprise-operability-gated.md`) — the plan was written against a commit four phases old. ADRs are never renumbered (Art. XXVII), so this is 0027, the next free number.

---

## Context

XR shipped a module called **XR Shield** (`src/security/shield.ts`, 1,134 LOC). Its header read *"Local-First Security, Privacy, and System Integrity Layer."* The CLI verb was `xr shield`. The README described it under security. A reasonable user concluded it was the thing protecting them.

It is not. It is a **host scanner**: it enumerates processes, inspects startup items, looks for miners, reviews privacy settings, and manages quarantine state. It is honest work, competently done, and Phase 2 hardened it against its own worst instinct (the `HONESTY DOCTRINE v2` header records that `analyzeThreatWithAgent()` was deleted outright rather than left to imply an AI that was not there).

But **no agent action passes through it.** It sits on no execution path. Disabling it removes zero enforcement. Enabling it grants zero protection against a malicious tool call.

Meanwhile the machinery that *does* decide whether an action runs — capability policy, the action guard, the trust lattice and its placement decision, consent/approvals, egress control, execution integrity, and the signed audit chain — **had no collective name at all.** It could not be pointed at, scoped for a pentest, or described in one line to a user.

So the protective name was on the component that protects nothing, and the component that protects everything was anonymous. Two independent audits reached this conclusion separately (Audit A proposed renaming the scanner "Sentinel"; Audit B proposed "the Trust Plane"). Both agreed the defect is real and that it is a **naming** defect, not an engineering one.

### Why this matters more than ordinary naming

A wrong name in a security product is a security problem. It shapes the user's mental model of what protects them, and it shapes where a reviewer looks. A reader auditing "the Shield" would have audited a scanner and concluded XR's boundary was weak — or worse, would have believed the boundary was covered when they had not looked at it.

---

## Decision

**1. The scanner is renamed to what it is.**

| Before | After |
|---|---|
| `src/security/shield.ts` | `src/hygiene/scanner.ts` |
| `XRShieldService` | `SystemHygieneScanner` (old name still exported) |
| `xr shield` | `xr hygiene` (`xr shield` kept as deprecated alias) |

**2. "XR Shield" now names the enforcement boundary**, which gets a thin facade at `src/xr-shield/index.ts`: re-exports plus one enumerable component table. The modules keep their existing paths.

**3. No enforcement code is added, moved, or removed.** Phase 5 is subtraction and renaming.

### The boundary, as named

| # | Component | Modules | Question it answers | Can refuse? |
|---|---|---|---|---|
| 1 | **Capability policy** | `capabilities/policy.ts` | Is this capability permitted for this workspace and mode? | ✅ |
| 2 | **Action guard** | `security/guard.ts` | Is the action dangerous once fully decoded and canonicalized? | ✅ |
| 3 | **Trust lattice + placement** | `runtime/trust/{classify,policy,service}.ts` | What risk tier is this, and where may it run? | ✅ |
| 4 | **Consent / approvals** | `control/approvals.ts` | Has a human approved this? | ✅ |
| 5 | **Network egress** | `security/{egress-proxy,private-ip}.ts` | Is this destination allowed? | ✅ |
| 6 | **Execution + output integrity** | `security/{exec-integrity,tool-output,secret-broker}.ts` | Is this binary allowlisted? Is tool output framed before re-entering the prompt? Are secrets brokered rather than exposed? | ✅ |
| 7 | **Signed audit evidence** | `security/{audit-signer,audit-verify}.ts` | Can this be proven afterwards, and would tampering show? | ➖ records |

This table is not prose. It is generated from `XR_SHIELD_COMPONENTS` in `src/xr-shield/index.ts`, and `test/architecture/xr-shield-facade.test.ts` asserts that every named module exists and is reachable through the facade — so the documentation cannot drift from the code.

---

## Why a facade and not a real rename

Renaming 549 modules to chase a label would be enormous churn with no safety benefit, and it would collide with every open branch in a repo that already carries 70+ of them.

Worse, a facade that *wrapped* these modules would be **new enforcement code shipped under a documentation change** — a new indirection on the hot path of every security decision, landing in a phase whose entire premise is that it adds no enforcement. That is how unreviewed security surface gets introduced.

So the facade is **re-exports and a data table, nothing else**, and a test enforces that:

```ts
test("the facade adds no enforcement of its own", () => {
  expect(src).not.toMatch(/\bif\s*\(/);
  expect(src).not.toMatch(/\bthrow\b/);
  expect(src).not.toMatch(/\bfunction\s+\w+\s*\(/);
  expect(src).not.toMatch(/\bclass\s+\w+/);
});
```

The name now exists in code, findable by grep and importable in one line, without a single new branch on a security path.

---

## Consequences

**Positive**
- The boundary can be named, enumerated, and scoped — the P10 pentest now has one import path instead of a scavenger hunt across seven directories.
- `xr hygiene` no longer implies protection it does not provide.
- The README's "XR Shield" section describes the thing that actually enforces.

**Negative / accepted**
- Two names in flight for one release (`shield` alias + re-export shim). Accepted: Art. XXVII requires the deprecation cycle, and breaking out-of-tree importers to save a shim would be the larger sin.
- `SHIELD_STATE_PATH` and the on-disk `shield-state.json` keep their names. Renaming them would be a **data migration** for a cosmetic gain, and Art. XXIII would then require it to be reversible. Not worth it; the file is internal.

---

## Migration

| Surface | Status | Removal |
|---|---|---|
| `xr shield …` | works, prints a one-line deprecation notice | 2.0.0 |
| `import … from "src/security/shield.ts"` | works, re-export shim | 2.0.0 |
| `XRShieldService` | still exported (it is still the class's runtime name) | not scheduled |

---

## Alternatives considered

**Rename the scanner "Sentinel" (Audit A).** Rejected: a new invented brand for a host scanner, when "system hygiene" already describes it accurately in words a user knows.

**Call the ensemble "the Trust Plane" (Audit B).** Reasonable, and `runtime/trust/` already exists — which is the problem: it would suggest the boundary *is* the trust module, when trust is one of seven components. "XR Shield" also has the advantage of already being the name users associate with protection; this ADR just points it at the thing that protects.

**Leave the naming alone and document the distinction.** Rejected: the prose explaining "Shield is not the shield" already existed in the audits, and it did not stop anyone from being misled. A name that requires a footnote is a defect.

---

## Evidence

- `src/xr-shield/index.ts` — facade + component table
- `test/architecture/xr-shield-facade.test.ts` — 7 tests: components exist, are reachable, hygiene is excluded, facade stays inert, shim identity holds
- `src/hygiene/scanner.ts` — renamed scanner, header records the correction
- `src/security/shield.ts` — deprecation shim
- `bun run xr hygiene --help` / `bun run xr shield --help`
