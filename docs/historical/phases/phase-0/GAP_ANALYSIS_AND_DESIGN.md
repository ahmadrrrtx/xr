# XR Phase 0 — STEPS 2–4: Gap Analysis · Research · Architecture Validation

Companion to `AUDIT_REPORT.md`. Nothing here restates the audit; this document turns audited
reality into an ordered, constitutionally-validated implementation plan.

---

## STEP 2 — GAP ANALYSIS

### 2.1 Constitutional gaps (the Constitution names XR's own defects verbatim)

The Constitution was written *from* these defects. Three Articles cite them by name, which makes
compliance non-negotiable rather than interpretive:

| Article | Verbatim text | Audited gap |
|---|---|---|
| **XIX — Documentation** | *Violations:* "README stating 3.1.6 is canonical 'from version.ts' while version.ts says 7.0.0." | H3 — exact match |
| **XIX — Rationale** | "the website advertised certifications and a 'Rust core' that do not exist" | H16 / §3 |
| **XX — Testing** | *Rationale:* "XR's 1,771 passing tests did not predict a working product because they asserted transitions, not effects" | Measured baseline is **exactly 1,771** |
| **XX — Violations** | "A test asserting a node reached 'completed' without checking the effect" | H7 |
| **XXII — Rationale** | "XR shipped source v7.0.0, README v3.1.6, npm v3.1.5, installers v1.0.0" | H1–H5 |
| **Cmdt 2** | "Thou shalt not report success without a verified effect." | H7, H8, B1, B2, N1–N3 |
| **Cmdt 4** | "Every consequential action passes through one execution/authority/evidence envelope. No surface bypasses it." | H9, H10 |
| **Cmdt 6** | "There is one source of truth per concern." | N6 |
| **Cmdt 13** | "Security before convenience; fail closed." | H11, H12, N4 |

### 2.2 Ordered gap list → task map

Dependency-ordered. Each row is a gap, not a feature.

| Order | Gap | Task | Blocks |
|---|---|---|---|
| 1 | No single manifest owns version/claims; `set-version.ts` covers 3 of 6 surfaces (N6) | **T1** | T2, T3, T13 |
| 2 | No linter can fail CI on a false claim | **T2** | T3 |
| 3 | Eight categories of fabricated public claims | **T3** | — |
| 4 | Readiness defined as "installed", not "can run" (B1) | **T4** | T13 |
| 5 | KDF salt discarded at construction ⇒ total credential loss on restart (H6) | **T5** | — |
| 6 | Workflow nodes report `succeeded` with no execution (H7) | **T6** | — |
| 7 | Stub tools exported; `ok:true` on unavailable (H8, N1–N3) | **T7** | — |
| 8 | Three surfaces bypass the extensibility layer (H9, H10) | **T8** | — |
| 9 | Policy gate is regex-over-JSON (H11) | **T9** | — |
| 10 | Reviewer fails open in two places (H12, N4) | **T10** | — |
| 11 | Failure exits 0; one-word input rejected; self-fallback (B2–B5, N5) | **T11** | — |
| 12 | Daemon binds loopback inside container (H14); installer needs proof | **T12** | — |
| 13 | No baseline for 7.0.0; no CONTRIBUTING/CODEOWNERS/templates (H17, N7) | **T13** | — |

### 2.3 Explicitly out of scope (Phase 0 = "no net-new features")

Recorded here rather than built, per Global Rule 4:

- **Full execution-envelope unification** (Cmdt 4 in its complete form) — Phase 2. T8 is a *bridge*:
  it re-points three call-sites at the existing `AgentService`. It adds no envelope, no new
  abstraction, no new module.
- **Kernel/VM isolation** (Article: policy ≠ confinement) — Phase 4. T9 hardens the in-process
  policy gate and Phase 0 *corrects the wording* that implies more.
- **Signed/SLSA releases** (Article XXII.3) — Phase 9. T1 makes the identity *signing-ready*;
  Phase 0 must not claim "signed".
- **Cross-platform CI matrix** (Article XX.4) — Phase 1. Phase 0 gate is Linux CI.
- **Mutation testing** (Article XX.3) — Phase 1.

---

## STEP 3 — RESEARCH

Principles extracted from established practice; no code copied. Each records the principle and why
it fits XR's constraints.

**R1 — Single-source release manifest.** Cargo/npm/Go all resolve identity from exactly one
declarative file and *generate* every derived surface. The decisive lesson from N6 is that a
stamping tool is only as strong as its file list: a gate that checks 3 of 6 surfaces produced a
green CI beside a 3-way version contradiction. **Adopted:** one `release.manifest.json` at the root
owning version + codename + every public claim; a generator that stamps *all* surfaces; a checker
that treats "surface not in the manifest's target list" as itself a failure. This closes the
class of bug, not the instance.

**R2 — Claim governance with evidence + expiry.** Provenance systems (SLSA, in-toto) bind an
assertion to a verifiable artifact and an expiry, so a claim cannot outlive its proof.
**Adopted:** every public claim is an object `{id, text, evidence, expires}`; the linter fails on a
claim with no evidence, expired evidence, or a superlative ("certified", "enterprise", "complete",
"supported") lacking both. Article XIX.1 and ADR-10 require precisely this.

**R3 — Per-ciphertext salt + envelope encryption.** libsodium/`age`/OS keychains never derive a key
from a passphrase without storing the salt *alongside the ciphertext*, and they wrap a random data
key (DEK) with a key-derived key (KEK) so the passphrase can rotate without re-encrypting payloads.
**Adopted:** a self-describing envelope `v2:<salt>:<iv>:<tag>:<wrappedDEK>:<ciphertext>`; scrypt for
the KEK; AES-256-GCM for both wrap and payload; the version prefix makes format detection
unambiguous and migration testable. Rejected: a single global salt file (one corruption ⇒ total
loss; no per-record rotation).

**R4 — Effect verification.** The lesson of Article XX is that state-machine assertions are not
evidence. **Adopted:** T5/T6 tests assert an *external observable* — bytes actually on disk, a real
HTTP request received by a fixture server, a real elapsed wall-clock delay — and, for T6, a
negative test proving an unsupported node **cannot** reach `completed`.

**R5 — Canonical resolution before policy.** The universal defeat of string-matching policy is
normalization mismatch: `%2e%2e`, `..`, symlinks, `0x7f.0.0.1`, `2130706433`, `[::1]`, `file:`,
`data:`. Every hardened gateway canonicalizes *first*, then decides. **Adopted:** `realpath` on the
resolved path (with a lexical fallback for not-yet-existing paths so the check cannot be skipped by
targeting a new file), WHATWG `new URL()` for egress, repeated percent-decoding to a fixed point,
and numeric-host normalization (decimal/hex/octal/IPv6) before allow-list comparison.

**R6 — Fail-closed structured output.** Treat an LLM as an untrusted transport: parse strictly,
validate against a schema, and map *any* failure to the safe state. **Adopted:** reviewers must emit
`{"decision":"approved"|"changes_requested"|"rejected","reason":string}`; anything else →
`changes_requested` with the parse failure recorded. Never `approved`.

**R7 — Non-interactive installers.** `DEBIAN_FRONTEND=noninteractive` / `--yes` / `CI=true`:
a prompt with no TTY must resolve to the *safe* default, never block. Audit shows `install.sh`
already implements this correctly; the gap is *proof*, so T12 adds an automated test.

**R8 — Container networking.** A service must bind `0.0.0.0` *inside* the namespace to be
reachable; safety comes from publishing to `127.0.0.1:port` on the **host**, not from binding
loopback in the container. **Adopted:** bind address becomes environment-driven and defaults to
loopback outside containers (no change to today's local security posture), with container detection
and host-side loopback publishing in compose.

---

## STEP 4 — ARCHITECTURE VALIDATION (before any code)

Each task validated against ADR-1…ADR-12 and the Commandments. A "redesign" row records a plan that
was **changed** because the first design would have violated the Constitution.

| Task | ADR-1 home | ADR-2 single authority | ADR-8 deletion | Verdict |
|---|---|---|---|---|
| **T1** | L0 (Constitution grants L0 "single source of truth for version/claims") | Replaces `set-version.ts`'s partial authority — does not sit beside it | Retires 6 hardcoded strings | **APPROVED** |
| **T2** | L0 tooling | Only claim authority | — | **APPROVED** |
| **T3** | L6/website | — | Deletes 20+ false claims | **APPROVED** |
| **T4** | L0 (`doctor`) | Extends existing `summarizeHealthChecks`; no second health engine | — | **APPROVED (redesigned)** |
| **T5** | L2 integrations | One vault | Retires unsalted format | **APPROVED** |
| **T6** | L1 workflow | Delegates to existing executor; adds none | Deletes simulation | **APPROVED (redesigned)** |
| **T7** | L2 tools | — | Deletes 5 stubs | **APPROVED** |
| **T8** | L1/L2 boundary | **Removes** a second execution path | Deletes 3 duplicate wirings | **APPROVED (scope-guarded)** |
| **T9** | L0 policy | One gate | — | **APPROVED** |
| **T10** | L1 multi-agent | One decision fn | — | **APPROVED** |
| **T11** | L0 CLI | One exit contract | Deletes self-fallback | **APPROVED** |
| **T12** | L1 daemon | — | — | **APPROVED (redesigned)** |
| **T13** | L0 tooling | — | — | **APPROVED** |

### Redesign decisions (recorded per Global Rule 3)

**T4 — rejected first design.** Initial plan: a new `ReadinessService`. This fails **ADR-2**
(second health authority) and **ADR-8** (adds without subtracting). *Redesigned:* extend the
existing `summarizeHealthChecks` contract in `src/baseline/status.ts` with a `runnable` dimension
and make `provider-*` checks required-by-default. No new module.

**T6 — rejected first design.** Initial plan: give the workflow engine its own tool executor. This
fails **ADR-2/Cmdt 6** (a second execution engine) and **ADR-3** (building surface on unproven
substrate). *Redesigned:* the engine accepts an **optional injected executor**; when absent, a
tool-action node **fails closed** as `unsupported` rather than fabricating success. Deletes
simulation without adding an engine — satisfying "subtraction before addition".

**T12 — rejected first design.** Initial plan: bind `0.0.0.0` unconditionally. This weakens trust
for ordinary local users (Article IX; Cmdt 13). *Redesigned:* default stays `127.0.0.1`; `0.0.0.0`
only when explicitly opted in via `XR_DAEMON_HOST` or when container detection fires, with host-side
publishing pinned to loopback. Security posture is unchanged for the default path.

**T8 — scope guard enforced.** The prompt and Phase 2 boundary forbid envelope unification here.
Validated design touches exactly three call-sites and passes `extraTools` through the **already
correct** `AgentService`. No new abstraction is introduced. Confirmed compliant with
"bridge, not unification".

### Performance validation (ADR-9 / Article XII)

No task adds an eager import to the startup path. T7 *removes* five tool objects from a
module-level array (neutral-to-positive). T1's manifest is read by build/CI tooling, **not** at
runtime — `src/core/version.ts` remains a static generated module, so `xr --version` performs no
file I/O. Measured before/after in `baseline.json`.

**Conclusion: all 13 tasks are constitutionally clear to implement, three after documented redesign.**
