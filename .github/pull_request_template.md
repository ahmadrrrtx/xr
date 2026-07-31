# Summary

<!-- What changed, and WHY. The diff already shows what; explain the reasoning. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] False-claim fix (documentation/website/output corrected to match reality)
- [ ] New capability
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] CI / tooling

---

## Honesty checklist

XR's core rule is that it never claims what it has not verified. Every box here maps to a
constitutional requirement, and a PR that cannot tick them is not ready.

- [ ] **No success without a verified effect.** Nothing in this change reports `ok: true`,
      `succeeded`, or `completed` for an action that did not occur.
- [ ] **Tests assert effects, not transitions.** New tests check an observable outcome (a file
      written, a request received, an exit code, elapsed time) — not just that a state machine
      moved.
- [ ] **Fails closed.** Any ambiguity in trust, parsing, policy, or review resolves to deny.
- [ ] **No unsupported public claim.** Any new user-facing claim is in `release.manifest.json`
      with evidence and an expiry. `bun run claim-lint` passes.
- [ ] **No hand-edited version strings.** Release identity comes from `release.manifest.json`
      via `bun run release:stamp`.

## Engineering checklist

- [ ] `bun run ci` passes locally (typecheck, tests, release:check, claim-lint, inventory).
- [ ] No new boundary `any` and no empty `catch {}` in trust, CLI, policy, or credential paths.
- [ ] No TODOs, placeholders, or partially implemented paths.
- [ ] No second implementation of an existing concern (one authority per concern).
- [ ] No startup regression — no new eager imports on the boot path.
- [ ] Any migration is reversible and preserves user data, with a round-trip test.
- [ ] Stable CLI grammar preserved, or a deprecation notice is included.

---

## How this was verified

<!--
Paste real evidence, not intentions. For example:

  $ bun test test/phase0/credential-vault.test.ts
   16 pass, 0 fail

  $ xr doctor --json | jq .summary.runnable
  false
  $ echo $?
  1
-->

```
```

## Risk and rollback

<!-- What could break, who is affected, and how to revert. "None" is an acceptable answer
     if it is true. -->
