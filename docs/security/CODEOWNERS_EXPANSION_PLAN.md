# XR — CODEOWNERS Expansion Plan (review item #1)

**Status:** DRAFT — implements the bus-factor mitigation roadmap for KNOWN_LIMITATIONS #1 (bus factor of 1).
**Owner:** @ahmadrrrtx (current sole owner).
**References:** [CODEOWNERS](../../CODEOWNERS), [SECURITY.md](../../SECURITY.md) §Reporting,
[KNOWN_LIMITATIONS](./KNOWN_LIMITATIONS.md) (bus factor acknowledged in SECURITY.md),
[CONSTITUTION.md](../CONSTITUTION.md) Art. IX (review rights).

## The problem, stated honestly

Every line of `CODEOWNERS` currently resolves to `@ahmadrrrtx`. The
`SECURITY.md` disclosure section explicitly says the response effort is
"best-effort, not a contractual SLA." For a project whose entire thesis
is *auditable, fail-closed security*, a single point of failure at the
ownership layer is the largest unmitigated risk — larger than the
V8-escape residual risk (which OS isolation bounds on validated Linux
hosts) because there is **no** second reviewer who can catch a typo in
a fail-closed file.

This is not a code fix. It is a governance fix. The plan below is the
smallest realistic sequence that gets the project from "1 owner" to "2+
owners on every fail-closed path" without surrendering the maintainer's
final say on direction.

## Guiding principles

1. **Fail-closed code first.** The order is: `src/security/` →
   `src/runtime/trust/` → `cloud/src/middleware/` → everything else.
   These are the files where a bug = a security boundary failure.
2. **Review, not merge rights.** The goal is a second pair of eyes on
   every PR, not a co-maintainer who can override the maintainer's
   vision. New owners get `CODEOWNERS` review status; GitHub branch
   protection enforces "review required"; the maintainer retains
   merge authority.
3. **Earned, not granted.** A new owner must have shipped a non-trivial
   PR to the subsystem they'll own, AND reproduced the subsystem's
   test suite from a clean checkout, BEFORE being added to CODEOWNERS.
4. **Documented expectations.** Each subsystem's CODEOWNERS line gets a
   companion `OWNERS.md` in the subsystem dir describing what review
   entails (which tests to run, which invariants to check, which
   constitutional articles bind the file).

## Phased rollout (4 phases, ~6 months)

### Phase 1 — Recruit a Security Co-Owner (weeks 1–8)

**Target:** add a second reviewer to `src/security/`, `src/trust/`,
and `cloud/src/middleware/`. These are the three fail-closed subtrees
where a single-owner bug is most consequential.

**Recruitment criteria:**
- Demonstrable TypeScript strict-mode experience (≥2 years).
- Prior security review experience (either pro pentester, or
  maintainer of a security-sensitive OSS project).
- Willingness to commit to a 72-hour first-response SLA on PRs
  touching those subtrees (matches the `security@rrrtx.ai` SLA in
  `SECURITY.md`).
- No conflicts of interest with the maintainer's day job.

**Onboarding (the "earned" gate):**
1. Maintainer and candidate pair on 3 PRs to `src/security/` —
   candidate reviews, maintainer merges, debrief.
2. Candidate opens 1 PR of their own to `src/security/` (e.g., a new
   adversarial test, a documentation improvement, a refactoring that
   doesn't change behaviour).
3. Candidate reproduces the §2 evidence suite from
   `PENTEST_REGISTER.md` in a clean checkout and posts the output.
4. Maintainer adds candidate to `CODEOWNERS` for the three subtrees.

**CODEOWNERS diff:**
```diff
- /src/security/                  @ahmadrrrtx
- /src/trust/                     @ahmadrrrtx
- /cloud/src/middleware/          @ahmadrrrtx
+ /src/security/                  @ahmadrrrtx @SECURITY_COOWNER
+ /src/trust/                     @ahmadrrrtx @SECURITY_COOWNER
+ /cloud/src/middleware/          @ahmadrrrtx @SECURITY_COOWNER
```

**Branch protection:** enable "Require review from code owners" for
these paths. The maintainer can still self-merge other paths; the
fail-closed subtrees now require the co-owner's review.

### Phase 2 — Subsystem Owners for L1 Runtime (weeks 4–12, parallel with Phase 1)

**Target:** add owners for `src/execution/`, `src/providers/`,
`src/intelligence/`. These are not fail-closed, but they're the
agent-loop hot path — a bug here degrades the product for everyone.

**Recruitment:** the candidate pool is wider here (TypeScript
experience + agent-runtime interest; security experience is a bonus
but not required). The maintainer can recruit from active
contributors who've shipped ≥3 non-trivial PRs.

**Onboarding:** same "earned" gate (3 paired reviews + 1 own PR +
clean-checkout test reproduction), but the test suite is the
subsystem's own, not the security §2 suite.

**CODEOWNERS diff:** add `@EXEC_COOWNER` to the three L1 lines.

### Phase 3 — Subsystem Owners for Surfaces (weeks 8–16)

**Target:** add owners for `src/cli/`, `src/daemon/` (non-middleware),
`src/interfaces/`, `desktop/src/`. These are the user-facing surfaces;
a bug here is visible but not security-critical.

**Recruitment:** the widest candidate pool. Active contributors who
have shipped ≥1 PR to the surface they'll own.

**Onboarding:** 2 paired reviews + 1 own PR. No test-suite
reproduction gate (the surface tests are less load-bearing).

### Phase 4 — Backup Maintainer (weeks 16–24)

**Target:** designate a "backup maintainer" who has merge rights (not
just review rights) and can act if the primary maintainer is
unreachable for ≥30 days. This is the formal bus-factor mitigation.

**Recruitment:** must be a Phase 1 + Phase 2 co-owner (i.e., has
already earned review rights on fail-closed code). This is a
trust-grant, not a skill-grant.

**Documentation:** add a `MAINTAINERS.md` at the repo root listing:
- Primary maintainer (@ahmadrrrtx) — merge authority, direction.
- Backup maintainer (@BACKUP_MAINTAINER) — merge authority when
  primary is unreachable ≥30 days; documented escalation path
  (email → 14-day wait → backup takes over).
- Co-owners per subsystem (Phase 1–3 outputs).

**Branch protection:** the backup maintainer gets merge rights on
all paths, but normal PRs still require the subsystem co-owner's
review. The backup only merges when the primary is unreachable.

## Per-subsystem OWNERS.md (template)

Each subsystem with a co-owner gets a companion `OWNERS.md` in the
subsystem dir. Template:

```markdown
# Owners — <subsystem>

## Primary
@ahmadrrrtx — merge authority, final say on direction.

## Co-owner
@<COOWNER> — review authority on all PRs touching this dir.

## Review checklist
- [ ] Reproduce the subsystem test suite: `bun test <path>`
- [ ] Confirm no `process.env[API_KEY]` reads added (grep guard).
- [ ] Confirm no new `unsafe-inline` in any CSP.
- [ ] Confirm fail-closed behaviour preserved on unknown inputs.
- [ ] Confirm Constitutional Articles <list> still hold.

## Bound by
- Constitutional Articles: <list>
- ADRs: <list>
- KNOWN_LIMITATIONS rows: <list>
```

## Success metrics

| Metric | Today (1 owner) | Phase 1 done | Phase 4 done |
|---|---|---|---|
| Fail-closed subtrees with ≥2 owners | 0/3 | 3/3 | 3/3 |
| Subsystems with ≥2 owners | 0/~12 | 3/~12 | ~12/~12 |
| Bus factor (people who can merge) | 1 | 1 | 2 |
| Bus factor (people who can review fail-closed) | 1 | 2 | 2 |
| Avg PR first-response on `src/security/` | unlimited | 72h SLA | 72h SLA |
| Documented merge authority succession | none | none | MAINTAINERS.md |

## Why not just add a co-maintainer immediately?

Because trust is earned by working on the code, not by being added to
a file. Adding a stranger to `CODEOWNERS` for `src/security/` without
the onboarding gate would:
- Give them review authority over fail-closed code they don't yet
  understand.
- Create a false sense of security ("2 owners!" when the second owner
  can't actually evaluate the changes).
- Risk social-engineering attacks (a malicious contributor befriends
  the maintainer, gets added, approves their own backdoor PR).

The phased rollout deliberately front-loads the fail-closed subtrees
(Phase 1) and defers merge authority (Phase 4) until the co-owner has
months of review history.

## Maintainer checklist (internal)

- [ ] Write a "co-owner wanted" post (CONTRIBUTING.md link + X/HN post).
- [ ] Define the 72h SLA in `SECURITY.md` once Phase 1 lands (replace
      "best-effort, not a contractual SLA" with the new commitment).
- [ ] Set up GitHub branch protection for `src/security/`,
      `src/trust/`, `cloud/src/middleware/` — "Require review from
      code owners" + "Dismiss stale reviews on push".
- [ ] Create `OWNERS.md` in each Phase 1+ subtree.
- [ ] After Phase 4: publish `MAINTAINERS.md` at repo root; update
      `SECURITY.md` §Reporting to point to it.
- [ ] Update KNOWN_LIMITATIONS with a new row tracking bus-factor
      mitigation progress (this doc is the evidence; closure = Phase
      4 complete + MAINTAINERS.md shipped).
