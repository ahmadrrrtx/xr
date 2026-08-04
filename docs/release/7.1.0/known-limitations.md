# XR 7.1.0 (Truth) — Known Limitations

**Status:** current · **Generated for:** release 7.1.0 (Public Beta) · **Last reviewed:** 2026-08-04

This register exists because XR's constitution forbids claiming what has not been verified. It is
the honest, prominent list of what is **not yet real**. Everything here is a deliberate, recorded
gap — not an oversight — and each entry says plainly what does not work and what would be required
to close it.

If you find something untrue that is *not* listed here, that is a defect: please file a
[false-claim report](https://github.com/ahmadrrrtx/xr/issues/new?template=false_claim.yml).

**Closed since 7.0.1** (removed with evidence, per the review policy below):
*"Releases are not signed"* — releases are cosign keyless-signed with SBOM + SLSA provenance
(proof: `.github/workflows/release.yml`, `docs/release/VERIFYING_RELEASES.md`,
`test/release/release-build.test.ts`). *"CI is Linux-only"* — cross-platform CI now runs the full
suite + golden path at parity on Linux arm64, macOS arm64, macOS x64 and Windows x64
(proof: `.github/workflows/cross-platform.yml`, `docs/release/SUPPORT_MATRIX.md`).
*"No hermetic artifact E2E"* — `test/reliability/artifact-e2e.test.ts` packs the npm artifact,
installs it into a clean directory, and drives the installed artifact as a black box.

---

## 1. Security posture

### XR holds no third-party certifications
XR is **not** SOC 2, ISO 27001, HIPAA, PCI-DSS or FedRAMP certified, audited, or "ready". No
external audit has been performed. (7.0.1 removed the fabricated website claims; nothing has been
audited since — Phase 10 decides whether an audit happens.)

### Policy is not isolation
XR enforces an **in-process policy gate** (`src/security/guard.ts`): it canonicalises paths and URLs
and denies dangerous actions before a tool runs. This is a meaningful guard rail, and it works even
when the model is manipulated — but it is **not** kernel isolation, VM isolation, or a syscall
sandbox. Do not run XR against untrusted content with credentials you cannot afford to lose.

### Plugin sandboxing is permission-scoped, not confined
Plugins declare permissions and run through a host with capability gating. They are **not** confined
by an OS-level sandbox. A malicious plugin you install and enable can do what its granted
permissions allow.

### Binaries are cosign-signed, not vendor-certificate-signed
Release assets are signed keylessly with sigstore (identity pinned to the release workflow; Rekor
log) — that is tamper evidence, not OS trust. XR has **no Apple Developer ID notarization** and
**no Authenticode/EV certificate**:

- **macOS:** browser-downloaded binaries may be quarantine-blocked on first run
  (`xattr -d com.apple.quarantine <binary>` after verifying, per
  [`../VERIFYING_RELEASES.md`](../VERIFYING_RELEASES.md)).
- **Windows:** SmartScreen may warn on first run.

*To close:* paid vendor certificates + notarization steps in the release pipeline.

### Signed-release proof only exists for tags the new workflow ran on
Cosign/Rekor/SLSA evidence begins with the first tag cut by the Phase-9 Release workflow.
Older tags (including all ≤ 7.0.1 releases) remain unsigned by record — they are not retroactively
"signed" by this document.

---

## 2. Distribution (Phase-9-specific)

### Beta means beta
XR 7.1.0 is a **Public Beta**: validated (2,771 tests + golden path at the audit baseline),
signed and reversible — and not finished. The install-success metric bar (≥99% over a
30-attempt window across 3 OS families) is **PROVISIONAL until the nightly beta-install matrix
fills the window**; `scripts/beta-metric.ts` prints N and never projects a pass.

### WinGet lags one registry review
The `ahmadrrrtx.XR` community manifest updates on release, but the microsoft/winget-pkgs review
means `winget install` can trail the GitHub release by days. Tier 2, disclosed wherever WinGet is
listed.

### No hosted apt/dnf repositories
`.deb`/`.rpm` packages ship per release; there is no repository service. Update = fetch and install
the newer package (commands in [`../INSTALLATION.md`](../INSTALLATION.md)).

### Snap and flatpak do not exist
Rejected for now with rationale (confinement-model conflict with XR's honest "policy is not
isolation" story; store governance needs a second release authority) — see **ADR-0023**. Review at
9.0.0 planning.

### Windows ARM64 is unsupported
No `bun-windows-arm64` target; installs fail honestly rather than shipping an untested artifact.
macOS x64 (Intel) is tier 1 with CI on the `macos-13` runner image; arm64 macs are covered natively
via `macos-latest`.

### The container smoke test stops at publish
The release workflow builds, pushes, attests and digest-signs the GHCR image across two
architectures. A **post-publish pull→run→doctor smoke** against the pushed image is not automated
(nightly exercises the *installer* channel, not the container).

---

## 3. Credentials

### Pre-7.0.1 business credentials cannot be recovered
Before 7.0.1 the credential vault derived its encryption key from a random salt that was **never
persisted**. Any business credential stored before 7.0.1 is unrecoverable unless you separately
captured the derived key. XR detects these records and **refuses** them with a clear error rather
than silently mis-decrypting; `migrateLegacyRecords(legacyKey)` upgrades them **if** you can supply
the original key. See [`../../migration/credential-vault.md`](../../migration/credential-vault.md).

---

## 4. Execution

### Workflow tool-action nodes require an injected executor
Tool-action nodes execute through a `WorkflowToolExecutor` supplied to the engine. When no executor
is wired, those nodes **fail as unsupported** (they once reported `succeeded` without running
anything; failing is correct, but a workflow containing tool actions needs an executor to be
useful).

### Timer and event nodes need a scheduler
`wait_timer` nodes wait for real only when a `WorkflowTimerScheduler` is provided; event-wait nodes
need a subscriber. Neither fabricates completion, and neither self-advances.

### The interactive surfaces share extensibility, not the full execution envelope
Shell, Telegram and Voice reach installed plugins, MCP servers and skill context through a shared
bridge, so their tool-set matches the one-shot CLI. They still construct their own provider and
agent invocation rather than routing through one unified execution envelope.

---

## 5. Platform coverage

### Removed system tools
`system_volume`, `system_battery`, `system_wifi`, `system_media`, `system_trash` and
`system_screenshot` are **removed** — they never performed an action. Volume, battery, Wi-Fi,
media and trash control are not available. Screenshots are available through `computer_control`.

### Platform-specific gaps in surviving tools
- `system_apps` works on macOS (`osascript`) and Linux with `wmctrl` installed; it fails honestly
  elsewhere.
- `system_notify` works on macOS and Linux (`notify-send`); it fails honestly on Windows.
- Clipboard tools require `pbcopy`/`pbpaste` (macOS), `xclip` (Linux) or PowerShell (Windows).

### OS exceptions exist inside tests, whitelisted
Full-parity CI allows runtime detection-skips only (Constitution Art. XX.5); the whitelist is
enforced by `test/release/portability.test.ts` and currently holds three files (POSIX-only signal
and path-semantics suites, one CLI-spine assertion). Adding an entry fails review loudly.

---

## 6. Testing and verification

### No provider canaries
Nothing continuously verifies that real provider APIs still behave as XR expects. A breaking change
by a provider would be discovered by users first.

### Mutation testing is on-demand, not per-PR
`bun run mutation:run` exists (threshold 0.6) but does not gate every pull request; resident
mutants could linger between runs.

---

## 7. Product surfaces

### The dashboard does not surface MCP servers
MCP servers are managed from the CLI. The dashboard does not list or control them.

### The website is descriptive, not transactional
There is no contact form, no sales pipeline and no lead capture. All contact happens through
GitHub issues, including beta feedback (`beta_feedback.yml`).

---

## 8. Architecture (standing entries)

### Placement is recorded, not enforced
The execution envelope carries a `placement` field (`in_process` today). XR does **not** yet
enforce risk-tiered isolation: a high-risk tool is not automatically confined to a stronger
boundary. §1 "Policy is not isolation" remains fully in force.

### Type-only import cycles exist (by design, bounded)
Zero runtime cycles; `import type`-only cycles are permitted, reported at `warn`, and bounded by
architectural tests. See ADR-0005.

### `eslint-plugin-boundaries` is not used
One rule set (dependency-cruiser + architectural tests), no second source of truth. Recorded
deviation — ADR-0005 (review: 8.0.0).

### 16 modules remain over the 800-LOC threshold
Each carries an owned, dated split plan; the size gate fails if one grows, goes stale, or a new
unwaived module lands over threshold.

### The legacy `user_memory` table still exists
Retained as the system of record for pre-Phase-2 rows so the documented downgrade path stays
reversible. Removal scheduled for 8.0.0 behind its own reversible migration (ADR-0006).

### Consent for pre-Phase-2 memory is unknown
Rows migrated from `user_memory` carry `consent_state: legacy_unknown`; XR does **not** claim
those items were approved. They remain retrievable and flagged for re-affirmation.

---

## 9. Phase-8/10 scope boundaries (deliberate deferrals)

- **No hosted observability backend or SIEM connector.** Local-first only (OTLP to your own
  collector, local `/metrics`, local trace viewer). Phase 10.
- **No enterprise identity (SSO / SCIM / IdP).** Dashboard auth is a local bearer token. Phase 10.
- **No high-availability/operator model.** Single-node local-first runtime. Phase 10.
- **Remote telemetry transport is manual.** No vendor upload path; privacy defaults are
  non-negotiable when hosted surfaces land (Art. XXI).
- **Human-verified UX/a11y studies are pending, not claimed.** WCAG 2.2 AA is automated-verified
  only; screen-reader/zoom manual passes and the moderated first-task/SUS studies have protocols
  but no participants yet (recorded in `docs/a11y/CONFORMANCE.md`, exception E-1).

---

## 10. What XR is — and is not

**XR is:** a local-first, provider-neutral CLI agent runtime you self-host; governed by a policy
gate, approval prompts, spend ceilings and a hash-chained audit log; distributed as signed,
verified binaries and channels; extensible through skills, plugins and MCP; MIT-licensed and
readable end to end.

**XR is not:** certified by anyone; a sandbox; a hosted product; a replacement for a human
reviewing consequential actions; or finished. It is a Public Beta and says so everywhere.

---

## Review policy

This register is reviewed at every release. An entry may only be removed when the limitation is
genuinely closed **and** a test proves it. Removing an entry without evidence is itself a
false-claim defect.
