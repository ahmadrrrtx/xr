# Contributing to XR

Thank you for considering a contribution. XR is a **local-first, provider-neutral AI agent
runtime**, and it is governed by an explicit engineering constitution. This document tells you how
to work with that.

The single most important rule: **XR does not claim what it has not verified.** If your change
makes XR report success, that success must correspond to something that actually happened.

---

## Quick start

```bash
git clone https://github.com/ahmadrrrtx/xr.git
cd xr
bun install            # Bun >= 1.3 (version pinned by package.json packageManager)
bun test               # full suite
bun run typecheck      # tsc --noEmit
bun run ci             # what CI runs: typecheck + test + release:check + claim-lint + inventory
```

Run the CLI from source:

```bash
bun run src/index.ts doctor
bun run src/index.ts "summarise this repository"
```

---

## Your first day: the fast loop

The full suite is the gate for merging, not for editing. While you work, run the
**unit tier** — 19 curated files covering the invariants a first PR can actually
break (architecture boundaries, API contract, trust gates, core semantics,
dashboard/a11y/UX statics):

```bash
bun run unit-tier      # ~1.4s on a dev laptop; CI fails if it ever exceeds 5s
```

Then before pushing:

```bash
bun test               # full suite
bun run ci             # every gate CI will run against your PR
```

A first PR within a day is realistically scoped as:

1. **Orient (≤1 h):** §Architecture boundaries below; [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md)
   to see who owns the area you are touching; the newest ADRs in
   [`docs/adr/`](docs/adr/) for the decisions you must not fight.
2. **Change:** one logical change; add or adjust the tests that prove the effect.
3. **Verify:** `bun run unit-tier` while editing, `bun test && bun run ci` at the end.
4. **PR:** fill the template's honesty checklist; `CODEOWNERS` routes review
   automatically.

If any step on this path takes a new contributor materially longer than described,
that gap is a bug — file it as a DX issue, not a documentation complaint.

---

## The four rules that get PRs rejected fastest

### 1. No success without a verified effect

A function may not return `ok: true`, `succeeded`, or `completed` for an action that did not occur.

```ts
// ✗ rejected — reports success for nothing
return { ok: true, output: "volume control unavailable in this build" };

// ✓ correct — an honest failure
return { ok: false, output: "volume control is not supported on this platform" };
```

Tool results are additionally screened by `assertNoNoOpSuccess()` in
`src/computer/system-control.ts`, which downgrades any `ok: true` that announces unavailability.

### 2. Tests assert effects, not transitions

A test that asserts a state machine reached `completed` proves nothing about the product. Assert the
observable outcome: bytes on disk, a request a fixture server received, a real elapsed delay.

```ts
// ✗ rejected
expect(node.state).toBe("completed");

// ✓ correct
expect(node.state).toBe("completed");
expect(readFileSync(target, "utf8")).toBe("written-by-workflow");
```

See `test/phase0/workflow-effects.test.ts` for the reference pattern.

### 3. Fail closed

Ambiguity in trust, parsing, isolation, or review resolves to **deny**. A reviewer whose output
cannot be parsed is not an approval; a path that cannot be canonicalised is not safe; a credential
that cannot be authenticated is not valid.

### 4. No public claim without evidence

Every public claim lives in [`release.manifest.json`](release.manifest.json) with an `evidence`
pointer and an `expires` date. `bun run claim-lint` fails CI on anything else.

---

## Release identity: never hand-edit a version

`release.manifest.json` is the **single source of truth** for the version and for public claims.
Six surfaces are generated from it:

| Surface | File |
|---|---|
| Package metadata | `package.json` |
| Runtime identity | `src/core/version.ts` |
| Website identity | `website/src/lib/site.ts` |
| README header | `README.md` (between the `XR:RELEASE-IDENTITY` markers) |
| POSIX installer | `install.sh` |
| Windows installer | `install.ps1` |

To cut a release, edit the manifest and stamp:

```bash
# 1. edit identity.version / identity.codename in release.manifest.json
bun run release:stamp     # rewrite all six surfaces
bun run release:check     # CI's drift gate — must be clean
```

Editing `src/core/version.ts` (or any other stamped surface) by hand will be reverted by the next
stamp and will fail `release:check` in the meantime.

### Adding a public claim

1. Add an entry to `claims[]` in `release.manifest.json`:

```json
{
  "id": "my-capability",
  "text": "XR does X.",
  "evidence": "src/path/to/implementation.ts and test/path/to/proof.test.ts",
  "expires": "2027-07-31"
}
```

2. Run `bun run claim-lint`. The linter fails if the evidence is missing, the expiry has passed, or
   the claim uses a supervised term (`certified`, `enterprise-grade`, `production-ready`, <!-- xr-claim-lint-allow: enumerates the supervised vocabulary itself -->
   `complete`, `guaranteed`) without backing. <!-- xr-claim-lint-allow: enumerates the supervised vocabulary itself -->

3. Claims that can be counted mechanically (like the bundled skill count) should use the
   `mechanical` field so reality is checked, not just cited.

**Prohibited outright:** certifications XR does not hold (SOC 2, ISO 27001, HIPAA, PCI-DSS,
FedRAMP), inflated scale numbers, "Rust core" (XR is TypeScript on Bun), and absolute security <!-- xr-claim-lint-allow: enumerates the prohibited vocabulary itself -->
claims ("unhackable", "military-grade", "kernel-level isolation"). <!-- xr-claim-lint-allow: enumerates the prohibited vocabulary itself -->

The full machine-readable list lives in `prohibitedClaims` in
[`release.manifest.json`](release.manifest.json). If you are legitimately documenting a
banned term (as this section does), mark the line `xr-claim-lint-allow` — but only for
governance text that defines or disclaims the term, never to smuggle a claim past the gate.

---

## Architecture boundaries

XR has seven layers, and a concern has exactly one home:

| Layer | Contains |
|---|---|
| **L0 Kernel** | Composition root, service registry, lifecycle, policy decision point, version/claim authority |
| **L1 Runtime** | Agent loop, execution records, scheduling, provider plane, context/memory, workflow substrate |
| **L2 Platform** | Tool registry, MCP client, plugin host, skill loader, environment providers |
| **L3 Plugins** | Permissioned, isolated extensions |
| **L4 Skills** | Manifest-governed packaged capabilities |
| **L5 Business OS** | Extension package over thin kernel contracts |
| **L6 Enterprise** | Deployment profiles and operated controls |

**A second implementation of any L0/L1 concern is a defect, not a feature.** If you find yourself
writing a second executor, router, version authority, or claim authority — stop and extend the
existing one.

---

## Before you open a PR

```bash
bun run ci
```

That runs, in order:

1. `typecheck` — `tsc --noEmit`, zero errors
2. `test` — the full suite, zero failures
3. `release:check` — all six surfaces stamped from the manifest
4. `claim-lint` — no unsupported public claim
5. `baseline:inventory` — source-derived inventory regenerates

Additionally:

- **No new boundary `any`** and **no empty `catch {}`** in trust, CLI, policy, or credential paths.
- **No TODOs or placeholders.** Incomplete work is not merged; open an issue instead.
- **No startup regression.** Commands boot only what they need — no new eager imports on the
  startup path. Measure with `bun run baseline:measure`.
- **Migrations are reversible** and preserve user data. Add a round-trip test.

---

## Commit and PR conventions

- Keep the subject line imperative and under ~72 characters.
- Explain **why** in the body, not just what — the diff already shows what.
- Reference the issue you are closing.
- One logical change per PR. A refactor and a behaviour change belong in separate PRs.
- Fill in the PR template, including the honesty checklist.

---

## Reporting security issues

Do **not** open a public issue for a vulnerability. Follow the coordinated disclosure process in
[`SECURITY.md`](SECURITY.md).

---

## Testing notes

- Optional dependencies (for example Playwright) must **skip cleanly** when absent, never fail.
- Tests that spawn the CLI must use an isolated `HOME` so they cannot read or mutate a developer's
  real workspace. See `test/phase0/cli-spine.test.ts`.
- Adversarial tests belong with the thing they attack: `test/phase0/policy-gate-adversarial.test.ts`
  is the corpus for `src/security/guard.ts`.

---

## Known limitations

Read [`docs/release/7.0.1/known-limitations.md`](docs/release/7.0.1/known-limitations.md) before
filing a bug — the honest list of what is not yet real lives there, and keeping it accurate is part
of every release.
