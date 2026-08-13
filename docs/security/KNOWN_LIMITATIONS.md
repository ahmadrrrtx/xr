# XR — Known Limitations Register (canonical)

This is the **one canonical, living register** of what XR does not yet do —
every entry has an owner and a review date, and nothing here is claimed as
done. (Closes audit finding **A-15**: previously this and the 7.1.0 release
register were two parallel lists that could drift.)

**How the pieces relate:**

- **This register is the source of truth.** New entries, closures (with
  evidence) and re-scoping land here first.
- Per-release snapshots (e.g.
  [`docs/release/1.0.0/known-limitations.md`](../release/1.0.0/known-limitations.md))
  are **frozen excerpts** of this register taken at release-cut time; they are
  corrected in place only for false-claim defects, then refreshed from this
  register at the next release prep (RELEASING §1e; reviewed every release per
  [`docs/release/BETA.md`](../release/BETA.md)).
- Row numbers are stable: **#1–#9 keep their original Phase-4 numbering**
  (external runbooks reference them, e.g. LAUNCH_HANDOFF §6 ↔ row #6). New
  rows append from #10.

**Review policy (binding):** an entry leaves the register only when the
limitation is genuinely closed **and** a test proves it. Removing an entry
without evidence is itself a false-claim defect.

| # | Limitation | Category | Owner | Review | Detail |
|---|---|---|---|---|---|
| 1 | **macOS/Windows isolation backends not validated.** Seatbelt/Apple Containers (macOS) and container/VM (Windows) are documented gaps; the guarantee matrix reports them unavailable and high-risk actions fail closed on those hosts. No claim is made for them. | trust | trust | 2026-12-31 | guarantee matrix; release excerpt §1 |
| 2 | **Firecracker/Kata microVMs are detection hooks only.** Orchestration (rootfs images, jailer invocation, snapshot pools) is Phase 5+; when absent the policy fails closed. | trust | trust | 2026-12-31 | guarantee matrix |
| 3 | **gVisor runs only when `runsc` + a runsc-capable container runtime are present and the operator opts in.** | trust | trust | 2026-12-31 | guarantee matrix |
| 4 | **Provider API keys remain hydrated into `process.env`** for the provider plane (LLM calls). They are never shipped into plugin/MCP sandboxes, but process-global key handling is only fully eliminated with the Phase 10 identity work. | credentials | trust | 2027-06-30 | [ADR-0010](../adr/0010-credential-brokering.md) |
| 5 | **Independent pentest not yet conducted** — see [PENTEST_REGISTER.md](PENTEST_REGISTER.md) §4 for the exact engagement required. The exit gate's "0 open critical/high" currently holds for the automated self-assessment only. | verification | trust | 2026-09-30 | pentest register §4 |
| 6 | **Keyless cosign/Rekor proof exists only after the Release workflow runs on a real tag** (OIDC requires GitHub Actions). The pipeline, local verification path and tests are complete; the public-log evidence is pending a tagged release. | release | release | 2026-12-31 | [LAUNCH_HANDOFF §6](../release/LAUNCH_HANDOFF.md) |
| 7 | **Raw-`unshare` fallback is weaker than bubblewrap** (no pivot_root; sensitive paths hidden under tmpfs). The matrix + backend `describe()` state this; hosts without bwrap get the weaker mechanism or fail closed per policy. | trust | trust | 2026-12-31 | guarantee matrix |
| 8 | **Multi-tenant / enterprise identity is Phase 10** (not claimed). SAML/OIDC SSO, SCIM, HA profiles and remote/attended orchestration do not exist; dashboard auth is a local bearer token. | product | trust | — | release excerpt §7 |
| 9 | **SOC 2 / ISO / HIPAA certification is Phase 10 and requires an auditor.** No such claim exists. | verification | trust | — | release excerpt §7 |
| 10 | **Workflow engine nodes need their injected services.** Tool-action nodes require a `WorkflowToolExecutor`; `wait_timer` nodes require a `WorkflowTimerScheduler`; event-wait nodes require a subscriber. Without one the node **fails as unsupported / parks** — it never fabricates success or self-advances. | execution | runtime | — | release excerpt §4; [GETTING_STARTED](../development/GETTING_STARTED.md) limitations box (audit A-13) |
| 11 | **Provider canary COVERAGE is bounded by CI secrets.** The machinery exists (R-6, 2026-08-08): `scripts/provider-canaries.ts` + the nightly `provider-canaries` workflow live-probe every key-configured provider through its own `health()` and FAIL the job on a live probe error (401/5xx/timeout); unconfigured presets report SKIP (never a fake pass) — so continuous verification runs, but covers exactly the providers whose API-key secrets the maintainer adds to CI (zero secrets = all-SKIP green report). Note `xr doctor`'s "ready" also still means key present + endpoint answering. | verification | providers | — | [canary runbook](../../scripts/provider-canaries.ts) header; nightly workflow; tracker R-6 |
| 12 | **`.rpm` and Snap/Flatpak are not shipped** — they cannot be structurally validated and install-tested without rpm/snapcraft toolchains in CI, and "supported" means validated. | distribution | release | — | release excerpt §2; [ADR-0023](../adr/0023-one-canonical-build-many-channels.md) |
| 13 | **Channel-manager publications start with the first tagged 1.0.0 release.** Brew tap push, GHCR publish and WinGet submission are wired + structurally tested but have artifacts to publish only once a tag exists; "publication" rows in the support matrix are pending exactly that evidence. | release | release | on first tag | release excerpt §2; [SUPPORT_MATRIX](../release/SUPPORT_MATRIX.md) |
| 14 | **Linux arm64 and macOS x64 are Tier 2** — cross-compiled and signed, but CI has no native runners to smoke them (build-only, honestly recorded). Full-suite parity + golden path run natively on linux-x64, darwin-arm64, windows-x64. | platform | release | — | release excerpt §2; [SUPPORT_MATRIX](../release/SUPPORT_MATRIX.md) |
| 15 | **Hosted telemetry does not exist.** Observability is local-first (own OTLP collector, local `/metrics`, local trace viewer); no hosted XR telemetry service, no packaged SIEM connector. Phase 10; privacy defaults non-negotiable when it lands. | product | observability | — | release excerpt §7 |
| 16 | **Human-verified UX studies remain pending.** WCAG 2.2 AA is automated-verified (axe + contrast math + keyboard flows); manual screen-reader/zoom passes have recorded protocols but no human sessions yet (exception E-1); the first-task ≥95% figure is an automated proxy (20/20 fresh-machine attempts). | verification | ux | — | release excerpt §7 |
| 17 | **Pre-7.0.1 business credentials cannot be recovered** (key derived from a never-persisted salt). 7.0.1+ detects and refuses such records with a clear error; `migrateLegacyRecords(legacyKey)` upgrades them if you can supply the original key. Nothing is deleted automatically. Permanent historical record — no close-out. | credentials | trust | — | release excerpt §3; [credential-vault migration](../migration/credential-vault.md) |

*Updated 2026-08-08: A-15 dedup — register made canonical, release-scoped
excerpts declared frozen snapshots; rows #10–#17 merged in from the 7.1.0
excerpt so the living register is complete. Row #6 referenced by
LAUNCH_HANDOFF §6 is unchanged.*
