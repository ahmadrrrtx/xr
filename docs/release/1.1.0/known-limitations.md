# XR 1.1.0 — Known Limitations

**Status:** frozen release excerpt · **Generated for:** release 1.1.0 · **Last reviewed:** 2026-10-17

> **Canonical register:** [`docs/security/KNOWN_LIMITATIONS.md`](../../security/KNOWN_LIMITATIONS.md).
> This document is the **release-scoped excerpt** of that register, frozen at
> the 1.1.0 cut (stable line of the 1.x series; closes the GAP-002 npm drift
> against the 1.0.0 tag work). Post-release changes land in the canonical register
> first and flow into the next version's excerpt; this snapshot is corrected
> in place only for false-claim defects. The §-numbers below are the detail
> text the canonical register's "Detail" column points at.
>
> *Note on provenance:* the register step (RELEASING §1e) had not run when
> `v1.1.0` was tagged; this excerpt was generated retroactively on
> 2026-10-17 under fix-program Phase 1.3 so that the README's
> release-identity block links to a document that exists.

This register exists because XR's constitution forbids claiming what has not been verified. It is
the honest, prominent list of what is **not yet real**. Everything here is a deliberate, recorded
gap — not an oversight — and each entry says plainly what does not work and what would be required
to close it.

If you find something untrue that is *not* listed here, that is a defect: please file a
[false-claim report](https://github.com/ahmadrrrtx/xr/issues/new?template=false_claim.yml).
Beta feedback goes through [`docs/release/BETA.md`](../BETA.md).

**Changes since 1.0.0:** the npm `latest` dist-tag now points at 1.0.0 (GAP-002 closed for the
latest line; §7b updated from the real registry state); rows **#18** (Constitution
reconstruction), **#19** (satellites unpublished), **#20** (LOC ceiling — re-baselined to the
value `TREE_CEILING` enforces and machine-stamped) and **#21** (Windows approvals-durable probe)
added; row **#4** updated to the 2026-10-15 secret-broker status; the env-hydration and Tier-2
situations restated without change. Row numbering and meanings are stable with the canonical
register (#1–#21).

---

## 1. Security posture

### XR holds no third-party certifications
XR is **not** SOC 2, ISO 27001, HIPAA, PCI-DSS or FedRAMP certified, audited, or "ready". No
external audit has been performed; the independent pentest engagement (canonical row #5,
[PENTEST_REGISTER.md](../../security/PENTEST_REGISTER.md) §4) is still open. (Any surface
claiming otherwise is a false-claim defect.)

### Policy is not isolation everywhere
XR enforces an in-process **policy gate** (canonical path/URL resolution, deny-by-default) on
every platform, plus a risk-tier isolation lattice: on Linux, tool actions can be confined by
bubblewrap namespaces; `gVisor` runs only with `runsc` + a runsc-capable container runtime and
operator opt-in (row #3); the raw-`unshare` fallback now pivot_roots into a minimal root and
refuses if any mount step fails, but has no seccomp filter (row #7, XR-LAUNCH-004); on macOS and
Windows, agent shell commands need Docker/Podman or the **experimental, opt-in** Seatbelt /
AppContainer sandbox (`XR_OS_SANDBOX=experimental`, not hardware-verified) and are otherwise
**refused** (row #1, XR-LAUNCH-003); Windows ARM64 file tools fail closed on the CLI's Bun
(XR-LAUNCH-005); Firecracker/Kata microVMs are detection
hooks only (row #2). It is **not** VM/kernel confinement, and it degrades honestly by host
(`xr env capabilities --json` probes the real backend). Do not run XR against untrusted content
with credentials you cannot afford to lose.

*To close:* container/VM-grade placement for high-risk actions on every OS family.

### Signed releases are pipeline-complete; public-log proof lands per tagged release
Tagged releases ship cosign keyless signatures over `SHA256SUMS`, a CycloneDX SBOM, and SLSA3
provenance, verifiable from the public Rekor log
([docs/release/VERIFYING_RELEASES.md](../VERIFYING_RELEASES.md)). Row #6 stands unchanged:
keyless cosign/Rekor proof exists **only after the Release workflow runs on a real tag** (the
OIDC identity requires GitHub Actions); the pipeline, local verification path and tests are
complete, and `v1.0.0` + `v1.1.0` now exist as real tags. The pre-rebaseline 7.x history was
never published as verified artifacts.

---

## 2. Distribution & channels (honestly bounded)

### `.rpm` and Snap/Flatpak are not shipped
They cannot be structurally validated and install-tested without rpm/snapcraft toolchains in CI,
and "supported" means validated (row #12; [ADR-0023](../../adr/0023-one-canonical-build-many-channels.md)).
*To close:* an rpm builder validated by `dnf install` in CI and a snapcraft build with a store or
local-install test. When those tests exist, the channel ships.

### Channel-manager publications hang off tagged releases
Row #13 restated: the Homebrew tap push, GHCR publish, and WinGet community-repo submission are
wired and tested structurally; publication evidence attaches to tagged releases (1.0.0 first, now
1.1.0). The weekly `channel-install.yml` job performs REAL installs (apt/brew/scoop) from the
published assets and its results are recorded in
[`docs/release/SUPPORT_MATRIX.md`](../SUPPORT_MATRIX.md). Any row marked "publication" is pending
exactly that evidence.

### Linux arm64 and macOS x64 are Tier 2
Row #14 unchanged: the canonical build matrix cross-compiles them and they ship signed, but CI
has no native arm/IA runners to smoke them (build-only, honestly recorded). The full-suite parity
+ golden path runs natively on Linux x64, macOS arm64, and Windows x64
([`docs/release/SUPPORT_MATRIX.md`](../SUPPORT_MATRIX.md)).

### Satellite packages are not published yet
Row #19 (new since 1.0.0): `@rrrtx/xr-enterprise` and `@rrrtx/business-os` exist as complete,
tested packages under `satellites/` with their own manifests, but no npm publish or standalone
repo push has happened. Until then the install lines in the relocation notices and migration
guide describe the intended state, not a fetchable package
([ADR-0028](../../adr/0028-satellite-extraction.md)).

---

## 3. Credentials

### Provider API keys remain hydrated into `process.env` (with the broker now in between)
Row #4, status as of 2026-10-15: every native adapter (anthropic, mistral, google, cohere,
cerebras, bedrock) and `openai-compat` already routes through `secretBrokerSync()` — none read
`process.env[API_KEY]` directly. The remaining work is deprecating the
`XR_SECRETS_ENV_COMPAT` flag itself: v1.x emits a loud boot warning when the flag is on and a
`secret.read` audit event on every key access; v2.0 removes the flag (one-line change at the
`hydrateProviderEnv` seam). Keys are never shipped into plugin/MCP sandboxes
([ADR-0010](../../adr/0010-credential-brokering.md)).

### Pre-7.0.1 business credentials cannot be recovered
Row #17 unchanged: before 7.0.1 the credential vault derived its encryption key from a random
salt that was **never persisted**. 7.0.1+ detects these records and **refuses** them with a
clear error. `migrateLegacyRecords(legacyKey)` upgrades them **if** you can supply the original
key. Nothing is deleted automatically. Permanent historical record — no close-out. See
[`docs/migration/credential-vault.md`](../../migration/credential-vault.md).

---

## 4. Execution (unchanged)

Row #10 unchanged: tool-action nodes execute through a `WorkflowToolExecutor`; without one those
nodes **fail as unsupported** (they never fabricate success). `wait_timer` nodes wait for real
only with a `WorkflowTimerScheduler`; otherwise they park for an external scheduler. Event-wait
nodes likewise require a subscriber. Neither self-advances (see also the limitations box in
[`docs/development/GETTING_STARTED.md`](../../development/GETTING_STARTED.md)).

---

## 5. Platform coverage (unchanged)

`system_volume`, `system_battery`, `system_wifi`, `system_media`, `system_trash` and
`system_screenshot` remain **removed** (they reported `ok:true` while doing nothing); screenshots
go through `computer_control`. `system_apps` requires macOS (`osascript`) or Linux with `wmctrl`;
`system_notify` requires macOS or Linux (`notify-send`); clipboard tools require
`pbcopy`/`pbpaste` (macOS), `xclip` (Linux) or PowerShell on Windows — each fails honestly
elsewhere.

macOS + Windows run **typecheck + the full unit suite (minus documented, reason-guarded
exclusions) + the golden path** on every push/PR; `test/platform/exclusions.json` is the only
skip list, validated in CI.

---

## 6. Testing & verification

- The suite includes effect tests, adversarial corpora, black-box CLI exit-code tests, crash
  injection, artifact-level E2E (`test/reliability/artifact-e2e.test.ts`), channel install
  tests, and **mutation testing on critical modules** (`bun run mutation:run`, threshold 0.6).
- **Provider canaries exist** (`.github/workflows/provider-canaries.yml`,
  `scripts/provider-canaries.ts`) and fail closed: a sweep of zero configured providers exits 2
  unless `XR_CANARY_ALLOW_EMPTY=1` (deliberate, audited skip via repo variable). Unconfigured
  presets are SKIP, never a fake pass; a configured preset whose live `health()` fails is a red
  job (row #11 — coverage equals the secrets provisioned; `xr doctor`'s "ready" still means key
  present + endpoint answering).
- **Windows CI, `test/phase2/approvals-durable.test.ts` runs a staged diagnostic probe instead of
  the real suite — the Windows hang is still unrooted** (row #21, new since 1.0.0). On Windows
  runners this file dies at the segment cap with zero output and zero test failures (exit 124,
  2026-09-07, runs 34152171256 / 34156612385). Child-stdout watchdogs, `skipIf(win32)` on the
  spawn describes and `dispose()` were each tried and left the identical signature; comparison
  with files that pass the same lane rules out Store/bun:sqlite open handles and line endings.
  The file now runs staged probes on win32 only (D1 bare → D2 Store open/audit/close → D3 module
  load → D5 bare timer → D4 full request/TTL flow), each writing on-disk `xr-dbg-*.txt` markers
  that survive the kill; the "Hang diagnostics (win32)" step in `cross-platform.yml` dumps them
  on failure — the stage with START but no END names the culprit. The full real suite runs on
  the Linux reference lane and macOS (both green). Remove the probe branch + workflow step when
  the Windows lane passes
  ([test file](../../../test/phase2/approvals-durable.test.ts)).

---

## 7. Product surfaces

### The website is descriptive, not transactional
No contact form, sales pipeline or lead capture — deliberately. Contact happens through GitHub
issues (feedback / false_claim templates).

### Hosted telemetry does not exist
Row #15 unchanged: the observability plane is local-first (own OTLP collector, local `/metrics`,
local trace viewer); no hosted XR telemetry service, no packaged SIEM connector. *To close:*
Phase 10 (privacy defaults non-negotiable when it lands — Art. XXI).

### No enterprise identity / HA / remote execution (Phase 10)
Row #8 unchanged: dashboard auth is a local bearer token. SAML/OIDC SSO, SCIM provisioning, HA
deployment profiles, and remote/attended-orchestration do not exist. The beta never claims them.

### Human-verified UX studies remain pending
Row #16 unchanged: WCAG 2.2 AA is automated-verified (axe over all panels + contrast math +
keyboard flows); the manual screen-reader/zoom passes have recorded protocols but no human
sessions yet (exception E-1). The first-task ≥95% figure is an automated proxy (20/20
fresh-machine attempts).

### The LOC ceiling is re-baselined and machine-stamped
Row #20 (new since 1.0.0): **the <!-- XR:TREE-CEILING -->175,000<!-- /XR:TREE-CEILING -->-LOC
tree ceiling is a no-regrowth guard, not the plan's ≤110k target.**
History: Phase 5 measured 154,426 → 131,050 LOC and set the gate at 135,000; Phase 7 raised it once, deliberately, to 136,000 for the memory policy layer; later phases raised it again — each time in a diff, with the reason beside `TREE_CEILING` in `scripts/size-gate.ts` — and the excerpt row, previously published at the Phase-5 value, went stale behind those raises. <!-- xr:numeric-history -->
The present-tense figure is now stamped from the single
source (`bun run size-gate --stamp-docs`) and lint-checked. Reaching 110k would require
extracting `src/research` + `src/repo` (vetoed as live capability) or cutting genuine runtime;
110k remains a direction of travel, not a passing grade anyone can currently award
([loc-census](../../historical/phase-5/loc-census.md)).

### `docs/CONSTITUTION.md` is a reconstruction, honestly labeled
Row #18 (new since 1.0.0): the 30 Articles are cited ~300 times across the codebase and enforced
by real gates, but the original prose was never committed; the published document was rebuilt
from those citations — **[V]** clauses are verbatim quotes, **[R]** clauses reconstructions, and
Articles **XIII, XVII, XXV, XXVI** are recorded as *unattested* rather than invented. `claim-lint`
enforces Article-level citations only
([CONSTITUTION.md](../../CONSTITUTION.md) preamble).

---

## 7b. Distribution: npm `latest` caught up at 1.0.0; 1.1.0 publication is next

**GAP-002 status (measured 2026-10-17 against the live registry).** The 1.0.0 excerpt recorded
npm `latest` = **3.1.5** with no v1.x tag or release. Both halves have since closed for the 1.0.0
line: `v1.0.0-beta.1`, `v1.0.0` **and `v1.1.0` are real remote tags**, `latest` now resolves to
**1.0.0**, and `beta` resolves to **1.0.0-beta.1** (published versions as of access date: 0.2.0,
1.0.0-beta.1, 1.0.0, 3.0.0–3.0.3, 3.1.5 — `npm view @rrrtx/xr`).

What is still pending, stated plainly: **1.1.0 is tagged but not yet published to npm** (the
registry lists no `1.1.0`). Install-from-npm users get the 1.0.0 build; the 1.1.0 capability
claims on these pages are verifiable for source/binary installs and for npm once the 1.1.0
publish step of `release.yml` runs and the `latest` dist-tag moves.

*To close (operator steps, per the runbook):* cut the 1.1.0 publish through `release.yml`, then
re-point `latest` (`npm dist-tag add @rrrtx/xr@1.1.0 latest`; print-only preview via
`bun run scripts/tag-npm-invariant.ts --repair`). The 1.x tag ⇔ npm invariant
(`scripts/tag-npm-invariant.ts`, supply-chain job) binds `v1.*` git tags to published `1.*`
npm versions. Historical `v3`/`v4`/`v7` tags stay out of band
([`docs/HISTORY.md`](../../HISTORY.md)).

---

## 8. What XR is — and is not

**XR is:** a local-first, provider-neutral CLI agent runtime you self-host; governed by a policy
gate, approval prompts, spend ceilings and a hash-chained audit log; extensible through skills,
plugins and MCP; MIT-licensed and readable end to end; distributed as signed, verifiable releases
through the channels in the support matrix; honestly labeled **Public Beta**.

**XR is not:** certified by anyone; a VM sandbox; a hosted product; a replacement for a human
reviewing consequential actions; enterprise-HA/SSO/remote; or finished.

---

## Review policy

This register is reviewed at every release. An entry may only be removed when the limitation is
genuinely closed **and** a test proves it. Removing an entry without evidence is itself a
false-claim defect.
