# Changelog convention (Phase 9)

Release notes are **generated from git history**, never hand-written after the
fact — a changelog written from memory omits the unglamorous fixes users
actually feel. `scripts/changelog.ts` is the generator;

```bash
bun run changelog -- --from v7.1.0 --to HEAD --version 7.2.0
```

## The contract

Commit subjects must be **Conventional Commits**:

```
<type>(<optional scope>)!: <subject>
```

Recognised types and their release-notes sections (in emitted order):

| type | section |
|---|---|
| `feat` | Added |
| `fix` | Fixed |
| `perf` | Performance |
| `refactor` | Refactored |
| `docs` | Documentation |
| `test` | Tests |
| `build` | Build & distribution |
| `ci` | CI |
| `chore` | Chore |
| `style` | Style |
| `revert` | Reverts |

Rules the generator enforces — know them before you commit:

1. **Unknown types are dropped from the notes.** A typo (`feature:`) means
   your change ships silently undocumented — the parser ignores what it
   cannot classify. There is no "misc" bucket by design.
2. **`!` means breaking.** `feat(api)!:` puts the entry in the **Breaking
   changes** callout at the top of the notes, above everything else.
3. **Merge commits are excluded**; squash-merge or ensure the individual
   commits are well-formed.
4. **Deterministic output**: same range → same bytes (stable ordering by
   section, then subject). The notes are diffable across runs.
5. **Empty ranges say so.** If no commits classify, the notes carry an
   explicit empty-range marker instead of pretending otherwise.
6. The Release workflow appends the verification pointer
   (sha256sum + cosign + slsa-verifier) to every generated body.

## Breaking-change body trailers (recommended)

`BREAKING CHANGE: <what + migration>` in the commit body. The subject line
must still carry the `!` — that is what the generator sees.

## What belongs in a subject

- one behaviour change in imperative mood: `fix(update): refuse unsigned
  checksums instead of warning`;
- the scope is the user's mental model (`update`, `install`, `release`,
  `daemon`), not the directory name;
- never paste a PR title that starts with "Merge".
