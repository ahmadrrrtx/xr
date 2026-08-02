# First-Task Success Evidence — XR Phase 8 · T4

**Last updated:** 2026-08-03 · **Build:** 7.0.1 + Phase-8 branch
**Requirement:** a new user's first task succeeds ≥ 95% of the time.

---

## 1. What "the first task" is

> **Install XR and get your first answer.** (`install → boot → first answer`, with audit evidence)

This is the task every new user must complete before any other value exists,
and it exercises exactly the surfaces Phase 8 hardened: the installer wizard,
first boot, and the first execution through the real spine.

## 2. What is machine-verified (CI-enforced)

`scripts/first-task-survey.ts` spawns N=20 independent attempts, each in a
fully fresh `XR_HOME`+`HOME` (clean-room proxy for a brand-new machine — no
residual config, no warmed caches). An attempt succeeds only if **all** steps
pass: `install-exit-0 → install-materializes-home → runtime-boots →
first-answer-succeeds → answer-is-audited`.

### Measured on this build (2026-08-03, Linux x86_64, bun 1.3.14)

| Metric | Result |
|---|---|
| Attempts | 20/20 succeeded |
| Success rate | **1.0000** (target ≥ 0.95 — gate `ok: true`) |
| Time to first value | p50 **385 ms** · p95 404 ms · max 405 ms |
| Failures | none |

The nightly CI workflow (`nightly.yml`, job `first-task-survey`) re-runs this
survey and fails the run if the rate drops below 0.95, so regressions in the
first-run journey are caught within 24h.

## 3. What is NOT claimed

This is an **automated environment-reliability proxy**, not a human usability
study. It proves the journey is *mechanically* complete on a clean machine; it
cannot measure comprehension, discoverability, or confidence. The proxy's
"answer" step uses the deterministic in-process execution stub (identical
harness style to `scripts/golden-path.ts`) — it does not require a model
download or network, so it measures the product path, not model availability.

## 4. Human study — protocol (pending, honesty exception E-1)

The human half of the ≥95% requirement is **not yet performed and not
claimed** (see `docs/phase8/04-ARCHITECTURE-VALIDATION.md`, exception E-1).

Protocol when run:

1. **Recruit** ≥5 participants who have never installed XR (mix of CLI-fluent
   and CLI-casual engineers). No XR team members.
2. **Setup** a clean machine/VM per participant; hand them only the public
   install instructions.
3. **Task** (read verbatim): *"Install XR and get your first answer from it."*
4. **Moderate** silently until success, explicit give-up, or 30 minutes.
5. **Record**: success/failure per participant, time-to-first-value, steps
   where they hesitated > 60 s, every documentation detour.
6. **Publish** the raw table + rate in this file before release claims the
   ≥95% first-task requirement as human-verified.

| Participant | Result | Time | Hesitation points |
|---|---|---|---|
| — | study pending | — | — |

**Current standing:** `automated-proxy-green (20/20) · human-study-pending`
