# Release-candidate engineering decisions

2026-10-26; baseline `e25afd362e80485340a322e60a97a04d41b6bd51`.

## D-001 — Preserve the architecture

Keep Bun, Tauri/React, service registry, execution envelope/runner, native file authority, policy/approval, SQLite, intelligence plane and current release tooling. Existing code is substantial and many gates already pass. No second router/engine, schema store, UI framework or publishing system. New modules only for a demonstrated gap (e.g. OpenAI Responses tool transport).

## D-002 — Record effect evidence, not optimistic summaries

Baseline unshare readonly-remount probe modifies a disposable **host** canary, a confirmed critical vulnerability. Baseline TMPDIR test failure writes to **private scratch** only, a distinct assertion mismatch. Tests must assert protected host bytes, not confuse return codes with effects. No adversarial tests against real user credentials or repository files.

## D-003 — Smallest toolchain / memory

Initial environment: Debian 13 x86_64, 1,982 MiB RAM (~1,504 MiB available), 2 CPUs, 21 GB free disk, no swap. Git 2.47.3, Python 3.13.16, Node 20.20.2/npm 10.8.2, cc 14.2, pkg-config already installed. Bun, Rust, GTK/WebKit headers, bwrap and scanners absent. Manifests pin Bun 1.4.2 (engine >=1.3), TS lock 5.9.3, Tauri 2, React 18; Rust manifest minimum 1.77 but lock dependencies may require newer stable.

Installed **only Bun 1.4.2** initially, official GitHub release binary, SHA-256 `36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913`, matched official release asset metadata; user-owned `/home/user/toolchains` + `.bun/bin`. Dependencies installed sequentially from both frozen Bun locks with scripts disabled; no browser binary. Existing util-linux setpriv/prlimit 2.41.5 can harden raw unshare without a new library. Consider bwrap as a small justified official distro package to exercise the other existing backend. Native Rust/GTK toolchain only after resource/provenance assessment; one install stage at a time, versions recorded.

Node tsc at an explicitly limited 768 MB heap OOMed (134). Do not repeat unchanged or add swap. Same typechecks passed using Bun's runtime; use that low-memory command. Segment tests with existing parity runner, one job/build at a time. No LLM weights, parallel agents, container platform or competitor installs.

## D-004 — Identity and release authorization

Authoritative manifest already distinguishes in-development 1.1.0 from public 1.0.0. Preserve publicVersion. Do not reuse/force `v1.1.0`, already marked withdrawn in source. Candidate identity proposed `1.1.1-rc.1`, stamped through existing tool, preview only. No push/tag/stable publish or credential creation for production. Gated drafts are safe preparation, not stable authorization. Historical public-channel repair requires owner GitHub/npm permissions unavailable here (GitHub connector is unsupported in this session; public HTTPS reads work).

## D-005 — Fail closed without pretending all platforms are Linux

Drop mapped-root capabilities before untrusted raw-unshare execution, no-new-privileges, verify required tools. Do not disable trust to make a command/build pass. macOS/Windows isolation remains experimental/off by default until native evidence; Linux tests cannot promote it. Explicit host-control features must remain labeled host-authority operations, not advertised as sandbox-confined.

## D-006 — Model evidence levels and privacy

Extend the existing catalog/router. Official model docs (retrieved 2026-10-26) are metadata/protocol evidence, not credentials, reachability, compatible multi-turn tools or benchmark performance. Current OpenAI Sol/Astra tool use requires Responses; Luna also permits Chat Completions tools with reasoning_effort:none. Use model-specific official contracts, not a family-wide assumption; use correct transport or refuse tool routing. Anthropic current 5.5 families introduce thinking restrictions; do not treat text-only reachability as agent validation. Cached registry offline startup, no failed refresh erasing user selections. Cross-provider failover must be explicit opt-in and re-check privacy/capabilities/accounting; disabling unaccounted hidden fallback is preferable to a privacy/spend bypass.

## D-007 — Money is an estimate, not a billing guarantee

Unknown price is unavailable, not free. Free-tier eligibility is account-dependent; local inference has zero provider token fees, not zero electricity/hardware costs. Per-request limits/retries/tokens can be bounded in XR, but USD is estimated and must be labeled accordingly. Provider-side account spending controls are separate. No fabricated benchmark dollar values.

## D-008 — Desktop/CLI share a governed engine, not accidental configuration mutation

Desktop already bundles xr-engine; keep it. Separate engine home from CLI defaults for the preview, leaving legacy shared data untouched and documenting intentional import/migration. Do not delete or silently rewrite old configuration/history or modify a user's shell on desktop install/uninstall. This is a state-location change, not a fork of authorization/accounting logic.

## D-009 — Cosmetic debt is not a security rewrite

Desktop Prettier baseline fails 375 files while ESLint/build pass. Use existing formatter for touched UI files. Record the full baseline failure and avoid a mass unrelated rewrite. A final format gate is not PASS unless executed successfully; distinguish changed-files check from full-tree check.

## D-010 — Report actual limits, disable unsafe experimental identity reuse

Linux CPU and memory controls are hard **per-process** RLIMIT_CPU / RLIMIT_AS, not a whole-job cgroup RSS ceiling; nproc counts a real UID across processes; wall-clock/PID namespace cleanup bounds the action lifetime. Scratch is bounded tmpfs, but granted workspace disk usage/file count is not quota-controlled. Stop issuing a fictitious maxFiles guarantee; explicitly requested unsupported limits fail verification. Container cancellation must remove the uniquely named container, not just kill the client. Windows experimental shared AppContainer SID/accumulated ACL implementation is unavailable until per-execution identity and ACL revocation are natively verified; do not bless it based on a Linux test. No new root/system installation performed.


## D-011 — Intersect privacy and account at every request boundary

A request preference cannot relax workspace locality; unknown/hybrid/public custom endpoints do not satisfy private/local constraints. An endpoint override must be classified by its actual destination, not its provider's marketing kind. Fallback and in-place retries require explicit fresh consent and admission, and each attempt settles under the actual target before another request. Failed settlement terminates; unknown prices stop execution. Strict pins never silently change models, including before the first request. Test fixtures must configure their own declared rates/secret resolver; production must not recognize mock identifiers.

## D-012 — Honest protocol and measurement scope

Native whole-turn buffered adapters are not token streaming; their XR capability projection must say so even when the vendor API offers SSE. Capability claims are not account reachability, live agent validation, or measured recommendation. Live compatibility probes require an explicit live flag and one exact target, shared accounting/audit, output/request/deadline bounds, and must not save a fidelity contract if transport/admission/output completion was incomplete. No automatic paid probing from startup/catalog inspection. Deterministic fixtures validate protocol behavior, not external API availability or OS confinement.

### D-012 — resource-bounded validation and telemetry are not authority

On this 2 GiB host, full unchanged-root TypeScript checking passes on Node with explicit 1024 MiB old-space/16 MiB semi-space; Bun checking timed out and is not a pass. No tsconfig scope or checks were removed. Optional UI/SLO/diagnostic callbacks are best-effort and cannot trigger a paid retry; mandatory admission, cost persistence and audit settlement remain fail-closed. Unknown provider inspection stays offline and explicitly unknown. 70aca4… identifies the verified bubblewrap **archive**, 573236e5… its extracted binary; these are not conflicting hashes of the same object.

## D-013 — One engine, explicit homes, honest presentation

Desktop child engines use an independent absolute home and a per-home hashed OS-keychain service (`XR_SECRET_NAMESPACE=desktop`), not just a new directory over globally shared macOS/Linux credential accounts. CLI's existing service remains unchanged. There is no implicit CLI-state/key import; explicit external-engine attachment deliberately shares that endpoint's authority. Legacy browser credential copies are migrated/purged in place with rotation advice, not claimed securely erased from backups. Removing a provider requires credential-backend acknowledgment before metadata success. The engine file fallback is AES-GCM sealed with a nearby key, not an OS-keychain guarantee.

Canonical offline facts and sourced pricing feed root/renderer/native guards. Native tests import the shipped pure governor without a heavyweight Tauri build; this does not validate GUI/native lifecycle. Desktop cannot re-route a pin or re-price actual attempts. Unknown/interrupted cost is unavailable. Root ledger/reservations enforce shared estimated admissions; UI history may be incomplete. Automatic cap synchronization can only tighten, while an explicit owner action can change caps. Auto preview has no provider traffic and only pins a visible, explicitly accepted target; no saved global roaming/failover opt-in is implied.

## D-014 — Independent desktop owns engine home; no silent CLI migration

Desktop starts its bundled engine against an independently validated absolute
XR_DESKTOP_HOME/default~/.xr-desktop. CLI XR_HOME behavior is unchanged. UI/native
credential migration requires acknowledged broker persistence + cleanup; legacy
OS operations are scoped get/delete, writes disabled. File fallback is sealed
but a nearby key is not protection from whole-home compromise. GUI/actual OS
keychains/native installers remain external evidence; source contracts do not
make them PASS.

## D-015 — Benchmark is governed deterministic effects, not synthetic model quality

Version15 categories;5smoke, stable IDs and real byte/exit/SQLite/audit verifiers.
Scripted adapter tokens are heuristic and dollar tariff synthetic; billing and
actual human interventions unavailable. Pin HOME before production imports;
strip ambient credentials/opt-outs. Existing bounded opt-in measurement is the
live compatibility path; manual live-task/competitor protocols are separate and
unexecuted. Standard AbortError is cancellation only with an actually aborted
caller signal; accounting/other errors are not broadly masked. Autonomous empty
replies remain failures; conversational retry remains explicit.

## D-016 — Private preparation and explicit owner publication; no tag auto-defaults

Tags may prepare verified private drafts, never automatically publish stable or
move npm/GHCR/GitHub default channels. All tag desktop candidates require real
OS signatures/notarization (missing owner prerequisites block early). Production
signature/SLSA/native CI results are required, not local fixtures. Publisher
identity/ref/commit and artifact digests are verified, installer architecture
names cannot collide, test certificates/MSIX never become production assets.
Versioned npm candidate/beta and container version staging must precede a
separate owner-controlled default promotion using the existing channel workflow.
No local signing keys or owner accounts were provisioned/handled. No publication
is authorized or performed by this agent.

## D-017 — Full verification is bounded segmented execution, not a monolith

A monolithic optional full attempt reached memory pressure and timed out; no
OOM kill was recorded. It was not called PASS or retried unchanged. The final
security gate streams diagnostics with an actually tested async process-group
watchdog and uses the existing parity authority for full scope. Blackbox and
pre-existing quarantine are separately visible. No test was removed, no new
quarantine introduced, and static layer/size predicates were not weakened to
hide failures.

## D-018 — Preserve accounting ownership through instrumentation

Telemetry decorators forward managed-attempt ownership/dynamic identity and
cannot turn completed accounting into replay. Unknown pricing is never zero;
explicit synthetic tariffs belong only to deterministic test fixtures. Shared
facts/abort contracts are L0 leaves with compatibility exports, and existing
BudgetService remains the construction facade. Consent is explicit before a
fallback; an identical target is not advertised/replayed as a fallback.

## D-019 — Platform package versions are derived encodings

Canonical1.1.1-rc.1 remains product identity; Debian control derives1.1.1~rc.1 so
it sorts before stable. No late version restamp or second authority is allowed.
Local checksums/extracted payload passes cannot be relabeled production
publisher authentication. Missing signing/provenance correctly blocks release.
