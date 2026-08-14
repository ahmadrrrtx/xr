# Windows Release Blocker — Resolution Report

Two release-blocking defects were diagnosed and fixed:

1. **Windows Cross-Platform CI** — `Windows — full parity` job failing.
2. **Windows installer** — `iex (irm .../install.ps1)` failing with
   `ValidationMetadataException` / `ValidateSetFailure`.

Both root causes were reproduced and proven before any code was changed.
Neither fix weakens Linux/macOS behaviour, removes a test, skips a test, or
introduces a timeout/`continue-on-error` workaround.

---

## 1. Windows CI root cause

**A per-test timeout caused by filesystem write amplification in the capability
provenance graph — not a hang, not a Bun crash, not a process-cleanup defect.**

`CapabilityService.list()` indexed every descriptor into the provenance graph
through a **freshly allocated store per descriptor**:

```ts
private provenance(): CapabilityProvenanceStore {
  return new CapabilityProvenanceStore();   // new instance on EVERY call
}
...
for (const row of rows) this.provenance().indexDescriptor(row);
```

`CapabilityProvenanceStore` has a write-behind throttle (flush every 256 events
or 1 s), but it is **instance state**. Each new instance starts with
`hasFlushed = false`, so its *first* mutation always flushes synchronously. One
instance per row means the throttle could never engage.

A flush is a **full rewrite of the entire graph**:
`JSON.stringify(state)` → temp file → `renameSync`.

## 2. Why it took ~6 minutes and failed

The job failed at **5 m 52 s in the "Full unit suite" step** — it did *not* hit
the 30-minute step bound or the 60-minute job bound, so it was never a hang.
The ~6 minutes is simply how long the Windows suite takes to reach and finish
the `test/capabilities/` segment.

Measured on this repository (Linux, tmpfs):

| Metric | Before fix | After fix | Improvement |
|---|---:|---:|---:|
| Atomic graph rewrites per `list()` | 153 | 1 | 153× |
| Atomic rewrites in ONE lifecycle test | **1,703** | **22** | 77× |
| Bytes rewritten in that test | **125.6 MB** | **1.7 MB** | 74× |
| Lifecycle test body wall time | 1,867 ms | 598 ms | 3.1× |

`list()` also backs `inspect()`, `discover()` and `provenanceOf()`, which the
lifecycle test calls repeatedly — hence 1,703 rewrites for a single test.

On Linux/macOS a write+rename on tmpfs is microseconds, so the test finished in
~1.9 s and passed. On `windows-latest` each write+rename of a growing ~75 KB
file pays NTFS metadata cost **plus Microsoft Defender real-time scanning** of
every newly created file. At a realistic 5 ms per rewrite, 1,703 rewrites is
**~8.5 s** — past Bun's **5 s default per-test timeout**.

### The signature that confirms it

The failing check annotations were:

```
suite segment test/capabilities/ FAILED (exit 1)
FAILED TEST: (fail) full local lifecycle with effects asserted at each step
FAILED TEST: (fail) full local lifecycle with effects asserted at each step
```

with **no** `ERROR:`, **no** `ASSERT: Expected/Received`, and **no** `FRAME:`
annotation. I enumerated every Bun failure mode empirically (assertion failure,
rejected promise, `beforeEach`/`afterEach` throw, non-Error throw, timeout) and
**only a timeout** produces a `(fail)` line with none of those. Every other mode
emits an `error:` line that `diagnose_segment` would have annotated.

This also explains the misleading prior fix attempts: the previous commits
(`rollback snapshot uniqueness`, `staging/backup dirs`, `beforeEach` EBUSY
retry) treated it as a filesystem-locking or assertion problem. Simulating an
EBUSY-throwing `beforeEach` locally still produced **46 pass / 0 fail**,
disproving that hypothesis.

## 3. Exact component responsible

| | |
|---|---|
| Failing test | `test/capabilities/lifecycle.test.ts` → *"full local lifecycle with effects asserted at each step"* |
| Responsible component | `src/platform/capabilities/service.ts` — `CapabilityService.list()` / `provenance()` |
| Amplifying component | `src/platform/capabilities/provenance.ts` — `indexDescriptor()` → `maybeFlush()` → `flush()` |

## 4. Fix implemented

A batching API on the provenance store, and one call site change.

`src/platform/capabilities/provenance.ts`
- Split each mutation into a **pure in-memory** part and a **persisting** part:
  `applyDescriptor` / `addEvent` / `addEdge` (pure) vs
  `indexDescriptor` / `recordEvent` / `pushEdge` (prune + flush).
- Added `indexDescriptors(descriptors)`: apply all rows in memory, then
  `prune()` and `maybeFlush()` **once**.

`src/platform/capabilities/service.ts`
- `for (const row of rows) this.provenance().indexDescriptor(row);`
  → `this.provenance().indexDescriptors(rows);`

All public single-item methods keep their exact previous behaviour.

## 5. Why the fix is correct

- **Semantically identical.** The same nodes, edges and events are produced in
  the same order; only the number of *intermediate* rewrites changes. A
  regression test asserts graph equivalence between batched and one-by-one
  indexing.
- **Durability preserved.** The graph is still written atomically (tmp +
  rename) by a single writer, and a batch still flushes.
- **Platform-neutral.** No `process.platform` branch, no Windows-specific code
  path. Linux and macOS get the same ~3× speedup.
- **Root cause, not symptom.** No timeout was raised, no test excluded, no
  retry added.

## 6. Windows installer root cause

`install.ps1` began with a top-level `param(...)` block:

```powershell
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$AllowSystem,
  [ValidateSet('minimal','local','byok','hybrid','full')][string]$Mode = '',
  ...
)
```

## 7. Exact PowerShell issue

`iex (irm ...)` passes the downloaded text to **`Invoke-Expression`**, which
executes it as a *statement list in the caller's scope* — **not** as a script or
function with its own parameter binding.

In that context a top-level `param()` does not declare parameters. PowerShell
instead tries to **attach the parameter attributes to variables in the current
scope**. Attaching a `ValidateSet` to `$Mode` whose value is `''` — which is not
a member of the set — violates the attribute at the moment of attachment:

```
ValidationMetadataException / ValidateSetFailure
The attribute cannot be added because variable Mode with value
would no longer be valid.
```

Reproduced exactly on PowerShell 7.4.6. Key findings from isolating it:

| Variant | Result under `iex` |
|---|---|
| `[ValidateSet('a','b')][string]$Mode = ''` (original) | **ValidateSetFailure** |
| `[ValidateSet('a','b')][string]$Mode` (no default) | **ValidateSetFailure** — removing the default does NOT fix it |
| `[ValidateSet('a','b')][string]$Mode = 'a'` | works (default inside set) |
| Same script run via `-File` | works — file execution binds parameters normally |
| Parameters on a **function** | works in all invocation modes |

So the bug is **invocation-mode dependent**, which is why `-File` execution and
all existing tests passed while the documented command was broken.
`Invoke-Expression` itself was not the fault — it only exposed it. `Mode` is
also a dangerously generic name to inject into a user's live session.

### Second latent defect found (PowerShell 5.1)

```powershell
Set-StrictMode -Version Latest
$os = if ($IsWindows -or $env:OS -eq 'Windows_NT') { ... }
```

`$IsWindows` only exists in PowerShell 6+. Under Windows PowerShell **5.1**
with `Set-StrictMode -Version Latest`, *reading* an unset variable throws:
`The variable '$IsWindows' cannot be retrieved because it has not been set.`
Verified by reproducing the exact expression shape. The installer would have
failed on stock Windows PowerShell 5.1 even after the ValidateSet fix.

## 8. Installer fix

Rewrote `install.ps1` around a **function-scoped parameter block**:

- **No top-level `param()`** — all parameters live on `Invoke-XrInstall`, where
  `ValidateSet` performs genuine parameter binding and still rejects bad values.
- **Explicit, collision-free names**: `-AssumeYes`, `-AllowSystem`,
  `-InstallMode`, `-TargetDirectory` (no generic `$Mode`/`$Yes`/`$TargetDir`).
- **Safe Windows detection**: `Test-XrOnWindows` probes
  `Test-Path Variable:\IsWindows` before reading it → correct on 5.1 and 7+.
- **TLS 1.2 enabled explicitly** — stock 5.1 cannot reach GitHub otherwise.
- **No top-level `exit`** — under `iex` that would close the user's console;
  failures `throw` instead (`-File` still yields exit code 1 on an uncaught
  throw, verified).
- **Approved verbs** for every function (`Install-`, `Test-`, `Write-`,
  `Confirm-`, `Update-`, `Get-`, `Stop-`).
- **Prerequisite / error handling**: PowerShell version gate, `git clone` and
  `bun install` exit codes checked, actionable messages, no silent failures.
- **PATH hygiene**: appends only when genuinely absent (trailing-separator
  tolerant), never writes back a PATH it failed to read.
- **Idempotent**: re-running detects an existing checkout and an existing PATH
  entry.
- **Security preserved**: HTTPS-only, SHA256SUMS verification retained (fail
  closed on missing/mismatched checksum), unique temp files always cleaned up in
  `finally`, and the script never `Invoke-Expression`s anything it downloads.
- Dispatch supports remote (`iex`), file (`-File`, with arguments), and
  dot-sourcing (defines functions only).

## 9. Tests performed

**Regression coverage added** (both verified to genuinely fail on the old code):

`test/platform/provenance-write-amplification.test.ts` (6 tests)
- Hooks `CapabilityProvenanceStore.prototype.flush` (prototype, not instance —
  an instance hook would miss the per-row stores and the guard would pass while
  the bug is present; this was verified) and drives real
  `CapabilityService.list()`.
- Asserts rewrites per `list()` are constant and do not scale with descriptor
  count; asserts batched vs one-by-one graphs are equivalent.
- **Mutation-tested**: restoring the original per-row loop makes 2 tests fail.

`test/release/installer-powershell.test.ts` (18 tests)
- Static: no top-level `param()`, no bare `$Mode`, no top-level `exit`, guarded
  `$IsWindows`, TLS 1.2, HTTPS-only, checksum verification, PATH hygiene, no
  self-`Invoke-Expression`. (Comment lines are stripped before behavioural
  assertions so the explanatory header cannot satisfy them.)
- Live PowerShell execution: script parses with 0 errors; `Invoke-Expression`
  raises **no** ValidateSetFailure; caller scope is not polluted; a pre-existing
  `$Mode` is preserved; dot-sourcing defines `Invoke-XrInstall` and ValidateSet
  still rejects invalid modes; a valid `-InstallMode` binds.
- **Mutation-tested**: against the original `install.ps1`, **9 of 18 fail**.

Also updated `test/phase0/install-container.test.ts` for the renamed switch and
strengthened it (non-interactive short-circuit, no-TTY behaviour, flag
propagation) rather than merely relaxing the pattern.

**Validation runs (all green):**

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | pass |
| Full suite, linux authority | **241/241 files, 0 fail, exit 0** |
| Full suite, win32 authority | **236/236 files, 0 fail, exit 0** |
| Repeat runs (win32 + golden path) ×3 | 3/3 exit 0, no flake |
| Golden path (hermetic) | `"ok": true`, exit 0 |
| `release:check` | 6 surfaces in sync at 1.0.0 |
| `platform:parity:check` | 241 files · linux:241 · darwin:241 · win32:236 |
| claim-lint, changelog, baseline, capability gate, api schema/client/compat, boundaries, size-gate, hot-path-lint, ownership, channel, marketplace | 13/13 pass |

Exclusion manifest unchanged — **no test added to it, none skipped, none
removed**. Test count grew 240 → 242.

## 10. CI results

**Not yet pushed.** This environment has no credentials for
`github.com/ahmadrrrtx/xr`: `git push` fails with
`could not read Username for 'https://github.com'`, and the raw Actions job
logs return **HTTP 403 ("Must have admin rights to Repository")**. Diagnosis was
therefore performed against the public check-run annotations API plus local
reproduction, and the work is delivered as the branch
**`fix/windows-ci-and-installer`** for you to push.

The diagnosis does not depend on log access: the annotation *shape* (a `(fail)`
line with no `error:`/`Expected`/`FRAME`) uniquely identifies a timeout, and the
write-amplification cost was measured directly.

## 11. Files changed

| File | Change |
|---|---|
| `src/platform/capabilities/provenance.ts` | Batching API; pure vs persisting mutation split (+65/−9) |
| `src/platform/capabilities/service.ts` | `list()` indexes descriptors as one batch (+10/−2) |
| `install.ps1` | Rewritten: function-scoped params, 5.1/7 safe, TLS 1.2, PATH hygiene |
| `test/platform/provenance-write-amplification.test.ts` | **New** — 6 CI regression tests |
| `test/release/installer-powershell.test.ts` | **New** — 18 installer regression tests |
| `test/phase0/install-container.test.ts` | Updated + strengthened for renamed switch |
| `README.md` | Install table notes PowerShell 5.1 / 7+ |
| `docs/development/GETTING_STARTED.md` | Documents how to pass installer options |
| `docs/release/1.0.0/{INVENTORY.md,inventory.json}` | Regenerated (240 → 242 test files) |

No workflow file was modified: `.github/workflows/cross-platform.yml` was
already correct, and the failure was a genuine product defect it surfaced
accurately. No architecture or UX outside these paths was touched.

## 12. Remaining risks

- **Not yet verified on real Windows CI.** The fix is verified by direct
  measurement of the causal quantity (atomic rewrites) rather than by a green
  Windows run. Residual risk is low but non-zero.
- **Timing margin, not a hard bound.** The lifecycle test now performs 22
  rewrites instead of 1,703 (~77× headroom against the 5 s timeout). If Windows
  I/O were catastrophically slower than modelled, a timeout could still occur —
  the regression tests would not catch that, since they assert work done rather
  than wall time.
- **PowerShell 5.1 not executed.** No Windows PowerShell 5.1 host was available;
  5.1 compatibility is established by construction (guarded `$IsWindows`,
  TLS 1.2, no 6+‑only syntax) and by PS 7.4.6 execution, not by running 5.1.
- **Full end-to-end install not run.** The installer cannot complete in a Linux
  sandbox; tests assert the failure *class* is gone and each stage's logic,
  not a completed Windows installation.
- Other Windows-only crash-class items (`test/perf/binary-update.test.ts`,
  `test/architecture/unit-tier.test.ts`) appeared in *older* runs and are
  absorbed by the runner's crash-class retry. They were **not** present in the
  latest failing run and are untouched here.

## 13. Installation command verified

```powershell
iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)
```

This exact command shape was executed against the fixed script under PowerShell
7.4.6 and **no longer raises** `ValidationMetadataException` /
`ValidateSetFailure`. It remains the documented command. To pass options, the
docs now correctly instruct downloading the file first (`iex` cannot forward
arguments):

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1 -OutFile install.ps1
.\install.ps1 -AssumeYes -InstallMode minimal -TargetDirectory C:\tools\xr
```

## 14. Final release status

**Fixes complete and locally validated; awaiting a real CI run to be declared
green.**

- [x] Windows CI root cause found, proven and fixed
- [x] Linux parity preserved — 241/241, exit 0
- [x] macOS parity preserved (no platform-specific change)
- [x] Windows full parity preserved — 236/236 via win32 authority
- [x] typecheck / full suite / golden path pass
- [x] No test removed, skipped, or added to the exclusion manifest
- [x] No `continue-on-error` or timeout workaround
- [x] Installer root cause found, proven and fixed
- [x] PS 5.1 behaviour understood; PS 7 behaviour tested
- [x] Documented install command verified against the exact failure
- [x] Regression coverage exists and is mutation-tested
- [x] `git diff` contains only intentional changes
- [ ] **Final GitHub checks green — requires push access (see §10)**
