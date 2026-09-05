# XR 4.2 — Phase 3 Validation Report (Trust and Isolation)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## 1. Environment

- Repo: `github.com/ahmadrrrtx/xr`, branch `main` → work on `phase3/trust-and-isolation`
- Baseline commit (verified): `d80e6a4d596f7fb1604d4690b5b6561a84345596`
  ("Merge pull request #9 … phase2/unified-execution-fabric")
- Version after changes: `@rrrtx/xr@4.2.0` ("Trust and Isolation"), confirmed in
  sync across `package.json`, `src/core/version.ts`, `website/src/lib/site.ts`
  by `bun run set-version:check`.
- Host: Linux x86_64, Debian-family kernel 6.1, **non-root (uid 1000)**
- Runtime: Bun 1.3.14 (matches `packageManager`/`.bun-version`)
- Isolation tooling: bubblewrap 0.11.0 (installed for validation); raw
  `unshare -Urmnp` user namespaces available (`max_user_namespaces=7917`);
  Docker/Podman **not present**.

## 2. Commands executed

```
git clone https://github.com/ahmadrrrtx/xr.git && git rev-parse HEAD   # d80e6a4
bun install --frozen-lockfile                                          # 8 packages, exit 0
bun run typecheck                                                      # tsc --noEmit, exit 0
bun test                                                               # see counts
bun run ci                                                             # typecheck+test+set-version:check+baseline:inventory, exit 0
bun run scripts/measure-trust-perf.ts                                  # per-tier latency
bun run src/index.ts trust                                             # real kernel boot: backend list
bun run src/index.ts trust classify "<cmd>" --json                      # real classification
```

## 3. Prior-phase validation (Stage A) — GREEN

Frozen install OK; typecheck clean; baseline suite **577 pass / 0 fail**
(2552 assertions, 51 files); version sync + baseline inventory OK.

## 4. Phase 3 results — GREEN (additive)

- Full suite after Phase 3: **683 pass / 0 fail** (2858 assertions, 66 files).
  - **+106 new Phase-3 tests, 0 regressions** to the 577 baseline tests.
- Typecheck clean; `bun run ci` exit 0; version sync confirmed at 4.2.0.

### Test inventory (new, all passing)

- `classify` — deterministic classification; no model downgrade; conservative
  escalation; sensitive blocked paths; per-tier resource limits.
- `policy` — fail-closed placement; Tier-2 never admitted in-process; root
  refusal; explicit Tier-1 fallback; container preference.
- `authority` — bounded/TTL grants; stale/expired/revoked rejection; execution-
  and workspace-binding; `revokeWorkspace`; prune.
- `credentials` — reference-only; names-only scope; transient injection; revoke;
  redaction (registered + generic shapes); `assertClean`.
- `verify` — placement match; Tier-2 guarantee requirements; cwd containment;
  blocked-path detection; allowlist not enforceable; credential satisfaction.
- `namespace` — **real kernel boundary**: fs confined (host secret absent,
  workspace persists); network blocked (no routes, DNS fails); ambient env not
  inherited; output bounded; credentials injected+revoked; Tier-2 allowlist refused.
- `execution-integration` — end-to-end through the fabric: unchanged-without-trust;
  Tier-0 fast path; Tier-2 verified isolated shell; blocked-without-executable;
  credential redaction+revocation; blocked-without-backend.
- `shell-tool` — shell uses the isolated runner with a Tier-2 request; fails
  closed; approval precedes the runner; legacy fallback when unwired.
- `tool-risk` — `requiresHostAuthority` refinement; per-tool declarations
  (read_file→T0, write_file→T1, fetch_url→T1+allowlist, git_status→T0,
  git_commit→T1); tools execute through the gate non-blocking.
- `adapters-risk` — MCP tool→T1 / resource→T0; control safe→T0 / sensitive→T1 /
  destructive→T2 (host authority, admitted not blocked); plugin/skill→T1.
- `ux` — daemon `/api/trust` + `/api/trust/classify` (auth-gated, secret-free);
  `xr trust` CLI (status / classify / --json).
- `persistence` — trust block (tier, decision, verification, cleanup) round-trips
  through the repository; host secret never persisted.
- `migration-rollback` — 4.1-shaped records (no trust) still load; the Tier-1
  fallback flag can never enable an unsafe high-risk fallback; low-risk stays
  fast; high-risk stays fail-closed by default.
- `mcp-isolation` — stdio placement decision matrix (high-risk→isolated /
  blocked-without-sandbox / explicit-ack-confined); server-risk classification;
  confined bwrap argv shape; **a real isolated stdio process is confined**
  (host secret absent, no network) **and passes stdio through**; **a high-risk
  (credential-bearing) MCP stdio server completes its handshake INSIDE the
  sandbox** (`isIsolated=true`).
- `plugin-risk` — capability tier model (shell/control/browser & secrets→Tier 2;
  net→Tier 1; reads→Tier 0); declared-vs-effective assessment (declared
  shell/control are **membrane-blocked**, declared ≠ authority); permission-aware
  trust request (granted secrets→credential-bearing Tier 2; declared-shell-but-
  granted-fs:read→classified by effective risk, not the declaration).

## 5. Isolation backend results

| Backend | detect() | Verified behavior |
|---|---|---|
| in_process | available | env stripped, time/output bounds (not a boundary) |
| restricted_process | available (non-root) | cwd path-confined, group-kill, env stripped |
| namespace_sandbox (bubblewrap) | **available** | fs confined, net none, env stripped, ulimits, cleanup |
| namespace_sandbox (unshare fallback) | available | user+mount+pid+net namespaces verified via PoC |
| container (docker/podman) | unavailable here | reports unavailable; policy fails closed |

Fail-closed verified: with only in-process + restricted backends, a Tier-2 action
is **blocked** (remediation: install bubblewrap), and the in-process `run()` is
never invoked.

## 6. Adversarial results (all passing)

- Host secret outside the workspace is **absent** inside the sandbox; its value
  never appears in output or the persisted record.
- Network: no routing entries; DNS fails (no route, no `eth0`).
- Ambient host env var set on the host is **not** visible inside; sandbox `PATH`
  is rebuilt to `/usr/bin:/bin`.
- Output over the cap is truncated and raises a boundary event.
- Credential injected into the sandbox (presence observed) is **revoked** after
  the run and **never** present in the serialized execution record.
- Approval granted but high-risk action with no isolated path → `denied`
  (`TRUST_BLOCKED`); `run()` not called.
- Tier-1 fallback config cannot enable an unsafe Tier-2 in-process fallback.

## 7. Secret-redaction results

`redact` removes registered values and generic secret shapes; `assertClean`
throws on leakage; execution records contain env-var **names only**;
`JSON.stringify(record)` never contains the raw secret (asserted in tests).

## 8. Performance (reference host; `scripts/measure-trust-perf.ts`)

- Tier-0 classify+decision (fast-path overhead): **median ~0.01 ms** (n=200).
- Tier-1 restricted-process `echo`: **median ~7.0 ms** (n=30).
- Tier-2 namespace-sandbox `echo` (full startup+teardown): **median ~7.7 ms** (n=30).
- Low-risk path pays no sandbox startup cost; Tier-2 overhead is the price of an
  enforceable boundary and is reported, not hidden.

## 9. Migration / rollback

- 4.1 workspace data opens unchanged; execution `placement` text column accepts
  new kinds; old records lack `trust` and still load (tested).
- Trust metadata round-trips through `record_json` (tested).
- Rollback documented in `MIGRATION_4.1_to_4.2.md`; rollback-safety tested:
  low-risk may use the in-process path, high-risk must remain blocked, and the
  Tier-1 fallback flag cannot enable an unsafe high-risk fallback.

## 10. What is COMPLETE and verified

The **enforceable engine and all in-scope integrations** are done and tested:

- Deterministic risk tiers; fail-closed policy-to-placement; task-scoped
  revocable authority; reference-only credentials with redaction; real
  namespace/container isolation with verification, cleanup, and quarantine.
- Execution-fabric integration (`ExecutionRecord.trust`, `ExecuteOptions.trust`,
  trust gate) — fully additive; 4.1 behavior preserved when trust is absent.
- Kernel DI (`Tokens.Trust`, provider, lifecycle, secret-free health).
- **Shell tool runs in the namespace sandbox** in the full runtime (or blocks).
- **Risk declared/recorded** for file/web/git tools and control actions;
  host-authority actions (GUI/browser/computer-use) admitted with an explicit
  elevated gate (recorded), never treated as low-risk, never wrongly blocked.
- **MCP**: high-risk (credential-bearing) **stdio servers run inside the
  namespace sandbox** for their lifetime (verified end-to-end handshake) and
  **fail closed** without a sandbox unless explicitly acknowledged; low-risk
  stdio keeps the confined spawn; HTTP/SSE are egress-gated (Tier 1).
- **Plugins/skills**: classified by **effective (granted)** permissions;
  hard-boundary capabilities (`shell`/`control`/`browser`) are Tier 2 and
  **membrane-blocked** (declared ≠ authority — the "or blocked" outcome);
  `secrets`→Tier 2 mediated, `net`→Tier 1 egress-gated.
- **UX**: `xr trust` CLI (verified with a real kernel boot); daemon `/api/trust`
  + `/api/trust/classify`; **dashboard Trust & Isolation matrix card**;
  dashboard `/status` trust line.
- Trust metadata durability (repository round-trip) and migration/rollback safety.

## 11. Documented out-of-scope / procedural items (not technical blockers)

1. **Cross-platform Tier-2 backends** (macOS Seatbelt / Windows AppContainer) —
   explicitly out of scope for 4.2 (local Linux isolation phase). Those
   platforms **fail closed** for high-risk actions; this is documented in
   `PLATFORM_SUPPORT.md`, not a silent downgrade.
2. **Running plugin VM code itself inside a kernel namespace** — a future
   hardening. The Phase-3 criterion ("high-risk plugin capabilities use the
   isolation backend **or are blocked**") is satisfied via the **blocked**
   branch: the VM membrane denies raw process/GUI/web authority regardless of
   declaration, and effective risk is computed from granted permissions.
3. **Production rollback drill + human security/release owner sign-off** —
   operational/procedural steps. Rollback **safety** is tested (no unsafe
   high-risk fallback; 4.1 records still load; fail-closed default). An agent
   documents this gate; a human owner formalizes the release.

None of these are silent security downgrades. The core invariant — *high-risk
work (shell/tool/MCP-stdio) is materially constrained by an OS boundary,
verified, and fails closed; plugin hard-boundary capabilities are blocked;
credentials are scoped/redacted/revoked; cleanup is recorded* — holds across the
shell, tool, control, MCP, plugin, and browser paths.

## 12. Final status

All **in-scope, technically-verifiable** Phase 3 acceptance and release criteria
are met and verified (683-test green suite; real adversarial sandbox proofs;
fail-closed; no silent high-risk fallback; credentials never leaked; placement
verified; cleanup recorded; durability + migration/rollback safety; CLI/API/
dashboard visibility; honest documentation of guarantees and limitations). The
remaining items in §11 are out-of-scope (cross-platform), a documented future
hardening already satisfied via the "blocked" branch (plugin-JS-in-namespace),
and the procedural human owner sign-off.

**PHASE 3 COMPLETE — XR 4.2 TRUST AND ISOLATION RELEASE READY**

(Engineering deliverable is technically release-ready. Before an actual
production release, the human security/release owner performs the §11.3 sign-off;
cross-platform Tier-2 backends and in-namespace plugin JS are documented future
work, with those platforms/cases failing closed in the meantime.)
