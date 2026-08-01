# XR — Known Limitations Register (updated Phase 4)

Every entry has an owner and a review date; nothing here is claimed as done.

| # | Limitation | Owner | Phase | Review |
|---|---|---|---|---|
| 1 | **macOS/Windows isolation backends not validated.** Seatbelt/Apple Containers (macOS) and container/VM (Windows) are documented gaps; the guarantee matrix reports them unavailable and high-risk actions fail closed on those hosts. No claim is made for them. | trust | 5 | 2026-12-31 |
| 2 | **Firecracker/Kata microVMs are detection hooks only.** Orchestration (rootfs images, jailer invocation, snapshot pools) is Phase 5+; when absent the policy fails closed. | trust | 5 | 2026-12-31 |
| 3 | **gVisor runs only when `runsc` + a runsc-capable container runtime are present and the operator opts in.** | trust | 5 | 2026-12-31 |
| 4 | **Provider API keys remain hydrated into `process.env`** for the provider plane (LLM calls). They are never shipped into plugin/MCP sandboxes, but process-global key handling is only fully eliminated with the Phase 10 identity work (ADR-0010). | trust | 10 | 2027-06-30 |
| 5 | **Independent pentest not yet conducted** — see PENTEST_REGISTER.md §4 for the exact engagement required. The exit gate's "0 open critical/high" currently holds for the automated self-assessment only. | trust | 7 | 2026-09-30 |
| 6 | **Keyless cosign/Rekor proof exists only after the Release workflow runs on a real tag** (OIDC requires GitHub Actions). The pipeline, local verification path and tests are complete; the public-log evidence is pending a tagged release. | release | 6 | 2026-12-31 |
| 7 | **Raw-`unshare` fallback is weaker than bubblewrap** (no pivot_root; sensitive paths hidden under tmpfs). The matrix + backend `describe()` state this; hosts without bwrap get the weaker mechanism or fail closed per policy. | trust | 5 | 2026-12-31 |
| 8 | **Multi-tenant / enterprise identity is Phase 10** (not claimed in Phase 4). | trust | 10 | — |
| 9 | **SOC 2 / ISO / HIPAA certification is Phase 10 and requires an auditor.** No such claim exists in Phase 4. | trust | 10 | — |
