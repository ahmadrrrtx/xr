# XR 7.0.1 — "Truth"

**Release type:** patch (truth and foundation reset) · **Date:** 2026-07-31
**Theme:** make every public statement and every internal success signal true.

This release fixes no features and adds none. It repairs the gap between what XR *said* and what XR
*did*. Several changes are visible removals — of claims, of tools, and of false success signals —
and they are the point of the release.

---

## Breaking-ish changes you should read

### 1. `doctor` now exits non-zero when XR cannot run a task

`xr doctor` previously reported `ok: true` and exited `0` on a machine with **zero** reachable
providers. Readiness was defined as "the binary is installed", not "XR can do work".

Readiness is now "can XR run a task right now":

```bash
$ xr doctor --json | jq '.summary | {ok, runnable, runnableReason}'
{ "ok": false, "runnable": false,
  "runnableReason": "no provider is reachable (11 configured but unavailable) — check credentials or start a local runtime" }
$ echo $?
1
```

**If you script against `xr doctor`, it will now fail on machines where it previously passed.** That
is the fix, not a regression. `xr status` still answers the narrower "is XR installed correctly"
question and is unaffected.

New: `xr doctor --deep` runs voice, control, capability and environment probes. The default checks
only the active path.

### 2. Failed tasks exit non-zero

A task that could not complete printed an error and exited `0`, so every CI pipeline wrapping XR was
silently green on failure. Now:

| Outcome | Exit code |
|---|---|
| Task completed | `0` |
| Task failed / budget / approval / step limit | `1` |
| Usage error (e.g. `xr run` with no task) | `2` |

Also fixed: `xr run` with no task previously consumed the router's injected `--no-color` flag *as the
task text* and ran it, exiting `1` instead of reporting the usage error.

### 3. Five stub tools were removed

`system_volume`, `system_battery`, `system_wifi`, `system_media`, `system_trash` and
`system_screenshot` are gone. None of them ever performed an action, and three reported `ok: true`
while doing nothing — so a model would tell you the volume had changed when it had not.

Screenshots remain available via `computer_control`. Volume, battery, Wi-Fi, media and trash control
are simply not available, and XR now says so.

A structural guard (`assertNoNoOpSuccess`) downgrades any tool result that claims success while
announcing unavailability, so this class of defect cannot quietly return.

### 4. Credential vault format changed (migration required)

Pre-7.0.1 records are **refused with a clear error** rather than silently mis-decrypted. See
[`docs/migration/credential-vault.md`](../../migration/credential-vault.md). In most cases the old
data is unrecoverable — because the old code never persisted the salt it derived keys from — and
the credential must be re-entered. Nothing is deleted automatically.

### 5. Workflow tool/timer nodes no longer fabricate success

Tool-action nodes now execute through an injected executor and **fail as unsupported** when none is
configured. Timer nodes wait for real, or park for an external scheduler. Previously both reported
`completed` immediately without doing anything.

### 6. Bundled plugin compatibility range corrected

`plugins/hello` and `plugins/github` declared `>=1.0.0 <2.0.0`, which made them **uninstallable** on
XR 7.x — the shipped examples of XR's extensibility could not be installed at all. Now `>=7.0.0 <8.0.0`.

---

## Withdrawn claims

Per Constitution Article XIX, removing a public claim is a release-note item, never a silent edit.
The following were removed from the website and README because **no evidence exists for any of them**:

| Withdrawn claim | Reality |
|---|---|
| "SOC 2 Type II" (5 locations) | No audit has ever been performed |
| "ISO 27001" | No certification |
| "HIPAA-ready" | No compliance program, no BAA |
| "GDPR"/"CCPA" listed as *certifications* | Neither is a certification |
| "12,000+ verified skills" (8 locations) | The repository ships **65** |
| "74k" GitHub stars | Fabricated |
| "Rust core" / "Rewritten Rust core: 3x faster" | **Zero Rust.** XR is TypeScript on Bun |
| "Request our SOC 2 report, penetration test summaries" | Those documents do not exist |
| Fabricated customer logos ("Fortune 500 Fintech", …) | Replaced with actual provider integrations |
| Fabricated metrics (12.4M runs, 840K developers, 99.99% uptime) | Replaced with mechanically true figures |
| README: "3.1.6 canonical from `src/core/version.ts`" | `version.ts` said 7.0.0 — self-refuting |

Also removed: two dead `href="#"` links and two forms that silently discarded submissions
(`preventDefault()` with no backend). Contact now routes to GitHub, where the conversation is
visible and referenceable.

Added: a prominent **"What XR is / is not"** section on the homepage and in the README.

---

## New governance machinery

- **[`release.manifest.json`](../../../release.manifest.json)** — one source of truth for version
  identity and every public claim. Six surfaces are stamped from it.
- **`bun run release:check`** — fails CI if any surface drifts. The previous version-sync job
  covered 3 of 6 surfaces, which is exactly how README and the installers drifted while CI stayed
  green.
- **`bun run claim-lint`** — fails CI on prohibited claims, unevidenced supervised terms, expired
  evidence, and mechanically false counts.
- **[Known-limitations register](known-limitations.md)** — the honest list of what is not yet real,
  maintained as a first-class release artifact.

---

## Security fixes

- **Policy gate canonicalisation.** `checkAction` matched regexes against `JSON.stringify(args)`,
  which is defeated by percent-encoding, traversal, alternate key names and numeric hosts. It now
  canonicalises first — `realpath` for paths, WHATWG `URL` for egress, numeric-host normalisation —
  and denies anything it cannot canonicalise. The deny-list covers `id_ed25519`/`id_ecdsa`,
  `/etc/shadow`, `/etc/passwd`, `.aws/credentials`, `.git-credentials`, `.kube/config` and more.
  Non-HTTP schemes and raw-IP egress are blocked unless explicitly allow-listed.
  90 adversarial cases are covered by tests.

- **Reviewer fails closed.** `inferReviewState` ended in `return "approved"`, so an empty response, a
  timeout, a stack trace or a refusal all counted as approval. Reviewers must now emit strict JSON
  `{"decision","reason"}`; anything else resolves to `changes_requested`. Approval additionally
  requires a stated reason.

- **Credential vault is restart-safe.** Per-record salt plus AES-256-GCM envelope encryption, with
  key rotation and tamper detection.

- **Honest security wording.** Language implying isolation where only in-process policy exists has
  been corrected throughout, including "workspace isolation" → "workspace data scoping".

---

## Fixes to extensibility reach

Shell, Telegram and Voice called `runAgent` directly without `extraTools`, so **installed plugins
and connected MCP servers were invisible on the surfaces people actually use** while working fine in
`xr run`. All three now resolve the same plugin/MCP/skill context through a shared bridge, verified
by a parity test that installs a real plugin.

This is a bridge, not full execution-envelope unification — that remains future work and is recorded
as such.

---

## Container and install

- The daemon detects a container and binds `0.0.0.0` **inside** it, because a process bound to the
  container's own loopback can never be reached through a published port. Host publishing stays
  loopback-only (`127.0.0.1:7842:7842`), so a normal local install gains no network exposure. Override
  with `XR_DAEMON_HOST`.
- The unattended install path (`install.sh --yes`, no TTY) is now covered by tests.

---

## Verification

```
bun run ci
  typecheck ............ pass
  test ................. 1980 pass / 0 fail
  release:check ........ 6/6 surfaces in sync at 7.0.1
  claim-lint ........... 8 evidenced claims, 0 violations
  baseline:inventory ... regenerated
```

Baseline measurements: [`BASELINE_MEASUREMENTS.md`](BASELINE_MEASUREMENTS.md).
