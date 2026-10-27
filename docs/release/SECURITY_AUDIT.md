# Release-candidate security audit

Date: 2026-10-26. Baseline `e25afd362e80485340a322e60a97a04d41b6bd51`. Read alongside [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) and the [implementation register](IMPLEMENTATION_PLAN.md). **No certification or exhaustive absence-of-vulnerabilities claim.** Tests and source inspection are separate evidence classes.

## Confirmed findings at baseline

| ID | Classification / severity | Demonstrated evidence | Impact / correction |
|---|---|---|---|
| RC-SEC-001 | **Confirmed vulnerability, critical** | `runtime/trust/environment/namespace.ts:buildUnshare/unshareRootScript` leaves mapped-root capabilities after pivot. `evidence/rc-2026-10-26/baseline-sandbox-effect-probe.log`: readonly grant remounted rw; host canary changes `ORIGINAL` → `CHANGED`. Only disposable fixtures used. | Model-generated command can write a host path granted read-only. Drop capabilities and prevent privilege reacquisition before exec; detect/control availability must fail closed; real-byte regression on every available Linux backend. |
| RC-SEC-002 | Confirmed enforcement defect, high | `namespace.ts:limitScript`: `ulimit ... || true`; `/bin/sh` on this host is dash, no `ulimit -u`; resource guarantee advertises CPU/memory/process-tree enforcement. | Limits can fail silently. Use compatible OS resource controls, reject invalid bounds, refuse setup on control failure; test actual exhaustion/cancellation without large allocations/fork bombs. |
| RC-SEC-003 | Confirmed unsafe alternate credential path, high | `providers/native/anthropic.ts:chat` catches errors and calls `chatOpenAICompat` with `ANTHROPIC_BASE_URL`, raw vendor key, no request guard or endpoint validation. | A vendor failure can send prompts/key to another endpoint automatically and hang indefinitely. Remove this implicit fallback; custom endpoints must be configured/selected through the existing guarded registry. |
| RC-SEC-004 | Confirmed policy gap, high | `intelligence/routing-service.ts:wrapFallbackLegacy` ignores `allowFallback`; `providers/fallback-chain.ts` appends configured targets before locality checks and defaults fallback on; wrapper changes capabilities/usage identity. | Cross-provider egress without explicit per-provider consent; advertised constraints may not apply on legacy/exhaustion paths. One shared per-hop policy; default-deny cross-provider switching; no capability downgrade; accounting-aware admission. |
| RC-SEC-005 | Confirmed accounting defects, high | `core/agent.ts` empty-turn retry overwrites first usage before any recording; `cost/pricing.ts` assumes unknown/free cloud prices and broad regex matches `gpt-4o-mini` as `gpt-4o`; `ChatOptions` lacks output ceiling. | Under/over-reporting and retry budget bypass; estimated monetary caps cannot be called guaranteed dollar ceilings. Account every request including failed/empty turns; bounded request count; missing hosted pricing must not imply free; provider output controls. |
| RC-SEC-006 | Confirmed dependency finding, high | `bun audit` via `scripts/audit-deps.sh` fails; Zod 3.25.76, GHSA-mrhx-c7xc-m3w5, patched release reported as 4.6.6. `baseline-dependency-audit.log`; [GitHub advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). | Unbounded validation issue accumulation / availability. Minimal justified patched major migration, actual v4 imports (not vulnerable v3 compatibility code), regression tests and lockfile audit. |
| RC-SEC-007 | Confirmed release-integrity defect, high | `desktop-signing-plan.ts:signingPlan` allows tag builds with no OS signing material; `desktop-app.yml` attaches files in bundle job, before journey/latest verification; `release.yml` restamps tag after binaries built. | Public artifacts can be incomplete/unsigned or contain a version not matching their tag. Gate tag identity before builds, require stable OS signatures, publish drafts only after security/journey/integrity gates. |

### A failed test is not automatically a vulnerability

Baseline `namespace-confinement.test.ts` fails the TMPDIR "write denied" assertion. Effect probe confirms the command created a **private scratch copy** while the real sibling stayed `SIBLING`. This is a test/spec mismatch, **not that host write**. Keep host-byte assertions and distinguish private scratch from forbidden host writes. RC-SEC-001 is a separate, successfully reproduced host mutation; do not conflate the two.

## Threat/control/test map

This supplements the existing `docs/security/THREAT_MODEL.md` without replacing its trust architecture. "Existing" means source/test present; only executed results in evidence are PASS.

| Threat / asset | Enforcing component | Tests / next verification | Residual boundary |
|---|---|---|---|
| Malicious workspace, injected repository instructions, external output | Context channel/ACL pipeline, `frameToolOutput`, capability grant + explicit approvals | Context/poisoning, policy adversarial, capability suites; denial no-effect benchmark | Model compliance/delimiters alone are not a security boundary. |
| Malicious shell command / nested interpreter / remount | Trust service, namespace backend, dropped capabilities, no-new-privileges, policy consent | RC-SEC-001 fixtures, canonical shell isolation; nested `sh -c` probe | Kernel bugs outside scope; host-control tools intentionally require separate elevated consent and are not workspace-confined shells. |
| Traversal, symlink/hardlink/race escape, unauthorized file IO | `FilesystemAuthority` and native descriptor-relative APIs; prepared mutation identity revalidation | `test/security` native authority tests; real no-effect benchmark; sandbox symlink tests | Different platform implementations need native OS execution, not Linux inference. |
| Process/privilege escalation; resource exhaustion, orphan tree | Linux user/mount/PID/network namespaces; process-group cleanup; resource limits | Process tests; bounded output, timeout, child marker, remount probes | No large fork bomb/model inference in 2 GB box. Cancellation gap for in-flight isolated runner currently documented. |
| Host credentials/env leakage to children | Secret broker; explicit trust env; grant-scoped injected credentials | Secret backend/broker/credential tests; ambient env canary; no error-body logging | Same-user compromise defeats colocated local fallback encryption key. |
| MCP/plugin code | Signed permission grants, worker/VM membrane, effective-risk placement, isolated stdio | Plugin/trust/capability suites, stdio policy tests | Worker/VM is not OS isolation. Low-risk stdio runs with policy/environment restrictions, not a claimed kernel boundary; audit before expanding guarantees. |
| Untrusted provider JSON/tool arguments, oversized responses | Adapter parse guards, typed policy/tool arguments, request deadlines, payload limits | Malformed/auth/rate-limit/timeout/stream tests; real HTTP fixture multi-turn contract | Mock transport success does not prove vendor/account availability. |
| IPC/local API/browser abuse | Loopback daemon, random bearer, host/origin checks, bounded bodies; Tauri per-window ACL/CSP | Daemon API/session/CSRF and desktop IPC ACL tests | Native GUI threat surface still requires OS journey and security review; optional LAN explicitly separate. |
| Unauthorized spending / retry or fallback multiplication | Governor/reservations/partitions; per-request accounting and consented provider selection | Budget, partition, empty retry, missing price, failover consent regressions | USD estimates cannot enforce provider billing; provider-side account limits remain necessary. |
| Audit corruption, failed persistence, redaction | Store write gate, hash chain, redaction, signed anchor support, startup verification | Chain/tamper/restart and persistence-error tests; benchmark reopen+verify | Locally rewritten entire history needs independently retained anchor to detect. Hash chain is tamper-evident, not tamper-proof. |
| Substituted installer/update metadata | Signed SHA256SUMS/provenance; Tauri signed updater payload verification; tag/channel checks | Artifact mutation and updater signature negatives; native OS signature checks | Updater disabled until real public key/feed and full update cycle are verified. Checksums without trusted signature do not authenticate publisher. |
| Unsafe defaults; install/upgrade/uninstall/rollback data loss | Hardened trust defaults, separate product homes, bounded installers, channel metadata | CLI journey, desktop journey matrices, user-data preservation fixtures | Installer creation is not installation success; preserve unknown prior data; no unverified downgrade migration. |

## Baseline controls actually observed

Security/trust/capability lane: 615 pass, 16 skip, 1 fail (six-second Linux execution; see log). Direct file authority tests and fail-closed-without-runner tests execute. Real unshare confinement is available in this sandbox. Bubblewrap is initially absent. macOS/Windows experimental isolation is off by default and cannot be called validated here.

## Release disposition

At baseline: **NOT READY** (critical RC-SEC-001 and high findings above). After changes, re-run tests and a fresh path review; close items only against recorded acceptance criteria. Owner credentials, vendor live tests and non-Linux platforms must stay BLOCKED/NOT RUN, never converted to PASS because a workflow was written.

## Phase 4 follow-up controls and limits

* RC-208: inspected credential copying into onboarding/generic settings and ignored save/deletion failures. New saves use engine broker acknowledgment only; in-place native/browser cleanup fails closed on unavailable storage, get/set/save failure or retained-copy readback. No plaintext fallback or backup-erasure promise. File fallback was source-verified as AES-GCM with an adjacent local key, not plaintext and not equivalent to OS keychain protection.
* RC-209: confirmed unscoped native keychain IPC accepts arbitrary OS service/account strings (source evidence; no live OS credential access attempted). Recovery/deletion now call a shipped pure scope validator permitting only known historical XR desktop provider accounts, not foreign services or CLI environment-name accounts. Legacy writes return an explicit disabled error; new keys require engine broker. Scope validator 2 tests PASS on Linux; full Tauri/keyring integration remains BLOCKED by GTK/WebKit.
* Strict OS broker deletion refuses backend unavailability/refusal or a retained value; index/memo remain available for recovery. Both UI removal paths await owning backend acknowledgment. Environment, other installations, backups and vendor-side revocation remain owner responsibilities. Separate OS-service namespaces prevent new desktop/CLI credential collisions; actual macOS/Linux OS-store isolation is NOT RUN.
* ProviderService no longer catches a registered Intelligence authority's policy/initialization error and silently asks the classic router. Three executed refusal/initialization tests cover both gateway flag values; this is not a live routing/quality claim.
* Root budget defaults/partial writes/tighten-only/daily-null updates and redacted audit intent run through the actual authenticated route/schema/SQLite path in isolated homes. Concurrent in-process stale cap submissions cannot raise caps because they serialize inside the store transaction; cross-storage config/SQLite atomicity is not claimed. Interrupted SSE cost is unavailable; all dollar limits are estimated admissions, not guaranteed provider bills.

## Final-tree re-audit and disposition — 2026-10-27

**Local implementation verified; public release NOT READY.** Baseline findings
above are historical evidence, not assertions that the fixed remount/fallback/
unknown-free-price paths remain unchanged. Current checks are bound to exact
commands/outputs in the candidate report.

* Critical remount/confined-file controls: real unshare+bwrap tests deny
  read-only remount and inherited writable submount mutation, leave host canaries
  unchanged and permit the granted workspace write. Invalid/unsupported limits,
  no required sandbox, cancellation and denied grants execute no marker. There
  are no aggregate cgroup quota/file-count-enforcement claims.
* Real public CLI adversarial tests now reach the model/tool path using explicit
  synthetic tariffs, then assert no symlink/hardlink/traversal/secret/context/
  search disclosure or outside write. Positive read/write controls prevent a
  no-op/budget short-circuit from masquerading as confinement. Typed policy
  throw/denial, durable approval, reservations and checkpoint recovery remain
  exercised. Scripted tariffs are test inputs, not production free-price defaults.
* Shared transport bounds/cancellation, native multi-turn IDs/continuation,
  source/error/consent/privacy barriers and actually aborted TCP SSE settle
  usage honestly. The final full suite exposed and fixed decorator double
  admission/settlement and lost executing identity; unavailable telemetry is
  not an authority failure or a retry cause. Known structured transport errors
  are distinct from unknown/auth/accounting/cancel failures.
* Root and desktop locks use patched Zod4.6.6; strict scanner parsing refuses
  malformed/unavailable outputs. Current production audit is executed, not
  inferred from a lockfile edit. Heavy OSV/gitleaks/container/production OIDC
  checks remain owned by the existing CI and are not claimed locally executed.
* Desktop generic persistence rejects secret keys/nested credential fields;
  cleanup/removal waits for backend acknowledgment and preserves recovery state
  on failure. Legacy native reads/deletes cannot name foreign services or CLI
  environment-key accounts; writes are disabled. Pure scope/crypto tests do not
  validate actual platform stores. Environment/backups/vendor revocation and
  complete same-user/home compromise remain outside a deletion guarantee.
* Tag candidates cannot quietly ship unsigned macOS/Windows installers. Raw
  signing values are tag-only, not PR env inputs; actual reviewer/ref rules are
  owner configuration, not presumed from YAML. Private preparation, immutable
  published-release guard, exact identity/provenance and signed channel-byte
  checks are implemented and negatively tested; no live account mutation ran.

Remaining external assurance: native GUI/IPC/OS stores/install/upgrade/update,
trusted production signatures/provenance, account/registry settings and optional
live model compatibility/quality. Remaining design limits: estimated billing
rather than invoice cap, adjacent sealed-file key, config/multi-store atomicity,
per-process rather than aggregate limits, historical default release repair.
None is converted to PASS by source inspection or a mock. See the current
[report](RELEASE_CANDIDATE_REPORT.md) and [owner commands](VERIFICATION_COMMANDS.md).
