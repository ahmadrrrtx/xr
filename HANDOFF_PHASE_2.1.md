# Phase 2.1 · Request-trust boundary: Origin, Host, health — HANDOFF

> **RECONSTRUCTED 2026-10-18.** The original file, written 2026-10-17, was lost in a sandbox
> storage reset while it was untracked (same loss class as the 2.3/2.4 reconstruction journals).
> Content below is rebuilt from the authoritative sources that survive: commit `a6bb605` (message +
> stat) and tracker `XR_FIX_TRACKER.md` row 2.1 (ⓒ inlined verbatim evidence column). No fact beyond
> those two sources is invented here. Treat the tracker row as primary.

Date: 2026-10-17 · Branch: `stage-2` · Commit: `a6bb605`

## What shipped (single commit)

`fix(daemon): request-trust boundary — Host gate (421), shared allowed-host set, minimal health,
XR_TRUST_PROXY rate key` — closes `P1-3`, `P1-5`, `P2-21`, `§15#27`.

- One allowed-host set `allowedDaemonHosts()` = `resolveBindHost()` ∪ {localhost, 127.0.0.1, ::1,
  [::1]}; LAN addresses deliberately excluded (those are Phase 2.4's).
- Host gate first in `dispatch`, before auth/open-paths/rate-limit: port-stripped exact match,
  missing Host fails closed, mismatch → **421 Misdirected Request** (RFC 9110 §15.5.21). Bearer
  tokens no longer defeat a spoofed Host (DNS-rebinding posture).
- `originAllowed` compares the Origin hostname against the same set while preserving listener-port
  semantics and the GET/HEAD/OPTIONS/bearer/bootstrap exemptions; missing or foreign Origin → 403.
- Rate limiter keys on the real socket peer (`server.requestIP` threaded through fetch/handle/
  dispatch; `"local"` fallback for in-process callers); `x-forwarded-for` is only honoured when
  the operator opts in with `XR_TRUST_PROXY=1` (§15#27 both modes tested).
- Unauthenticated health probe (both mounts) → `{ok, ts}` only (contract change): `HealthResponse`
  schema, `openapi.json` and the generated client regenerated; api:compat green.

## Evidence ledger (per tracker row 2.1)

- `test/daemon/origin-host-guard.test.ts` — **12 tests**: Host matrix ×3 auth kinds (token must not
  override a 421), Origin 200(127.0.0.1)/200(localhost)/200([::1])/403(evil)/403(missing), 5th
  open-path latch (health ×2, auth.js, telegram/discord webhooks ≠ 421), health `{ok,ts}` only.
- Fail-before proof: `git stash push -- src/` → **11/12 fail → 12/12 pass**.
- Live after-probes: localhost=200, evil-Host=421 (bearer + unauth open path), localhost-origin=200,
  health has no name/version, dashboard 200.
- Contract: `api:schema:check` / `client:check` / `api:compat` ✓; HealthResponse callers in
  `test/api/client.test.ts` baseUrl fixed to loopback for the gate.
- src/ net **+47** (≤60 budget) · root `bun test` **4,439p/19s/0f/409 files**
  (TEST-BASELINE.json re-measured; commit field stays `ec672fe` = phase base).
- typecheck ✓ · `bun run ci` 19/19.

## Notes for successors

- The allowed-host set lives in `server.ts` next to `resolveBindHost`; Phase 2.4 extends the set
  with LAN hosts only when the LAN runtime is active (`lanExtraHosts`).
- `PeerLookup` threading (`fetch(req, server)` → handle → dispatch) is the seam 2.4 reused for the
  mobile auth fall-through; keep requestIP a first-class input, never an XFF default.
