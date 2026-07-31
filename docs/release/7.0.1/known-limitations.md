# XR 7.0.1 (Truth) — Known Limitations

**Status:** current · **Generated for:** release 7.0.1 · **Last reviewed:** 2026-07-31

This register exists because XR's constitution forbids claiming what has not been verified. It is
the honest, prominent list of what is **not yet real**. Everything here is a deliberate, recorded
gap — not an oversight — and each entry says plainly what does not work and what would be required
to close it.

If you find something untrue that is *not* listed here, that is a defect: please file a
[false-claim report](https://github.com/ahmadrrrtx/xr/issues/new?template=false_claim.yml).

---

## 1. Security posture

### XR holds no third-party certifications
XR is **not** SOC 2, ISO 27001, HIPAA, PCI-DSS or FedRAMP certified, audited, or "ready". No
external audit has been performed. Earlier releases of the website advertised several of these;
those claims were fabricated and have been removed in 7.0.1.

### Policy is not isolation
XR enforces an **in-process policy gate** (`src/security/guard.ts`): it canonicalises paths and URLs
and denies dangerous actions before a tool runs. This is a meaningful guard rail, and it works even
when the model is manipulated — but it is **not** kernel isolation, VM isolation, or a syscall
sandbox. A sufficiently novel in-process bypass is possible. Do not run XR against untrusted content
with credentials you cannot afford to lose.

*To close:* process/VM-level isolation with syscall filtering. Planned for a later phase.

### Plugin sandboxing is permission-scoped, not confined
Plugins declare permissions and run through a host with capability gating. They are **not** confined
by an OS-level sandbox. A malicious plugin you install and enable can do what its granted
permissions allow.

### Releases are not signed
Artifacts are **not** signed, and there is no SBOM or SLSA provenance. Do not treat a downloaded
artifact as tamper-evident. XR's release identity is unified and signing-ready, but signing is not
implemented — and until it is, XR does not claim it.

---

## 2. Credentials

### Pre-7.0.1 business credentials cannot be recovered
Before 7.0.1 the credential vault derived its encryption key from a random salt that was **never
persisted**, so ciphertext written by one process could not be decrypted by the next. Any business
credential stored before 7.0.1 is unrecoverable unless you separately captured the derived key.

7.0.1 detects these records and **refuses** them with a clear error rather than silently
mis-decrypting. `migrateLegacyRecords(legacyKey)` will upgrade them **if** you can supply the
original key. Otherwise, re-enter the credential. Nothing is deleted automatically.

See [`docs/migration/credential-vault.md`](../../migration/credential-vault.md).

---

## 3. Execution

### Workflow tool-action nodes require an injected executor
Tool-action nodes execute through a `WorkflowToolExecutor` supplied to the engine. When no executor
is wired, those nodes **fail as unsupported**. They used to report `succeeded` without running
anything; failing is now the correct behaviour, but it does mean a workflow containing tool actions
needs an executor to be useful.

### Timer and event nodes need a scheduler
`wait_timer` nodes wait for real only when a `WorkflowTimerScheduler` is provided. Without one they
**park in a waiting state** for an external scheduler to advance. Event-wait nodes likewise require
a subscriber. Neither fabricates completion any more, but neither self-advances.

### The interactive surfaces share extensibility, not the full execution envelope
Shell, Telegram and Voice now reach installed plugins, MCP servers and skill context through a
shared bridge, so their tool-set matches the one-shot CLI. They still construct their own provider
and agent invocation rather than routing through one unified execution envelope. Unification is
deliberately deferred; this release only closes the extensibility gap.

---

## 4. Platform coverage

### Removed system tools
`system_volume`, `system_battery`, `system_wifi`, `system_media`, `system_trash` and
`system_screenshot` have been **removed**. They never performed an action, and three of them
reported `ok: true` while doing nothing. Volume, battery, Wi-Fi, media and trash control are simply
not available. Screenshots are available through `computer_control`.

### Platform-specific gaps in surviving tools
- `system_apps` works on macOS (`osascript`) and Linux with `wmctrl` installed; it fails honestly
  elsewhere.
- `system_notify` works on macOS (`osascript`) and Linux (`notify-send`); it fails honestly on
  Windows.
- Clipboard tools require `pbcopy`/`pbpaste` (macOS), `xclip` (Linux) or PowerShell (Windows).

### CI is Linux-only
The pipeline runs on `ubuntu-latest`. macOS and Windows are supported on a best-effort basis and are
**not** verified by CI. Cross-platform CI is a later phase.

---

## 5. Testing and verification

### Tests are mostly in-process
The suite is large and now includes effect tests, an adversarial policy corpus and black-box CLI
exit-code tests. It does **not** yet include a hermetic end-to-end suite that installs XR from a
published artifact and drives it as a black box, nor mutation testing on critical modules.

### No provider canaries
Nothing continuously verifies that real provider APIs still behave as XR expects. A breaking change
by a provider would be discovered by users first.

---

## 6. Product surfaces

### The dashboard does not surface MCP servers
MCP servers are managed from the CLI. The dashboard does not list or control them.

### The website is descriptive, not transactional
There is no contact form, no sales pipeline and no lead capture — deliberately, because a form that
discards your message is worse than no form. All contact happens through GitHub issues.

### Docker path is verified only for binding and unattended install
The daemon binds correctly inside a container and the installer is proven non-interactive-safe.
A full published-image smoke test in CI does not exist yet.

---

## 7. What XR is — and is not

**XR is:** a local-first, provider-neutral CLI agent runtime you self-host; governed by a policy
gate, approval prompts, spend ceilings and a hash-chained audit log; extensible through skills,
plugins and MCP; MIT-licensed and readable end to end.

**XR is not:** certified by anyone; a sandbox; a hosted product; a replacement for a human reviewing
consequential actions; or finished.

---

## Review policy

This register is reviewed at every release. An entry may only be removed when the limitation is
genuinely closed **and** a test proves it. Removing an entry without evidence is itself a
false-claim defect.
