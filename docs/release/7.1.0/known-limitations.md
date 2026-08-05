# XR 7.1.0 (Truth) — Known Limitations

**Status:** current · **Generated for:** release 7.1.0 · **Last reviewed:** 2026-08-05

This register exists because XR's constitution forbids claiming what has not been verified. It is
the honest, prominent list of what is **not yet real**. Everything here is a deliberate, recorded
gap — not an oversight — and each entry says plainly what does not work and what would be required
to close it.

If you find something untrue that is *not* listed here, that is a defect: please file a
[false-claim report](https://github.com/ahmadrrrtx/xr/issues/new?template=false_claim.yml).
Beta feedback goes through [`docs/release/BETA.md`](../BETA.md).

**Changes since 7.0.1:** entries claiming "releases are not signed" and "CI is Linux-only" were
stale relative to the Phase-4 workflow and the Phase-1 cross-platform workflow and are corrected;
the dashboard-MCP entry is closed (the dashboard surfaces MCP servers); Phase-9 entries added.

---

## 1. Security posture

### XR holds no third-party certifications
XR is **not** SOC 2, ISO 27001, HIPAA, PCI-DSS or FedRAMP certified, audited, or "ready". No
external audit has been performed. (Any surface claiming otherwise is a false-claim defect.)

### Policy is not isolation everywhere
XR enforces an in-process **policy gate** (canonical path/URL resolution, deny-by-default) on
every platform, and Phase-4 added risk-tier classification with an **isolation lattice**: on Linux,
tool actions can be confined by bubblewrap namespaces; elsewhere, a restricted-process backend is
used. It is **not** VM/kernel confinement, and it degrades honestly by host
(`xr env capabilities --json` probes the real backend). Do not run XR against untrusted content
with credentials you cannot afford to lose.

*To close:* container/VM-grade placement for high-risk actions on every OS family.

### Signed releases start at v7.1.0
Tagged releases ≥ 7.1.0 ship cosign keyless signatures over `SHA256SUMS`, a CycloneDX SBOM, and
SLSA3 provenance, verifiable from the public Rekor log
([docs/release/VERIFYING_RELEASES.md](../VERIFYING_RELEASES.md)). Releases **before** 7.1.0 were
never published as verified artifacts (the GitHub release feed held only a stale v3.0.0, npm
lagged at 3.1.5 while source was 7.0.x — the exact drift this release closes).

---

## 2. Distribution & channels (Phase-9 scope, honestly bounded)

### `.rpm` and Snap/Flatpak are not shipped
They cannot be structurally validated and install-tested without rpm/snapcraft toolchains in CI,
and "supported" means validated. *To close:* an rpm builder validated by `dnf install` in CI and a
snapcraft build with a store or local-install test. When those tests exist, the channel ships.

### Channel-manager publications start with the first tagged 7.1.x release
The Homebrew tap push, GHCR publish, and WinGet community-repo submission are wired and tested
structurally, but they only have artifacts to publish **once a tag is cut**. The weekly
`channel-install.yml` job performs REAL installs (apt/brew/scoop) from the published assets and
its first-run results are recorded in `docs/release/SUPPORT_MATRIX.md`. Any row marked
"publication" is pending exactly that evidence.

### Linux arm64 and macOS x64 are Tier 2
The canonical build matrix cross-compiles them and they ship signed, but CI has no native arm/IA
runners to smoke them (build-only, honestly recorded). The full-suite parity + golden path runs
natively on Linux x64, macOS arm64, and Windows x64.

### The full-parity Windows/macOS suite is new
Phase 9 expands cross-platform CI from a curated subset to the full suite minus four documented
POSIX-only exclusions. First-run status is recorded in the support matrix; any real failure is a
bug, not a basis for claiming green.

---

## 3. Credentials (unchanged from 7.0.1)

### Pre-7.0.1 business credentials cannot be recovered
Before 7.0.1 the credential vault derived its encryption key from a random salt that was **never
persisted**, so ciphertext written by one process could not be decrypted by the next. 7.0.1+
detects these records and **refuses** them with a clear error. `migrateLegacyRecords(legacyKey)`
upgrades them **if** you can supply the original key. Nothing is deleted automatically. See
[`docs/migration/credential-vault.md`](../../migration/credential-vault.md).

---

## 4. Execution (unchanged)

### Workflow tool-action nodes require an injected executor
Tool-action nodes execute through a `WorkflowToolExecutor`; without one those nodes **fail as
unsupported** (they never fabricate success). A workflow containing tool actions needs an executor.

### Timer and event nodes need a scheduler
`wait_timer` nodes wait for real only with a `WorkflowTimerScheduler`; otherwise they park for an
external scheduler. Event-wait nodes likewise require a subscriber. Neither self-advances.

---

## 5. Platform coverage (updated)

### Removed system tools
`system_volume`, `system_battery`, `system_wifi`, `system_media`, `system_trash` and
`system_screenshot` remain **removed** (they reported `ok:true` while doing nothing).
Screenshots are available through `computer_control`.

### Platform-specific gaps in surviving tools
- `system_apps`: macOS (`osascript`) and Linux with `wmctrl`; fails honestly elsewhere.
- `system_notify`: macOS (`osascript`) and Linux (`notify-send`); fails honestly on Windows.
- Clipboard tools require `pbcopy`/`pbpaste` (macOS), `xclip` (Linux) or PowerShell (Windows).

### Cross-platform CI is full-parity (was: Linux-only)
Since Phase 1, macOS + Windows run in CI; since 7.1.0 they run **typecheck + the full unit suite
(minus four documented, reason-guarded POSIX exclusions) + the golden path** on every push/PR
(`test/platform/exclusions.json` is the only skip list, validated in CI).

---

## 6. Testing & verification (updated)

- The suite includes effect tests, adversarial corpora, black-box CLI exit-code tests, crash
  injection, art**ifact**-level E2E (`test/reliability/artifact-e2e.test.ts`), channel install
  tests, and **mutation testing on critical modules** (`bun run mutation:run`, threshold 0.6).
- **Provider canaries are still absent** (nothing continuously verifies real provider APIs).
  *To close:* read-only probe canaries per provider on a schedule.

---

## 7. Product surfaces (updated)

### The website is descriptive, not transactional
No contact form, sales pipeline or lead capture — deliberately. Contact happens through GitHub
issues (beta_feedback / false_claim templates).

### Hosted telemetry does not exist
The observability plane is local-first (own OTLP collector, local `/metrics`, local trace viewer).
No hosted XR telemetry service, no packaged SIEM connector. *To close:* Phase 10 (privacy defaults
non-negotiable when it lands — Art. XXI).

### No enterprise identity / HA / remote execution (Phase 10)
Dashboard auth is a local bearer token. SAML/OIDC SSO, SCIM provisioning, HA deployment profiles,
and remote/attended-orchestration do not exist. The beta never claims them.

### Human-verified UX studies remain pending
WCAG 2.2 AA is automated-verified (axe over all panels + contrast math + keyboard flows); the
manual screen-reader/zoom passes have recorded protocols but no human sessions yet (exception E-1
from Phase 8, still in force). The first-task ≥95% figure is an automated proxy (20/20
fresh-machine attempts).

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
